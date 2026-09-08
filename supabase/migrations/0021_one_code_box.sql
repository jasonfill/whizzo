-- ---------------------------------------------------------------------------
-- One box for both kinds of code
-- ---------------------------------------------------------------------------
-- There are two pairing systems, and they are both right:
--
--   link_invites      a parent mints a code *for one child* and hands it to
--                     another grown-up. The redeemer gains access.
--   connection_codes  a tutor mints a code *for themselves* and hands it to a
--                     family. The redeemer grants access.
--
-- The arrow runs opposite ways on purpose (see 0010). What went wrong is that
-- both are eight characters from the same alphabet, so nothing on the paper
-- says which one you are holding — and each entry box rejected the other
-- kind with "that code is not valid any more". The codes were fine. The box
-- was wrong, and there was no way for the person typing to know that.
--
-- So the code says what it is, and the app decides where it goes.

create or replace function public.describe_any_code(p_code text)
returns table (
  /** 'connection' | 'invite' | 'unknown' — which flow this code belongs to. */
  kind               text,
  valid              boolean,
  reason             text,
  owner_name         text,
  /** The tutor's own note, or for an invite the learner it is about. */
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
    if inv.redeemed_at is not null then
      return query select 'invite', false, 'That code has already been used',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if inv.expires_at <= now() then
      return query select 'invite', false, 'That code has expired — ask them for a new one',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;
    if inv.created_by = auth.uid() then
      return query select 'invite', false, 'That is your own code — give it to the other grown-up',
                          null::text, null::text, null::text, null::boolean;
      return;
    end if;

    -- An invite is about one named child, and the person accepting is about to
    -- be able to see them. Saying whose progress they are taking on is the
    -- whole point of looking before you leap.
    return query
      select 'invite', true, null::text,
             coalesce(p.display_name, 'A grown-up'),
             l.display_name,
             inv.role,
             true
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
  'Resolve a pairing code of either kind, so one entry box can serve both flows.';

-- ---------------------------------------------------------------------------
-- Honest refusals
-- ---------------------------------------------------------------------------
-- Every `raise exception` below used to leave as P0001, which fromDatabaseError
-- does not map — so "that is your own code" reached the browser as HTTP 500,
-- "Something went wrong on our side". The rules have not changed; only whether
-- the person on the other end is allowed to hear them.

create or replace function public.redeem_connection_code(
  p_code       text,
  p_learner_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.connection_codes%rowtype;
begin
  if not public.owns_learner(p_learner_id) then
    raise exception 'Only the grown-up who owns this learner can connect a tutor to them'
      using errcode = 'insufficient_privilege';
  end if;

  select * into c from public.connection_codes
   where code = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'That code does not exist' using errcode = 'check_violation';
  end if;
  if c.revoked_at is not null then
    raise exception 'That code has been withdrawn' using errcode = 'check_violation';
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    raise exception 'That code has expired' using errcode = 'check_violation';
  end if;
  if c.max_uses is not null and c.uses >= c.max_uses then
    raise exception 'That code has been used up' using errcode = 'check_violation';
  end if;
  if c.owner_id = auth.uid() then
    raise exception 'That is your own code' using errcode = 'check_violation';
  end if;

  insert into public.guardian_links (guardian_id, learner_id, role, can_manage_content)
  values (c.owner_id, p_learner_id, c.role, c.can_manage_content)
  on conflict (guardian_id, learner_id) do nothing;

  -- Only a link that is actually new counts against a limited code, so a
  -- family re-entering the code does not burn a seat.
  if found then
    update public.connection_codes set uses = uses + 1 where code = c.code;
  end if;

  return c.owner_id::text;
end;
$$;

grant execute on function public.describe_any_code(text) to authenticated;
