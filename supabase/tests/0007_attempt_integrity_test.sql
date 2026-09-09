-- ============================================================================
-- Integrity tests for the audit trail (0006 and 0007).
--
-- `attempts` is the row everything else is derived from, and it is what a
-- parent reads when they want to know what a score was made of. These assert
-- the properties that make it worth trusting, all of which are one careless
-- grant away from being untrue:
--
--   * a learner can add to their history and never revise it
--   * a grown-up linked to them can read it
--   * a stranger cannot
--   * mastery rebuilt from the trail counts only checked answers
--   * erasing progress is the owner's to do, not the child's
--
-- Run against a scratch database with 0001-0007 applied:
--   psql -f supabase/tests/0007_attempt_integrity_test.sql
-- Any failure raises, so a non-zero exit means the schema regressed.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end;
$$;

create or replace function pg_temp.check(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL % — expected %, got %', p_label, p_want, p_got;
  end if;
  raise notice 'pass: %', p_label;
end;
$$;

create or replace function pg_temp.check_denied(p_label text, p_sql text, p_match text default '')
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_match <> '' and position(lower(p_match) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL % — denied, but for the wrong reason: %', p_label, sqlerrm;
    end if;
    raise notice 'pass: % (denied: %)', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL % — the statement was allowed and should not have been', p_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: a parent who owns the profile, the teenager who practices on it
-- and signs in themselves, and an unrelated stranger.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'integrity-parent@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'integrity-teen@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'integrity-stranger@example.com')
on conflict (id) do nothing;

\set parent   '''eeeeeeee-0000-0000-0000-000000000001'''
\set teen     '''eeeeeeee-0000-0000-0000-000000000002'''
\set stranger '''eeeeeeee-0000-0000-0000-000000000003'''
\set kid      '''eeeeeeee-0000-0000-0000-00000000000a'''
\set round    '''eeeeeeee-0000-0000-0000-00000000000b'''

set role authenticated;
select pg_temp.become(:parent);

insert into public.learners (id, owner_id, auth_user_id, auth_kind, display_name, birth_year)
values (:kid::uuid, :parent::uuid, :teen::uuid, 'self', 'Integrity Kid',
        extract(year from current_date)::int - 14)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The shape of a session: provenance is recorded alongside the score.
-- ---------------------------------------------------------------------------
insert into public.sessions
  (id, learner_id, subject, activity, items_total, items_correct, accuracy,
   evidence, verified_items_total, verified_items_correct)
values (:round::uuid, :kid::uuid, 'quiz', 'learn', 2, 1, 50, 'attempts', 1, 0)
on conflict (id) do nothing;

select pg_temp.check('a session records where its numbers came from',
  (select evidence from public.sessions where id = :round::uuid), 'attempts');

select pg_temp.check_denied('evidence cannot be an arbitrary string',
  'update public.sessions set evidence = ''vibes'' where id = ' || quote_literal(:round) || '::uuid',
  'sessions_evidence_check');

-- ---------------------------------------------------------------------------
-- The child's own account: append, never revise.
-- ---------------------------------------------------------------------------
select pg_temp.become(:teen);

insert into public.attempts
  (learner_id, session_id, subject, item_key, activity, is_test, verified, correct, difficulty)
values
  (:kid::uuid, :round::uuid, 'quiz', 'card-A', 'learn',      true, true,  false, 3),
  (:kid::uuid, :round::uuid, 'quiz', 'card-B', 'flashcards', true, false, true,  3),
  (:kid::uuid, :round::uuid, 'quiz', 'card-A', 'learn',      true, true,  true,  3);

select pg_temp.check('a learner can record their own answers',
  (select count(*)::int from public.attempts where learner_id = :kid::uuid), 3);

select pg_temp.check('and can read their own history back',
  (select count(*)::int from public.attempts where session_id = :round::uuid), 3);

-- The two that matter. A child who can edit their history can manufacture any
-- claim about it, which would make every number downstream worthless.
select pg_temp.check_denied('a learner cannot rewrite an answer',
  'update public.attempts set correct = true where learner_id = ' || quote_literal(:kid) || '::uuid',
  'permission denied');

select pg_temp.check_denied('a learner cannot delete an answer',
  'delete from public.attempts where learner_id = ' || quote_literal(:kid) || '::uuid',
  'permission denied');

select pg_temp.check_denied('a learner cannot erase the profile''s progress',
  'select public.erase_learner_progress(' || quote_literal(:kid) || '::uuid)',
  'owner');

-- ---------------------------------------------------------------------------
-- Who may read it
-- ---------------------------------------------------------------------------
select pg_temp.become(:parent);
select pg_temp.check('the grown-up who owns the profile can read the history',
  (select count(*)::int from public.attempts where learner_id = :kid::uuid), 3);

select pg_temp.become(:stranger);
select pg_temp.check('a stranger sees none of it',
  (select count(*)::int from public.attempts where learner_id = :kid::uuid), 0);

-- ---------------------------------------------------------------------------
-- Rebuilding mastery uses evidence only
-- ---------------------------------------------------------------------------
-- Three attempts were recorded: card-A missed and then got right, both checked,
-- and card-B claimed correct on a flashcard, which nobody checked. A rebuild
-- is meant to derive mastery from what was demonstrated, so card-B must not
-- appear at all.
select pg_temp.become(:parent);
select public.rebuild_item_mastery(:kid::uuid, 'quiz');

select pg_temp.check('only checked answers rebuild into mastery',
  (select count(*)::int from public.item_mastery where learner_id = :kid::uuid), 1);
select pg_temp.check('and it is the card that was actually checked',
  (select item_key from public.item_mastery where learner_id = :kid::uuid), 'card-A');

-- ---------------------------------------------------------------------------
-- Erasing on purpose
-- ---------------------------------------------------------------------------
select public.erase_learner_progress(:kid::uuid);
select pg_temp.check('the owner can erase everything, audit trail included',
  (select count(*)::int from public.attempts where learner_id = :kid::uuid), 0);

reset role;
\echo '--- all attempt integrity tests passed ---'
