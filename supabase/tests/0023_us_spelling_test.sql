-- ============================================================================
-- US spelling (0023).
--
-- Migration 0023 rebuilt five CHECK constraints and rewrote the rows behind
-- them. The unit suite mocks `pg`, so nothing there can tell whether a
-- constraint came back correctly — a dropped constraint that was never re-added
-- looks exactly like a passing test until a bad write reaches production.
--
-- So this asserts three things per constraint, against the catalog and the data
-- rather than against fixtures:
--
--   * the constraint exists at all (it was dropped on the way through)
--   * it names the US spelling
--   * it no longer names the British one
--
-- and then that no row anywhere is still holding an old value.
--
-- Run against a scratch database with every migration applied:
--   psql -f supabase/tests/0023_us_spelling_test.sql
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL % — expected %, got %', p_label, p_want, p_got;
  end if;
  raise notice 'pass: %', p_label;
end;
$$;

/**
 * A constraint says the new word and not the old one — and exists, which is the
 * failure mode a spelling migration actually has.
 */
create or replace function pg_temp.check_constraint(
  p_label text, p_name text, p_us text, p_uk text
) returns void language plpgsql as $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = p_name;
  if def is null then
    raise exception 'FAIL % — constraint % does not exist; 0023 dropped it and did not put it back', p_label, p_name;
  end if;
  if position(p_us in def) = 0 then
    raise exception 'FAIL % — % does not allow %: %', p_label, p_name, p_us, def;
  end if;
  if position(p_uk in def) > 0 then
    raise exception 'FAIL % — % still allows %: %', p_label, p_name, p_uk, def;
  end if;
  raise notice 'pass: %', p_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- The constraints 0023 rebuilt.
-- ---------------------------------------------------------------------------
select pg_temp.check_constraint(
  'assignments accept canceled', 'assignments_status_check', 'canceled', 'cancelled');

select pg_temp.check_constraint(
  'subscriptions accept canceled', 'subscriptions_status_check', 'canceled', 'cancelled');

select pg_temp.check_constraint(
  'rewards accept canceled', 'rewards_status_check', 'canceled', 'cancelled');

-- Dropped alongside the status check because it names the status too, and the
-- easiest thing to lose in a migration is the second constraint on one table.
select pg_temp.check_constraint(
  'rewards still require evidence to be earned',
  'rewards_earned_has_evidence', 'canceled', 'cancelled');

select pg_temp.check_constraint(
  'planner purpose is organize', 'planner_items_purpose_check', 'organize', 'organise');
select pg_temp.check_constraint(
  'planner purpose is practice', 'planner_items_purpose_check', 'practice', 'practise');

select pg_temp.check_constraint(
  'tutor round mode is practice', 'mcp_rounds_mode_check', 'practice', 'practise');

-- The reward status vocabulary is otherwise untouched: 'fulfilled' is spelled
-- the same on both sides of the Atlantic and must not have been "corrected".
select pg_temp.check(
  'rewards still allow fulfilled',
  (select position('fulfilled' in pg_get_constraintdef(oid)) > 0
     from pg_constraint where conname = 'rewards_status_check'),
  true);

-- ---------------------------------------------------------------------------
-- And no row is still holding an old value. A constraint only guards writes
-- from here on; these are what 0023 had to convert.
-- ---------------------------------------------------------------------------
select pg_temp.check('no assignment is cancelled',
  (select count(*) from public.assignments where status = 'cancelled'), 0::bigint);

select pg_temp.check('no subscription is cancelled',
  (select count(*) from public.subscriptions where status = 'cancelled'), 0::bigint);

select pg_temp.check('no reward is cancelled',
  (select count(*) from public.rewards where status = 'cancelled'), 0::bigint);

select pg_temp.check('no planner card is organise or practise',
  (select count(*) from public.planner_items where purpose in ('organise', 'practise')), 0::bigint);

select pg_temp.check('no tutored round is practise',
  (select count(*) from public.mcp_rounds where mode = 'practise'), 0::bigint);

-- History is read back through the same vocabulary the screens use, so the
-- JSONB rewrite has to have landed too.
select pg_temp.check('no planner event remembers a British purpose',
  (select count(*) from public.planner_events
    where (before ->> 'purpose') in ('organise', 'practise')
       or (after  ->> 'purpose') in ('organise', 'practise')), 0::bigint);

select pg_temp.check('no deck is tagged maths',
  (select count(*) from public.decks where 'maths' = any(tags)), 0::bigint);

\echo ''
\echo 'US spelling (0023): all checks passed.'
