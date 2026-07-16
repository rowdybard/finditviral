-- Automated content moderation: privilege boundary, bounded queue, idempotency,
-- and no-owner-action publication for clean bounties and lead confirmations.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(26);

select has_table('private', 'content_moderation_results', 'private moderation result table exists');
select is(
  (select rowsecurity from pg_tables where schemaname = 'private' and tablename = 'content_moderation_results'),
  true,
  'moderation result table has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'private.content_moderation_results', 'select')
  and not has_table_privilege('authenticated', 'private.content_moderation_results', 'select')
  and not has_table_privilege('service_role', 'private.content_moderation_results', 'select'),
  'no API role has direct access to moderation result rows'
);

select has_function('public', 'get_pending_moderation_queue', array['integer'], 'bounded queue RPC exists');
select has_function('public', 'set_content_moderation_result', array['text', 'uuid', 'boolean', 'text[]', 'text'], 'result RPC exists');
select has_function('public', 'mark_content_moderation_notification_sent', array['text', 'uuid'], 'notification completion RPC exists');
select ok(
  not has_function_privilege('anon', 'public.get_pending_moderation_queue(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_pending_moderation_queue(integer)', 'execute')
  and not has_function_privilege('anon', 'public.set_content_moderation_result(text,uuid,boolean,text[],text)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_content_moderation_result(text,uuid,boolean,text[],text)', 'execute'),
  'browser roles cannot invoke moderation queue or result RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'public.mark_content_moderation_notification_sent(text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.get_pending_moderation_queue(integer)', 'execute')
  and has_function_privilege('service_role', 'public.set_content_moderation_result(text,uuid,boolean,text[],text)', 'execute')
  and has_function_privilege('service_role', 'public.mark_content_moderation_notification_sent(text,uuid)', 'execute'),
  'only the service Worker role can operate moderation'
);
select ok(
  (select 'search_path=pg_catalog, private, public, pg_temp' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.get_pending_moderation_queue(integer)'::regprocedure)
  and (select 'search_path=pg_catalog, private, public, pg_temp' = any(p.proconfig)
   from pg_proc p where p.oid = 'public.set_content_moderation_result(text,uuid,boolean,text[],text)'::regprocedure),
  'moderation SECURITY DEFINER functions use fixed search paths'
);
select throws_ok(
  $$ select * from public.get_pending_moderation_queue(26) $$,
  '22023',
  'Moderation queue limit must be between 1 and 25',
  'queue refuses a limit above its bounded batch size'
);

do $$
declare
  v_user_id uuid := '00000000-0000-4000-8000-000000000f01';
  v_product_id uuid;
  v_store_id uuid;
begin
  set local session_replication_role = 'replica';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'moderation@test.local', 'test', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username, onboarding_completed, karma, created_at)
  values (v_user_id, 'moderation_fixture', true, 10, now())
  on conflict (id) do update set username = excluded.username, onboarding_completed = true;

  insert into private.username_claims (user_id, claimed_username, normalized_username, protection_name, is_legacy)
  values (v_user_id, 'moderation_fixture', 'moderation_fixture', 'moderation_fixture', false)
  on conflict (user_id) do update set claimed_username = excluded.claimed_username,
    normalized_username = excluded.normalized_username, protection_name = excluded.protection_name, is_legacy = false;

  select id into v_product_id from public.products where is_active order by verified_at desc nulls last limit 1;
  select id into v_store_id from public.stores where is_active limit 1;
  if v_product_id is null or v_store_id is null then
    raise exception 'test catalog fixture is unavailable';
  end if;

  insert into public.bounties (
    id, user_id, product_id, reward_amount, reward_cents, zip_code, radius_miles,
    status, deadline, moderation_status, scope_type, requirements
  ) values
    ('00000000-0000-4000-8000-000000000f11', v_user_id, v_product_id, 5, 500, '48910', 50, 'open', now() + interval '30 days', 'pending', 'region', 'Clean bounty text'),
    ('00000000-0000-4000-8000-000000000f12', v_user_id, v_product_id, 5, 500, '48910', 50, 'open', now() + interval '30 days', 'pending', 'region', 'Flagged bounty text'),
    ('00000000-0000-4000-8000-000000000f13', v_user_id, v_product_id, 5, 500, '48910', 50, 'open', now() + interval '30 days', 'pending', 'region', 'Changed by a human'),
    ('00000000-0000-4000-8000-000000000f14', v_user_id, v_product_id, 5, 500, '48910', 50, 'open', now() + interval '30 days', 'pending', 'region', 'Aged out of the queue');

  update public.bounties
  set created_at = now() - interval '25 hours'
  where id = '00000000-0000-4000-8000-000000000f14';

  insert into public.leads (
    id, user_id, product_id, slug, headline, details, scope_type, zip_code, radius_miles,
    source_type, status, expires_at
  ) values
    ('00000000-0000-4000-8000-000000000f21', v_user_id, v_product_id, 'moderation-clean-lead', 'Clean lead', 'Clean lead details', 'region', '48910', 50, 'other', 'pending', now() + interval '30 days'),
    ('00000000-0000-4000-8000-000000000f22', v_user_id, v_product_id, 'moderation-confirmation-lead', 'Lead confirmation', 'Confirmation lead details', 'region', '48910', 50, 'other', 'active', now() + interval '30 days');

  insert into public.sightings (
    id, user_id, product_id, store_id, store_name, city, state, zip_code, stock_level,
    availability, seen_at, notes, is_public, moderation_status, lead_id
  ) values (
    '00000000-0000-4000-8000-000000000f31', v_user_id, v_product_id, v_store_id,
    'Moderation Test Store', 'Lansing', 'MI', '48910', 'in_stock', 'in_stock', now(),
    'Clean confirmation note', false, 'pending', '00000000-0000-4000-8000-000000000f22'
  );

  update public.leads
  set confirmed_sighting_id = '00000000-0000-4000-8000-000000000f31'
  where id = '00000000-0000-4000-8000-000000000f22';

  set local session_replication_role = 'origin';
end;
$$;

set role service_role;

select ok(
  not exists (
    select 1 from public.get_pending_moderation_queue(25)
    where contribution_id = '00000000-0000-4000-8000-000000000f14'
  ),
  'queue ignores contributions older than 24 hours'
);
select ok(
  (select auto_approved from public.set_content_moderation_result(
    'bounty', '00000000-0000-4000-8000-000000000f11', false, '{}'::text[], 'test-model'
  )),
  'clean bounty is approved without owner action'
);
reset role;
select is(
  (select moderation_status from public.bounties where id = '00000000-0000-4000-8000-000000000f11'),
  'approved',
  'clean bounty is public to the normal bounty listing workflow'
);
set role service_role;
select ok(
  not (select recorded from public.set_content_moderation_result(
    'bounty', '00000000-0000-4000-8000-000000000f11', true, array['violence']::text[], 'different-model'
  )),
  'replaying a moderation result is idempotent and cannot change the first decision'
);
select ok(
  not (select auto_approved from public.set_content_moderation_result(
    'bounty', '00000000-0000-4000-8000-000000000f12', true, array['violence']::text[], 'test-model'
  )),
  'flagged bounty remains pending for owner review'
);
select ok(
  public.mark_content_moderation_notification_sent('bounty', '00000000-0000-4000-8000-000000000f12'),
  'flagged owner notification can be marked accepted once'
);
select ok(
  not public.mark_content_moderation_notification_sent('bounty', '00000000-0000-4000-8000-000000000f12'),
  'flagged owner notification marking is idempotent'
);
reset role;
select is(
  (select categories from private.content_moderation_results
    where contribution_type = 'bounty' and contribution_id = '00000000-0000-4000-8000-000000000f12'),
  array['violence']::text[],
  'only flagged categories are retained'
);
set role service_role;
select ok(
  (select auto_approved from public.set_content_moderation_result(
    'lead', '00000000-0000-4000-8000-000000000f21', false, '{}'::text[], 'test-model'
  )),
  'clean lead becomes active without owner action'
);
reset role;
select is(
  (select status from public.leads where id = '00000000-0000-4000-8000-000000000f21'),
  'active',
  'clean lead has an active public lifecycle state'
);
set role service_role;
select ok(
  (select auto_approved from public.set_content_moderation_result(
    'sighting', '00000000-0000-4000-8000-000000000f31', false, '{}'::text[], 'test-model'
  )),
  'clean lead confirmation is approved without owner action'
);
reset role;
select ok(
  (select is_public and moderation_status = 'approved'
   from public.sightings where id = '00000000-0000-4000-8000-000000000f31')
  and (select status = 'confirmed' from public.leads where id = '00000000-0000-4000-8000-000000000f22'),
  'clean lead confirmation publishes and confirms its linked lead'
);

update public.bounties
set moderation_status = 'approved'
where id = '00000000-0000-4000-8000-000000000f13';

set role service_role;
select ok(
  not (select recorded from public.set_content_moderation_result(
    'bounty', '00000000-0000-4000-8000-000000000f13', false, '{}'::text[], 'test-model'
  )),
  'a human status change before processing prevents an automated result'
);
reset role;

select ok(
  not exists (
    select 1 from private.content_moderation_results
    where contribution_type = 'bounty' and contribution_id = '00000000-0000-4000-8000-000000000f13'
  ),
  'human-changed work has no stale automated moderation row'
);
select ok(
  pg_get_functiondef('public.get_pending_moderation_queue(integer)'::regprocedure) ~ 's\.bounty_id is null',
  'bounty-claim evidence is excluded from the automated moderation queue'
);
select ok(
  pg_get_functiondef('public.get_admin_review_counts()'::regprocedure) ~ 'r\.flagged'
  and pg_get_functiondef('public.get_admin_review_counts()'::regprocedure) ~ '24 hours',
  'owner review count excludes fresh clean automation work'
);

select * from finish();
rollback;
