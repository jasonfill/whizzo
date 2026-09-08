-- ============================================================================
-- One-code-box tests (0021).
--
-- There are two pairing systems and they run opposite ways: an invite hands
-- the redeemer access to one child, a connection code asks the redeemer to
-- grant it. Both are eight characters from the same alphabet, so nothing on
-- the paper says which is which — and while each entry box took only its own
-- kind, a code in the wrong box came back "not valid any more" about a code
-- that was perfectly good.
--
-- So these pin the two things that fixed it:
--
--   * describe_any_code resolves EITHER kind, and says which
--   * every refusal carries a sqlstate the API can turn into an answer,
--     rather than P0001, which reaches a browser as HTTP 500
--
-- It also pins what resolving must NOT leak: a code tells you about itself and
-- the person holding it, never about their other students.
--
-- Run against a scratch database with 0001-0021 applied:
--   psql -f supabase/tests/0021_one_code_box_test.sql
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

/**
 * Denied, and denied in a way the API can pass on.
 *
 * The sqlstate matters as much as the message here: fromDatabaseError maps
 * 23514 onto 400 with the database's own words, and leaves P0001 to become
 * "Something went wrong on our side" — which is what a family used to be told
 * about a code that had simply been handed to the wrong person.
 */
create or replace function pg_temp.check_denied(
  p_label text, p_sql text, p_match text default '', p_sqlstate text default null
)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_match <> '' and position(lower(p_match) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL % — denied, but for the wrong reason: %', p_label, sqlerrm;
    end if;
    if p_sqlstate is not null and sqlstate <> p_sqlstate then
      raise exception 'FAIL % — denied as % rather than %, so the API cannot pass it on',
        p_label, sqlstate, p_sqlstate;
    end if;
    raise notice 'pass: % (denied: %)', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL % — the statement was allowed and should not have been', p_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: a tutor, a family, and an unrelated stranger.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values
  ('dddddddd-2100-0000-0000-000000000001', 'tutor21@example.com'),
  ('dddddddd-2100-0000-0000-000000000002', 'mum21@example.com'),
  ('dddddddd-2100-0000-0000-000000000003', 'other21@example.com')
on conflict (id) do nothing;

update public.profiles set display_name = 'Mrs Patel'
 where id = 'dddddddd-2100-0000-0000-000000000001';
update public.profiles set display_name = 'Sam'
 where id = 'dddddddd-2100-0000-0000-000000000002';

\set tutor    '''dddddddd-2100-0000-0000-000000000001'''
\set mum      '''dddddddd-2100-0000-0000-000000000002'''
\set other    '''dddddddd-2100-0000-0000-000000000003'''
\set pupil    '''dddddddd-2100-0000-0000-00000000000a'''

set role authenticated;

select pg_temp.become(:mum);
insert into public.learners (id, owner_id, display_name, birth_year) values
  (:pupil::uuid, :mum::uuid, 'Pupil21', extract(year from current_date)::int - 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- One lookup, either kind
-- ---------------------------------------------------------------------------
select pg_temp.become(:tutor);
select public.mint_connection_code('Tuesday maths') as conn \gset

select pg_temp.become(:mum);
select public.mint_link_invite(:pupil::uuid, 'parent', 'guardian', interval '24 hours') as inv \gset

-- The family holding a tutor's code.
select pg_temp.become(:mum);
select pg_temp.check('a connection code says which system it belongs to',
  (select kind from public.describe_any_code(:'conn')), 'connection');
select pg_temp.check('and that it is usable',
  (select valid from public.describe_any_code(:'conn')), true);
select pg_temp.check('and whose it is',
  (select owner_name from public.describe_any_code(:'conn')), 'Mrs Patel');
select pg_temp.check('and what it is for',
  (select label from public.describe_any_code(:'conn')), 'Tuesday maths');

-- The other grown-up holding an invite. This is the case that used to fail:
-- the same eight characters, resolved by the same call.
select pg_temp.become(:other);
select pg_temp.check('an invite resolves through the same lookup',
  (select kind from public.describe_any_code(:'inv')), 'invite');
select pg_temp.check('and is usable',
  (select valid from public.describe_any_code(:'inv')), true);
select pg_temp.check('and names who is sharing',
  (select owner_name from public.describe_any_code(:'inv')), 'Sam');
select pg_temp.check('and which child it is about, so nobody accepts blind',
  (select label from public.describe_any_code(:'inv')), 'Pupil21');

select pg_temp.check('a code from neither system is reported, not guessed at',
  (select kind from public.describe_any_code('ZZZZZZZZ')), 'unknown');
select pg_temp.check('and says so plainly',
  (select reason from public.describe_any_code('ZZZZZZZZ')), 'That code does not exist');

-- Read off paper, so case and stray spaces cannot be the reason it fails.
select pg_temp.check('a code is matched however it was typed',
  (select valid from public.describe_any_code('  ' || lower(:'conn') || ' ')), true);

-- ---------------------------------------------------------------------------
-- Refusals that say what is wrong
-- ---------------------------------------------------------------------------
-- Every one of these is a rule the person typing can act on, and each used to
-- arrive as the same dead end.

select pg_temp.become(:tutor);
select pg_temp.check('your own connection code is refused before you pick children',
  (select valid from public.describe_any_code(:'conn')), false);
select pg_temp.check('and told to be given away rather than used',
  (select reason from public.describe_any_code(:'conn')),
  'That is your own code — give it to the family you work with');

select pg_temp.become(:mum);
select pg_temp.check('your own invite is refused too',
  (select valid from public.describe_any_code(:'inv')), false);

select pg_temp.become(:mum);
select public.mint_link_invite(:pupil::uuid, 'parent', 'guardian', interval '-1 hour') as stale \gset
select pg_temp.become(:other);
select pg_temp.check('an expired invite is named as expired, not as unknown',
  (select kind from public.describe_any_code(:'stale')), 'invite');
select pg_temp.check('and says what to do about it',
  (select reason from public.describe_any_code(:'stale')),
  'That code has expired — ask them for a new one');

select pg_temp.become(:tutor);
select public.mint_connection_code('Withdrawn', 'tutor', true, null, null) as gone \gset
update public.connection_codes set revoked_at = now() where code = :'gone';
select pg_temp.become(:mum);
select pg_temp.check('a withdrawn code is named as withdrawn',
  (select reason from public.describe_any_code(:'gone')), 'That code has been withdrawn');

-- ---------------------------------------------------------------------------
-- Refusals the API can pass on
-- ---------------------------------------------------------------------------
-- This is the half that turned honest rules into HTTP 500. The messages did
-- not change; only whether the person on the other end is allowed to hear them.

select pg_temp.become(:mum);
select pg_temp.check_denied('a withdrawn code refuses as check_violation, not as a crash',
  'select public.redeem_connection_code(' || quote_literal(:'gone') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'withdrawn', '23514');

select pg_temp.check_denied('a code that does not exist refuses the same way',
  'select public.redeem_connection_code(''ZZZZZZZZ'', '
    || quote_literal(:pupil) || '::uuid)',
  'does not exist', '23514');

select pg_temp.become(:tutor);
insert into public.learners (id, owner_id, display_name, birth_year)
values ('dddddddd-2100-0000-0000-00000000000b', :tutor::uuid, 'Own Child',
        extract(year from current_date)::int - 9)
on conflict (id) do nothing;
select pg_temp.check_denied('and so does your own code, which is a rule not a fault',
  'select public.redeem_connection_code(' || quote_literal(:'conn') || ', '
    || '''dddddddd-2100-0000-0000-00000000000b''::uuid)',
  'your own code', '23514');

-- Not owning the learner stays a permission answer rather than a rule answer,
-- because it is one: 42501 becomes 403, and the other four become 400.
select pg_temp.become(:other);
select pg_temp.check_denied('granting access to a child that is not yours is still forbidden',
  'select public.redeem_connection_code(' || quote_literal(:'conn') || ', '
    || quote_literal(:pupil) || '::uuid)',
  'owns this learner', '42501');

-- ---------------------------------------------------------------------------
-- What resolving a code must not reveal
-- ---------------------------------------------------------------------------
-- A code is a business card. Holding one tells you about the person who wrote
-- it, and nothing about anybody else they work with.
select pg_temp.become(:mum);
select public.redeem_connection_code(:'conn', :pupil::uuid);

select pg_temp.become(:other);
select pg_temp.check('resolving a tutor code exposes none of their students',
  (select count(*)::int from public.learners), 0);

-- Signed out, not privileged: clearing the claim rather than dropping the role,
-- because `reset role` would make this postgres and prove nothing.
select pg_temp.become(null::uuid);
select pg_temp.check_denied('and a signed-out stranger cannot resolve one at all',
  'select * from public.describe_any_code(' || quote_literal(:'conn') || ')',
  'sign in', '42501');

-- ---------------------------------------------------------------------------
-- Leave the database as we found it
-- ---------------------------------------------------------------------------
reset role;
delete from public.guardian_links
 where guardian_id in (:tutor::uuid, :other::uuid);
delete from public.connection_codes where owner_id = :tutor::uuid;
delete from public.link_invites where created_by = :mum::uuid;
delete from public.learners
 where owner_id in (:mum::uuid, :tutor::uuid);
delete from auth.users where id in (:tutor::uuid, :mum::uuid, :other::uuid);

\echo '--- all one-code-box tests passed ---'
