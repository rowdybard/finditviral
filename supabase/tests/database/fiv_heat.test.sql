begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select has_table('private', 'product_click_receipts', 'private click receipts exist');
select has_table('private', 'product_click_totals', 'private click totals exist');

select ok(
  (select relrowsecurity from pg_class where oid = 'private.product_click_receipts'::regclass),
  'click receipts have row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'private.product_click_totals'::regclass),
  'click totals have row level security enabled'
);

select ok(
  not has_table_privilege('anon', 'private.product_click_receipts', 'select'),
  'anon cannot read click receipts'
);

select ok(
  not has_table_privilege('authenticated', 'private.product_click_totals', 'select'),
  'authenticated users cannot read click totals directly'
);

select ok(
  not has_table_privilege('service_role', 'private.product_click_totals', 'insert'),
  'service role cannot bypass the write RPC with direct inserts'
);

select ok(
  not has_function_privilege('anon', 'public.record_product_click(uuid,text)', 'execute'),
  'anon cannot execute the click recorder directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.record_product_click(uuid,text)', 'execute'),
  'authenticated users cannot execute the click recorder directly'
);

select ok(
  has_function_privilege('service_role', 'public.record_product_click(uuid,text)', 'execute'),
  'service role can execute the click recorder'
);

select ok(
  not has_function_privilege('anon', 'public.get_trend_click_heat(uuid)', 'execute'),
  'anon cannot read heat through the Data API'
);

select ok(
  has_function_privilege('authenticated', 'public.get_trend_click_heat(uuid)', 'execute'),
  'authenticated users can read heat'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.record_product_click(uuid,text)'::regprocedure),
  'the click recorder is security definer'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.get_trend_click_heat(uuid)'::regprocedure),
  'the heat reader is security definer'
);

select is(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = 'public.record_product_click(uuid,text)'::regprocedure
  ),
  'search_path=pg_catalog, pg_temp',
  'the click recorder has a hardened search path'
);

select is(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = 'public.get_trend_click_heat(uuid)'::regprocedure
  ),
  'search_path=pg_catalog, pg_temp',
  'the heat reader has a hardened search path'
);

select has_index(
  'private',
  'product_click_receipts',
  'product_click_receipts_expires_at_idx',
  'expired receipt cleanup is indexed'
);

select is(
  (select count(*) from pg_policies where schemaname = 'private' and tablename = 'product_click_receipts'),
  0::bigint,
  'click receipts expose no row policies'
);

select is(
  (select count(*) from pg_policies where schemaname = 'private' and tablename = 'product_click_totals'),
  0::bigint,
  'click totals expose no row policies'
);

truncate table private.product_click_receipts, private.product_click_totals;

select throws_ok(
  $$select public.record_product_click(
      (select id from public.products where is_active order by id limit 1),
      'not-a-digest'
    )$$,
  '22023',
  'Invalid product click',
  'malformed click keys are rejected'
);

select throws_ok(
  $$select public.record_product_click(
      '00000000-0000-4000-8000-000000000000'::uuid,
      repeat('a', 64)
    )$$,
  '22023',
  'Product is not active',
  'unknown products are rejected'
);

update public.products
set is_active = false
where slug = 'ghirardelli-dubai-style-chocolate-4oz';

select throws_ok(
  $$select public.record_product_click(
      (
        select p.id from public.products p
        where p.slug = 'ghirardelli-dubai-style-chocolate-4oz'
      ),
      repeat('b', 64)
    )$$,
  '22023',
  'Product is not active',
  'inactive products are rejected'
);

update public.products
set is_active = true
where slug = 'ghirardelli-dubai-style-chocolate-4oz';

select is(
  public.record_product_click(
    (select id from public.products where is_active order by id limit 1),
    repeat('c', 64)
  ),
  true,
  'a first product open is counted'
);

select is(
  public.record_product_click(
    (select id from public.products where is_active order by id limit 1),
    repeat('c', 64)
  ),
  false,
  'the same product-specific key is deduplicated for six hours'
);

select is(
  public.record_product_click(
    (select id from public.products where is_active order by id limit 1),
    repeat('d', 64)
  ),
  true,
  'a different anonymous key is counted'
);

select is(
  (
    select click_count
    from private.product_click_totals
    where product_id = (select id from public.products where is_active order by id limit 1)
  ),
  2::bigint,
  'deduplicated opens increment one aggregate counter atomically'
);

update private.product_click_receipts
set expires_at = now() - interval '1 second'
where click_key = repeat('c', 64);

select is(
  public.record_product_click(
    (select id from public.products where is_active order by id limit 1),
    repeat('c', 64)
  ),
  true,
  'an expired product-specific key can count again'
);

select is(
  (select count(*) from private.product_click_receipts where expires_at <= now()),
  0::bigint,
  'later FiV Heat activity removes expired deduplication keys'
);

truncate table private.product_click_receipts, private.product_click_totals;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  (
    select count(*)
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    )
  ),
  3::bigint,
  'the reader returns every active product in the trend'
);

select is(
  (
    select count(*)
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    )
    where not has_signal and heat_percent = 0
  ),
  3::bigint,
  'a trend with no opens reports no signal instead of fake equal heat'
);

insert into private.product_click_totals (product_id, click_count, last_clicked_at)
select
  p.id,
  case when row_number() over (order by p.name) = 1 then 1 else 0 end,
  now()
from public.products p
join public.trends t on t.id = p.trend_id
where p.is_active and t.slug = 'pokemon-tcg-pitch-black';

select is(
  (
    select h.heat_percent
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    ) h
    join private.product_click_totals totals on totals.product_id = h.product_id
    where totals.click_count = 1
  ),
  35,
  'one early open produces only 35 percent heat in a three-product trend'
);

select is(
  (
    select min(h.heat_percent)
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    ) h
    join private.product_click_totals totals on totals.product_id = h.product_id
    where totals.click_count = 0
  ),
  32,
  'unclicked products remain close behind when the sample is tiny'
);

update private.product_click_totals set click_count = 10 where click_count = 1;

select is(
  (
    select h.heat_percent
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    ) h
    join private.product_click_totals totals on totals.product_id = h.product_id
    where totals.click_count = 10
  ),
  50,
  'ten opens produce 50 percent heat in a three-product trend'
);

select is(
  (
    select min(h.heat_percent)
    from public.get_trend_click_heat(
      (select id from public.trends where slug = 'pokemon-tcg-pitch-black')
    ) h
    join private.product_click_totals totals on totals.product_id = h.product_id
    where totals.click_count = 0
  ),
  25,
  'the remaining products retain 25 percent heat each'
);

select * from finish();
rollback;
