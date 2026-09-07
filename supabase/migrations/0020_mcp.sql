-- ---------------------------------------------------------------------------
-- MCP: the app as tools for an assistant the family already pays for
-- ---------------------------------------------------------------------------
-- docs/mcp-tutor-spec.md. A parent connects Whizzo to Claude or ChatGPT; the
-- assistant runs practice rounds through our tools; the answers land in
-- `attempts` as verified evidence, because the server graded them.
--
-- Five tables and one column, all additive:
--
--   * `mcp_clients`        — OAuth clients, registered dynamically or by URL.
--   * `mcp_grants`         — "this user let this client act for these
--                            learners". The revoke button is a timestamp here.
--   * `mcp_auth_codes`     — single-use codes, ten minutes, deleted on use.
--   * `mcp_refresh_tokens` — rotated on every use; reuse revokes the family.
--   * `mcp_rounds`         — a round in progress. Server-held, because the
--                            assistant's context is not storage and a round
--                            must be written whether or not the conversation
--                            that started it ever comes back.
--   * `attempts.channel`   — where an attempt came from. A column rather than
--                            a meta key for the reason `verified` is one:
--                            comparing the two kinds of evidence should not
--                            need parsing.
--
-- Nothing here is ever visible to a browser session. The OAuth and round
-- tables have RLS on and no policies; the API reaches them through its
-- connecting role. `mcp_grants` is the exception: the owner may read and
-- revoke their own, which is what the Connected apps screen does.
--
-- Idempotent, like every migration here.

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_clients (
  id              text        primary key,   -- a uuid for DCR; the document URL for CIMD
  kind            text        not null,
  name            text        not null,
  redirect_uris   text[]      not null,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz,
  constraint mcp_clients_kind_check check (kind in ('dcr', 'cimd'))
);

comment on table public.mcp_clients is
  'OAuth clients that may ask for a grant: registered dynamically (RFC 7591) or by Client ID Metadata Document URL.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_grants (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  client_id          text        not null references public.mcp_clients (id) on delete cascade,
  -- Which assistant, from the client's own identification. For the Family
  -- line and for the one question data should answer: which one families use.
  client_label       text        not null default 'other',
  -- The learners this grant may act for, chosen at consent. RLS still decides
  -- what the user can reach; this narrows it to what they agreed to share.
  learner_ids        uuid[]      not null,
  -- The learner tools default to when none is named. Set by `select_learner`,
  -- or at consent when there is exactly one.
  current_learner_id uuid        references public.learners (id) on delete set null,
  scope              text        not null default 'tutor',
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  constraint mcp_grants_learners_nonempty check (cardinality(learner_ids) > 0)
);

create index if not exists mcp_grants_user_idx on public.mcp_grants (user_id, revoked_at);

comment on table public.mcp_grants is
  'One row per connection a user approved: which client, for which learners. Revoking is setting revoked_at; nothing is deleted.';

-- ---------------------------------------------------------------------------
-- Authorization codes and refresh tokens
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_auth_codes (
  code_hash       text        primary key,
  grant_id        uuid        not null references public.mcp_grants (id) on delete cascade,
  client_id       text        not null,
  redirect_uri    text        not null,
  code_challenge  text        not null,          -- S256 only
  resource        text        not null,
  expires_at      timestamptz not null
);

create table if not exists public.mcp_refresh_tokens (
  token_hash      text        primary key,
  grant_id        uuid        not null references public.mcp_grants (id) on delete cascade,
  -- Every rotation stays in the family it started in. Presenting a token
  -- that was already spent revokes the whole family (OAuth 2.1 §4.3.1).
  family          uuid        not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists mcp_refresh_family_idx on public.mcp_refresh_tokens (family);

-- ---------------------------------------------------------------------------
-- Rounds
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_rounds (
  id              uuid        primary key default gen_random_uuid(),
  grant_id        uuid        not null references public.mcp_grants (id) on delete cascade,
  learner_id      uuid        not null references public.learners (id) on delete cascade,
  deck_id         uuid,
  mode            text        not null,
  -- The planned cards, rungs and scaffolds. This is the one place the answer
  -- sides sit next to an open question, which is why nothing but the API
  -- can read it.
  plan            jsonb       not null,
  -- The attempts so far. A buffer, not the record: on close they are written
  -- as rows through the same insert the app's rounds use. The buffer is what
  -- makes an abandoned round recoverable rather than lost.
  answers         jsonb       not null default '[]'::jsonb,
  started_at      timestamptz not null default now(),
  last_answer_at  timestamptz,
  ended_at        timestamptz,
  session_id      uuid        references public.sessions (id) on delete set null,
  constraint mcp_rounds_mode_check check (mode in ('practise', 'study', 'test', 'review'))
);

create index if not exists mcp_rounds_open_idx on public.mcp_rounds (grant_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.mcp_clients        enable row level security;
alter table public.mcp_grants         enable row level security;
alter table public.mcp_auth_codes     enable row level security;
alter table public.mcp_refresh_tokens enable row level security;
alter table public.mcp_rounds         enable row level security;

-- The owner sees and revokes their own grants. Nothing else about a grant is
-- theirs to change from a browser: the learners it covers were agreed at
-- consent, and widening them is a new consent.
drop policy if exists mcp_grants_select_own on public.mcp_grants;
create policy mcp_grants_select_own on public.mcp_grants
  for select using (user_id = (select auth.uid()));

drop policy if exists mcp_grants_revoke_own on public.mcp_grants;
create policy mcp_grants_revoke_own on public.mcp_grants
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Clients are readable so the Connected apps screen can name them.
drop policy if exists mcp_clients_select_all on public.mcp_clients;
create policy mcp_clients_select_all on public.mcp_clients
  for select using (true);

grant select, update on public.mcp_grants  to authenticated;
grant select         on public.mcp_clients to authenticated;

-- ---------------------------------------------------------------------------
-- Where an attempt came from
-- ---------------------------------------------------------------------------
alter table public.attempts
  add column if not exists channel text not null default 'app';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attempts_channel_check') then
    alter table public.attempts
      add constraint attempts_channel_check check (channel in ('app', 'mcp'));
  end if;
end;
$$;

comment on column public.attempts.channel is
  'app = recorded by the app; mcp = a tutor round run through an assistant (docs/mcp-tutor-spec.md). Server-set.';

-- ---------------------------------------------------------------------------
-- A tutor round closes a Learn task
-- ---------------------------------------------------------------------------
-- Same function as 0009, with one clause: a task set for `learn` on a deck is
-- satisfied by a `tutor` session on that deck that asked questions. Learn and
-- Tutor are the same container asking at the same per-card rungs, and a
-- parent who set "Learn Chapter 4" and finds it not done after the child
-- spent twenty minutes doing it with Claude has been told something false.
-- The guard is `meta.complete`: the round was seen through to its last
-- card. A round ended early, or by half an hour of silence, still writes its
-- session — the answers are real — but it is not a task done, any more than
-- closing the app after the second card is. A study round writes no session
-- at all, and the rule is stated here anyway, because a closer that trusts
-- its callers is a closer that will be wrong one day.
create or replace function public.complete_matching_assignments(
  p_learner_id uuid,
  p_session_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.sessions%rowtype;
  checked numeric;
  closed  int;
begin
  if not public.can_access_learner(p_learner_id) then
    raise exception 'Not allowed to record work for that learner'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.sessions
   where id = p_session_id and learner_id = p_learner_id;
  if not found then
    return 0;
  end if;

  checked := case
    when s.verified_items_total > 0
      then (s.verified_items_correct::numeric * 100) / s.verified_items_total
    else null
  end;

  with matched as (
    select a.id
      from public.assignments a
      join public.assignment_sets t on t.id = a.set_id
     where a.learner_id  = p_learner_id
       and a.status      = 'open'
       and t.subject     = s.subject
       and (t.activity   = s.activity
            or (t.activity = 'learn' and s.activity = 'tutor'
                and coalesce((s.meta ->> 'complete')::boolean, false)))
       and (t.target_id is null or t.target_id is not distinct from s.list_id)
       and (t.min_accuracy is null or checked >= t.min_accuracy)
  )
  update public.assignments a
     set status       = 'done',
         completed_at = coalesce(s.ended_at, now()),
         session_id   = s.id
    from matched m
   where a.id = m.id;

  get diagnostics closed = row_count;
  return closed;
end;
$$;
