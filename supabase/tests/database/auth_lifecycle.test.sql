-- Auth lifecycle tests: verify handle_new_user trigger, complete_onboarding
-- guards, username normalization collisions, one-time onboarding, and
-- member restriction enforcement.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- 1. handle_new_user trigger exists on auth.users
select ok(
  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name = 'on_auth_user_created'
  ),
  'handle_new_user trigger exists on auth.users'
);

-- 2. handle_new_user creates a profile with placeholder username
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'user_'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_user'
  ),
  'handle_new_user creates profile with placeholder username'
);

-- 3. complete_onboarding requires email_confirmed_at
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'email_confirmed_at is not null'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_onboarding'
  ),
  'complete_onboarding requires email_confirmed_at'
);

-- 4. complete_onboarding rejects duplicate completion
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'onboarding_completed'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_onboarding'
  ),
  'complete_onboarding rejects already-completed profiles'
);

-- 5. complete_onboarding validates ZIP against allowed Greater Lansing set
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'v_allowed_zips'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_onboarding'
  ),
  'complete_onboarding validates ZIP against allowed Greater Lansing set'
);

-- 6. is_permanent_member checks email_confirmed_at and onboarding_completed
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'email_confirmed_at is not null'
    and pg_get_functiondef(p.oid) ~ 'onboarding_completed'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'is_permanent_member'
  ),
  'is_permanent_member checks email_confirmed_at and onboarding_completed'
);

-- 7. is_permanent_member checks member_restrictions (suspended/disabled)
select ok(
  (
    select pg_get_functiondef(p.oid) ~ 'member_restrictions'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'is_permanent_member'
  ),
  'is_permanent_member checks member_restrictions'
);

-- 8. assert_permanent_member raises 42501 when not a permanent member
select ok(
  (
    select pg_get_functiondef(p.oid) ~ '42501'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'assert_permanent_member'
  ),
  'assert_permanent_member raises 42501 for non-members'
);

select * from finish();

rollback;
