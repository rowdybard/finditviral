-- Tests for public.get_sitemap_urls RPC.
-- Verifies active products/stores are included, inactive excluded,
-- inactive parent trends/retailers excluded, private routes excluded,
-- and max URL count enforced.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

-- 1. Function exists and is executable
select has_function('public', 'get_sitemap_urls', 'get_sitemap_urls function exists');

-- 2. Returns expected columns (behavioral: select from the result set)
select ok(
  (
    select count(*) > 0
    from (
      select url_path, lastmod, changefreq, priority
      from public.get_sitemap_urls()
    ) s
  ),
  'get_sitemap_urls returns url_path, lastmod, changefreq, priority columns'
);

-- 3. Static pages are included
select results_eq(
  $$ select count(*) > 0 from public.get_sitemap_urls() where url_path = '/' $$,
  $$ select true $$,
  'static homepage URL is included in sitemap'
);

-- 4. Stores page is included
select results_eq(
  $$ select count(*) > 0 from public.get_sitemap_urls() where url_path = '/stores' $$,
  $$ select true $$,
  'static stores page URL is included in sitemap'
);

-- 5. No private routes in sitemap
select results_eq(
  $$ select count(*) from public.get_sitemap_urls() where url_path like '/auth%' or url_path like '/onboarding%' or url_path like '/home%' or url_path like '/admin%' $$,
  $$ select 0::bigint $$,
  'no private routes in sitemap'
);

-- 6. Max 1000 URLs returned
select ok(
  (select count(*) from public.get_sitemap_urls()) <= 1000,
  'sitemap returns at most 1000 URLs'
);

-- 7. Inactive products are excluded from sitemap
select ok(
  not exists (
    select 1
    from public.get_sitemap_urls() su
    join public.products p on '/products/' || p.slug = su.url_path
    where not p.is_active
  ),
  'inactive products are excluded from sitemap'
);

-- 8. Inactive stores are excluded from sitemap
select ok(
  not exists (
    select 1
    from public.get_sitemap_urls() su
    join public.stores s on '/stores/' || s.slug = su.url_path
    where not s.is_active
  ),
  'inactive stores are excluded from sitemap'
);

-- 9. All URL paths start with '/'
select ok(
  not exists (
    select 1 from public.get_sitemap_urls() where url_path !~ '^/'
  ),
  'all sitemap URL paths start with /'
);

-- ============================================================================
-- Fixtures: inactive parent trend with active product, inactive retailer with active store
-- ============================================================================
do $$
declare
  v_inactive_trend_id uuid;
  v_inactive_retailer_id uuid;
  v_product_id uuid;
  v_store_id uuid;
begin
  set local session_replication_role = 'replica';

  -- Inactive trend
  insert into public.trends (name, slug, description, is_active)
  values ('Inactive Test Trend', 'inactive-test-trend', 'Test trend for sitemap exclusion', false)
  on conflict (slug) do update set is_active = false
  returning id into v_inactive_trend_id;

  -- Active product under inactive trend
  insert into public.products (trend_id, name, slug, is_active, availability_status, verified_at, verification_method)
  values (v_inactive_trend_id, 'Inactive Trend Product', 'inactive-trend-product', true,
    'available', now(), 'owner_verified')
  on conflict (slug) do update set is_active = true, trend_id = v_inactive_trend_id,
    availability_status = 'available', verified_at = now(), verification_method = 'owner_verified'
  returning id into v_product_id;

  -- Inactive retailer
  insert into public.retailers (name, slug, is_active)
  values ('Inactive Test Retailer', 'inactive-test-retailer', false)
  on conflict (slug) do update set is_active = false
  returning id into v_inactive_retailer_id;

  -- Active store under inactive retailer
  insert into public.stores (retailer_id, name, slug, address_line1, city, state, zip_code, is_active, verification_method, verified_at)
  values (v_inactive_retailer_id, 'Inactive Retailer Store', 'inactive-retailer-store',
    '123 Test St', 'Lansing', 'MI', '48910', true, 'owner_verified', now())
  on conflict (slug) do update set is_active = true, retailer_id = v_inactive_retailer_id,
    verification_method = 'owner_verified', verified_at = now()
  returning id into v_store_id;

  set local session_replication_role = 'origin';
end;
$$;

-- 10. Products under inactive trends are excluded from sitemap
select ok(
  not exists (
    select 1
    from public.get_sitemap_urls() su
    join public.products p on '/products/' || p.slug = su.url_path
    join public.trends t on t.id = p.trend_id
    where not t.is_active
  ),
  'products under inactive trends are excluded from sitemap'
);

-- 11. Stores under inactive retailers are excluded from sitemap
select ok(
  not exists (
    select 1
    from public.get_sitemap_urls() su
    join public.stores s on '/stores/' || s.slug = su.url_path
    join public.retailers r on r.id = s.retailer_id
    where not r.is_active
  ),
  'stores under inactive retailers are excluded from sitemap'
);

select * from finish();

rollback;
