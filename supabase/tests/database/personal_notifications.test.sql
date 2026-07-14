-- Issue 21: Verify get_personal_notifications RPC exists, is secured, and
-- produces correct link values for sighting and bounty moderation events.
-- Tests combine structural checks with behavioral fixtures.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(12);

-- ============================================================================
-- Structural checks
-- ============================================================================

-- 1. Function exists with correct signature
select has_function(
  'public', 'get_personal_notifications',
  ARRAY['integer'],
  'get_personal_notifications function exists'
);

-- 2. Returns the expected columns
select ok(
  (
    select 'id' = any(proargnames) and 'event_type' = any(proargnames)
      and 'title' = any(proargnames) and 'subtitle' = any(proargnames)
      and 'link' = any(proargnames) and 'occurred_at' = any(proargnames)
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'get_personal_notifications'
  ),
  'get_personal_notifications returns id, event_type, title, subtitle, link, occurred_at columns'
);

-- 3. Granted to authenticated
select ok(
  has_function_privilege('authenticated', 'public.get_personal_notifications(integer)', 'execute'),
  'authenticated role can execute get_personal_notifications'
);

-- 4. Not granted to anon
select ok(
  not has_function_privilege('anon', 'public.get_personal_notifications(integer)', 'execute'),
  'anon role cannot execute get_personal_notifications'
);

-- ============================================================================
-- Behavioral fixtures: create test users, moderation events, bounty claims
-- ============================================================================

do $$
declare
  v_owner_id uuid := '00000000-0000-4000-8000-0000000000a1';
  v_member_id uuid := '00000000-0000-4000-8000-0000000000a2';
  v_product_id uuid;
  v_store_id uuid;
  v_bounty_id uuid;
  v_sighting_id uuid;
begin
  set local session_replication_role = 'replica';

  -- Create auth users
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'notif-owner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'notif-member@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  -- Create profiles
  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_owner_id, 'notifowner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = 'notifowner';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_member_id, 'notifmember', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'notifmember';

  -- Create username claims
  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_owner_id, 'notifowner', 'notifowner', 'notifowner', false)
  on conflict (user_id) do update set claimed_username = 'notifowner', normalized_username = 'notifowner', protection_name = 'notifowner', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_member_id, 'notifmember', 'notifmember', 'notifmember', false)
  on conflict (user_id) do update set claimed_username = 'notifmember', normalized_username = 'notifmember', protection_name = 'notifmember', is_legacy = false;

  -- Get a seed product and store
  select id into v_product_id from public.products where is_active order by verified_at desc limit 1;
  select id into v_store_id from public.stores where is_active limit 1;

  -- Create a bounty owned by member (for moderation event)
  insert into public.bounties (user_id, product_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline, status, moderation_status, scope_type)
  values (v_member_id, v_product_id, 5.00, 500, '48910', 10,
    'test', 'test', now() + interval '7 days', 'open', 'approved', 'region')
  returning id into v_bounty_id;

  -- Create a sighting owned by member (for moderation event)
  insert into public.sightings (user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, seen_at, is_public, moderation_status)
  values (v_member_id, v_product_id, v_store_id, 'Test Store', 'Lansing', 'MI', '48910',
    'in_stock', 'in_stock', now() - interval '1 hour', true, 'approved')
  returning id into v_sighting_id;

  -- Insert a moderation event for the sighting (by owner, not member)
  insert into private.contribution_moderation_events (
    contribution_id, contribution_type, actor_id, previous_status, new_status, reason, created_at
  ) values (
    v_sighting_id, 'sighting', v_owner_id, 'pending', 'approved', 'test approval', now() - interval '30 minutes'
  );

  -- Insert a moderation event for the bounty (by owner, not member)
  insert into private.contribution_moderation_events (
    contribution_id, contribution_type, actor_id, previous_status, new_status, reason, created_at
  ) values (
    v_bounty_id, 'bounty', v_owner_id, 'pending', 'approved', 'test approval', now() - interval '20 minutes'
  );

  set local session_replication_role = 'origin';
end;
$$;

-- Helper: set JWT claims for member
create or replace function pg_temp.set_member_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- ============================================================================
-- Behavioral assertions (run as member)
-- ============================================================================

-- Set member context for behavioral tests
select pg_temp.set_member_ctx();

-- 5. Sighting moderation link is '/sightings' (not '/sightings/<uuid>')
select results_eq(
  $$ select link from public.get_personal_notifications(50)
     where event_type = 'moderation' and subtitle = 'Sighting' $$,
  $$ select '/sightings'::text $$,
  'sighting moderation link is /sightings (not /sightings/<uuid>)'
);

-- 6. Bounty moderation link is '/bounties/<uuid>'
select ok(
  (
    select link ~ '^/bounties/[0-9a-f-]{36}$'
    from public.get_personal_notifications(50)
    where event_type = 'moderation' and subtitle = 'Bounty'
    limit 1
  ),
  'bounty moderation link is /bounties/<uuid>'
);

-- 7. Results ordered by occurred_at desc
select ok(
  (
    with n as (
      select occurred_at, row_number() over (order by occurred_at desc, id) as rn
      from public.get_personal_notifications(50)
    )
    select bool_and(occurred_at is not null)
      and (select count(*) from n) >= 2
      and not exists (
        select 1 from n a join n b on a.rn < b.rn and a.occurred_at < b.occurred_at
      )
    from n
  ),
  'results ordered by occurred_at desc'
);

-- 8. Limit clamped to max 50
select ok(
  (select count(*) from public.get_personal_notifications(100)) <= 50,
  'p_limit clamped to max 50 even when p_limit=100'
);

-- 9. Default limit is 20
select ok(
  (select count(*) from public.get_personal_notifications()) <= 20,
  'default limit (no argument) returns at most 20 rows'
);

-- 10. Limit of 1 returns at most 1 row
select ok(
  (select count(*) from public.get_personal_notifications(1)) <= 1,
  'p_limit=1 returns at most 1 row'
);

-- 11. Anonymous user gets no results
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$ select count(*) from public.get_personal_notifications(50) $$,
  $$ select 0::bigint $$,
  'anonymous user (no JWT) gets zero notifications'
);

-- 12. Member sees their own moderation events only
select pg_temp.set_member_ctx();
select ok(
  (
    select count(*) >= 2
    from public.get_personal_notifications(50)
    where event_type = 'moderation'
  ),
  'member sees at least 2 moderation events (sighting + bounty)'
);

select * from finish();

rollback;
