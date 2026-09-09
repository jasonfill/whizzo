-- ============================================================================
-- The weekly planner (0019).
--
-- What these pin:
--
--   * the planner is the learner's: a learner can write their own plan, a
--     view-only guardian can read it and comment, a stranger sees nothing
--   * two kinds of done: an unlinked card is ticked and attributed, a linked
--     card refuses a hand tick and is closed only by a matching round
--   * an erased round reopens the card it closed
--   * every card remembers: the log is written by the database, carries the
--     actor, and cannot be updated or deleted by anybody
--   * a card is never hard-deleted by a user; soft delete keeps its history
--   * three priorities, and a week starts on Monday
--
-- Run against a scratch database with 0001-0019 applied:
--   psql -f supabase/tests/0019_planner_test.sql
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
-- Fixtures: a parent, the teenager who practices and signs in, a tutor with
-- view-only access, and a stranger.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'planner-parent@example.com'),
  ('99999999-0000-0000-0000-000000000002', 'planner-teen@example.com'),
  ('99999999-0000-0000-0000-000000000003', 'planner-tutor@example.com'),
  ('99999999-0000-0000-0000-000000000004', 'planner-stranger@example.com')
on conflict (id) do nothing;
insert into public.profiles (id, display_name) values
  ('99999999-0000-0000-0000-000000000001', 'Mum'),
  ('99999999-0000-0000-0000-000000000002', 'Ava')
on conflict (id) do update set display_name = excluded.display_name;

\set parent   '''99999999-0000-0000-0000-000000000001'''
\set teen     '''99999999-0000-0000-0000-000000000002'''
\set tutor    '''99999999-0000-0000-0000-000000000003'''
\set stranger '''99999999-0000-0000-0000-000000000004'''
\set kid      '''99999999-0000-0000-0000-00000000000a'''
\set course   '''99999999-0000-0000-0000-00000000000b'''
\set task     '''99999999-0000-0000-0000-00000000000c'''
\set study    '''99999999-0000-0000-0000-00000000000d'''
\set exam     '''99999999-0000-0000-0000-00000000000e'''
\set round    '''99999999-0000-0000-0000-00000000000f'''
\set week     '''99999999-0000-0000-0000-000000000010'''
\set round2   '''99999999-0000-0000-0000-000000000011'''

set role authenticated;
select pg_temp.become(:parent);

insert into public.learners (id, owner_id, auth_user_id, auth_kind, display_name, birth_year)
values (:kid::uuid, :parent::uuid, :teen::uuid, 'self', 'Planner Kid',
        extract(year from current_date)::int - 14)
on conflict (id) do nothing;

-- A view-only tutor.
reset role;
insert into public.guardian_links (learner_id, guardian_id, role, can_manage_content)
values (:kid::uuid, :tutor::uuid, 'tutor', false)
on conflict do nothing;
set role authenticated;

-- The Monday of the current week, as the app computes it.
select (current_date - (extract(isodow from current_date)::int - 1))::text as monday \gset

-- ---------------------------------------------------------------------------
-- The planner is the learner's
-- ---------------------------------------------------------------------------
select pg_temp.become(:teen);

insert into public.courses (id, learner_id, name, track, color, created_by)
values (:course::uuid, :kid::uuid, 'Biology', 'science.biology', '#4FA36F', :teen::uuid);
select pg_temp.check('a learner can add their own course',
  (select count(*)::int from public.courses where learner_id = :kid::uuid), 1);

insert into public.planner_weeks (id, learner_id, week_start)
values (:week::uuid, :kid::uuid, :'monday'::date);

select pg_temp.check_denied('a week must start on Monday',
  'insert into public.planner_weeks (learner_id, week_start) values ('
    || quote_literal(:kid) || '::uuid, ' || quote_literal(:'monday') || '::date + 1)',
  'planner_weeks_monday');

select pg_temp.check_denied('three priorities, not four',
  'update public.planner_weeks set priorities = ''[{"text":"a"},{"text":"b"},{"text":"c"},{"text":"d"}]'' where id = '
    || quote_literal(:week) || '::uuid',
  'planner_weeks_priorities_cap');

insert into public.planner_items (id, learner_id, week_start, on_day, kind, title, course_id, minutes, created_by)
values (:task::uuid, :kid::uuid, :'monday'::date, :'monday'::date, 'task', 'Bio worksheet p.42',
        :course::uuid, 25, :teen::uuid);

select pg_temp.check_denied('only a task can sit on the shelf',
  'insert into public.planner_items (learner_id, week_start, on_day, kind, title) values ('
    || quote_literal(:kid) || '::uuid, ' || quote_literal(:'monday') || '::date, null, ''study'', ''x'')',
  'planner_items_shelf_kinds');

select pg_temp.check_denied('a placed card sits inside its own week',
  'insert into public.planner_items (learner_id, week_start, on_day, kind, title) values ('
    || quote_literal(:kid) || '::uuid, ' || quote_literal(:'monday') || '::date, '
    || quote_literal(:'monday') || '::date + 9, ''task'', ''x'')',
  'planner_items_day_in_week');

-- ---------------------------------------------------------------------------
-- Two kinds of done
-- ---------------------------------------------------------------------------
select pg_temp.check_denied('done without saying who is not done',
  'update public.planner_items set status = ''done'', done_at = now() where id = ' || quote_literal(:task) || '::uuid',
  'planner_items_done_shape');

update public.planner_items set status = 'done', done_at = now(), done_by = :teen::uuid
 where id = :task::uuid;
select pg_temp.check('an unlinked card is ticked, and says whose claim it is',
  (select done_by from public.planner_items where id = :task::uuid), :teen::uuid);

update public.planner_items set status = 'open', done_at = null, done_by = null
 where id = :task::uuid;
select pg_temp.check('and can be un-ticked',
  (select status from public.planner_items where id = :task::uuid), 'open');

insert into public.assessments (id, learner_id, course_id, kind, title, on_day, difficulty,
                                target_subject, target_id, created_by)
values (:exam::uuid, :kid::uuid, :course::uuid, 'test', 'Chapter 7', current_date + 5, 2,
        'quiz', 'starter-body', :teen::uuid);

insert into public.planner_items (id, learner_id, week_start, on_day, kind, title, assessment_id,
                                  purpose, proposed, target_subject, target_activity, target_id, minutes)
values (:study::uuid, :kid::uuid, :'monday'::date, :'monday'::date, 'study', 'Practice · Chapter 7',
        :exam::uuid, 'practice', true, 'quiz', 'learn', 'starter-body', 20);

select pg_temp.check_denied('a linked card refuses a hand tick',
  'update public.planner_items set status = ''done'', done_at = now(), done_by = '
    || quote_literal(:teen) || '::uuid where id = ' || quote_literal(:study) || '::uuid',
  'planner_items_done_shape');

-- A round that matches subject, activity and target closes it.
insert into public.sessions
  (id, learner_id, subject, activity, list_id, items_total, items_correct, accuracy,
   evidence, verified_items_total, verified_items_correct, ended_at)
values (:round::uuid, :kid::uuid, 'quiz', 'learn', 'starter-body', 10, 9, 90,
        'attempts', 10, 9, now());

select pg_temp.check('a matching round closes the linked card',
  public.complete_matching_planner_items(:kid::uuid, :round::uuid, :'monday'::date), 1);
select pg_temp.check('and the card sits on the day the learner said it happened',
  (select on_day from public.planner_items where id = :study::uuid), :'monday'::date);
select pg_temp.check('with the round as evidence',
  (select session_id from public.planner_items where id = :study::uuid), :round::uuid);
select pg_temp.check('and no human claim on it',
  (select done_by from public.planner_items where id = :study::uuid), null::uuid);
select pg_temp.check('a closed card is not closed twice',
  public.complete_matching_planner_items(:kid::uuid, :round::uuid, :'monday'::date), 0);

-- ---------------------------------------------------------------------------
-- Every card remembers
-- ---------------------------------------------------------------------------
select pg_temp.check('the task has a created event with the learner as actor',
  (select actor_id from public.planner_events
    where entity = 'item' and entity_id = :task::uuid and kind = 'created'), :teen::uuid);

select pg_temp.check('ticking and un-ticking were both logged',
  (select array_agg(kind order by id) from public.planner_events
    where entity = 'item' and entity_id = :task::uuid and kind in ('done', 'undone')),
  array['done', 'undone']);

select pg_temp.check('the closure was logged as the system, with the session',
  (select actor_id is null and session_id = :round::uuid from public.planner_events
    where entity = 'item' and entity_id = :study::uuid and kind = 'closed_by_session'), true);

select pg_temp.check_denied('nobody can rewrite the log',
  'update public.planner_events set kind = ''done'' where entity_id = ' || quote_literal(:task) || '::uuid',
  'permission denied');
select pg_temp.check_denied('nobody can delete from the log',
  'delete from public.planner_events where entity_id = ' || quote_literal(:task) || '::uuid',
  'permission denied');
select pg_temp.check_denied('nobody can write to the log directly',
  'insert into public.planner_events (learner_id, entity, entity_id, kind) values ('
    || quote_literal(:kid) || '::uuid, ''item'', ' || quote_literal(:task) || '::uuid, ''done'')',
  'permission denied');

-- Moving is logged with where it left.
update public.planner_items set on_day = :'monday'::date + 1 where id = :task::uuid;
select pg_temp.check('a move remembers the day it left',
  (select before ->> 'onDay' from public.planner_events
    where entity_id = :task::uuid and kind = 'moved' order by id desc limit 1),
  :'monday');

-- Reordering alone is not history.
update public.planner_items set sort_order = 5000 where id = :task::uuid;
select pg_temp.check('a reorder writes no event',
  (select count(*)::int from public.planner_events where entity_id = :task::uuid and kind = 'edited'), 0);

-- ---------------------------------------------------------------------------
-- An erased round reopens the card
-- ---------------------------------------------------------------------------
select pg_temp.become(:parent);
delete from public.sessions where id = :round::uuid;
select pg_temp.check('erasing the round reopens the card it closed',
  (select status from public.planner_items where id = :study::uuid), 'open');
select pg_temp.check('and that reopening is in the log as the system',
  (select actor_id is null from public.planner_events
    where entity_id = :study::uuid and kind = 'reopened'), true);

-- ---------------------------------------------------------------------------
-- No hard delete by users; soft delete keeps history
-- ---------------------------------------------------------------------------
select pg_temp.become(:teen);
select pg_temp.check_denied('a user cannot hard-delete a card',
  'delete from public.planner_items where id = ' || quote_literal(:task) || '::uuid',
  'permission denied');

update public.planner_items set deleted_at = now(), deleted_by = :teen::uuid where id = :task::uuid;
select pg_temp.check('a soft delete is logged',
  (select count(*)::int from public.planner_events where entity_id = :task::uuid and kind = 'deleted'), 1);
select pg_temp.check('and the card is still there to read',
  (select count(*)::int from public.planner_items where id = :task::uuid), 1);

-- ---------------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
select pg_temp.check('a view-only tutor reads the plan',
  (select count(*)::int from public.planner_items where learner_id = :kid::uuid), 2);
select pg_temp.check('and the log',
  (select count(*) > 0 from public.planner_events where learner_id = :kid::uuid), true);

update public.planner_items set title = 'changed by tutor' where id = :task::uuid;
select pg_temp.check('a view-only tutor changes nothing',
  (select title from public.planner_items where id = :task::uuid), 'Bio worksheet p.42');

insert into public.planner_comments (learner_id, week_start, item_id, author_id, body)
values (:kid::uuid, :'monday'::date, :task::uuid, :tutor::uuid, 'Nice work starting early.');
select pg_temp.check('but can leave a note',
  (select count(*)::int from public.planner_comments where learner_id = :kid::uuid), 1);

select pg_temp.check_denied('and cannot sign it as someone else',
  'insert into public.planner_comments (learner_id, week_start, author_id, body) values ('
    || quote_literal(:kid) || '::uuid, ' || quote_literal(:'monday') || '::date, '
    || quote_literal(:parent) || '::uuid, ''x'')',
  'row-level security');

select pg_temp.become(:stranger);
select pg_temp.check('a stranger sees no cards',
  (select count(*)::int from public.planner_items where learner_id = :kid::uuid), 0);
select pg_temp.check('no courses',
  (select count(*)::int from public.courses where learner_id = :kid::uuid), 0);
select pg_temp.check('no log',
  (select count(*)::int from public.planner_events where learner_id = :kid::uuid), 0);
select pg_temp.check('no comments',
  (select count(*)::int from public.planner_comments where learner_id = :kid::uuid), 0);
select pg_temp.check_denied('and cannot read the Family line by calling the definer function',
  'select public.planner_overview(' || quote_literal(:kid) || '::uuid)',
  'not allowed');

-- ---------------------------------------------------------------------------
-- The Family line
-- ---------------------------------------------------------------------------
select pg_temp.become(:parent);
select pg_temp.check('the overview names the next test',
  (public.planner_overview(:kid::uuid) -> 'nextAssessment' ->> 'title'), 'Chapter 7');
select pg_temp.check('and counts its sessions',
  (public.planner_overview(:kid::uuid) -> 'nextAssessment' ->> 'sessionsTotal')::int, 1);

-- ---------------------------------------------------------------------------
-- A learner can be deleted with a round-closed card still in place. The
-- cascade reaches sessions first; the reopen trigger touches the card; the log
-- has nobody to file the event under and writes nothing rather than failing.
-- ---------------------------------------------------------------------------
select pg_temp.become(:teen);
insert into public.planner_items (learner_id, week_start, on_day, kind, title,
                                  target_subject, target_activity, target_id)
values (:kid::uuid, :'monday'::date, :'monday'::date, 'study', 'Practice again',
        'quiz', 'learn', 'starter-body');
insert into public.sessions
  (id, learner_id, subject, activity, list_id, items_total, items_correct, accuracy,
   evidence, verified_items_total, verified_items_correct, ended_at)
values (:round2::uuid, :kid::uuid, 'quiz', 'learn', 'starter-body', 10, 10, 100,
        'attempts', 10, 10, now());
select pg_temp.check('a second round closes the second card',
  public.complete_matching_planner_items(:kid::uuid, :round2::uuid, :'monday'::date), 1);

-- ---------------------------------------------------------------------------
-- Tidy up. The log rows go with the learner, which is the one case where
-- history should.
-- ---------------------------------------------------------------------------
reset role;
delete from public.learners where id = :kid::uuid;
select pg_temp.check('a learner with a round-closed card can be deleted',
  (select count(*)::int from public.learners where id = :kid::uuid), 0);
delete from auth.users where id in (:parent::uuid, :teen::uuid, :tutor::uuid, :stranger::uuid);
