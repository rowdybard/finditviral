begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(36);

select has_table('public', 'retailers', 'canonical retailers table exists');
select has_table('public', 'stores', 'canonical stores table exists');
select has_table('private', 'username_claims', 'private username registry exists');
select has_table('private', 'product_suggestions', 'private product suggestions exist');
select has_table('private', 'store_suggestions', 'private store suggestions exist');
select has_table('private', 'contribution_drafts', 'private contribution drafts exist');
select has_table('private', 'interest_events', 'private interest outbox exists');
select has_table('private', 'digest_runs', 'private digest runs exist');
select has_table('private', 'digest_run_items', 'immutable digest items exist');
select has_table('private', 'digest_delivery_attempts', 'digest delivery attempts exist');

select is(
  (select count(*) from private.username_claims),
  (select count(*) from public.profiles),
  'every existing profile has exactly one registry row'
);
select is(
  (select normalized_username from private.username_claims where claimed_username ~ '^user_[0-9a-f]{15}$' limit 1),
  null::text,
  'generated placeholders have no protection key'
);

select ok(
  exists (select 1 from public.zip_codes where zip_code = '48910' and state = 'MI'),
  'default Greater Lansing ZIP is seeded'
);
select is(
  (select count(*) from public.stores where is_active),
  15::bigint,
  'fifteen official or owner-verifiable launch stores are active'
);

select has_function('public', 'search_products', array['text', 'integer'], 'product search RPC exists');
select has_function('public', 'search_stores', array['text', 'integer'], 'store search RPC exists');
select has_function('public', 'create_sighting', array['uuid', 'uuid', 'timestamp with time zone', 'text', 'integer', 'text', 'uuid'], 'sighting creation RPC exists');
select has_function('public', 'create_bounty', array['uuid', 'uuid', 'text', 'integer', 'integer', 'timestamp with time zone', 'text', 'uuid'], 'bounty creation RPC exists');
select has_function('public', 'claim_interest_digest_attempt', array['timestamp with time zone'], 'digest claim RPC exists');
select has_function('public', 'complete_interest_digest_attempt', array['uuid', 'uuid', 'text', 'text', 'text', 'text'], 'digest completion RPC exists');

select ok(
  has_function_privilege('anon', 'public.search_products(text,integer)', 'execute'),
  'anon can use sanitized product search'
);
select ok(
  has_function_privilege('anon', 'public.list_public_sightings(uuid,uuid,text,integer,integer)', 'execute'),
  'anon can use sanitized sighting discovery'
);
select ok(
  has_function_privilege('authenticated', 'public.create_sighting(uuid,uuid,timestamp with time zone,text,integer,text,uuid)', 'execute'),
  'members can call sighting creation'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_list_product_suggestions(text,integer)', 'execute'),
  'authenticated role can reach owner-checked admin RPC'
);
select ok(
  has_function_privilege('service_role', 'public.request_early_access(text,text)', 'execute'),
  'Worker can submit early access'
);
select ok(
  has_function_privilege('service_role', 'public.claim_interest_digest_attempt(timestamp with time zone)', 'execute'),
  'digest Worker can claim a run'
);

select ok(
  not has_function_privilege('anon', 'public.request_early_access(text,text)', 'execute'),
  'browser roles cannot bypass the early-access Worker'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_interest_digest_attempt(timestamp with time zone)', 'execute'),
  'members cannot claim digest delivery work'
);
select ok(
  not has_table_privilege('authenticated', 'public.sightings', 'insert'),
  'direct sighting inserts are revoked'
);
select ok(
  not has_table_privilege('authenticated', 'public.bounties', 'insert'),
  'direct bounty inserts are revoked'
);
select ok(
  not has_table_privilege('anon', 'private.interest_events', 'select'),
  'interest events are not anonymously readable'
);
select ok(
  not has_table_privilege('authenticated', 'private.contribution_drafts', 'select'),
  'drafts are exposed only through owner-checking RPCs'
);

select ok(
  not has_column_privilege('authenticated', 'public.bounties', 'moderation_reason', 'select'),
  'members cannot read private bounty moderation reasons directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.sightings', 'moderated_by', 'select'),
  'members cannot read sighting moderator identities directly'
);

select lives_ok(
  $$select private.validate_draft_payload(
    'sighting',
    jsonb_build_object(
      'version', 1, 'product', null, 'store', null,
      'seenAt', '2026-07-13T12:00', 'availability', 'high',
      'quantity', '', 'notes', ''
    )
  )$$,
  'the sighting form payload matches the database draft allowlist'
);
select lives_ok(
  $$select private.validate_draft_payload(
    'bounty',
    jsonb_build_object(
      'version', 1, 'product', null, 'scope', 'region', 'store', null,
      'zipCode', '48910', 'radiusMiles', '50', 'rewardAmount', '20.00',
      'deadline', '2026-07-20T12:00', 'requirements', ''
    )
  )$$,
  'the bounty form payload matches the database draft allowlist'
);

select * from finish();
rollback;
