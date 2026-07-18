-- Behavior tests for security and integrity fixes.
-- Tests use catalog metadata checks (no test users needed for most assertions).

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

-- 1. list_my_bounties is SECURITY DEFINER and calls assert_permanent_member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_my_bounties'
      and pg_get_function_identity_arguments(p.oid) = 'integer'
  ),
  'list_my_bounties(integer) calls assert_permanent_member'
);

-- 2. list_my_bounties filters by the caller's user_id (check function body contains user_id = v_user_id)
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'b\.user_id = v_user_id'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_my_bounties'
  ),
  'list_my_bounties filters bounties by caller user_id'
);

-- 3. list_my_claims is SECURITY DEFINER and calls assert_permanent_member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_permanent_member'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_my_claims'
      and pg_get_function_identity_arguments(p.oid) = 'integer'
  ),
  'list_my_claims(integer) calls assert_permanent_member'
);

-- 4. list_my_claims filters by the caller's finder_id
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'bc\.finder_id = v_user_id'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_my_claims'
  ),
  'list_my_claims filters claims by caller finder_id'
);

-- 5. get_bounty_detail gates moderation_status for non-owners
-- The function body should contain a CASE expression that checks ownership
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'v_is_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_bounty_detail'
  ),
  'get_bounty_detail gates moderation_status by ownership'
);

-- 6. get_bounty_detail returns null for non-approved, non-owner moderation_status
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'else null'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_bounty_detail'
  ),
  'get_bounty_detail returns null for non-owner non-approved moderation_status'
);

-- 7. admin_search_members calls assert_app_owner (by exact signature)
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_search_members'
      and pg_get_function_identity_arguments(p.oid) = 'text, integer'
  ),
  'admin_search_members(text, integer) calls assert_app_owner'
);

-- 8. Bounty RLS policy uses approved/owner/participant visibility (not using (true))
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

-- 9. All 7 previously NOT VALID constraints are now valid
select ok(
  not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.conname in (
        'bounties_notes_max_length',
        'bounties_reward_max_amount',
        'bounties_reward_two_decimals',
        'profile_contacts_info_max_length',
        'profiles_looking_for_max_length',
        'sightings_store_name_length',
        'sightings_city_max_length'
      )
      and not c.convalidated
  ),
  'All 7 previously NOT VALID constraints are now validated'
);

-- 10. All 6 new FK indexes exist
select ok(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_leads_store_id',
        'idx_leads_confirmed_sighting_id',
        'idx_sightings_lead_id',
        'idx_bounties_store_id',
        'idx_bounty_retailers_retailer_id',
        'idx_bounty_stores_store_id'
      )
  )::integer = 6,
  'All 6 missing FK indexes have been created'
);

select * from finish();

rollback;
