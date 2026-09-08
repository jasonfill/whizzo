-- ---------------------------------------------------------------------------
-- Three kinds of code, not two
-- ---------------------------------------------------------------------------
-- 0021 gave both pairing systems one entry box, and resolved a typed code to
-- 'connection' or 'invite'. That was one distinction short.
--
-- `link_invites.purpose` carries two quite different operations under the same
-- eight characters. A 'guardian' invite hands another grown-up sight of a
-- child. A 'self_login' invite hands a 13+ learner *their own profile* — it
-- sets learners.auth_user_id and auth_kind='self', creates no guardian link at
-- all, and cannot be undone from the app.
--
-- Describing the second as the first told a teenager they were about to gain
-- oversight of somebody called Ada, when Ada is who they are about to become.
-- A consent screen that describes the wrong operation is worse than no consent
-- screen, because the person stops reading and trusts it.
--
-- So purpose reaches the surface, and the box can say what will actually happen.

create or replace function public.describe_any_code(p_code text)
returns table (
  /**
   * 'connection' | 'invite' | 'self_login' | 'unknown'.
   *
   * 'invite' and 'self_login' are both rows in link_invites; they are separate
   * here because they are separate operations, and only the caller's screen
   * can tell the difference to the person reading it.
   */
  kind               text,
  valid              boolean,
  reason             text,
  owner_name         text,
  /** The tutor's own note, or for either invite the learner it is about. */
  label              text,
  role               text,
  can_manage_content boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  cc     public.connection_codes%rowtype;
  inv    public.link_invites%rowtype;
  v_kind text;
  v_owner_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- Connection codes first: they are the standing ones, so a stale invite that
  -- happened to collide would not shadow a code still in use.
  select * into cc from public.connection_codes c where c.code = v_code;

  if found then
    if cc.revoked_at is not null then
      return query select 'connection', false, 'That code has been withdrawn',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if cc.expires_at is not null and cc.expires_at < now() then
      return query select 'connection', false, 'That code has expired',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if cc.max_uses is not null and cc.uses >= cc.max_uses then
      return query select 'connection', false, 'That code has been used up',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if cc.owner_id = auth.uid() then
      -- Said here rather than at redemption, so nobody picks children for a
      -- link that was never going to be made.
      return query select 'connection', false, 'That is your own code — give it to the family you work with',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;

    -- Looked up separately rather than joined: a code whose owner somehow has
    -- no profile row is still a usable code, and the join version of this
    -- returned nothing at all, which the caller then read as "does not exist".
    select coalesce(p.display_name, 'A grown-up') into v_owner_name
      from public.profiles p where p.id = cc.owner_id;

    return query select 'connection', true, null::text,
                        coalesce(v_owner_name, 'A grown-up'),
                        cc.label, cc.role, cc.can_manage_content;
    return;
  end if;

  select * into inv from public.link_invites i where i.code = v_code;

  if found then
    v_kind := case when inv.purpose = 'self_login' then 'self_login' else 'invite' end;

    if inv.redeemed_at is not null then
      return query select v_kind, false, 'That code has already been used',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if inv.expires_at <= now() then
      return query select v_kind, false, 'That code has expired — ask them for a new one',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if inv.created_by = auth.uid() then
      return query select v_kind, false, 'That is your own code — give it to the person it is for',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;

    -- Both kinds are about one named child, and the person accepting is about
    -- to be tied to them one way or the other. Saying whose name is on it is
    -- the whole point of looking before you leap.
    --
    -- can_manage_content is false for a self_login code, not because of a
    -- setting but because no guardian link is created at all: the learner
    -- becomes the account rather than gaining rights over it.
    return query
      select v_kind, true, null::text,
             coalesce(p.display_name, 'A grown-up'),
             l.display_name,
             inv.role,
             v_kind = 'invite'
        from public.learners l
        left join public.profiles p on p.id = inv.created_by
       where l.id = inv.learner_id;
    return;
  end if;

  return query select 'unknown', false, 'That code does not exist',
                      null::text, null::text, null::text, null::boolean;
end;
$$;

comment on function public.describe_any_code(text) is
  'Resolve a pairing code of any kind, so one entry box can serve every flow.';

-- ---------------------------------------------------------------------------
-- The preview and the redemption agree
-- ---------------------------------------------------------------------------
-- describe_any_code refuses a code you minted yourself; redeem_link_invite did
-- not, so the rule lived only in the preview — which is exactly the layer that
-- anything other than our own screen skips. Redeeming your own invite was
-- harmless (a guardian link from an owner to their own learner) but it burned
-- the single use, and a guard that only one caller honours is not a guard.

create or replace function public.redeem_link_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.link_invites;
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming an invite' using errcode = 'insufficient_privilege';
  end if;

  select * into inv
  from public.link_invites
  where code = upper(btrim(p_code))
  for update;

  if not found or inv.redeemed_at is not null or inv.expires_at <= now() then
    -- One message for all three cases: a redeemer should not learn whether a
    -- code exists, only that this one did not work.
    raise exception 'That code is not valid any more' using errcode = 'check_violation';
  end if;

  -- Said separately, because unlike the three above it is not a secret: you
  -- already know this code exists, having just minted it.
  if inv.created_by = auth.uid() then
    raise exception 'That is your own code — give it to the person it is for'
      using errcode = 'check_violation';
  end if;

  if inv.purpose = 'guardian' then
    insert into public.guardian_links (guardian_id, learner_id, role)
    values (auth.uid(), inv.learner_id, inv.role)
    on conflict (guardian_id, learner_id) do nothing;
  else
    -- Attaching the learner's own identity. The age gate in learners_guard()
    -- still runs and will reject an under-13.
    perform set_config('app.learner_guard', 'off', true);
    update public.learners
       set auth_user_id = auth.uid(),
           auth_kind    = 'self'
     where id = inv.learner_id;
    perform set_config('app.learner_guard', 'on', true);
  end if;

  update public.link_invites
     set redeemed_at = now(), redeemed_by = auth.uid()
   where code = inv.code;

  return inv.learner_id;
end;
$$;
