-- Security definer audit: verify every SECURITY DEFINER function in the
-- public schema has appropriate authorization (assert_app_owner,
-- assert_permanent_member, or is intentionally public safe read).

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

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

-- 5. Exactly one create_bounty overload exists (the canonical 14-param version)
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
  )::integer,
  1,
  'Exactly one create_bounty overload exists (legacy overloads dropped)'
);

-- 6. create_bounty has the canonical 14-param signature and calls both auth checks
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
      and pg_get_functiondef(p.oid) ~ 'check_contribution_rate_limit'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bounty'
  ),
  'create_bounty calls assert_permanent_member and check_contribution_rate_limit'
);

-- 7. admin_list_products is SECURITY DEFINER and calls assert_app_owner
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

-- 8. admin_list_stores is SECURITY DEFINER and calls assert_app_owner
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

-- 9. admin_search_members is SECURITY DEFINER and calls assert_app_owner
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_search_members'
      and pg_get_function_identity_arguments(p.oid) = 'p_query text, p_limit integer'
  ),
  'admin_search_members(text, integer) calls assert_app_owner'
);

-- 10. No SECURITY DEFINER function granted to authenticated/anon lacks authorization.
-- Uses effective ACL (acldefault when proacl is null) to catch default-privileged functions.
-- Classifies safe public reads by: STABLE volatility + no mutation keywords in body.
-- Mutating or volatile functions must call assert_app_owner or assert_permanent_member.
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        join pg_authid a on a.oid = acl.grantee
        where a.rolname in ('authenticated', 'anon')
          and acl.privilege_type = 'X'
      )
      and pg_get_functiondef(p.oid) !~ 'assert_app_owner'
      and pg_get_functiondef(p.oid) !~ 'assert_permanent_member'
      -- A function is only exempt if it is STABLE (read-only) AND contains no mutation keywords
      and not (
        p.provolatile = 's'
        and pg_get_functiondef(p.oid) !~* '\b(insert|update|delete)\b'
      )
  ),
  'No SECURITY DEFINER function granted to authenticated/anon lacks authorization (effective ACL, property-based safe-read classification)'
);

-- 11. The bounty RLS policy is not using (true) — the restrictive policy must be in place
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bounties'
      and policyname = 'authenticated_bounties_read'
      and qual = 'true'
  ),
  'authenticated_bounties_read RLS policy is not using (true)'
);

select * from finish();

rollback;
