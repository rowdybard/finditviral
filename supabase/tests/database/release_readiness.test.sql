-- Behavioral pgTAP tests for release readiness migration (20260715000010).
-- Tests draft payload validation, bounty lifecycle, admin RPCs, security, and search.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(27);

-- ============================================================================
-- Test fixtures: create two test users, profiles, username claims, app_owners
-- ============================================================================
do $$
declare
  v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
  v_member_id uuid := '00000000-0000-4000-8000-000000000002';
begin
  -- Owner user in auth.users
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'owner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  -- Member user in auth.users
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'member@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  -- Owner profile
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_owner_id, 'testowner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = 'testowner';

  -- Member profile
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_member_id, 'testmember', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'testmember';

  -- Username claims (exactly 1 per user for is_permanent_member)
  insert into private.username_claims (user_id, username, normalized_username, protection_name, is_legacy)
  values (v_owner_id, 'testowner', 'testowner', 'testowner', false)
  on conflict do nothing;

  insert into private.username_claims (user_id, username, normalized_username, protection_name, is_legacy)
  values (v_member_id, 'testmember', 'testmember', 'testmember', false)
  on conflict do nothing;

  -- Owner in app_owners
  insert into private.app_owners (user_id)
  values (v_owner_id)
  on conflict (user_id) do nothing;
end;
$$;

-- Helper: set JWT claims for owner
create or replace function pg_temp.set_owner_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- Helper: set JWT claims for member
create or replace function pg_temp.set_member_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- ============================================================================
-- 1. Draft payload accepts all current bounty fields
-- ============================================================================
select lives_ok(
  $$ select private.validate_draft_payload('bounty',
    '{"version":1,"product":null,"scope":"region","store":null,"zipCode":"48910","radiusMiles":"50","rewardAmount":"20","deadline":"2026-07-20","requirements":"","quantityNeeded":"1","variantRequirements":"","acceptEquivalent":false,"selectedRetailers":[],"selectedStores":[]}'::jsonb) $$,
  'bounty draft payload with all current fields validates successfully'
);

-- 2. Draft payload rejects unknown fields
select throws_ok(
  $$ select private.validate_draft_payload('bounty',
    '{"version":1,"unknownField":"bad"}'::jsonb) $$,
  '22023',
  'bounty draft payload rejects unknown fields'
);

-- 3. Draft payload rejects invalid scope
select throws_ok(
  $$ select private.validate_draft_payload('bounty',
    '{"version":1,"scope":"invalid"}'::jsonb) $$,
  '22023',
  'bounty draft payload rejects invalid scope'
);

-- 4. refresh_contribution_draft reads zipCode (not zip_code)
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'refresh_contribution_draft'
      and pg_get_functiondef(p.oid) ~ "zipCode"
  ),
  'refresh_contribution_draft reads zipCode from payload'
);

-- ============================================================================
-- 5. Bounty scope check constraint allows ZIP+radius for retailers
-- ============================================================================
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'bounties'
      and c.conname = 'bounties_scope_check'
      and pg_get_constraintdef(c.oid) ~ "scope_type = 'retailers'.*zip_code.*radius_miles"
  ),
  'bounties_scope_check allows ZIP+radius for retailers scope'
);

-- 6. validate_bounty_scope trigger has been dropped
select hasnt_function(
  'public', 'validate_bounty_scope',
  'validate_bounty_scope trigger function dropped'
);

-- 7. create_bounty validates associations after insert (not via trigger)
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
      and pg_get_functiondef(p.oid) ~ 'bounty_retailers.*bounty_id = v_bounty_id'
      and pg_get_functiondef(p.oid) ~ 'bounty_stores.*bounty_id = v_bounty_id'
  ),
  'create_bounty validates associations inside function body'
);

-- ============================================================================
-- 8. list_public_bounties returns retailer_names and store_names
-- ============================================================================
select has_column(
  'public', 'list_public_bounties', 'retailer_names',
  'list_public_bounties returns retailer_names column'
);

select has_column(
  'public', 'list_public_bounties', 'store_names',
  'list_public_bounties returns store_names column'
);

-- 9. get_bounty_detail returns retailer_names and store_names
select has_column(
  'public', 'get_bounty_detail', 'retailer_names',
  'get_bounty_detail returns retailer_names column'
);

select has_column(
  'public', 'get_bounty_detail', 'store_names',
  'get_bounty_detail returns store_names column'
);

-- ============================================================================
-- 10. Admin store RPC signature: no phone/website_url, has source_url
-- ============================================================================
select has_function(
  'public', 'admin_create_store',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'numeric'],
  'admin_create_store has correct signature with source_url'
);

select hasnt_function(
  'public', 'admin_create_store',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'numeric'],
  'admin_create_store old signature with phone/website_url is gone'
);

-- 11. Admin product RPC signature: brand instead of retailer
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_create_product'
      and pg_get_functiondef(p.oid) ~ 'p_brand'
      and pg_get_functiondef(p.oid) !~ 'p_retailer'
  ),
  'admin_create_product uses p_brand (not p_retailer)'
);

-- 12. admin_create_store inserts verification_method and verified_at
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_create_store'
      and pg_get_functiondef(p.oid) ~ 'owner_verified'
      and pg_get_functiondef(p.oid) ~ 'official_source'
      and pg_get_functiondef(p.oid) ~ 'verified_at'
  ),
  'admin_create_store sets verification_method and verified_at'
);

-- 13. admin_create_product inserts brand column
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_create_product'
      and pg_get_functiondef(p.oid) ~ 'insert into public\.products'
      and pg_get_functiondef(p.oid) ~ 'brand'
  ),
  'admin_create_product inserts brand column'
);

-- ============================================================================
-- 14. Personal notifications revoked from anon
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.get_personal_notifications(integer)', 'execute'),
  'anon cannot execute get_personal_notifications'
);

select ok(
  has_function_privilege('authenticated', 'public.get_personal_notifications(integer)', 'execute'),
  'authenticated can execute get_personal_notifications'
);

-- ============================================================================
-- 15. Username unique index on normalized_username for non-legacy
-- ============================================================================
select has_index(
  'private', 'username_claims', 'username_claims_normalized_unique_idx',
  'username_claims has unique index on normalized_username'
);

select index_is_unique(
  'private', 'username_claims', 'username_claims_normalized_unique_idx',
  'username_claims normalized_username index is unique'
);

-- ============================================================================
-- 16. search_products includes brand
-- ============================================================================
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_products'
      and pg_get_functiondef(p.oid) ~ 'p\.brand'
  ),
  'search_products searches on brand column'
);

-- 17. products has brand index
select has_index(
  'public', 'products', 'products_brand_idx',
  'products has index on brand'
);

-- ============================================================================
-- 18. submit_bounty_claim checks retailer scope distance
-- ============================================================================
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bounty_claim'
      and pg_get_functiondef(p.oid) ~ "scope_type = 'retailers'"
      and pg_get_functiondef(p.oid) ~ 'distance_miles'
      and pg_get_functiondef(p.oid) ~ 'radius_miles'
  ),
  'submit_bounty_claim checks distance for retailer scope'
);

-- 19. submit_bounty_claim checks store belongs to allowed retailer
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bounty_claim'
      and pg_get_functiondef(p.oid) ~ 'bounty_retailers'
  ),
  'submit_bounty_claim checks store belongs to allowed retailer'
);

-- ============================================================================
-- 20. create_bounty requires ZIP+radius for retailer scope
-- ============================================================================
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
      and pg_get_functiondef(p.oid) ~ "scope_type = 'retailers'"
      and pg_get_functiondef(p.oid) ~ 'v_zip is null'
      and pg_get_functiondef(p.oid) ~ 'p_radius_miles not in'
  ),
  'create_bounty requires ZIP+radius for retailer scope'
);

-- 21. create_bounty hint codes for stable error mapping
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
      and pg_get_functiondef(p.oid) ~ "hint = 'INVALID_SCOPE'"
      and pg_get_functiondef(p.oid) ~ "hint = 'INVALID_LOCATION'"
      and pg_get_functiondef(p.oid) ~ "hint = 'INVALID_BOUNTY_DETAILS'"
  ),
  'create_bounty has stable error hint codes'
);

-- 22. submit_bounty_claim hint codes
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bounty_claim'
      and pg_get_functiondef(p.oid) ~ "hint = 'BOUNTY_CLOSED'"
      and pg_get_functiondef(p.oid) ~ "hint = 'STORE_OUT_OF_SCOPE'"
      and pg_get_functiondef(p.oid) ~ "hint = 'UNAUTHORIZED'"
  ),
  'submit_bounty_claim has stable error hint codes'
);

-- ============================================================================
-- 23. Admin store creation works against real schema (behavioral)
-- ============================================================================
select pg_temp.set_owner_ctx();

select lives_ok(
  $$ select public.admin_create_store(
    'Test Retailer Co',
    'Test Store Alpha',
    '123 Test St',
    'Lansing',
    'MI',
    '48910',
    null,
    null,
    null
  ) $$,
  'admin_create_store succeeds with real schema columns'
);

-- 24. Admin product creation works (behavioral)
-- Get a trend ID from seed data
select lives_ok(
  $$ declare v_trend_id uuid;
    select id into v_trend_id from public.trends where is_active limit 1;
    if v_trend_id is null then
      insert into public.trends (name, slug, description, is_active)
      values ('Test Trend', 'test-trend', 'Test', true)
      on conflict (slug) do update set is_active = true
      returning id into v_trend_id;
    end if;
    perform public.admin_create_product(v_trend_id, 'Test Product Alpha', 'available', null, null, 'TestBrand');
  $$,
  'admin_create_product succeeds with brand column'
);

-- 25. Non-owner admin call fails
select pg_temp.set_member_ctx();

select throws_ok(
  $$ select public.admin_create_store(
    'Unauthorized Retailer',
    'Unauthorized Store',
    '456 Fail St',
    'Lansing',
    'MI',
    '48910',
    null,
    null,
    null
  ) $$,
  '42501',
  'non-owner cannot create store'
);

-- ============================================================================
-- 26. Product search finds by brand (behavioral)
-- ============================================================================
-- Insert a product with a unique brand for search testing
insert into public.products (trend_id, name, slug, brand, is_active, verification_method, verified_at)
select t.id, 'BrandSearch Test Product', 'brandsearch-test-product', 'UniqueBrandXYZ', true, 'owner_verified', now()
from public.trends t where t.is_active limit 1
on conflict (slug) do update set brand = 'UniqueBrandXYZ', is_active = true;

select results_eq(
  $$ select count(*) > 0 from public.search_products('UniqueBrandXYZ', 12) $$,
  $$ select true $$,
  'search_products finds products by brand'
);

-- 27. Onboarding interest events have NULL email in DB
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_onboarding'
      and pg_get_functiondef(p.oid) ~ 'onboarding_looking_for'
      and pg_get_functiondef(p.oid) ~ 'email.*null'
  ),
  'complete_onboarding stores NULL email for onboarding_looking_for events'
);

select * from finish();
rollback;
