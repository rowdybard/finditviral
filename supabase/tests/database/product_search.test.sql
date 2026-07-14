-- Behavioral pgTAP tests for public.search_products (20260716000000).
-- Covers every match dimension (name, name-prefix ranking, brand,
-- brand+name, category, search_terms, trend name, trend description),
-- the 2-char minimum query length, the 12-row result cap, and exclusion of
-- inactive products / products under an inactive trend.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(14);

-- ============================================================================
-- Fixtures: dedicated trends + products, isolated with unique zqx* tokens
-- ============================================================================
insert into public.trends (name, slug, description, is_active) values
  ('Zqx Search Trend', 'zqx-search-trend', null, true),
  ('Zqx Inactive Trend', 'zqx-inactive-trend', null, false),
  ('Zqxtrendnametoken Trend', 'zqx-trend-name-test', 'Some text containing zqxtrenddescriptiontoken here', true);

-- P1: plain name match
insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Zqxnametoken Widget', 'zqx-p1-name', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P2/P3: name-prefix vs. name-contains, for ranking comparison
insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Zqxpfx Gadget', 'zqx-p2-prefix', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Widget Zqxpfx Extra', 'zqx-p3-nonprefix', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P4: brand-only match
insert into public.products (trend_id, name, slug, brand, is_active, availability_status, verification_method, verified_at)
select id, 'Random Name Brandonly', 'zqx-p4-brand', 'Zqxbrandtoken', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P5: brand+name concatenation match (query spans the brand/name boundary)
insert into public.products (trend_id, name, slug, brand, is_active, availability_status, verification_method, verified_at)
select id, 'ComboSuffixProduct', 'zqx-p5-combo', 'Zqxcombo', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P6: category match
insert into public.products (trend_id, name, slug, category, is_active, availability_status, verification_method, verified_at)
select id, 'Random Name Category', 'zqx-p6-category', 'Zqxcategorytoken', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P7: search_terms match
insert into public.products (trend_id, name, slug, search_terms, is_active, availability_status, verification_method, verified_at)
select id, 'Random Name Terms', 'zqx-p7-terms', 'zqxsearchtermtoken', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- P8: trend name / trend description match (dedicated trend, no other overlap)
insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Random Unrelated Name', 'zqx-p8-trend', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-trend-name-test';

-- P9: active product under an inactive trend (must be excluded)
insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Zqxinactivetrendtoken Product', 'zqx-p9-inactivetrend', true, 'available', 'owner_verified', now()
from public.trends where slug = 'zqx-inactive-trend';

-- P10: inactive product under an active trend (must be excluded)
insert into public.products (trend_id, name, slug, is_active, availability_status, verification_method, verified_at)
select id, 'Zqxinactiveproducttoken Product', 'zqx-p10-inactiveproduct', false, 'retired', 'owner_verified', now()
from public.trends where slug = 'zqx-search-trend';

-- 13 products sharing one token, to test the 12-row result cap
do $$
declare
  v_trend_id uuid;
  i integer;
begin
  select id into v_trend_id from public.trends where slug = 'zqx-search-trend';
  for i in 1..13 loop
    insert into public.products (
      trend_id, name, slug, is_active, availability_status, verification_method, verified_at
    ) values (
      v_trend_id, 'Zqxpagetoken Item ' || lpad(i::text, 2, '0'),
      'zqx-page-item-' || lpad(i::text, 2, '0'),
      true, 'available', 'owner_verified', now()
    );
  end loop;
end;
$$;

-- ============================================================================
-- 1. Match by name
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('zqxnametoken', 12) $$,
  $$ select true $$,
  'search_products matches by product name'
);

-- ============================================================================
-- 2. Name-prefix match is ranked before a name-contains match
-- ============================================================================
select results_eq(
  $$ select slug from public.search_products('Zqxpfx', 12) limit 1 $$,
  $$ select 'zqx-p2-prefix'::text $$,
  'a name-prefix match is ranked before a non-prefix name match'
);

-- ============================================================================
-- 3. Match by brand
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('zqxbrandtoken', 12) $$,
  $$ select true $$,
  'search_products matches by brand'
);

-- ============================================================================
-- 4. Match by brand+name concatenation
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('Zqxcombo Combo', 12) $$,
  $$ select true $$,
  'search_products matches by brand+name concatenation'
);

-- ============================================================================
-- 5. Match by category
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('zqxcategorytoken', 12) $$,
  $$ select true $$,
  'search_products matches by category'
);

-- ============================================================================
-- 6. Match by search_terms
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('zqxsearchtermtoken', 12) $$,
  $$ select true $$,
  'search_products matches by search_terms'
);

-- ============================================================================
-- 7. Match by trend name
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('Zqxtrendnametoken', 12) $$,
  $$ select true $$,
  'search_products matches by trend name'
);

-- ============================================================================
-- 8. Match by trend description
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('zqxtrenddescriptiontoken', 12) $$,
  $$ select true $$,
  'search_products matches by trend description'
);

-- ============================================================================
-- 9. A 1-char query returns no rows
-- ============================================================================
select results_eq(
  $$ select count(*) from public.search_products('z', 12) $$,
  $$ select 0::bigint $$,
  'a 1-char query returns zero rows'
);

-- ============================================================================
-- 10. A 2-char query is allowed and returns matches
-- ============================================================================
select results_eq(
  $$ select count(*) > 0 from public.search_products('Zq', 12) $$,
  $$ select true $$,
  'a 2-char query is allowed and returns matches'
);

-- ============================================================================
-- 11. More than 12 matches are capped at 12 (default limit)
-- ============================================================================
select results_eq(
  $$ select count(*) from public.search_products('Zqxpagetoken') $$,
  $$ select 12::bigint $$,
  '13 matching products are capped at 12 with the default limit'
);

-- ============================================================================
-- 12. A p_limit above the cap is still capped at 12
-- ============================================================================
select results_eq(
  $$ select count(*) from public.search_products('Zqxpagetoken', 999) $$,
  $$ select 12::bigint $$,
  '13 matching products are capped at 12 even when p_limit is 999'
);

-- ============================================================================
-- 13. An inactive product is excluded
-- ============================================================================
select results_eq(
  $$ select count(*) from public.search_products('zqxinactiveproducttoken', 12) $$,
  $$ select 0::bigint $$,
  'an inactive product is excluded from search results'
);

-- ============================================================================
-- 14. A product under an inactive trend is excluded
-- ============================================================================
select results_eq(
  $$ select count(*) from public.search_products('zqxinactivetrendtoken', 12) $$,
  $$ select 0::bigint $$,
  'a product under an inactive trend is excluded from search results'
);

select * from finish();
rollback;
