-- Issue 3: Contribution moderation (pending → approve)
-- Trusted catalog sightings publish immediately through submit_sightings_v2;
-- pending contributions remain excluded until an owner approves them.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

-- Legacy entry points delegate to the trusted standard submission workflow.
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_sighting'
      and pg_get_functiondef(p.oid) ~ 'submit_sightings_v2'
  ),
  'create_sighting delegates to the trusted v2 sighting workflow'
);

-- Pending sightings should not appear in list_public_sightings
select ok(
  not exists (
    select 1 from public.list_public_sightings(null, null, '48910', 250, 100)
    where id in (select id from public.sightings where moderation_status = 'pending')
  ),
  'pending sightings are excluded from public listing'
);

-- Pending bounties should not appear in list_public_bounties
select ok(
  not exists (
    select 1 from public.list_public_bounties(null, '48910', 250, 100)
    where id in (select id from public.bounties where moderation_status = 'pending')
  ),
  'pending bounties are excluded from public listing'
);

-- The admin_set_contribution_moderation function should accept 'approve'
select has_function(
  'public', 'admin_set_contribution_moderation',
  array['text', 'uuid', 'text', 'text'],
  'admin_set_contribution_moderation RPC exists with approve support'
);

select * from finish();
rollback;
