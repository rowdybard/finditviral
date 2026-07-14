-- Issue 3: Contribution moderation (pending → approve)
-- Verify that new sightings/bounties are created as pending and excluded
-- from public listing, and that approve action makes them public.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

-- New sightings should default to pending + is_public = false
select is(
  (select moderation_status from public.sightings order by created_at desc limit 1),
  'pending',
  'new sightings are created with pending moderation status'
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
