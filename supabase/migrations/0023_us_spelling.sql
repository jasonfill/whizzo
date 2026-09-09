-- US spelling, all the way down.
--
-- The prose was converted in place; this is the half that cannot be, because
-- these strings are already sitting in rows: statuses, a planner session's
-- purpose, a tutored round's mode. Code and database have to cross over
-- together, so each one here drops its CHECK, rewrites the data, and puts the
-- constraint back in the new vocabulary.
--
-- Written to be re-runnable like every migration in this directory: dropping a
-- constraint that is already gone and updating rows that are already converted
-- are both no-ops the second time.
--
-- Deliberately NOT edited: the migrations that created these constraints. They
-- are the historical record, they are checksummed, and rewriting an applied
-- file only makes the ledger lie about what ran.

-- --------------------------------------------------------------------------
-- 'cancelled' -> 'canceled', in three places that each mean something else.
-- --------------------------------------------------------------------------
alter table public.assignments drop constraint if exists assignments_status_check;
update public.assignments set status = 'canceled' where status = 'cancelled';
alter table public.assignments
  add constraint assignments_status_check check (status in ('open', 'done', 'canceled'));

alter table public.subscriptions drop constraint if exists subscriptions_status_check;
update public.subscriptions set status = 'canceled' where status = 'cancelled';
alter table public.subscriptions
  add constraint subscriptions_status_check check (status in ('active', 'past_due', 'canceled'));

-- Rewards carry two constraints that name the status, not one.
alter table public.rewards drop constraint if exists rewards_status_check;
alter table public.rewards drop constraint if exists rewards_earned_has_evidence;
update public.rewards set status = 'canceled' where status = 'cancelled';
alter table public.rewards
  add constraint rewards_status_check check (status in
    ('offered', 'earned', 'claimed', 'fulfilled', 'canceled', 'expired'));
-- Unchanged in meaning: earned still means evidence exists. 'fulfilled' is
-- spelled the same on both sides of the Atlantic and stays as it is.
alter table public.rewards
  add constraint rewards_earned_has_evidence check (
    status in ('offered', 'canceled', 'expired')
    or (earned_at is not null and evidence is not null)
  );

-- --------------------------------------------------------------------------
-- The planner's session purpose, and the tutor's round mode.
-- --------------------------------------------------------------------------
alter table public.planner_items drop constraint if exists planner_items_purpose_check;
update public.planner_items set purpose = 'organize' where purpose = 'organise';
update public.planner_items set purpose = 'practice' where purpose = 'practise';
alter table public.planner_items
  add constraint planner_items_purpose_check check (
    purpose is null or purpose in ('organize', 'practice', 'prove', 'review')
  );

alter table public.mcp_rounds drop constraint if exists mcp_rounds_mode_check;
update public.mcp_rounds set mode = 'practice' where mode = 'practise';
alter table public.mcp_rounds
  add constraint mcp_rounds_mode_check check (mode in ('practice', 'study', 'test', 'review'));

-- --------------------------------------------------------------------------
-- History reads back through the same vocabulary the screens use.
--
-- planner_events is append-only and nobody updates it — except here, once,
-- because a timeline that says a card's purpose was 'practise' next to a card
-- that says 'practice' is the same drift this migration exists to end. The
-- trigger that writes it was already converted with the rest of the code.
-- --------------------------------------------------------------------------
update public.planner_events
   set before = jsonb_set(before, '{purpose}',
         to_jsonb(replace(replace(before ->> 'purpose', 'organise', 'organize'),
                          'practise', 'practice')))
 where before ? 'purpose' and before ->> 'purpose' in ('organise', 'practise');

update public.planner_events
   set after = jsonb_set(after, '{purpose}',
         to_jsonb(replace(replace(after ->> 'purpose', 'organise', 'organize'),
                          'practise', 'practice')))
 where after ? 'purpose' and after ->> 'purpose' in ('organise', 'practise');

-- --------------------------------------------------------------------------
-- Free-text, so no constraint to move: a deck tagged 'maths' is now 'math'.
-- --------------------------------------------------------------------------
update public.decks
   set tags = array_replace(tags, 'maths', 'math')
 where 'maths' = any(tags);
