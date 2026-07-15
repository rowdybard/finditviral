-- Regression coverage for the launch-blocker audit fixes.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

select ok(
  to_regprocedure('public.create_sighting(uuid,uuid,timestamptz,text,integer,text,uuid)') is null,
  'superseded create_sighting overload is removed'
);

select ok(
  to_regprocedure('public.confirm_lead_with_sighting(uuid,uuid,timestamptz,text,integer,text)') is null,
  'superseded Lead confirmation overload is removed'
);

select has_table(
  'private',
  'public_request_rate_limits',
  'private authoritative request-rate table exists'
);

select is(
  (select rowsecurity from pg_tables
   where schemaname = 'private' and tablename = 'public_request_rate_limits'),
  true,
  'authoritative request-rate table has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'private.public_request_rate_limits', 'select')
  and not has_table_privilege('anon', 'private.public_request_rate_limits', 'insert')
  and not has_table_privilege('anon', 'private.public_request_rate_limits', 'update')
  and not has_table_privilege('anon', 'private.public_request_rate_limits', 'delete'),
  'anon has no direct request-rate table access'
);

select ok(
  not has_table_privilege('authenticated', 'private.public_request_rate_limits', 'select')
  and not has_table_privilege('authenticated', 'private.public_request_rate_limits', 'insert')
  and not has_table_privilege('authenticated', 'private.public_request_rate_limits', 'update')
  and not has_table_privilege('authenticated', 'private.public_request_rate_limits', 'delete'),
  'authenticated has no direct request-rate table access'
);

select ok(
  not has_table_privilege('service_role', 'private.public_request_rate_limits', 'select')
  and not has_table_privilege('service_role', 'private.public_request_rate_limits', 'insert')
  and not has_table_privilege('service_role', 'private.public_request_rate_limits', 'update')
  and not has_table_privilege('service_role', 'private.public_request_rate_limits', 'delete'),
  'service role must use the hardened RPC rather than direct DML'
);

select has_function(
  'public',
  'consume_public_request_limit',
  array['text', 'text'],
  'authoritative request-rate RPC exists'
);

select ok(
  not has_function_privilege('anon', 'public.consume_public_request_limit(text,text)', 'execute'),
  'anon cannot consume authoritative request limits directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.consume_public_request_limit(text,text)', 'execute'),
  'authenticated cannot consume authoritative request limits directly'
);

select ok(
  has_function_privilege('service_role', 'public.consume_public_request_limit(text,text)', 'execute'),
  'service role can consume authoritative request limits'
);

select ok(
  (select p.prosecdef
   from pg_proc p
   where p.oid = 'public.consume_public_request_limit(text,text)'::regprocedure),
  'authoritative request-rate RPC is security definer'
);

select ok(
  (select 'search_path=pg_catalog, public, private, pg_temp' = any(p.proconfig)
   from pg_proc p
   where p.oid = 'public.consume_public_request_limit(text,text)'::regprocedure),
  'authoritative request-rate RPC has a hardened search path'
);

select ok(
  (select pg_get_functiondef(p.oid) ~ 'pg_advisory_xact_lock'
      and pg_get_functiondef(p.oid) ~ 'private.product_suggestions'
      and pg_get_functiondef(p.oid) ~ 'private.store_suggestions'
      and pg_get_functiondef(p.oid) !~ 'public.product_suggestions'
   from pg_proc p
   where p.oid = 'private.check_contribution_rate_limit(uuid,text)'::regprocedure),
  'contribution quotas serialize and query the real private suggestion tables'
);

select lives_ok(
  $$ select private.check_contribution_rate_limit(
    '00000000-0000-4000-8000-0000000000e1'::uuid,
    'suggestion'
  ) $$,
  'catalog suggestion quota check uses valid relations'
);

select is(
  (select public from storage.buckets where id = 'sighting-photos'),
  false,
  'sighting photo bucket is private'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read sighting photos'
  ),
  'unconditional public sighting-photo read policy is absent'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Owners and moderators read sighting photos'
  ),
  'owners and moderators can read managed sighting photos'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Approved sightings read photos'
  ),
  'only approved public sightings expose their managed photos'
);

select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.sightings'::regclass
      and t.tgname = 'enforce_sighting_photo_ownership'
      and not t.tgisinternal
  ),
  'sighting writes enforce server-side photo ownership'
);

select ok(
  (select pg_get_functiondef(p.oid) ~ 'owner_id = p_user_id::text'
      and pg_get_functiondef(p.oid) ~ 'v_path_count > 4'
   from pg_proc p
   where p.oid = 'private.assert_owned_sighting_photo_paths(uuid,text[])'::regprocedure),
  'photo ownership helper verifies owner and photo count'
);

truncate private.public_request_rate_limits;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)
   from generate_series(1, 6)
   where public.consume_public_request_limit(
     'early_access',
     repeat('a', 64)
   )),
  5::bigint,
  'early-access rolling window atomically permits only five requests'
);

select ok(
  (select count(*) = 2 and bool_and(request_count = 5)
   from private.public_request_rate_limits
   where key_hash = repeat('a', 64)),
  'early-access daily and rolling counters advance together'
);

select is(
  (select count(*)
   from generate_series(1, 61)
   where public.consume_public_request_limit(
     'product_click',
     repeat('b', 64)
   )),
  60::bigint,
  'product-click rolling window atomically permits only sixty requests'
);

update private.public_request_rate_limits
set window_started_at = now() - interval '11 minutes', request_count = 60
where scope = 'product_click' and key_hash = repeat('b', 64);

select is(
  public.consume_public_request_limit('product_click', repeat('b', 64)),
  true,
  'expired product-click windows accept a new request'
);

select is(
  (select request_count
   from private.public_request_rate_limits
   where scope = 'product_click' and key_hash = repeat('b', 64)),
  1,
  'expired product-click counter resets to one'
);

select * from finish();
rollback;
