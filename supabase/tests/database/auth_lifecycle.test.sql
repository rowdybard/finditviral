-- Auth lifecycle tests: verify handle_new_user trigger, complete_onboarding
-- guards, username normalization collisions, one-time onboarding, and
-- member restriction enforcement.
-- Behavioral tests create users and exercise the RPCs directly.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(8);

-- ============================================================================
-- Fixtures: create test users with different states
-- ============================================================================
do $$
declare
  v_unconfirmed_id uuid := '00000000-0000-4000-8000-0000000000c1';
  v_confirmed_id uuid := '00000000-0000-4000-8000-0000000000c2';
  v_completed_id uuid := '00000000-0000-4000-8000-0000000000c3';
  v_restricted_id uuid := '00000000-0000-4000-8000-0000000000c4';
  v_zip_test_id uuid := '00000000-0000-4000-8000-0000000000c5';
  v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  set local session_replication_role = 'replica';

  -- Unconfirmed user (no email_confirmed_at)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_unconfirmed_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'unconfirmed@test.local', 'test', now(), now())
  on conflict (id) do nothing;
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_unconfirmed_id, 'user_unconf', false, 0, now())
  on conflict (id) do update set onboarding_completed = false, username = 'user_unconf';
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_unconfirmed_id, 'user_unconf', 'user_unconf', 'user_unconf', false)
  on conflict (user_id) do update set claimed_username = 'user_unconf', normalized_username = 'user_unconf', protection_name = 'user_unconf', is_legacy = false;

  -- Confirmed but not onboarded user
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_confirmed_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'confirmed@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_confirmed_id, 'user_conf', false, 0, now())
  on conflict (id) do update set onboarding_completed = false, username = 'user_conf';
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_confirmed_id, 'user_conf', 'user_conf', 'user_conf', false)
  on conflict (user_id) do update set claimed_username = 'user_conf', normalized_username = 'user_conf', protection_name = 'user_conf', is_legacy = false;

  -- Already onboarded user
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_completed_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'completed@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_completed_id, 'user_done', true, 10, now())
  on conflict (id) do update set onboarding_completed = true, username = 'user_done';
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_completed_id, 'user_done', 'user_done', 'user_done', false)
  on conflict (user_id) do update set claimed_username = 'user_done', normalized_username = 'user_done', protection_name = 'user_done', is_legacy = false;

  -- Restricted (suspended) user
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_restricted_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'restricted@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_restricted_id, 'user_rest', true, 10, now())
  on conflict (id) do update set onboarding_completed = true, username = 'user_rest';
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_restricted_id, 'user_rest', 'user_rest', 'user_rest', false)
  on conflict (user_id) do update set claimed_username = 'user_rest', normalized_username = 'user_rest', protection_name = 'user_rest', is_legacy = false;
  insert into private.member_restrictions (user_id, status, reason, expires_at, created_by)
  values (v_restricted_id, 'suspended', 'test suspension', now() + interval '30 days', v_owner_id)
  on conflict (user_id) do update set status = 'suspended', expires_at = now() + interval '30 days';

  -- Confirmed user for ZIP validation test (not yet onboarded)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_zip_test_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'ziptest@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_zip_test_id, 'user_zip', false, 0, now())
  on conflict (id) do update set onboarding_completed = false, username = 'user_zip';
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_zip_test_id, 'user_zip', 'user_zip', 'user_zip', false)
  on conflict (user_id) do update set claimed_username = 'user_zip', normalized_username = 'user_zip', protection_name = 'user_zip', is_legacy = false;

  set local session_replication_role = 'origin';
end;
$$;

-- Helper: set JWT claims for a specific user
create or replace function pg_temp.set_ctx(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated', 'is_anonymous', false)::text,
    true);
end;
$$;

-- ============================================================================
-- 1. handle_new_user trigger exists on auth.users (structural)
-- ============================================================================
select ok(
  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name = 'on_auth_user_created'
  ),
  'handle_new_user trigger exists on auth.users'
);

-- ============================================================================
-- 2. complete_onboarding rejects unconfirmed email (behavioral)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_ctx('00000000-0000-4000-8000-0000000000c1');
    perform public.complete_onboarding('newuser', '48910', null, null, null);
  end;
  $body$;
  $test$,
  '42501',
  'Permanent authenticated account required',
  'complete_onboarding rejects user without email_confirmed_at'
);

-- ============================================================================
-- 3. complete_onboarding succeeds for confirmed user (behavioral)
-- ============================================================================
select lives_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_ctx('00000000-0000-4000-8000-0000000000c2');
    perform public.complete_onboarding('onboardok', '48910', 'looking for toys', null, array['Lansing']);
  end;
  $body$;
  $test$,
  'complete_onboarding succeeds for confirmed user with valid username and ZIP'
);

-- ============================================================================
-- 4. complete_onboarding rejects duplicate completion (behavioral)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_ctx('00000000-0000-4000-8000-0000000000c3');
    perform public.complete_onboarding('another', '48910', null, null, null);
  end;
  $body$;
  $test$,
  '55006',
  'Onboarding has already been completed',
  'complete_onboarding rejects already-completed profile'
);

-- ============================================================================
-- 5. complete_onboarding rejects invalid ZIP (behavioral)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_ctx('00000000-0000-4000-8000-0000000000c5');
    perform public.complete_onboarding('zipbad', '99999', null, null, null);
  end;
  $body$;
  $test$,
  '22023',
  'ZIP code must be in the Greater Lansing beta area',
  'complete_onboarding rejects ZIP outside allowed Greater Lansing set'
);

-- ============================================================================
-- 6. is_permanent_member returns false for unconfirmed user (behavioral)
-- ============================================================================
select results_eq(
  $$ select private.is_permanent_member('00000000-0000-4000-8000-0000000000c1') $$,
  $$ select false $$,
  'is_permanent_member returns false for unconfirmed email user'
);

-- ============================================================================
-- 7. is_permanent_member returns false for suspended user (behavioral)
-- ============================================================================
select results_eq(
  $$ select private.is_permanent_member('00000000-0000-4000-8000-0000000000c4') $$,
  $$ select false $$,
  'is_permanent_member returns false for suspended user'
);

-- ============================================================================
-- 8. assert_permanent_member raises 42501 for non-member (behavioral)
-- ============================================================================
select set_config('request.jwt.claims', '', true);
grant usage on schema private to authenticated;
grant execute on function private.assert_permanent_member() to authenticated;
set role authenticated;
select throws_ok(
  $$ select private.assert_permanent_member() $$,
  '42501',
  'Permanent member account required',
  'assert_permanent_member raises 42501 for non-member'
);
reset role;
revoke execute on function private.assert_permanent_member() from authenticated;
revoke usage on schema private from authenticated;

select * from finish();

rollback;
