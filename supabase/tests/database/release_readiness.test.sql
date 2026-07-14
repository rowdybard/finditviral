-- Behavioral pgTAP tests for release readiness migration (20260715000010).
-- Tests draft payload validation, bounty lifecycle (create/claim), admin RPCs,
-- suggestion→draft→publish flow, cross-user draft denial, security, and search.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(30);

-- ============================================================================
-- Test fixtures: create two test users, profiles, username claims, app_owners
-- ============================================================================
do $$
declare
  v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
  v_member_id uuid := '00000000-0000-4000-8000-000000000002';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'owner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'member@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_owner_id, 'testowner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = 'testowner';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_member_id, 'testmember', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'testmember';

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_owner_id, 'testowner', 'testowner', 'testowner', false)
  on conflict (user_id) do update set claimed_username = 'testowner', normalized_username = 'testowner', protection_name = 'testowner', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_member_id, 'testmember', 'testmember', 'testmember', false)
  on conflict (user_id) do update set claimed_username = 'testmember', normalized_username = 'testmember', protection_name = 'testmember', is_legacy = false;

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

-- Helper: fetch a seed product ID for tests
create or replace function pg_temp.get_test_product_id()
returns uuid language sql stable as $$
  select id from public.products where is_active order by verified_at desc limit 1;
$$;

-- Helper: fetch seed retailer IDs (Target + Walmart)
create or replace function pg_temp.get_retailer_ids()
returns uuid[] language sql stable as $$
  select array_agg(id order by name) from public.retailers where is_active and slug in ('target', 'walmart');
$$;

-- Helper: fetch a store ID by slug
create or replace function pg_temp.get_store_id(p_slug text)
returns uuid language sql stable as $$
  select id from public.stores where slug = p_slug and is_active;
$$;

-- Helper: fetch seed store IDs for multi-store bounty
create or replace function pg_temp.get_store_ids()
returns uuid[] language sql stable as $$
  select array_agg(id order by slug) from public.stores where is_active and slug in ('target-east-lansing-downtown', 'target-west-lansing');
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

-- ============================================================================
-- 4. Create region bounty (behavioral)
-- ============================================================================
select pg_temp.set_owner_ctx();

select lives_ok(
  $$ select public.create_bounty(
    pg_temp.get_test_product_id(),
    'region',
    null,
    '48910',
    50,
    null, null,
    500,
    now() + interval '7 days',
    'Test region bounty',
    1, null, false, null
  ) $$,
  'create_bounty succeeds for region scope'
);

-- 5. Create retailer bounty with ZIP+radius (behavioral)
select lives_ok(
  $$ select public.create_bounty(
    pg_temp.get_test_product_id(),
    'retailers',
    null,
    '48910',
    50,
    pg_temp.get_retailer_ids(),
    null,
    500,
    now() + interval '7 days',
    'Test retailer bounty',
    1, null, false, null
  ) $$,
  'create_bounty succeeds for retailer scope with ZIP+radius'
);

-- 6. Create multi-store bounty (behavioral)
select lives_ok(
  $$ select public.create_bounty(
    pg_temp.get_test_product_id(),
    'stores',
    null,
    null, null,
    null,
    pg_temp.get_store_ids(),
    500,
    now() + interval '7 days',
    'Test multi-store bounty',
    1, null, false, null
  ) $$,
  'create_bounty succeeds for multi-store scope'
);

-- 7. Retailer bounty requires ZIP+radius
select throws_ok(
  $$ select public.create_bounty(
    pg_temp.get_test_product_id(),
    'retailers',
    null,
    null, null,
    pg_temp.get_retailer_ids(),
    null,
    500,
    now() + interval '7 days',
    'Test retailer bounty no zip',
    1, null, false, null
  ) $$,
  '22023',
  'create_bounty rejects retailer scope without ZIP+radius'
);

-- ============================================================================
-- 8. Claim from allowed store for retailer bounty (behavioral)
-- ============================================================================
-- Insert an approved retailer bounty directly for claim testing
do $$
declare
  v_bounty_id uuid;
begin
  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status, scope_type
  ) values (
    '00000000-0000-4000-8000-000000000001',
    pg_temp.get_test_product_id(),
    null,
    5.00, 500,
    '48910', 50,
    'Claim test retailer bounty', 'Claim test retailer bounty',
    now() + interval '7 days',
    'open', 'approved', 'retailers'
  )
  returning id into v_bounty_id;

  insert into public.bounty_retailers (bounty_id, retailer_id)
  select v_bounty_id, id from public.retailers where slug in ('target', 'walmart');

  perform set_config('pg_temp.test_bounty_id', v_bounty_id::text, true);
end;
$$;

-- Member claims from a Target store (should succeed — Target is in scope, within 50mi of 48910)
select pg_temp.set_member_ctx();

select lives_ok(
  $$ select public.submit_bounty_claim(
    (select current_setting('pg_temp.test_bounty_id', true))::uuid,
    pg_temp.get_store_id('target-east-lansing-downtown'),
    now() - interval '1 hour',
    'in_stock',
    1, 'Test claim allowed store'
  ) $$,
  'submit_bounty_claim succeeds for store within retailer scope and radius'
);

-- 9. Reject claim from out-of-scope retailer (behavioral)
select throws_ok(
  $$ select public.submit_bounty_claim(
    (select current_setting('pg_temp.test_bounty_id', true))::uuid,
    pg_temp.get_store_id('best-buy-lansing-803'),
    now() - interval '30 minutes',
    'in_stock',
    1, 'Test claim wrong retailer'
  ) $$,
  '22023',
  'submit_bounty_claim rejects store from non-scoped retailer'
);

-- 10. Reject self-claim (behavioral)
select pg_temp.set_owner_ctx();

select throws_ok(
  $$ select public.submit_bounty_claim(
    (select current_setting('pg_temp.test_bounty_id', true))::uuid,
    pg_temp.get_store_id('target-east-lansing-downtown'),
    now() - interval '10 minutes',
    'in_stock',
    1, 'Self claim test'
  ) $$,
  '42501',
  'submit_bounty_claim rejects self-claim'
);

-- 11. Reject claim on closed bounty (behavioral)
do $$
declare
  v_closed_bounty_id uuid;
begin
  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status, scope_type
  ) values (
    '00000000-0000-4000-8000-000000000001',
    pg_temp.get_test_product_id(),
    null,
    5.00, 500,
    '48910', 50,
    'Closed bounty', 'Closed bounty',
    now() + interval '7 days',
    'closed', 'approved', 'region'
  )
  returning id into v_closed_bounty_id;

  perform set_config('pg_temp.closed_bounty_id', v_closed_bounty_id::text, true);
end;
$$;

select pg_temp.set_member_ctx();

select throws_ok(
  $$ select public.submit_bounty_claim(
    (select current_setting('pg_temp.closed_bounty_id', true))::uuid,
    pg_temp.get_store_id('target-east-lansing-downtown'),
    now() - interval '5 minutes',
    'in_stock',
    1, 'Claim on closed bounty'
  ) $$,
  '55000',
  'submit_bounty_claim rejects claim on closed bounty'
);

-- ============================================================================
-- 12. Suggestion → draft → approve → publish flow (behavioral)
-- ============================================================================
select pg_temp.set_member_ctx();

-- Member saves a product suggestion for a bounty draft and capture IDs
do $$
declare
  v_row record;
begin
  select draft_id, suggestion_id into v_row
  from public.suggest_product_for_draft(
    null,
    'bounty',
    '{"version":1,"scope":"region","zipCode":"48910","radiusMiles":"50","rewardAmount":"20","deadline":"2026-07-20","requirements":"","quantityNeeded":"1","variantRequirements":"","acceptEquivalent":false,"selectedRetailers":[],"selectedStores":[]}'::jsonb,
    'Suggestion Test Product',
    'SuggestionTestBrand',
    'https://example.com/source',
    null
  );
  perform set_config('pg_temp.test_draft_id', v_row.draft_id::text, true);
  perform set_config('pg_temp.test_suggestion_id', v_row.suggestion_id::text, true);
end;
$$;

-- Owner approves the product suggestion
select pg_temp.set_owner_ctx();

select lives_ok(
  $$ select public.admin_resolve_product_suggestion(
    (select current_setting('pg_temp.test_suggestion_id', true))::uuid,
    'approved',
    null,
    null,
    'available',
    null
  ) $$,
  'admin_resolve_product_suggestion approves the suggestion'
);

-- 13. Draft state is ready after suggestion approval (behavioral)
select results_eq(
  $$ select state from private.contribution_drafts
     where id = (select current_setting('pg_temp.test_draft_id', true))::uuid $$,
  $$ select 'ready'::text $$,
  'draft state is ready after suggestion approval'
);

-- 14. Member publishes bounty from approved draft (behavioral)
select pg_temp.set_member_ctx();

select lives_ok(
  $$ select public.create_bounty(
    (select product_id from private.contribution_drafts where id = (select current_setting('pg_temp.test_draft_id', true))::uuid),
    'region',
    null,
    '48910',
    50,
    null, null,
    500,
    now() + interval '7 days',
    'Published from draft',
    1, null, false,
    (select current_setting('pg_temp.test_draft_id', true))::uuid
  ) $$,
  'create_bounty succeeds publishing from approved draft'
);

-- 15. Draft is consumed after publish (behavioral)
select results_eq(
  $$ select count(*) from private.contribution_drafts
     where id = (select current_setting('pg_temp.test_draft_id', true))::uuid $$,
  $$ select 0::bigint $$,
  'draft is deleted after successful publish'
);

-- ============================================================================
-- 16. Cross-user draft access denied (behavioral)
-- ============================================================================
select pg_temp.set_member_ctx();

do $$
declare
  v_draft_id uuid;
begin
  v_draft_id := public.save_contribution_draft(
    null,
    'bounty',
    '{"version":1,"scope":"region","zipCode":"48910","radiusMiles":"50","rewardAmount":"20","deadline":"2026-07-20","requirements":"","quantityNeeded":"1","variantRequirements":"","acceptEquivalent":false,"selectedRetailers":[],"selectedStores":[]}'::jsonb,
    pg_temp.get_test_product_id(),
    null
  );
  perform set_config('pg_temp.member_a_draft_id', v_draft_id::text, true);
end;
$$;

select pg_temp.set_owner_ctx();

select throws_ok(
  $$ select public.create_bounty(
    pg_temp.get_test_product_id(),
    'region',
    null,
    '48910',
    50,
    null, null,
    500,
    now() + interval '7 days',
    'Cross-user draft test',
    1, null, false,
    (select current_setting('pg_temp.member_a_draft_id', true))::uuid
  ) $$,
  'P0002',
  'create_bounty rejects cross-user draft access'
);

-- ============================================================================
-- 17. Admin store creation succeeds (behavioral)
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

-- 18. Admin product creation with brand (behavioral)
select lives_ok(
  $$ do $$
  declare v_trend_id uuid;
  begin
    select id into v_trend_id from public.trends where slug = 'community-verified';
    perform public.admin_create_product(v_trend_id, 'Test Product Alpha', 'available', null, null, 'TestBrand');
  end;
  $$ $$,
  'admin_create_product succeeds with brand column'
);

-- 19. Non-owner admin denied (behavioral)
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
-- 20. Product search finds by brand (behavioral)
-- ============================================================================
insert into public.products (trend_id, name, slug, brand, is_active, verification_method, verified_at)
select t.id, 'BrandSearch Test Product', 'brandsearch-test-product', 'UniqueBrandXYZ', true, 'owner_verified', now()
from public.trends t where t.slug = 'community-verified'
on conflict (slug) do update set brand = 'UniqueBrandXYZ', is_active = true;

select results_eq(
  $$ select count(*) > 0 from public.search_products('UniqueBrandXYZ', 12) $$,
  $$ select true $$,
  'search_products finds products by brand'
);

-- ============================================================================
-- 21. Retailer bounty has correct associations (behavioral verification)
-- ============================================================================
select results_eq(
  $$ select count(*) from public.bounty_retailers br
     join public.bounties b on b.id = br.bounty_id
     join public.retailers r on r.id = br.retailer_id
     where b.scope_type = 'retailers'
       and b.requirements = 'Test retailer bounty'
       and r.slug in ('target', 'walmart') $$,
  $$ select 2::bigint $$,
  'retailer bounty has 2 retailer associations (Target + Walmart)'
);

-- 22. Multi-store bounty has correct associations (behavioral verification)
select results_eq(
  $$ select count(*) from public.bounty_stores bs
     join public.bounties b on b.id = bs.bounty_id
     where b.scope_type = 'stores'
       and b.requirements = 'Test multi-store bounty' $$,
  $$ select 2::bigint $$,
  'multi-store bounty has 2 store associations'
);

-- 23. list_public_bounties returns retailer_names (behavioral)
select ok(
  exists (
    select 1 from public.list_public_bounties(null, '48910', 250, 100) lb
    where lb.retailer_names is not null
      and array_length(lb.retailer_names, 1) >= 1
  ),
  'list_public_bounties returns non-null retailer_names for retailer bounty'
);

-- 24. get_bounty_detail returns scope details (behavioral)
select pg_temp.set_owner_ctx();

select ok(
  exists (
    select 1 from public.get_bounty_detail(
      (select id from public.bounties where requirements = 'Test retailer bounty' limit 1)
    ) d
    where d.scope_type = 'retailers'
      and d.retailer_names is not null
      and d.quantity_needed = 1
      and d.accept_equivalent = false
  ),
  'get_bounty_detail returns retailer_names and scope details'
);

-- ============================================================================
-- 25. validate_bounty_scope trigger dropped (structural)
-- ============================================================================
select hasnt_function(
  'public', 'validate_bounty_scope',
  'validate_bounty_scope trigger function dropped'
);

-- 26. Username unique index (structural)
select has_index(
  'private', 'username_claims', 'username_claims_normalized_unique_idx',
  'username_claims has unique index on normalized_username'
);

select index_is_unique(
  'private', 'username_claims', 'username_claims_normalized_unique_idx',
  'username_claims normalized_username index is unique'
);

-- 27. Personal notifications revoked from anon (structural)
select ok(
  not has_function_privilege('anon', 'public.get_personal_notifications(integer)', 'execute'),
  'anon cannot execute get_personal_notifications'
);

select ok(
  has_function_privilege('authenticated', 'public.get_personal_notifications(integer)', 'execute'),
  'authenticated can execute get_personal_notifications'
);

-- 28. admin_create_product uses p_brand not p_retailer (structural)
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

select * from finish();
rollback;
