-- ============================================================================
-- Library tests (0011).
--
-- Content can belong to a learner or to a grown-up. The rules worth pinning are
-- the ones a tutor's livelihood rests on:
--
--   * a grown-up's library is theirs — no family can read or rewrite it
--   * except what they have assigned, which the student (and that student's
--     parent) can read, and only that
--   * a learner's own material keeps working exactly as it did
--   * nothing can belong to both a learner and a grown-up at once
--
-- Run against a scratch database with 0001-0011 applied:
--   psql -f supabase/tests/0011_library_test.sql
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
-- Fixtures: a tutor with a library, a family with one child.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('bbbbbbbb-2000-0000-0000-000000000001', 'lib-tutor@example.com'),
  ('bbbbbbbb-2000-0000-0000-000000000002', 'lib-parent@example.com')
on conflict (id) do nothing;

\set tutor   '''bbbbbbbb-2000-0000-0000-000000000001'''
\set parent  '''bbbbbbbb-2000-0000-0000-000000000002'''
\set pupil   '''bbbbbbbb-2000-0000-0000-00000000000a'''
\set shelved '''bbbbbbbb-2000-0000-0000-00000000000b'''
\set setwork '''bbbbbbbb-2000-0000-0000-00000000000c'''
\set private '''bbbbbbbb-2000-0000-0000-00000000000d'''
\set owndeck '''bbbbbbbb-2000-0000-0000-00000000000e'''

set role authenticated;

select pg_temp.become(:parent);
insert into public.learners (id, owner_id, display_name, birth_year)
values (:pupil::uuid, :parent::uuid, 'Library Pupil', extract(year from current_date)::int - 10)
on conflict (id) do nothing;

-- The child's own deck, made the old way.
insert into public.decks (id, learner_id, title) values (:owndeck::uuid, :pupil::uuid, 'My own cards');

-- ---------------------------------------------------------------------------
-- A library belongs to its author
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
-- accepted_at on the one that gets set as work: the gate added in 0017 refuses
-- to assign a deck still sitting in review, and this fixture predates it.
insert into public.decks (id, owner_user_id, title, accepted_at) values
  (:setwork::uuid, :tutor::uuid, 'Fractions — week 1', now()),
  (:private::uuid, :tutor::uuid, 'Draft I have not shared', null);

select pg_temp.check('a grown-up can keep decks of their own',
  (select count(*)::int from public.decks where owner_user_id = :tutor::uuid), 2);

select pg_temp.check_denied('a deck cannot belong to a learner and a grown-up at once',
  'insert into public.decks (learner_id, owner_user_id, title) values ('
    || quote_literal(:pupil) || '::uuid, ' || quote_literal(:tutor) || '::uuid, ''Both'')',
  'decks_one_owner');

-- Belongs to nobody: refused by the policy before the constraint gets a look
-- in, since a row with no owner satisfies neither arm of the WITH CHECK. Both
-- would reject it; the policy is just first.
select pg_temp.check_denied('nor to neither',
  'insert into public.decks (title) values (''Orphan'')',
  'row-level security');

-- Before anything is assigned, the family sees none of it.
select pg_temp.become(:parent);
select pg_temp.check('a family cannot see a tutor''s library',
  (select count(*)::int from public.decks where owner_user_id = :tutor::uuid), 0);

-- ---------------------------------------------------------------------------
-- Assigning is what opens a deck up, and only that deck
-- ---------------------------------------------------------------------------
-- The tutor is connected to the pupil the way they actually would be: a code
-- they hand out, redeemed by the family. There is no insert privilege on
-- guardian_links at all, which is what keeps a link from being self-granted.
select pg_temp.become(:tutor);
select public.mint_connection_code('Library test') as libcode \gset

select pg_temp.become(:parent);
select public.redeem_connection_code(:'libcode', :pupil::uuid);

select pg_temp.check('the tutor is connected to the pupil',
  (select role from public.guardian_links
    where guardian_id = :tutor::uuid and learner_id = :pupil::uuid), 'tutor');

select pg_temp.become(:tutor);
insert into public.assignment_sets (id, created_by, subject, activity, target_id, title)
values (:shelved::uuid, :tutor::uuid, 'quiz', 'learn', :setwork, 'Fractions homework');
insert into public.assignments (set_id, learner_id) values (:shelved::uuid, :pupil::uuid);

select pg_temp.become(:parent);
select pg_temp.check('the assigned deck becomes readable',
  (select title from public.decks where id = :setwork::uuid), 'Fractions — week 1');
select pg_temp.check('and nothing else from that library does',
  (select count(*)::int from public.decks where id = :private::uuid), 0);

-- Readable, not editable: a tutor's deck is used by other students too.
update public.decks set title = 'Rewritten by a parent' where id = :setwork::uuid;
select pg_temp.become(:tutor);
select pg_temp.check('a family cannot rewrite a tutor''s deck',
  (select title from public.decks where id = :setwork::uuid), 'Fractions — week 1');

select pg_temp.become(:parent);
delete from public.decks where id = :setwork::uuid;
select pg_temp.become(:tutor);
select pg_temp.check('nor delete it',
  (select count(*)::int from public.decks where id = :setwork::uuid), 1);

-- ---------------------------------------------------------------------------
-- A learner's own material is untouched by any of this
-- ---------------------------------------------------------------------------
select pg_temp.become(:parent);
select pg_temp.check('a learner''s own deck is still theirs to read',
  (select title from public.decks where id = :owndeck::uuid), 'My own cards');

update public.decks set title = 'Renamed by the parent' where id = :owndeck::uuid;
select pg_temp.check('and still theirs to edit',
  (select title from public.decks where id = :owndeck::uuid), 'Renamed by the parent');

-- The tutor is linked to this pupil, so they see the pupil's own deck too —
-- that is the point of being connected.
select pg_temp.become(:tutor);
select pg_temp.check('a connected tutor sees the pupil''s own deck',
  (select count(*)::int from public.decks where id = :owndeck::uuid), 1);

-- ---------------------------------------------------------------------------
-- Withdrawing the work closes the deck again
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
delete from public.assignment_sets where id = :shelved::uuid;

select pg_temp.become(:parent);
select pg_temp.check('unassigning takes the deck back out of view',
  (select count(*)::int from public.decks where id = :setwork::uuid), 0);

reset role;
\echo '--- all library tests passed ---'
