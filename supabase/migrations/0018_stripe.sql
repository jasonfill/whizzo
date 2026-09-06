-- ---------------------------------------------------------------------------
-- Stripe: the payment provider behind the coverage model
-- ---------------------------------------------------------------------------
-- 0013 built the whole coverage model and deliberately wired no provider: what
-- could not wait was the meter, and what could wait was the till. This is the
-- till.
--
-- Nothing about the model changes here. `is_learner_covered` still asks the
-- same question of the same two tables; all that arrives is a way for rows to
-- get into them that does not involve somebody running SQL by hand.
--
-- Three things are added, and each exists because of a specific way payment
-- integrations go wrong:
--
--  1. `checkout_intents` — what a checkout was *for*. Stripe hands back a
--     session, not a list of children, and metadata is a 500-character string
--     nobody can join on. Recording the intent before redirecting means the
--     webhook has something authoritative to reconcile against instead of
--     parsing a comma-separated list out of a text field.
--
--  2. `processed_stripe_events` — webhooks are at-least-once. Stripe retries
--     for three days on any non-2xx, and a duplicate `checkout.session.completed`
--     without this is a second subscription row for a family that bought once.
--
--  3. `subscriptions.provider_*` already existed; what was missing was a unique
--     index on `provider_sub_id`, without which the retry above inserts happily.
--
-- See docs/billing-spec.md.

-- ---------------------------------------------------------------------------
-- What a checkout was for
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_intents (
  id                uuid        primary key default gen_random_uuid(),
  payer_id          uuid        not null references auth.users (id) on delete cascade,
  -- The children this checkout would cover. Not a foreign key array by
  -- accident: it is deliberately a snapshot. If a learner is deleted between
  -- redirect and webhook, the intent should still describe what was bought
  -- rather than silently shrinking.
  learner_ids       uuid[]      not null,
  provider_session_id text      unique,
  -- Set when the webhook has acted on it. A second delivery finds this already
  -- stamped and does nothing.
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint checkout_intents_some_learners check (cardinality(learner_ids) > 0)
);

create index if not exists checkout_intents_payer_idx
  on public.checkout_intents (payer_id, created_at desc);

comment on table public.checkout_intents is
  'What a Stripe checkout was for. The webhook reconciles against this rather than against metadata.';

-- ---------------------------------------------------------------------------
-- Webhook idempotency
-- ---------------------------------------------------------------------------
-- Stripe retries any delivery that does not return 2xx, for up to three days.
-- Every handler here is written to be safe to run twice, and this table is the
-- belt to that pair of braces: the cheapest possible "have I seen this?".
create table if not exists public.processed_stripe_events (
  id           text        primary key,   -- Stripe's own event id, evt_...
  type         text        not null,
  processed_at timestamptz not null default now()
);

comment on table public.processed_stripe_events is
  'Seen webhook event ids. Stripe delivers at least once; this makes handling exactly once.';

-- ---------------------------------------------------------------------------
-- Subscriptions: the constraint that makes a retry harmless
-- ---------------------------------------------------------------------------
-- Without this, the retried `checkout.session.completed` above inserts a second
-- row for the same Stripe subscription and the family is billed once but
-- recorded twice — and `learner_coverage` then has two candidate parents.
create unique index if not exists subscriptions_provider_sub_idx
  on public.subscriptions (provider_sub_id) where provider_sub_id is not null;

-- A payer has at most one Stripe customer. Looking it up by scanning is fine at
-- this size, but the uniqueness is a real invariant: two customer records for
-- one person is how somebody ends up with two subscriptions and one of them
-- invisible.
create unique index if not exists subscriptions_provider_customer_idx
  on public.subscriptions (provider_customer_id) where provider_customer_id is not null;

-- ---------------------------------------------------------------------------
-- Reading your own billing
-- ---------------------------------------------------------------------------
-- The API writes through the service role; these policies exist so the SPA can
-- *read* what it is paying for without a round trip through a route that would
-- only be re-implementing a select.
--
-- Deliberately read-only, and deliberately not writable: coverage is granted by
-- a webhook that verified a signature from Stripe. A client that could insert
-- into `learner_coverage` could grant itself the paid feature set.

alter table public.checkout_intents enable row level security;

drop policy if exists checkout_intents_select on public.checkout_intents;
create policy checkout_intents_select on public.checkout_intents
  for select using (payer_id = auth.uid());

alter table public.processed_stripe_events enable row level security;
-- No policy at all: nothing outside the service role has any business reading
-- the webhook log, and an RLS-enabled table with no policy denies everyone.

grant select on public.checkout_intents to authenticated;

-- ---------------------------------------------------------------------------
-- Coverage, moved by the webhook only
-- ---------------------------------------------------------------------------
-- One function so that "grant coverage" is a single auditable act rather than
-- an insert scattered across three handlers. Runs as definer because the caller
-- is a webhook with no user context.
--
-- `on conflict do update` rather than `do nothing`: a child moved from a lapsed
-- subscription to a new one should end up on the new one. The primary key on
-- `learner_id` still guarantees they are on exactly one.
create or replace function public.grant_coverage(
  p_subscription uuid,
  p_learners uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  granted integer;
begin
  insert into public.learner_coverage (learner_id, subscription_id)
  select unnest(p_learners), p_subscription
  on conflict (learner_id) do update
    set subscription_id = excluded.subscription_id,
        since = now();
  get diagnostics granted = row_count;
  return granted;
end;
$$;

comment on function public.grant_coverage(uuid, uuid[]) is
  'Grant or move coverage for a set of learners. Called by the Stripe webhook only.';

-- Ending a subscription does not end the record it paid for. Coverage rows are
-- removed so `is_learner_covered` goes false; nothing a learner made is touched,
-- because deleting a child''s work for non-payment is not a business model.
create or replace function public.revoke_coverage(p_subscription uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.learner_coverage where subscription_id = p_subscription;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.revoke_coverage(uuid) is
  'Drop coverage when a subscription ends. Removes access, never content.';
