-- Boundary tests for per-user contribution rate limits.
-- Tests that check_contribution_rate_limit enforces exact limits:
--   - 10 sightings/hour: 10th allowed, 11th rejected
--   - 5 bounties/hour: 5th allowed, 6th rejected
--   - Owner bypass: owner exceeds limits without error

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(9);

-- ============================================================================
-- Test fixtures: create test users, profiles, app_owners
-- ============================================================================
do $$
declare
  v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
  v_member_id uuid := '00000000-0000-4000-8000-000000000002';
  v_finder_id uuid := '00000000-0000-4000-8000-000000000003';
begin
  set local session_replication_role = 'replica';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'owner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  update public.profiles set username = 'rateowner' where id = v_owner_id;
  update private.username_claims set claimed_username = 'rateowner', normalized_username = 'rateowner' where user_id = v_owner_id;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'member@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;
  update public.profiles set username = 'ratemember' where id = v_member_id;
  update private.username_claims set claimed_username = 'ratemember', normalized_username = 'ratemember' where user_id = v_member_id;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_finder_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'finder@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_owner_id, 'rateowner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = 'rateowner';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_member_id, 'ratemember', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'ratemember';

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_finder_id, 'ratefinder', true, 50, now())
  on conflict (id) do update set onboarding_completed = true, username = 'ratefinder';

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_owner_id, 'rateowner', 'rateowner', 'rateowner', false)
  on conflict (user_id) do update set claimed_username = 'rateowner', normalized_username = 'rateowner', protection_name = 'rateowner', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_member_id, 'ratemember', 'ratemember', 'ratemember', false)
  on conflict (user_id) do update set claimed_username = 'ratemember', normalized_username = 'ratemember', protection_name = 'ratemember', is_legacy = false;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_finder_id, 'ratefinder', 'ratefinder', 'ratefinder', false)
  on conflict (user_id) do update set claimed_username = 'ratefinder', normalized_username = 'ratefinder', protection_name = 'ratefinder', is_legacy = false;

  insert into private.app_owners (user_id)
  values (v_owner_id)
  on conflict (user_id) do nothing;

  set local session_replication_role = 'origin';
end;
$$;

-- Helper: set JWT claims for member
create or replace function pg_temp.set_member_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- Helper: set JWT claims for owner
create or replace function pg_temp.set_owner_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- Helper: set JWT claims for finder
create or replace function pg_temp.set_finder_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',
    true);
end;
$$;

-- Helper: fetch a seed product ID
create or replace function pg_temp.get_test_product_id()
returns uuid language sql stable as $$
  select id from public.products where is_active order by verified_at desc limit 1;
$$;

-- Helper: fetch a seed store ID
create or replace function pg_temp.get_test_store_id()
returns uuid language sql stable as $$
  select id from public.stores where is_active limit 1;
$$;

-- ============================================================================
-- 1. Sighting rate limit: 10th sighting is allowed (at limit but not over)
-- ============================================================================
select lives_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
    v_store_id uuid := pg_temp.get_test_store_id();
    v_member_id uuid := '00000000-0000-4000-8000-000000000002';
    i integer;
  begin
    perform pg_temp.set_member_ctx();
    -- Insert 9 sightings directly (bypassing RPC to avoid rate limit on setup)
    for i in 1..9 loop
      insert into public.sightings (user_id, product_id, store_id, store_name, city, state, zip_code,
        stock_level, availability, seen_at, is_public, moderation_status)
      values (v_member_id, v_product_id, v_store_id, 'Test Store', 'Lansing', 'MI', '48910',
        'in_stock', 'in_stock', now() - interval '5 minutes', false, 'pending');
    end loop;
    -- 10th sighting via RPC should succeed (count is 9, limit is 10, 9 < 10)
    perform public.create_sighting(v_product_id, v_store_id, now() - interval '1 minute', 'in_stock');
  end;
  $body$;
  $test$,
  '10th sighting is allowed when 9 exist in the current hour'
);

-- ============================================================================
-- 2. Sighting rate limit: 11th sighting is rejected (over limit)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
    v_store_id uuid := pg_temp.get_test_store_id();
    v_member_id uuid := '00000000-0000-4000-8000-000000000002';
  begin
    perform pg_temp.set_member_ctx();
    -- 10 sightings already exist from test 1, 11th should fail
    perform public.create_sighting(v_product_id, v_store_id, now() - interval '1 minute', 'in_stock');
  end;
  $body$;
  $test$,
  '42901',
  'Rate limit exceeded for sightings',
  '11th sighting is rejected with rate limit error (42901)'
);

-- ============================================================================
-- 3. Bounty rate limit: 5th bounty is allowed (at limit but not over)
-- ============================================================================
select lives_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
    v_member_id uuid := '00000000-0000-4000-8000-000000000002';
    i integer;
  begin
    perform pg_temp.set_member_ctx();
    -- Insert 4 bounties directly (bypassing RPC to avoid rate limit on setup)
    for i in 1..4 loop
      insert into public.bounties (user_id, product_id, reward_amount, reward_cents,
        zip_code, radius_miles, notes, requirements, deadline, status, moderation_status,
        scope_type)
      values (v_member_id, v_product_id, 5.00, 500, '48910', 10,
        'test', 'test', now() + interval '7 days', 'open', 'pending', 'region');
    end loop;
    -- 5th bounty via RPC should succeed (count is 4, limit is 5, 4 < 5)
    perform public.create_bounty(v_product_id, 'region', null, '48910', 10,
      null, null, 500, now() + interval '7 days', 'test', null, null, false, null);
  end;
  $body$;
  $test$,
  '5th bounty is allowed when 4 exist in the current hour'
);

-- ============================================================================
-- 4. Bounty rate limit: 6th bounty is rejected (over limit)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
  begin
    perform pg_temp.set_member_ctx();
    -- 5 bounties already exist from test 3, 6th should fail
    perform public.create_bounty(v_product_id, 'region', null, '48910', 10,
      null, null, 500, now() + interval '7 days', 'test', null, null, false, null);
  end;
  $body$;
  $test$,
  '42901',
  'Rate limit exceeded for bounties',
  '6th bounty is rejected with rate limit error (42901)'
);

-- ============================================================================
-- 5. Owner bypasses rate limits entirely
-- ============================================================================
select lives_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
    v_store_id uuid := pg_temp.get_test_store_id();
    v_owner_id uuid := '00000000-0000-4000-8000-000000000001';
    i integer;
  begin
    perform pg_temp.set_owner_ctx();
    -- Insert 15 sightings directly for owner (well over the limit of 10)
    for i in 1..15 loop
      insert into public.sightings (user_id, product_id, store_id, store_name, city, state, zip_code,
        stock_level, availability, seen_at, is_public, moderation_status)
      values (v_owner_id, v_product_id, v_store_id, 'Test Store', 'Lansing', 'MI', '48910',
        'in_stock', 'in_stock', now() - interval '5 minutes', false, 'pending');
    end loop;
    -- 16th sighting via RPC should still succeed because owner bypasses rate limit
    perform public.create_sighting(v_product_id, v_store_id, now() - interval '1 minute', 'in_stock');
  end;
  $body$;
  $test$,
  'Owner can create sightings beyond the member rate limit'
);

-- ============================================================================
-- 6. Suggestion rate limit: 5th suggestion is allowed (at limit but not over)
-- ============================================================================
select lives_ok(
  $test$
  do $body$
  declare
    v_member_id uuid := '00000000-0000-4000-8000-000000000002';
    i integer;
  begin
    perform pg_temp.set_member_ctx();
    -- Insert 4 product suggestions directly (bypassing RPC to avoid rate limit on setup)
    for i in 1..4 loop
      insert into private.product_suggestions (user_id, name)
      values (v_member_id, 'Rate Limit Setup Product ' || i);
    end loop;
    -- 5th suggestion via RPC should succeed (count is 4, limit is 5, 4 < 5)
    perform public.suggest_product_for_draft(
      null, 'sighting', '{"version":1}'::jsonb,
      'Rate Limit Test Product', null, null, null
    );
  end;
  $body$;
  $test$,
  '5th suggestion is allowed when 4 exist in the current hour'
);

-- ============================================================================
-- 7. Suggestion rate limit: 6th suggestion is rejected (over limit)
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_member_ctx();
    -- 5 suggestions already exist from test 6, 6th should fail
    perform public.suggest_store_for_draft(
      null, 'sighting', '{"version":1}'::jsonb,
      null, 'Rate Limit Retailer', 'Rate Limit Store',
      '123 Test St', 'Lansing', 'MI', '48910', null, null
    );
  end;
  $body$;
  $test$,
  '42901',
  'Rate limit exceeded for suggestions',
  '6th suggestion is rejected with rate limit error (42901)'
);

-- ============================================================================
-- 8. Store suggestion rate limit: 6th store suggestion is rejected
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  begin
    perform pg_temp.set_member_ctx();
    -- 5 suggestions already exist from test 6 (product suggestions count toward shared limit)
    -- A store suggestion is the 6th suggestion overall and should fail
    perform public.suggest_store_for_draft(
      null, 'sighting', '{"version":1}'::jsonb,
      null, 'Rate Limit Retailer 2', 'Rate Limit Store 2',
      '456 Test Ave', 'Lansing', 'MI', '48910', null, null
    );
  end;
  $body$;
  $test$,
  '42901',
  'Rate limit exceeded for suggestions',
  '6th store suggestion is rejected with rate limit error (42901)'
);

-- ============================================================================
-- 9. Duplicate bounty claim by same finder is rejected
-- ============================================================================
select throws_ok(
  $test$
  do $body$
  declare
    v_product_id uuid := pg_temp.get_test_product_id();
    v_store_id uuid := pg_temp.get_test_store_id();
    v_member_id uuid := '00000000-0000-4000-8000-000000000002';
    v_bounty_id uuid;
  begin
    -- Member creates a bounty (owner)
    perform pg_temp.set_member_ctx();
    insert into public.bounties (user_id, product_id, reward_amount, reward_cents,
      zip_code, radius_miles, notes, requirements, deadline, status, moderation_status,
      scope_type)
    values (v_member_id, v_product_id, 5.00, 500, '48910', 10,
      'test', 'test', now() + interval '7 days', 'open', 'approved', 'region')
    returning id into v_bounty_id;

    -- Finder submits first claim (should succeed)
    perform pg_temp.set_finder_ctx();
    perform public.submit_bounty_claim(v_bounty_id, v_store_id, now() - interval '1 minute', 'in_stock');

    -- Finder submits second claim on same bounty (should fail: duplicate)
    perform public.submit_bounty_claim(v_bounty_id, v_store_id, now() - interval '1 minute', 'in_stock');
  end;
  $body$;
  $test$,
  '23505',
  'duplicate key value violates unique constraint "bounty_claims_bounty_id_finder_id_key"',
  'Duplicate bounty claim by same finder is rejected'
);

select * from finish();
rollback;
