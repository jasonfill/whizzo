-- ---------------------------------------------------------------------------
-- The weekly planner: courses, the week, tests planned backwards, and a
-- history every card keeps.
-- ---------------------------------------------------------------------------
-- Two principles carry the design (docs/weekly-planner-spec.md):
--
--   * **The planner is the learner's.** Writes use can_manage_learner_content(),
--     which deliberately counts the learner — the opposite choice from
--     assignments, where a child setting their own homework would be the bug.
--
--   * **Two kinds of done, never confused.** A card the app can run (it has a
--     target) is closed by the round that satisfied it, with the session as
--     evidence — the same mechanism as assignments. A card with no target is
--     ticked by hand and says whose claim it is. The check constraint makes
--     the two shapes mutually exclusive so a report can tell them apart without
--     trusting the client.
--
-- And one that arrived with the parents in mind: **every card remembers.**
-- planner_events is written by triggers, in the same transaction as the change,
-- with the actor from auth.uid(). Nobody updates or deletes it — the posture
-- attempts has had since 0007.

-- ---------------------------------------------------------------------------
-- Courses — enrolments. The learner's, freely defined, citing a closed track.
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id            uuid        primary key default gen_random_uuid(),
  learner_id    uuid        not null references public.learners (id) on delete cascade,
  name          text        not null,
  track         text,                       -- null resolves to General, as everywhere
  teacher_name  text,
  period        text,
  color         text        not null,
  emoji         text,
  term_label    text,
  starts_on     date,
  ends_on       date,
  archived_at   timestamptz,
  sort_order    int         not null default 0,
  created_by    uuid        references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint courses_name_check check (length(trim(name)) between 1 and 80)
);

create index if not exists courses_learner_idx
  on public.courses (learner_id, archived_at, sort_order);

drop trigger if exists courses_touch on public.courses;
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

comment on table public.courses is
  'A class the learner is enrolled in. Not a track: a track is an ability pool we define.';

-- ---------------------------------------------------------------------------
-- The week — one row per learner per week, holding the four sections.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_weeks (
  id            uuid        primary key default gen_random_uuid(),
  learner_id    uuid        not null references public.learners (id) on delete cascade,
  week_start    date        not null,
  priorities    jsonb       not null default '[]',
  wins          jsonb       not null default '[]',
  goals         jsonb       not null default '[]',
  reflection    text,
  busy_days     date[]      not null default '{}',
  planned_at    timestamptz,
  wrapped_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (learner_id, week_start),
  constraint planner_weeks_monday check (extract(isodow from week_start) = 1),
  -- Three priorities. The cap is the feature.
  constraint planner_weeks_priorities_cap check (jsonb_array_length(priorities) <= 3)
);

drop trigger if exists planner_weeks_touch on public.planner_weeks;
create trigger planner_weeks_touch before update on public.planner_weeks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Assessments — tests, quizzes, exams, projects.
-- ---------------------------------------------------------------------------
create table if not exists public.assessments (
  id                uuid        primary key default gen_random_uuid(),
  learner_id        uuid        not null references public.learners (id) on delete cascade,
  course_id         uuid        references public.courses (id) on delete set null,
  kind              text        not null,
  title             text        not null,
  on_day            date        not null,
  difficulty        int         not null,
  target_subject    text,
  target_id         text,
  -- { feltLike, score, note }. A claim, shown as one.
  outcome           jsonb,
  plan_generated_at timestamptz,
  created_by        uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint assessments_kind_check check (kind in ('quiz', 'test', 'exam', 'project')),
  constraint assessments_difficulty_check check (difficulty between 1 and 3),
  constraint assessments_title_check check (length(trim(title)) between 1 and 120),
  constraint assessments_target_pair check ((target_subject is null) = (target_id is null))
);

create index if not exists assessments_learner_day_idx
  on public.assessments (learner_id, on_day);

drop trigger if exists assessments_touch on public.assessments;
create trigger assessments_touch before update on public.assessments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Items — what is on a day. Every one of them is a card.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_items (
  id              uuid        primary key default gen_random_uuid(),
  learner_id      uuid        not null references public.learners (id) on delete cascade,
  week_start      date        not null,
  on_day          date,                     -- null: on the shelf, no day yet
  kind            text        not null,
  title           text        not null,
  course_id       uuid        references public.courses (id) on delete set null,
  assessment_id   uuid        references public.assessments (id) on delete cascade,
  minutes         int,
  purpose         text,
  proposed        boolean     not null default false,
  -- What the app can run for this card. Null means "not app work".
  target_subject  text,
  target_activity text,
  target_id       text,
  status          text        not null default 'open',
  done_at         timestamptz,
  done_by         uuid        references auth.users (id) on delete set null,  -- a claim
  session_id      uuid        references public.sessions (id) on delete set null, -- evidence
  -- Soft delete: the card leaves the grid, its history stays readable.
  deleted_at      timestamptz,
  deleted_by      uuid        references auth.users (id) on delete set null,
  sort_order      int         not null default 0,
  created_by      uuid        references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint planner_items_kind_check check (kind in ('task', 'study', 'event')),
  constraint planner_items_status_check check (status in ('open', 'done', 'skipped')),
  constraint planner_items_purpose_check check (
    purpose is null or purpose in ('organise', 'practise', 'prove', 'review')
  ),
  constraint planner_items_title_check check (length(trim(title)) between 1 and 200),
  constraint planner_items_minutes_check check (minutes is null or minutes between 0 and 600),
  constraint planner_items_monday check (extract(isodow from week_start) = 1),
  constraint planner_items_target_shape check (
    (target_subject is null and target_activity is null and target_id is null)
    or (target_subject is not null and target_activity is not null and target_id is not null)
  ),
  -- Linked work is closed by a session, never by hand. Unlinked work is a claim
  -- and says whose.
  constraint planner_items_done_shape check (
    status <> 'done'
    or (target_id is not null and session_id is not null and done_at is not null)
    or (target_id is null     and done_by    is not null and done_at is not null)
  ),
  -- A placed card is placed inside its own week; sessions and events always have a day.
  constraint planner_items_day_in_week check (
    on_day is null or (on_day >= week_start and on_day < week_start + 7)
  ),
  constraint planner_items_shelf_kinds check (on_day is not null or kind = 'task')
);

create index if not exists planner_items_week_idx
  on public.planner_items (learner_id, week_start, on_day, sort_order);
create index if not exists planner_items_session_idx
  on public.planner_items (session_id) where session_id is not null;
create index if not exists planner_items_assessment_idx
  on public.planner_items (assessment_id) where assessment_id is not null;

drop trigger if exists planner_items_touch on public.planner_items;
create trigger planner_items_touch before update on public.planner_items
  for each row execute function public.touch_updated_at();

comment on table public.planner_items is
  'A card on the week. Linked cards close by evidence; unlinked ones are ticked and attributed.';

-- ---------------------------------------------------------------------------
-- Comments — sticky notes. No threads.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_comments (
  id          uuid        primary key default gen_random_uuid(),
  learner_id  uuid        not null references public.learners (id) on delete cascade,
  week_start  date        not null,
  item_id     uuid        references public.planner_items (id) on delete cascade,
  author_id   uuid        not null references auth.users (id) on delete cascade,
  body        text        not null,
  created_at  timestamptz not null default now(),
  constraint planner_comments_body_check check (length(trim(body)) between 1 and 500)
);

create index if not exists planner_comments_week_idx
  on public.planner_comments (learner_id, week_start, created_at);

-- ---------------------------------------------------------------------------
-- Preferences — stable, one row per learner, created lazily.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_prefs (
  learner_id       uuid        primary key references public.learners (id) on delete cascade,
  daily_minutes    int,
  sessions_per_day int,
  study_days       int[]       not null default '{1,2,3,4,5,7}',
  updated_at       timestamptz not null default now(),
  constraint planner_prefs_minutes_check check (daily_minutes is null or daily_minutes between 10 and 600),
  constraint planner_prefs_sessions_check check (sessions_per_day is null or sessions_per_day between 1 and 6)
);

-- ---------------------------------------------------------------------------
-- Filing existing content under a course. Learner-owned content only: a
-- library deck is reused across many learners, and a course belongs to one.
-- ---------------------------------------------------------------------------
alter table public.decks       add column if not exists course_id uuid references public.courses (id) on delete set null;
alter table public.word_lists  add column if not exists course_id uuid references public.courses (id) on delete set null;
alter table public.assignments add column if not exists course_id uuid references public.courses (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Every card remembers. Append-only; the database writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_events (
  id          bigint      generated always as identity primary key,
  learner_id  uuid        not null references public.learners (id) on delete cascade,
  entity      text        not null,
  entity_id   uuid        not null,
  at          timestamptz not null default now(),
  actor_id    uuid        references auth.users (id) on delete set null, -- null: the system
  kind        text        not null,
  before      jsonb,
  after       jsonb,
  session_id  uuid        references public.sessions (id) on delete set null,
  constraint planner_events_entity_check check (entity in ('item', 'assessment', 'week'))
);

create index if not exists planner_events_entity_idx
  on public.planner_events (entity, entity_id, at);
create index if not exists planner_events_learner_idx
  on public.planner_events (learner_id, at desc);

comment on table public.planner_events is
  'Append-only. Triggers write it in the same transaction as the change; nobody updates or deletes it.';

-- Posture identical to attempts: the trigger inserts as definer, users only read.
revoke all on public.planner_events from authenticated;
grant select on public.planner_events to authenticated;

-- The diff of the fields worth remembering, as camelCase so the wire and the
-- log agree on names.
create or replace function public.planner_item_facts(r public.planner_items)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'onDay', r.on_day,
    'weekStart', r.week_start,
    'title', r.title,
    'courseId', r.course_id,
    'minutes', r.minutes,
    'status', r.status,
    'proposed', r.proposed,
    'purpose', r.purpose,
    'deletedAt', r.deleted_at
  );
$$;

create or replace function public.assessment_facts(r public.assessments)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'on', r.on_day,
    'title', r.title,
    'kind', r.kind,
    'difficulty', r.difficulty,
    'courseId', r.course_id,
    'outcome', r.outcome
  );
$$;

-- Only the keys that changed, before and after, so a row in the log says what
-- happened and nothing else.
create or replace function public.jsonb_changed(p_before jsonb, p_after jsonb)
returns table (before jsonb, after jsonb)
language sql
immutable
as $$
  select
    coalesce((select jsonb_object_agg(k, v) from jsonb_each(p_before) b(k, v)
               where p_after -> k is distinct from v), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, v) from jsonb_each(p_after) a(k, v)
               where p_before -> k is distinct from v), '{}'::jsonb);
$$;

create or replace function public.log_planner_item_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k       text;
  b       jsonb;
  a       jsonb;
  changed record;
begin
  -- A cascade from the learner reaches these rows after the learner is gone
  -- — through sessions (the reopen trigger updates cards) and directly (the
  -- delete). There is nothing to file an event under, so none is written.
  if not exists (select 1 from public.learners where id = coalesce(new.learner_id, old.learner_id)) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, before, after)
    values (new.learner_id, 'item', new.id, auth.uid(), 'created', null, public.planner_item_facts(new));
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- A hard delete only happens through a cascade from an assessment being
    -- removed; worth a line.
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, before, after)
    values (old.learner_id, 'item', old.id, auth.uid(), 'deleted', public.planner_item_facts(old), null);
    return old;
  end if;

  select * into changed from public.jsonb_changed(public.planner_item_facts(old), public.planner_item_facts(new));
  b := changed.before;
  a := changed.after;

  if old.deleted_at is null and new.deleted_at is not null then
    k := 'deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    k := 'restored';
  elsif old.status <> new.status then
    k := case
      when new.status = 'done' and new.session_id is not null then 'closed_by_session'
      when new.status = 'done' then 'done'
      when new.status = 'skipped' then 'skipped'
      when old.status = 'done' and new.session_id is null and old.session_id is not null then 'reopened'
      when old.status = 'done' then 'undone'
      else 'unskipped'
    end;
  elsif old.on_day is distinct from new.on_day then
    k := case when new.on_day is null then 'shelved' else 'moved' end;
  elsif b = '{}'::jsonb then
    -- Only sort order or updated_at moved. Not history.
    return new;
  else
    k := 'edited';
  end if;

  insert into public.planner_events
    (learner_id, entity, entity_id, actor_id, kind, before, after, session_id)
  values
    (new.learner_id, 'item', new.id,
     -- A closure or reopening is the system's doing, not the caller's.
     case when k in ('closed_by_session', 'reopened') then null else auth.uid() end,
     k, b, a,
     case when k = 'closed_by_session' then new.session_id else null end);
  return new;
end;
$$;

drop trigger if exists planner_items_log on public.planner_items;
create trigger planner_items_log
  after insert or update or delete on public.planner_items
  for each row execute function public.log_planner_item_event();

create or replace function public.log_assessment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k       text;
  changed record;
begin
  if not exists (select 1 from public.learners where id = coalesce(new.learner_id, old.learner_id)) then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, before, after)
    values (new.learner_id, 'assessment', new.id, auth.uid(), 'created', null, public.assessment_facts(new));
    return new;
  end if;
  if tg_op = 'DELETE' then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, before, after)
    values (old.learner_id, 'assessment', old.id, auth.uid(), 'deleted', public.assessment_facts(old), null);
    return old;
  end if;

  select * into changed from public.jsonb_changed(public.assessment_facts(old), public.assessment_facts(new));
  if changed.before = '{}'::jsonb then return new; end if;

  k := case
    when old.on_day <> new.on_day then 'date_moved'
    when old.outcome is distinct from new.outcome and new.outcome is not null then 'outcome'
    else 'edited'
  end;

  insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, before, after)
  values (new.learner_id, 'assessment', new.id, auth.uid(), k, changed.before, changed.after);
  return new;
end;
$$;

drop trigger if exists assessments_log on public.assessments;
create trigger assessments_log
  after insert or update or delete on public.assessments
  for each row execute function public.log_assessment_event();

create or replace function public.log_planner_week_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, after)
    values (new.learner_id, 'week', new.id, auth.uid(), 'created',
            jsonb_build_object('weekStart', new.week_start));
    return new;
  end if;
  if old.planned_at is null and new.planned_at is not null then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, after)
    values (new.learner_id, 'week', new.id, auth.uid(), 'planned',
            jsonb_build_object('priorities', new.priorities, 'busyDays', to_jsonb(new.busy_days)));
  end if;
  if old.wrapped_at is null and new.wrapped_at is not null then
    insert into public.planner_events (learner_id, entity, entity_id, actor_id, kind, after)
    values (new.learner_id, 'week', new.id, auth.uid(), 'wrapped',
            jsonb_build_object('wins', new.wins, 'goals', new.goals, 'reflection', new.reflection));
  end if;
  return new;
end;
$$;

drop trigger if exists planner_weeks_log on public.planner_weeks;
create trigger planner_weeks_log
  after insert or update on public.planner_weeks
  for each row execute function public.log_planner_week_event();

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------
-- Reads: anyone linked to the learner. Writes: can_manage_learner_content(),
-- which includes the learner. Comments are the one table a view-only guardian
-- can write to, because leaving a note is the whole point of view-only access
-- for a tutor.

alter table public.courses          enable row level security;
alter table public.planner_weeks    enable row level security;
alter table public.assessments      enable row level security;
alter table public.planner_items    enable row level security;
alter table public.planner_comments enable row level security;
alter table public.planner_prefs    enable row level security;
alter table public.planner_events   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['courses', 'planner_weeks', 'assessments', 'planner_items', 'planner_prefs']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.can_access_learner(learner_id))', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.can_manage_learner_content(learner_id))', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.can_manage_learner_content(learner_id)) with check (public.can_manage_learner_content(learner_id))', t, t);
  end loop;
end;
$$;

-- Deleting a course or an assessment is allowed (a course made by mistake, a
-- test that was cancelled). Deleting a planner item is not: the only path off
-- the grid is the soft delete, so history survives.
create policy courses_delete on public.courses
  for delete to authenticated using (public.can_manage_learner_content(learner_id));
create policy assessments_delete on public.assessments
  for delete to authenticated using (public.can_manage_learner_content(learner_id));
create policy planner_weeks_delete on public.planner_weeks
  for delete to authenticated using (false);
create policy planner_prefs_delete on public.planner_prefs
  for delete to authenticated using (public.can_manage_learner_content(learner_id));

drop policy if exists planner_comments_select on public.planner_comments;
drop policy if exists planner_comments_insert on public.planner_comments;
drop policy if exists planner_comments_delete on public.planner_comments;
create policy planner_comments_select on public.planner_comments
  for select to authenticated using (public.can_access_learner(learner_id));
create policy planner_comments_insert on public.planner_comments
  for insert to authenticated
  with check (public.can_access_learner(learner_id) and author_id = (select auth.uid()));
create policy planner_comments_delete on public.planner_comments
  for delete to authenticated using (author_id = (select auth.uid()));

drop policy if exists planner_events_select on public.planner_events;
create policy planner_events_select on public.planner_events
  for select to authenticated using (public.can_access_learner(learner_id));

-- 0005 grants everything on new tables by default, so what is *not* allowed
-- has to be taken away by name: a card is never hard-deleted by a user, a week
-- row is never deleted, and a comment is never edited.
grant select, insert, update, delete on public.courses          to authenticated;
grant select, insert, update         on public.planner_weeks    to authenticated;
revoke delete                        on public.planner_weeks    from authenticated;
grant select, insert, update, delete on public.assessments      to authenticated;
grant select, insert, update         on public.planner_items    to authenticated;
revoke delete                        on public.planner_items    from authenticated;
grant select, insert, delete         on public.planner_comments to authenticated;
revoke update                        on public.planner_comments from authenticated;
grant select, insert, update, delete on public.planner_prefs    to authenticated;

-- ---------------------------------------------------------------------------
-- Closing a linked study session
-- ---------------------------------------------------------------------------
-- Same transaction as the round, same shape as complete_matching_assignments.
-- Closes the open study card for that work planned nearest to the day the
-- round happened — today's own card first, then the closest either side — so
-- a learner who does Tuesday's session on Wednesday has still done it, and
-- one who does it on Sunday has done it early. The card moves to the day it
-- actually happened.
--
-- `p_today` is the learner's own calendar day, sent by the app with the
-- round. Every day the learner sees is local; `ended_at::date` is the
-- database's zone and would move an evening round to tomorrow. The cast is
-- only the fallback for callers that send nothing.

create or replace function public.complete_matching_planner_items(
  p_learner_id uuid,
  p_session_id uuid,
  p_today      date default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s      public.sessions%rowtype;
  today  date;
  closed int := 0;
  it     record;
begin
  if not public.can_access_learner(p_learner_id) then
    raise exception 'Not allowed to record work for that learner'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.sessions
   where id = p_session_id and learner_id = p_learner_id;
  if not found then return 0; end if;

  today := coalesce(p_today, coalesce(s.ended_at, now())::date);

  -- One card per round: the open one planned nearest to today. A round is
  -- one session's worth of evidence and should not close a week of them.
  select * into it
    from public.planner_items i
   where i.learner_id = p_learner_id
     and i.deleted_at is null
     and i.status = 'open'
     and i.kind = 'study'
     and i.target_subject = s.subject
     and i.target_activity = s.activity
     and i.target_id = s.list_id
     and i.on_day is not null
   order by abs(i.on_day - today) asc, i.on_day asc, i.sort_order asc
   limit 1;
  if not found then return 0; end if;

  -- One update, so the log carries one event: closed by a round, with the
  -- day it moved to inside it, and the system as the actor rather than
  -- whoever happened to be recording the round.
  update public.planner_items
     set status = 'done',
         done_at = coalesce(s.ended_at, now()),
         session_id = s.id,
         on_day = today,
         week_start = today - (extract(isodow from today)::int - 1)
   where id = it.id;
  get diagnostics closed = row_count;
  return closed;
end;
$$;

grant execute on function public.complete_matching_planner_items(uuid, uuid, date) to authenticated;

-- An erased round reopens the card it closed. Same rule as assignments, its
-- own trigger so neither depends on the other's body.
create or replace function public.reopen_planner_items_for_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.planner_items
     set status = 'open', done_at = null, session_id = null
   where session_id = old.id;
  return old;
end;
$$;

drop trigger if exists planner_items_reopen_for_session on public.sessions;
create trigger planner_items_reopen_for_session
  before delete on public.sessions
  for each row execute function public.reopen_planner_items_for_session();

-- ---------------------------------------------------------------------------
-- What the Family line needs, in one call.
-- ---------------------------------------------------------------------------

create or replace function public.planner_overview(p_learner_id uuid, p_today date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  -- Definer, so it must ask the question RLS would have asked.
  if not public.can_access_learner(p_learner_id) then
    raise exception 'Not allowed to read that learner''s planner'
      using errcode = 'insufficient_privilege';
  end if;

  with wk as (
    select * from public.planner_weeks
     where learner_id = p_learner_id
       and week_start = p_today - (extract(isodow from p_today)::int - 1)
  ),
  next_a as (
    select a.id, a.title, a.on_day
      from public.assessments a
     where a.learner_id = p_learner_id and a.on_day >= p_today and a.kind <> 'project'
     order by a.on_day asc
     limit 1
  ),
  sess as (
    select count(*) filter (where i.status = 'done')::int as done,
           count(*) filter (where i.status <> 'skipped')::int as total
      from public.planner_items i
      join next_a on i.assessment_id = next_a.id
     where i.deleted_at is null and i.kind = 'study'
  )
  select jsonb_build_object(
    'planned', coalesce((select planned_at is not null from wk), false),
    'priorities', coalesce((select jsonb_array_length(priorities) from wk), 0),
    'nextAssessment',
      case when exists (select 1 from next_a) then
        (select jsonb_build_object(
           'title', next_a.title,
           'on', next_a.on_day,
           'sessionsDone', coalesce((select done from sess), 0),
           'sessionsTotal', coalesce((select total from sess), 0)
         ) from next_a)
      else null end
  ) into result;
  return result;
end;
$$;

grant execute on function public.planner_overview(uuid, date) to authenticated;
