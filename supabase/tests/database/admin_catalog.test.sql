-- Behavioral pgTAP tests for admin catalog management RPCs.
-- Covers the admin_list_products/admin_list_stores owner-check fix
-- (20260717000000), a full create->update->disable->restore lifecycle for
-- both products and stores (verified via list output and search exclusion),
-- and member/anon denial across all 8 admin catalog RPCs.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(32);

-- ============================================================================
-- Test fixtures: owner + member users
-- ============================================================================
do $$
declare
  v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
  v_member_id uuid := '00000000-0000-4000-8000-000000000002';
begin
  set local session_replication_role = 'replica';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'catalogowner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  update public.profiles set username = 'catalogowner' where id = v_owner_id;
  update private.username_claims set claimed_username = 'catalogowner', normalized_username = 'catalogowner' where user_id = v_owner_id;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'catalogmember@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  update public.profiles set username = 'catalogmember' where id = v_member_id;
  update private.username_claims set claimed_username = 'catalogmember', normalized_username = 'catalogmember' where user_id = v_member_id;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_owner_id, 'catalogowner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = 'catalogowner';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_member_id, 'catalogmember', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'catalogmember';

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_owner_id, 'catalogowner', 'catalogowner', 'catalogowner', false)
  on conflict (user_id) do update set claimed_username = 'catalogowner', normalized_username = 'catalogowner', protection_name = 'catalogowner', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_member_id, 'catalogmember', 'catalogmember', 'catalogmember', false)
  on conflict (user_id) do update set claimed_username = 'catalogmember', normalized_username = 'catalogmember', protection_name = 'catalogmember', is_legacy = false;

  insert into private.app_owners (user_id)
  values (v_owner_id)
  on conflict (user_id) do nothing;

  set local session_replication_role = 'origin';
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

-- Helper: fetch the seed trend ID used for owner-verified products
create or replace function pg_temp.get_test_trend_id()
returns uuid language sql stable as $$
  select id from public.trends where slug = 'community-verified';
$$;

-- ============================================================================
-- Anon has no execute privilege on either admin list function (structural)
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.admin_list_products(boolean,integer)', 'execute'),
  'anon cannot execute admin_list_products'
);
select ok(
  not has_function_privilege('anon', 'public.admin_list_stores(boolean,integer)', 'execute'),
  'anon cannot execute admin_list_stores'
);

-- ============================================================================
-- Owner: create product + store
-- ============================================================================
select pg_temp.set_owner_ctx();

select lives_ok(
  $$ select public.admin_create_product(
    pg_temp.get_test_trend_id(), 'Catalog QA Product', 'available', null, null,
    'CatalogQABrand', 'CatalogQACategory', 'catalogqasearchtermxyz'
  ) $$,
  'owner can create a product'
);

select lives_ok(
  $$ select public.admin_create_store(
    'Catalog QA Retailer', 'Catalog QA Store', '1 Test Ave', 'Lansing', 'MI', '48910',
    null::text, null::numeric, null::numeric
  ) $$,
  'owner can create a store'
);

-- ============================================================================
-- Owner: list_products / list_stores include the new active rows
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.admin_list_products(false, 200)
     where slug = 'catalog-qa-product' $$,
  $$ select true $$,
  'admin_list_products (owner) includes the new active product'
);

select results_eq(
  $$ select count(*) > 0 from public.admin_list_stores(false, 200)
     where slug = 'catalog-qa-store-lansing-mi' $$,
  $$ select true $$,
  'admin_list_stores (owner) includes the new active store'
);

-- ============================================================================
-- Owner: update product + store
-- ============================================================================
select lives_ok(
  $$ select public.admin_update_product(
    (select id from public.products where slug = 'catalog-qa-product'),
    'Catalog QA Product Updated', null, null, null, 'CatalogQACategory2', null
  ) $$,
  'owner can update a product'
);

select results_eq(
  $$ select name from public.admin_list_products(false, 200)
     where slug = 'catalog-qa-product' $$,
  $$ select 'Catalog QA Product Updated'::text $$,
  'admin_list_products reflects the updated product name'
);

select lives_ok(
  $$ select public.admin_update_store(
    (select id from public.stores where slug = 'catalog-qa-store-lansing-mi'),
    'Catalog QA Store Updated', null::text, null::text, null::boolean
  ) $$,
  'owner can update a store'
);

select results_eq(
  $$ select name from public.admin_list_stores(false, 200)
     where slug = 'catalog-qa-store-lansing-mi' $$,
  $$ select 'Catalog QA Store Updated'::text $$,
  'admin_list_stores reflects the updated store name'
);

-- ============================================================================
-- Owner: disable product + store
-- ============================================================================
select lives_ok(
  $$ select public.admin_disable_product(
    (select id from public.products where slug = 'catalog-qa-product')
  ) $$,
  'owner can disable a product'
);

select results_eq(
  $$ select count(*) from public.admin_list_products(false, 200)
     where slug = 'catalog-qa-product' $$,
  $$ select 0::bigint $$,
  'disabled product is excluded from admin_list_products by default'
);

select results_eq(
  $$ select count(*) > 0 from public.admin_list_products(true, 200)
     where slug = 'catalog-qa-product' $$,
  $$ select true $$,
  'disabled product is still visible with include_inactive'
);

select results_eq(
  $$ select count(*) from public.search_products('catalogqasearchtermxyz', 12) $$,
  $$ select 0::bigint $$,
  'disabled product is excluded from search_products'
);

select lives_ok(
  $$ select public.admin_disable_store(
    (select id from public.stores where slug = 'catalog-qa-store-lansing-mi')
  ) $$,
  'owner can disable a store'
);

select results_eq(
  $$ select count(*) from public.admin_list_stores(false, 200)
     where slug = 'catalog-qa-store-lansing-mi' $$,
  $$ select 0::bigint $$,
  'disabled store is excluded from admin_list_stores by default'
);

select results_eq(
  $$ select count(*) > 0 from public.admin_list_stores(true, 200)
     where slug = 'catalog-qa-store-lansing-mi' $$,
  $$ select true $$,
  'disabled store is still visible with include_inactive'
);

select results_eq(
  $$ select count(*) from public.search_stores('Catalog QA Store Updated', 12) $$,
  $$ select 0::bigint $$,
  'disabled store is excluded from search_stores'
);

-- ============================================================================
-- Owner: restore product + store
-- ============================================================================
select lives_ok(
  $$ select public.admin_update_product(
    (select id from public.products where slug = 'catalog-qa-product'),
    null, null, null, true, null, null
  ) $$,
  'owner can restore a disabled product'
);

select results_eq(
  $$ select count(*) > 0 from public.admin_list_products(false, 200)
     where slug = 'catalog-qa-product' $$,
  $$ select true $$,
  'restored product reappears in admin_list_products'
);

select results_eq(
  $$ select count(*) > 0 from public.search_products('catalogqasearchtermxyz', 12) $$,
  $$ select true $$,
  'restored product reappears in search_products'
);

select lives_ok(
  $$ select public.admin_update_store(
    (select id from public.stores where slug = 'catalog-qa-store-lansing-mi'),
    null::text, null::text, null::text, true
  ) $$,
  'owner can restore a disabled store'
);

select results_eq(
  $$ select count(*) > 0 from public.admin_list_stores(false, 200)
     where slug = 'catalog-qa-store-lansing-mi' $$,
  $$ select true $$,
  'restored store reappears in admin_list_stores'
);

select results_eq(
  $$ select count(*) > 0 from public.search_stores('Catalog QA Store Updated', 12) $$,
  $$ select true $$,
  'restored store reappears in search_stores'
);

-- ============================================================================
-- Member (non-owner) is denied on all 8 admin catalog RPCs
-- ============================================================================
select pg_temp.set_member_ctx();

select throws_ok(
  $$ select public.admin_create_product(
    pg_temp.get_test_trend_id(), 'Member Should Fail Product', 'available', null, null, null, null, null
  ) $$,
  '42501',
  'Owner access required',
  'member cannot create a product'
);

select throws_ok(
  $$ select public.admin_update_product(
    (select id from public.products where slug = 'catalog-qa-product'),
    'Member Should Fail', null, null, null, null, null
  ) $$,
  '42501',
  'Owner access required',
  'member cannot update a product'
);

select throws_ok(
  $$ select public.admin_disable_product(
    (select id from public.products where slug = 'catalog-qa-product')
  ) $$,
  '42501',
  'Owner access required',
  'member cannot disable a product'
);

select throws_ok(
  $$ select public.admin_create_store(
    'Member Fail Retailer', 'Member Fail Store', '1 Fail Ave', 'Lansing', 'MI', '48910',
    null::text, null::numeric, null::numeric
  ) $$,
  '42501',
  'Owner access required',
  'member cannot create a store'
);

select throws_ok(
  $$ select public.admin_update_store(
    (select id from public.stores where slug = 'catalog-qa-store-lansing-mi'),
    'Member Should Fail', null::text, null::text, null::boolean
  ) $$,
  '42501',
  'Owner access required',
  'member cannot update a store'
);

select throws_ok(
  $$ select public.admin_disable_store(
    (select id from public.stores where slug = 'catalog-qa-store-lansing-mi')
  ) $$,
  '42501',
  'Owner access required',
  'member cannot disable a store'
);

select throws_ok(
  $$ select public.admin_list_products() $$,
  '42501',
  'Owner access required',
  'member cannot call admin_list_products'
);

select throws_ok(
  $$ select public.admin_list_stores() $$,
  '42501',
  'Owner access required',
  'member cannot call admin_list_stores'
);

select * from finish();
rollback;
