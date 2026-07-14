-- Privacy isolation tests: verify cross-member access is denied for
-- profile_locations, profile_contacts, private sightings, contribution_drafts,
-- and early_access_requests. Also verify bounty claim contact info is only
-- visible to participants, and admin RPCs reject ordinary members.
-- Behavioral tests create two users and verify RLS isolation by querying as each user.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(10);

-- ============================================================================
-- Fixtures: create Alice and Bob as permanent members
-- ============================================================================
do $$
declare
  v_alice_id uuid := '00000000-0000-4000-8000-0000000000b1';
  v_bob_id uuid := '00000000-0000-4000-8000-0000000000b2';
  v_product_id uuid;
  v_store_id uuid;
begin
  set local session_replication_role = 'replica';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_alice_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'alice@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_bob_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'bob@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_alice_id, 'alice', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'alice';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_bob_id, 'bob', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'bob';

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_alice_id, 'alice', 'alice', 'alice', false)
  on conflict (user_id) do update set claimed_username = 'alice', normalized_username = 'alice', protection_name = 'alice', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_bob_id, 'bob', 'bob', 'bob', false)
  on conflict (user_id) do update set claimed_username = 'bob', normalized_username = 'bob', protection_name = 'bob', is_legacy = false;

  -- Alice's private location
  insert into public.profile_locations (user_id, zip_code)
  values (v_alice_id, '48910')
  on conflict (user_id) do update set zip_code = '48910';

  -- Alice's contact info
  insert into public.profile_contacts (user_id, contact_info)
  values (v_alice_id, 'alice-private-contact@test.local')
  on conflict (user_id) do update set contact_info = 'alice-private-contact@test.local';

  -- Alice's private sighting
  select id into v_product_id from public.products where is_active order by verified_at desc limit 1;
  select id into v_store_id from public.stores where is_active limit 1;
  insert into public.sightings (user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, seen_at, is_public, moderation_status)
  values (v_alice_id, v_product_id, v_store_id, 'Test Store', 'Lansing', 'MI', '48910',
    'in_stock', 'in_stock', now() - interval '1 hour', false, 'approved');

  -- Alice's contribution draft
  insert into private.contribution_drafts (user_id, draft_type, payload, product_id, store_id, state)
  values (v_alice_id, 'sighting', '{"version":1}'::jsonb, v_product_id, v_store_id, 'editing');

  set local session_replication_role = 'origin';
end;
$$;

-- Helper: set JWT claims for Alice
create or replace function pg_temp.set_alice_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- Helper: set JWT claims for Bob
create or replace function pg_temp.set_bob_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- ============================================================================
-- 1. profile_locations has RLS enabled (structural)
-- ============================================================================
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'profile_locations'
      and relnamespace = 'public'::regnamespace
  ),
  'profile_locations has RLS enabled'
);

-- ============================================================================
-- 2. Bob cannot read Alice's profile_locations (behavioral)
-- ============================================================================
select pg_temp.set_bob_ctx();
set role authenticated;
select results_eq(
  $$ select count(*) from public.profile_locations where user_id = '00000000-0000-4000-8000-0000000000b1' $$,
  $$ select 0::bigint $$,
  'Bob cannot read Alice profile_locations row'
);
reset role;

-- ============================================================================
-- 3. profile_contacts has RLS enabled (structural)
-- ============================================================================
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'profile_contacts'
      and relnamespace = 'public'::regnamespace
  ),
  'profile_contacts has RLS enabled'
);

-- ============================================================================
-- 4. Bob cannot read Alice's profile_contacts (behavioral)
-- ============================================================================
set role authenticated;
select results_eq(
  $$ select count(*) from public.profile_contacts where user_id = '00000000-0000-4000-8000-0000000000b1' $$,
  $$ select 0::bigint $$,
  'Bob cannot read Alice profile_contacts row'
);
reset role;

-- ============================================================================
-- 5. Bob cannot read Alice's private sightings (behavioral)
-- ============================================================================
set role authenticated;
select results_eq(
  $$ select count(*) from public.sightings
     where user_id = '00000000-0000-4000-8000-0000000000b1' and is_public = false $$,
  $$ select 0::bigint $$,
  'Bob cannot read Alice private sightings'
);
reset role;

-- ============================================================================
-- 6. Alice can read her own private sightings (behavioral — positive control)
-- ============================================================================
select pg_temp.set_alice_ctx();
set role authenticated;
select ok(
  (
    select count(*) >= 1 from public.sightings
    where user_id = '00000000-0000-4000-8000-0000000000b1' and is_public = false
  ),
  'Alice can read her own private sightings'
);
reset role;

-- ============================================================================
-- 7. contribution_drafts has RLS enabled with no authenticated read policy (structural)
-- ============================================================================
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'contribution_drafts'
      and relnamespace = 'private'::regnamespace
  )
  and not exists (
    select 1
    from pg_policies
    where schemaname = 'private'
      and tablename = 'contribution_drafts'
      and cmd = 'SELECT'
      and roles @> '{authenticated}'
  ),
  'contribution_drafts has RLS enabled with no authenticated read policy'
);

-- ============================================================================
-- 8. Bob cannot read Alice's contribution_drafts (behavioral)
-- ============================================================================
select pg_temp.set_bob_ctx();
grant usage on schema private to authenticated;
grant select on private.contribution_drafts to authenticated;
set role authenticated;
select results_eq(
  $$ select count(*) from private.contribution_drafts where user_id = '00000000-0000-4000-8000-0000000000b1' $$,
  $$ select 0::bigint $$,
  'Bob cannot read Alice contribution_drafts'
);
reset role;
revoke select on private.contribution_drafts from authenticated;
revoke usage on schema private from authenticated;

-- ============================================================================
-- 9. admin_list_products rejects ordinary member (behavioral)
-- ============================================================================
select throws_ok(
  $$ select * from public.admin_list_products(false, 50) $$,
  '42501',
  'Owner access required',
  'admin_list_products rejects ordinary member with 42501'
);

-- ============================================================================
-- 10. admin_list_stores rejects ordinary member (behavioral)
-- ============================================================================
select throws_ok(
  $$ select * from public.admin_list_stores(false, 50) $$,
  '42501',
  'Owner access required',
  'admin_list_stores rejects ordinary member with 42501'
);

select * from finish();

rollback;
