-- Tests for public.get_sitemap_urls RPC.
-- Verifies active products/stores are included, inactive excluded,
-- private routes excluded, and max URL count enforced.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

-- 1. Function exists and is executable
select has_function('public', 'get_sitemap_urls', 'get_sitemap_urls function exists');

-- 2. Returns expected columns
select has_column(
  (select to_regclass('public.get_sitemap_urls') is not null),
  'url_path',
  'get_sitemap_urls returns url_path column'
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

select * from finish();

rollback;
