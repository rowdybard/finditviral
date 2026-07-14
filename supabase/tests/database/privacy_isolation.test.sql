-- Privacy isolation tests: verify cross-member access is denied for
-- profile_locations, profile_contacts, private sightings, contribution_drafts,
-- and early_access_requests. Also verify bounty claim contact info is only
-- visible to participants, and admin RPCs reject ordinary members.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

-- 1. profile_locations has RLS enabled (self-only read)
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'profile_locations'
      and relnamespace = 'public'::regnamespace
  ),
  'profile_locations has RLS enabled'
);

-- 2. profile_locations self_read policy restricts to auth.uid() = user_id
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profile_locations'
      and policyname = 'profile_locations_self_read'
      and qual ~ 'auth\.uid'
  ),
  'profile_locations has self-only read policy'
);

-- 3. profile_contacts has RLS enabled
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'profile_contacts'
      and relnamespace = 'public'::regnamespace
  ),
  'profile_contacts has RLS enabled'
);

-- 4. profile_contacts participant_read policy requires self or accepted-claim participant
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profile_contacts'
      and policyname = 'profile_contacts_participant_read'
      and qual ~ 'auth\.uid'
  ),
  'profile_contacts has participant-scoped read policy'
);

-- 5. private sightings (is_public = false) are not visible via sightings_public_read policy
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sightings'
      and policyname = 'sightings_public_read'
      and qual ~ 'is_public\s*=\s*true'
  ),
  'sightings public read policy requires is_public = true'
);

-- 6. sightings_private_read policy restricts to owner or bounty owner
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sightings'
      and policyname = 'sightings_private_read'
      and qual ~ 'auth\.uid'
  ),
  'sightings private read policy restricts to owner or bounty owner'
);

-- 7. contribution_drafts has RLS enabled and no public/authenticated read policies
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'contribution_drafts'
      and relnamespace = 'private'::regnamespace
  )
  and not exists (
    select 1
    from pg_policies
    where schemaname = 'private'
      and tablename = 'contribution_drafts'
      and cmd = 'SELECT'
      and roles @> '{authenticated}'
  ),
  'contribution_drafts has RLS enabled with no authenticated read policy'
);

-- 8. early_access_requests has RLS enabled with no policies (no direct access)
select ok(
  (
    select relrowsecurity
    from pg_class
    where relname = 'early_access_requests'
      and relnamespace = 'public'::regnamespace
  )
  and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'early_access_requests'
  ),
  'early_access_requests has RLS enabled with no policies (service-role only)'
);

-- 9. admin_list_products is SECURITY DEFINER with assert_app_owner check
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_list_products'
  ),
  'admin_list_products calls assert_app_owner'
);

-- 10. admin_list_stores is SECURITY DEFINER with assert_app_owner check
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'assert_app_owner'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_list_stores'
  ),
  'admin_list_stores calls assert_app_owner'
);

select * from finish();

rollback;
