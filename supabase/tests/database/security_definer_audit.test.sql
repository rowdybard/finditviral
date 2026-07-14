-- Security definer audit: verify every SECURITY DEFINER function in the
-- public schema has appropriate authorization (assert_app_owner,
-- assert_permanent_member, or is intentionally public safe read).

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- 1. search_products is SECURITY DEFINER and intentionally public (safe read, no auth check needed)
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'search_products'
      and p.prosecdef = true
  ),
  'search_products is SECURITY DEFINER (intentionally public safe read)'
);

-- 2. search_stores is SECURITY DEFINER and intentionally public
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'search_stores'
      and p.prosecdef = true
  ),
  'search_stores is SECURITY DEFINER (intentionally public safe read)'
);

-- 3. get_bounty_detail is SECURITY DEFINER and calls assert_permanent_member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_bounty_detail'
    limit 1
  ),
  'get_bounty_detail calls assert_permanent_member'
);

-- 4. create_sighting is SECURITY DEFINER and calls assert_permanent_member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_sighting'
    limit 1
  ),
  'create_sighting calls assert_permanent_member'
);

-- 5. create_bounty is SECURITY DEFINER and calls assert_permanent_member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
    limit 1
  ),
  'create_bounty calls assert_permanent_member'
);

-- 6. admin_list_products is SECURITY DEFINER and calls assert_app_owner
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_list_products'
    limit 1
  ),
  'admin_list_products calls assert_app_owner'
);

-- 7. admin_list_stores is SECURITY DEFINER and calls assert_app_owner
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_list_stores'
    limit 1
  ),
  'admin_list_stores calls assert_app_owner'
);

-- 8. No SECURITY DEFINER function granted to authenticated lacks authorization
-- (search_products and search_stores are intentionally public, granted to anon+authenticated)
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.proname not in (
        'search_products', 'search_stores',
        'get_store_detail', 'get_product_detail',
        'get_stores', 'get_products',
        'handle_new_user', 'is_username_available',
        'is_app_owner'
      )
      and pg_get_functiondef(p.oid) !~ 'assert_app_owner'
      and pg_get_functiondef(p.oid) !~ 'assert_permanent_member'
      and exists (
        select 1
        from aclexplode(p.proacl) acl
        join pg_authid a on a.oid = acl.grantee
        where a.rolname in ('authenticated', 'anon')
          and acl.privilege_type = 'X'
      )
  ),
  'No SECURITY DEFINER function granted to authenticated/anon lacks authorization (excluding safe public reads)'
);

select * from finish();

rollback;
