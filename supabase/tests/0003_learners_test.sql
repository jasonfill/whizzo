-- ============================================================================
-- Row Level Security tests for the learner inversion (0003).
--
-- These assert the *security* properties, not the happy path: the whole point
-- of the inversion is that a stranger cannot read a child's record and that an
-- under-13 cannot be given their own sign-in. Both are easy to break with an
-- innocent-looking policy edit, so they are pinned here.
--
-- Run against a scratch database that already has 0001, 0002 and 0003 applied:
--   psql -f supabase/tests/0003_learners_test.sql
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

-- Asserts that a statement is rejected, and that it is rejected for a reason
-- rather than by accident: the message has to match.
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
-- Fixtures: a parent, a second parent, an unrelated stranger, and two children.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'mum@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dad@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'stranger@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'teen-google@example.com')
on conflict (id) do nothing;

\set mum     '''aaaaaaaa-0000-0000-0000-000000000001'''
\set dad     '''aaaaaaaa-0000-0000-0000-000000000002'''
\set stranger '''aaaaaaaa-0000-0000-0000-000000000003'''
\set teen    '''aaaaaaaa-0000-0000-0000-000000000004'''

set role authenticated;

-- === Mum creates two children ===============================================
select pg_temp.become(:mum);

insert into public.learners (id, owner_id, display_name, birth_year)
values ('cccccccc-0000-0000-0000-00000000000a', :mum, 'Small Child', extract(year from current_date)::int - 7)
on conflict (id) do nothing;

insert into public.learners (id, owner_id, display_name, birth_year)
values ('cccccccc-0000-0000-0000-00000000000b', :mum, 'Big Kid', extract(year from current_date)::int - 14)
on conflict (id) do nothing;

\set small '''cccccccc-0000-0000-0000-00000000000a'''
\set big   '''cccccccc-0000-0000-0000-00000000000b'''

select pg_temp.check('owner sees both of her learners',
  (select count(*)::int from public.learners where owner_id = :mum::uuid), 2);

-- A parent playing on her own device records progress for the child.
insert into public.attempts (learner_id, subject, item_key, activity, is_test, correct)
values (:small::uuid, 'spelling', 'cat', 'listen-spell', true, true);

select pg_temp.check('owner can record progress for her child',
  (select count(*)::int from public.attempts where learner_id = :small::uuid), 1);

-- === A stranger sees nothing ================================================
select pg_temp.become(:stranger);

select pg_temp.check('stranger sees no learners',
  (select count(*)::int from public.learners), 0);
select pg_temp.check('stranger sees no attempts',
  (select count(*)::int from public.attempts where learner_id = :small::uuid), 0);
select pg_temp.check_denied('stranger cannot write progress for a child',
  format('insert into public.attempts (learner_id, subject, item_key, activity, is_test, correct)
          values (%L, ''spelling'', ''hack'', ''listen-spell'', true, true)', :small),
  'row-level security');
select pg_temp.check_denied('stranger cannot mint an invite for a child',
  format('select public.mint_link_invite(%L)', :small),
  'only the owner');
select pg_temp.check_denied('stranger cannot bump activity for a child',
  format('select public.bump_daily_activity(%L, ''spelling'', 60, 5, 5)', :small),
  'not allowed');

-- === Credentials are invisible to every browser session =====================
select pg_temp.check_denied('learner_credentials is unreadable by authenticated',
  'select count(*) from public.learner_credentials',
  'permission denied');
select pg_temp.check_denied('authenticate_learner is not callable by authenticated',
  'select public.authenticate_learner(''ABCDEFGH'', ''1234'')',
  'permission denied');
select pg_temp.check_denied('attach_provisioned_login is not callable by authenticated',
  format('select public.attach_provisioned_login(%L, %L, ''ABCDEFGH'', ''1234'')', :small, :stranger),
  'permission denied');

-- === The age gate ===========================================================
select pg_temp.become(:mum);

select pg_temp.check_denied('an under-13 cannot be given their own sign-in',
  format('update public.learners set auth_kind = ''self'', auth_user_id = %L where id = %L', :teen, :small),
  '13 or older');

-- === Pairing a second parent ================================================
select pg_temp.become(:mum);
select public.mint_link_invite(:small::uuid) as code \gset

select pg_temp.become(:dad);
select pg_temp.check('a redeemer cannot read the invite table',
  (select count(*)::int from public.link_invites), 0);

select pg_temp.check('dad redeems the invite and gets the learner back',
  (select public.redeem_link_invite(:'code')), :small::uuid);
select pg_temp.check('dad now sees the child',
  (select count(*)::int from public.learners where id = :small::uuid), 1);
select pg_temp.check('dad now sees the child''s progress',
  (select count(*)::int from public.attempts where learner_id = :small::uuid), 1);
select pg_temp.check_denied('an invite cannot be redeemed twice',
  format('select public.redeem_link_invite(%L)', :'code'),
  'not valid any more');

-- A guardian is not an owner: the controlling columns stay with mum.
select pg_temp.check_denied('a guardian cannot change the child''s birth year',
  format('update public.learners set birth_year = 1990 where id = %L', :small),
  'only the owner');
select pg_temp.check_denied('a guardian cannot re-home the child',
  format('update public.learners set owner_id = %L where id = %L', :dad, :small),
  'only the owner');

-- === Read-only guardians cannot rewrite content =============================
select pg_temp.become(:mum);
update public.guardian_links set can_manage_content = false
 where learner_id = :small::uuid and guardian_id = :dad::uuid;

select pg_temp.become(:dad);
select pg_temp.check('a read-only guardian still reads progress',
  (select count(*)::int from public.attempts where learner_id = :small::uuid), 1);
select pg_temp.check_denied('a read-only guardian cannot add a deck',
  format('insert into public.decks (learner_id, title) values (%L, ''Sneaky'')', :small),
  'row-level security');

select pg_temp.become(:mum);
insert into public.decks (learner_id, title, created_by) values (:small::uuid, 'Planets', :mum::uuid);
select pg_temp.check('an owner can add a deck to her child',
  (select count(*)::int from public.decks where learner_id = :small::uuid), 1);

-- === A 13+ learner may attach their own Google account ======================
select pg_temp.become(:mum);
select public.mint_link_invite(:big::uuid, 'parent', 'self_login') as selfcode \gset

select pg_temp.become(:teen);
select pg_temp.check('a 13+ learner redeems a self-login invite',
  (select public.redeem_link_invite(:'selfcode')), :big::uuid);
select pg_temp.check('the learner is now linked to their own auth user',
  (select auth_kind from public.learners where id = :big::uuid), 'self');
select pg_temp.check('the learner can see their own record',
  (select count(*)::int from public.learners where id = :big::uuid), 1);
select pg_temp.check('the learner cannot see their sibling',
  (select count(*)::int from public.learners where id = :small::uuid), 0);

-- === Revocation =============================================================
select pg_temp.become(:mum);
delete from public.guardian_links where learner_id = :small::uuid and guardian_id = :dad::uuid;

select pg_temp.become(:dad);
select pg_temp.check('a revoked guardian loses sight of the child',
  (select count(*)::int from public.learners where id = :small::uuid), 0);
select pg_temp.check('a revoked guardian loses the progress too',
  (select count(*)::int from public.attempts where learner_id = :small::uuid), 0);

-- === An account can actually be deleted ====================================
-- 0003 shipped a contradiction: auth_user_id is ON DELETE SET NULL, but
-- learners_auth_kind_consistent forbids a null auth_user_id while auth_kind
-- still says 'self'. Deleting any account a learner signed in with therefore
-- failed — including from the Supabase dashboard, and from the API's own
-- "turn off this child's sign-in" route. 0004 normalizes the row on the way
-- through. This is the regression guard.
--
-- Uses its own throwaway accounts rather than the fixtures above, because the
-- API smoke suite runs against the same database afterwards and needs them.
reset role;
-- Clear the JWT claim as well as the role. Deleting an account is an admin
-- action with no signed-in user behind it, and learners_guard only defends
-- against a *different* signed-in user editing those columns — so leaving a
-- stale claim in place would have the guard block the cascade.
select pg_temp.become(null);

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'purge-owner@example.com'),
  ('dddddddd-0000-0000-0000-000000000002', 'purge-teen@example.com')
on conflict (id) do nothing;

insert into public.learners
  (id, owner_id, display_name, birth_year, auth_user_id, auth_kind)
values
  ('dddddddd-0000-0000-0000-00000000000a',
   'dddddddd-0000-0000-0000-000000000001',
   'Purge Teen',
   extract(year from current_date)::int - 15,
   'dddddddd-0000-0000-0000-000000000002',
   'self')
on conflict (id) do nothing;

\set powner '''dddddddd-0000-0000-0000-000000000001'''
\set pteen  '''dddddddd-0000-0000-0000-000000000002'''
\set plearner '''dddddddd-0000-0000-0000-00000000000a'''

select pg_temp.check('the throwaway learner is linked before we start',
  (select auth_kind from public.learners where id = :plearner::uuid), 'self');

delete from auth.users where id = :pteen::uuid;

select pg_temp.check('deleting an auth user succeeds',
  (select count(*)::int from auth.users where id = :pteen::uuid), 0);
select pg_temp.check('the learner survives, because the parent owns them',
  (select count(*)::int from public.learners where id = :plearner::uuid), 1);
select pg_temp.check('and their sign-in mode falls back to none',
  (select auth_kind from public.learners where id = :plearner::uuid), 'none');
select pg_temp.check('no learner is left in an inconsistent state',
  (select count(*)::int from public.learners
    where (auth_user_id is null) <> (auth_kind = 'none')), 0);

-- Deleting an owner takes their learners and everything under them.
delete from auth.users where id = :powner::uuid;
select pg_temp.check('deleting an owner removes their learners',
  (select count(*)::int from public.learners where owner_id = :powner::uuid), 0);
select pg_temp.check('and leaves no orphaned progress',
  (select count(*)::int from public.attempts a
     left join public.learners l on l.id = a.learner_id where l.id is null), 0);

reset role;
\echo '--- all learner RLS tests passed ---'
