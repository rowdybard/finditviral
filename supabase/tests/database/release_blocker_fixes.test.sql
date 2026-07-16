-- Release-blocker database contract tests.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

select ok(
  not has_table_privilege('authenticated', 'public.leads', 'insert')
  and not has_table_privilege('authenticated', 'public.leads', 'update')
  and not has_table_privilege('authenticated', 'public.leads', 'delete'),
  'authenticated users cannot mutate leads directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.lead_votes', 'insert')
  and not has_table_privilege('authenticated', 'public.lead_votes', 'update')
  and not has_table_privilege('authenticated', 'public.lead_votes', 'delete'),
  'authenticated users cannot mutate lead votes directly'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'lead_votes')
      and policyname in ('leads_self_insert', 'leads_self_update', 'lead_votes_self_insert', 'lead_votes_self_update', 'lead_votes_self_delete')
  ),
  'direct Lead and vote write policies are absent'
);

select has_function(
  'public', 'create_sightings_batch',
  array['uuid', 'uuid[]', 'timestamptz', 'text', 'integer', 'text', 'uuid', 'text[]'],
  'atomic sighting batch RPC exists'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'confirm_lead_with_sighting'
      and pg_get_functiondef(p.oid) ~ '''in_stock'', ''low_stock'''
      and pg_get_functiondef(p.oid) !~ '''sold_out'''
      and pg_get_functiondef(p.oid) ~ 'check_contribution_rate_limit'
      and pg_get_functiondef(p.oid) ~ '''pending'''
  ),
  'Lead confirmation limits availability, rate-limits, and creates a pending sighting'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'confirm_lead_with_sighting'
      and pg_get_functiondef(p.oid) ~ 'Sighting store is outside the Lead scope'
      and pg_get_functiondef(p.oid) ~ 'confirmed_sighting_id is not null'
  ),
  'Lead confirmation enforces scope and one pending confirmation'
);

select ok(
  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'sightings'
      and trigger_name = 'sightings_sync_lead_confirmation'
  ),
  'sighting moderation trigger synchronizes Lead confirmation'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'sync_lead_confirmation_from_sighting'
      and pg_get_functiondef(p.oid) ~ '''confirmed'''
      and pg_get_functiondef(p.oid) ~ 'confirmed_sighting_id = null'
      and pg_get_functiondef(p.oid) ~ '''active'''
  ),
  'Lead confirmation trigger confirms, clears rejected, and reverts to active'
);

select ok(
  not exists (
    select 1
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public'
      and cl.relname = 'leads'
      and c.conname = 'leads_scope_check'
      and pg_get_constraintdef(c.oid) ~ '''retailers'''
  ),
  'Lead scope constraint no longer accepts retailers'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_list_recent_contributions'
      and pg_get_functiondef(p.oid) ~ '''lead''::text'
      and pg_get_functiondef(p.oid) !~ 'l.status = ''pending'''
  ),
  'all Leads appear in the admin moderation queue (not just pending)'
);

-- Fixtures for behavioral confirmation and batch-transaction tests.
do $$
declare
  v_member_id uuid := '00000000-0000-4000-8000-0000000000f1';
  v_owner_id uuid := '00000000-0000-4000-8000-0000000000f2';
  v_product_id uuid;
  v_store_id uuid;
begin
  set local session_replication_role = 'replica';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (v_member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'release-member@test.local', 'test', now(), now(), now()),
    (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'release-owner@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values
    (v_member_id, 'release-member', true, 50, now()),
    (v_owner_id, 'release-owner', true, 100, now())
  on conflict (id) do update set onboarding_completed = true, username = excluded.username;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values
    (v_member_id, 'release-member', 'release-member', 'release-member', false),
    (v_owner_id, 'release-owner', 'release-owner', 'release-owner', false)
  on conflict (user_id) do update set claimed_username = excluded.claimed_username, normalized_username = excluded.normalized_username, protection_name = excluded.protection_name, is_legacy = false;

  insert into private.app_owners (user_id) values (v_owner_id) on conflict do nothing;

  select p.id into v_product_id from public.products p where p.is_active order by p.created_at limit 1;
  select s.id into v_store_id from public.stores s where s.is_active order by s.created_at limit 1;
  if v_product_id is null or v_store_id is null then
    raise exception 'Release blocker test requires an active product and store';
  end if;

  insert into public.leads (id, user_id, product_id, slug, headline, scope_type, store_id, source_type, status, expires_at)
  values
    ('00000000-0000-4000-8000-0000000000f3', v_member_id, v_product_id, 'release-confirm-approve', 'Release confirmation approval test', 'stores', v_store_id, 'other', 'active', now() + interval '7 days'),
    ('00000000-0000-4000-8000-0000000000f4', v_member_id, v_product_id, 'release-confirm-hide', 'Release confirmation hide test', 'stores', v_store_id, 'other', 'active', now() + interval '7 days'),
    ('00000000-0000-4000-8000-0000000000f5', v_member_id, v_product_id, 'release-confirm-unconfirm', 'Release confirmation unconfirm test', 'stores', v_store_id, 'other', 'active', now() + interval '7 days')
  on conflict (id) do update set status = 'active', confirmed_sighting_id = null, expires_at = excluded.expires_at;

  set local session_replication_role = 'origin';
end;
$$;

create or replace function pg_temp.set_member_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","is_anonymous":false}', true);
end;
$$;

create or replace function pg_temp.set_owner_ctx()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated","is_anonymous":false}', true);
end;
$$;

select pg_temp.set_member_ctx();
set role authenticated;
select throws_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f3',
    (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
    now(), 'sold_out', null, null, null
  ) $$,
  '22023',
  'Only in-stock sightings can confirm a lead',
  'sold-out sightings cannot confirm a Lead'
);

select throws_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f3',
    (select id from public.stores
     where is_active
       and id <> (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3')
     order by created_at
     limit 1),
    now(), 'in_stock', null, null, null
  ) $$,
  '22023',
  'Sighting store is outside the Lead scope',
  'an out-of-scope store cannot confirm a Lead'
);

select lives_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f3',
    (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
    now(), 'in_stock', null, null, null
  ) $$,
  'an in-stock sighting can be submitted for confirmation'
);

select throws_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f3',
    (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
    now(), 'in_stock', null, null, null
  ) $$,
  '55000',
  'A confirmation is already awaiting moderation',
  'a Lead cannot receive two concurrent pending confirmations'
);
reset role;

select ok(
  exists (
    select 1
    from public.leads l
    join public.sightings s on s.id = l.confirmed_sighting_id
    where l.id = '00000000-0000-4000-8000-0000000000f3'
      and l.status = 'active'
      and s.moderation_status = 'pending'
      and not s.is_public
  ),
  'submitted confirmation remains pending and leaves the Lead active'
);

select pg_temp.set_owner_ctx();
set role authenticated;
select lives_ok(
  $$ select public.admin_set_contribution_moderation(
    'sighting',
    (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
    'approve'
  ) $$,
  'owner can approve a confirmation sighting'
);
reset role;

select ok(
  exists (
    select 1
    from public.leads l
    join public.sightings s on s.id = l.confirmed_sighting_id
    where l.id = '00000000-0000-4000-8000-0000000000f3'
      and l.status = 'confirmed'
      and s.moderation_status = 'approved'
      and s.is_public
  ),
  'approved confirmation sighting confirms the Lead and becomes public'
);

select pg_temp.set_member_ctx();
set role authenticated;
select lives_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f4',
    (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f4'),
    now(), 'low_stock', null, null, null
  ) $$,
  'a second Lead can receive a pending low-stock confirmation'
);
reset role;

select pg_temp.set_owner_ctx();
set role authenticated;
select lives_ok(
  $$ select public.admin_set_contribution_moderation(
    'sighting',
    (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f4'),
    'hide'
  ) $$,
  'owner can hide a pending confirmation sighting'
);
reset role;

select is(
  (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f4'),
  null::uuid,
  'hiding a pending confirmation clears the Lead link for a replacement confirmation'
);

-- Test: approved confirmation sighting is hidden → lead reverts to 'active'
select pg_temp.set_member_ctx();
set role authenticated;
select lives_ok(
  $$ select public.confirm_lead_with_sighting(
    '00000000-0000-4000-8000-0000000000f5',
    (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f5'),
    now(), 'in_stock', null, null, null
  ) $$,
  'a third Lead can receive a pending in-stock confirmation'
);
reset role;

select pg_temp.set_owner_ctx();
set role authenticated;
select lives_ok(
  $$ select public.admin_set_contribution_moderation(
    'sighting',
    (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f5'),
    'approve'
  ) $$,
  'owner can approve the third Lead confirmation sighting'
);
reset role;

select ok(
  exists (
    select 1
    from public.leads l
    join public.sightings s on s.id = l.confirmed_sighting_id
    where l.id = '00000000-0000-4000-8000-0000000000f5'
      and l.status = 'confirmed'
      and s.moderation_status = 'approved'
  ),
  'third Lead is confirmed after approval'
);

select pg_temp.set_owner_ctx();
set role authenticated;
select lives_ok(
  $$ select public.admin_set_contribution_moderation(
    'sighting',
    (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f5'),
    'hide'
  ) $$,
  'owner can hide an approved confirmation sighting'
);
reset role;

select is(
  (select status from public.leads where id = '00000000-0000-4000-8000-0000000000f5'),
  'active',
  'hiding an approved confirmation sighting reverts the Lead to active'
);

select is(
  (select confirmed_sighting_id from public.leads where id = '00000000-0000-4000-8000-0000000000f5'),
  null::uuid,
  'hiding an approved confirmation sighting clears confirmed_sighting_id'
);

select pg_temp.set_member_ctx();
set role authenticated;
select throws_ok(
  $$ select public.create_sightings_batch(
    (select product_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
    array[
      (select store_id from public.leads where id = '00000000-0000-4000-8000-0000000000f3'),
      '00000000-0000-4000-8000-0000000000ff'::uuid
    ],
    now(), 'in_stock', null, 'release batch rollback test'
  ) $$,
  '22023',
  'Store is unavailable',
  'a batch with an invalid store fails'
);
reset role;

select is(
  (select count(*) from public.sightings where notes = 'release batch rollback test'),
  0::bigint,
  'failed sighting batches leave no partial inserts'
);

select * from finish();
rollback;
