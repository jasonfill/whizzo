-- ============================================================================
-- Connection code tests (0010).
--
-- A tutor hands out a code; a family redeems it. The whole point is that the
-- code is an invitation rather than a key, so these pin the consent boundary:
--
--   * minting a code grants nothing
--   * a family can see who they are letting in before they let them in
--   * only someone who OWNS a learner may grant access to them
--   * once granted, the tutor sees that child's work and no other
--   * withdrawn, expired and used-up codes stop working
--   * the family can put the tutor out again
--
-- Run against a scratch database with 0001-0010 applied:
--   psql -f supabase/tests/0010_tutor_codes_test.sql
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
-- Fixtures: a tutor, two unrelated families, and a teenager who owns herself.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('cccccccc-1000-0000-0000-000000000001', 'tutor@example.com'),
  ('cccccccc-1000-0000-0000-000000000002', 'mum@school.example.com'),
  ('cccccccc-1000-0000-0000-000000000003', 'unrelated@example.com'),
  ('cccccccc-1000-0000-0000-000000000004', 'teen-owner@example.com')
on conflict (id) do nothing;

update public.profiles set display_name = 'Mrs Patel'
 where id = 'cccccccc-1000-0000-0000-000000000001';

\set tutor     '''cccccccc-1000-0000-0000-000000000001'''
\set mum       '''cccccccc-1000-0000-0000-000000000002'''
\set stranger  '''cccccccc-1000-0000-0000-000000000003'''
\set teenowner '''cccccccc-1000-0000-0000-000000000004'''
\set pupil     '''cccccccc-1000-0000-0000-00000000000a'''
\set sibling   '''cccccccc-1000-0000-0000-00000000000b'''
\set teenself  '''cccccccc-1000-0000-0000-00000000000c'''

set role authenticated;

select pg_temp.become(:mum);
insert into public.learners (id, owner_id, display_name, birth_year) values
  (:pupil::uuid,   :mum::uuid, 'Pupil One',  extract(year from current_date)::int - 10),
  (:sibling::uuid, :mum::uuid, 'Sibling',    extract(year from current_date)::int - 8)
on conflict (id) do nothing;

-- A 13+ learner who signed up for themselves owns their own profile, and so
-- can connect a tutor without a parent in the loop.
select pg_temp.become(:teenowner);
insert into public.learners (id, owner_id, auth_user_id, auth_kind, display_name, birth_year)
values (:teenself::uuid, :teenowner::uuid, :teenowner::uuid, 'self', 'Teen Owner',
        extract(year from current_date)::int - 15)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Minting grants nothing
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
select public.mint_connection_code('Tuesday math') as code \gset

select pg_temp.check('minting a code creates no access at all',
  (select count(*)::int from public.guardian_links
    where guardian_id = :tutor::uuid), 0);

select pg_temp.check('the tutor can see their own code',
  (select count(*)::int from public.connection_codes where owner_id = :tutor::uuid), 1);

select pg_temp.become(:stranger);
select pg_temp.check('nobody else can list it',
  (select count(*)::int from public.connection_codes), 0);

-- ---------------------------------------------------------------------------
-- A family looks before it leaps
-- ---------------------------------------------------------------------------
select pg_temp.become(:mum);

select pg_temp.check('a family can see whose code it is before accepting',
  (select owner_name from public.describe_connection_code(:'code')), 'Mrs Patel');
select pg_temp.check('and what the code is for',
  (select label from public.describe_connection_code(:'code')), 'Tuesday math');
select pg_temp.check('and that it is usable',
  (select valid from public.describe_connection_code(:'code')), true);
select pg_temp.check('a code that does not exist is reported, not guessed at',
  (select reason from public.describe_connection_code('ZZZZZZZZ')), 'That code does not exist');

-- ---------------------------------------------------------------------------
-- Only an owner may grant
-- ---------------------------------------------------------------------------
select pg_temp.become(:stranger);
select pg_temp.check_denied('someone who does not own the learner cannot connect a tutor',
  'select public.redeem_connection_code(' || quote_literal(:'code') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'owns this learner');

select pg_temp.become(:tutor);
select pg_temp.check_denied('the tutor cannot redeem their own code against a child',
  'select public.redeem_connection_code(' || quote_literal(:'code') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'owns this learner');

-- The parent grants, for one child only.
select pg_temp.become(:mum);
select public.redeem_connection_code(:'code', :pupil::uuid);

select pg_temp.check('redeeming links the tutor to that child',
  (select role from public.guardian_links
    where guardian_id = :tutor::uuid and learner_id = :pupil::uuid), 'tutor');

-- ---------------------------------------------------------------------------
-- What the tutor can now see
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
select pg_temp.check('the tutor can see the child they were connected to',
  (select count(*)::int from public.learners where id = :pupil::uuid), 1);
select pg_temp.check('and not the sibling they were not',
  (select count(*)::int from public.learners where id = :sibling::uuid), 0);

-- The point of the whole exercise: progress, not just a name.
select pg_temp.become(:mum);
insert into public.attempts (learner_id, subject, item_key, activity, is_test, verified, correct, difficulty)
values (:pupil::uuid, 'spelling', 'because', 'listen-spell', true, true, true, 3);

select pg_temp.become(:tutor);
select pg_temp.check('and can see their work',
  (select count(*)::int from public.attempts where learner_id = :pupil::uuid), 1);

-- A tutor is trusted with content, so they can set work.
insert into public.assignment_sets (id, created_by, subject, activity, target_id, title)
values ('cccccccc-1000-0000-0000-0000000000f1', :tutor::uuid, 'spelling', 'listen-spell',
        'g2-digraphs', 'Digraphs for Tuesday');
insert into public.assignments (set_id, learner_id)
values ('cccccccc-1000-0000-0000-0000000000f1', :pupil::uuid);
select pg_temp.check('and set them work',
  (select count(*)::int from public.assignments where learner_id = :pupil::uuid), 1);

-- ---------------------------------------------------------------------------
-- A student can grant for themselves
-- ---------------------------------------------------------------------------
select pg_temp.become(:teenowner);
select public.redeem_connection_code(:'code', :teenself::uuid);
select pg_temp.check('a learner who owns their own profile can connect a tutor',
  (select count(*)::int from public.guardian_links
    where guardian_id = :tutor::uuid and learner_id = :teenself::uuid), 1);

-- ---------------------------------------------------------------------------
-- Re-entering the code is not a second seat
-- ---------------------------------------------------------------------------
select pg_temp.become(:mum);
select public.redeem_connection_code(:'code', :pupil::uuid);
select pg_temp.become(:tutor);
select pg_temp.check('redeeming twice for the same child does not count twice',
  (select uses from public.connection_codes where code = :'code'), 2);

-- ---------------------------------------------------------------------------
-- Codes that should not work
-- ---------------------------------------------------------------------------
select public.mint_connection_code('Used up', 'tutor', true, null, 1) as onceonly \gset
select pg_temp.become(:mum);
select public.redeem_connection_code(:'onceonly', :sibling::uuid);
select pg_temp.check_denied('a code past its use limit stops working',
  'select public.redeem_connection_code(' || quote_literal(:'onceonly') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'used up');

select pg_temp.become(:tutor);
select public.mint_connection_code('Expired', 'tutor', true, interval '-1 hour') as expired \gset
select pg_temp.become(:mum);
select pg_temp.check_denied('an expired code stops working',
  'select public.redeem_connection_code(' || quote_literal(:'expired') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'expired');

select pg_temp.become(:tutor);
update public.connection_codes set revoked_at = now() where code = :'code';
select pg_temp.become(:mum);
select pg_temp.check_denied('a withdrawn code stops working',
  'select public.redeem_connection_code(' || quote_literal(:'code') || ', '
    || quote_literal(:sibling) || '::uuid)',
  'withdrawn');

-- Withdrawing the code does not evict the families already connected: it stops
-- new ones, which is what a tutor closing enrollment means.
select pg_temp.become(:tutor);
select pg_temp.check('withdrawing a code leaves existing links alone',
  (select count(*)::int from public.guardian_links
    where guardian_id = :tutor::uuid and learner_id = :pupil::uuid), 1);

-- ---------------------------------------------------------------------------
-- And the family can put them out again
-- ---------------------------------------------------------------------------
select pg_temp.become(:mum);
delete from public.guardian_links
 where guardian_id = :tutor::uuid and learner_id = :pupil::uuid;

select pg_temp.become(:tutor);
select pg_temp.check('a revoked tutor loses sight of the child',
  (select count(*)::int from public.learners where id = :pupil::uuid), 0);
select pg_temp.check('and of their work',
  (select count(*)::int from public.attempts where learner_id = :pupil::uuid), 0);

reset role;
\echo '--- all connection code tests passed ---'
