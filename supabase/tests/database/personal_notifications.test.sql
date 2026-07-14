-- Issue 21: Verify get_personal_notifications RPC exists, is secured, and
-- produces correct link values for sighting and bounty moderation events.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- Function exists with correct signature
select has_function(
  'public', 'get_personal_notifications',
  ARRAY['integer'],
  'get_personal_notifications function exists'
);

-- Returns the expected columns
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

-- Granted to authenticated
select ok(
  has_function_privilege('authenticated', 'public.get_personal_notifications(integer)', 'execute'),
  'authenticated role can execute get_personal_notifications'
);

-- Not granted to anon
select ok(
  not has_function_privilege('anon', 'public.get_personal_notifications(integer)', 'execute'),
  'anon role cannot execute get_personal_notifications'
);

-- Sighting moderation link is '/sightings' (not '/sightings/<uuid>')
select ok(
  (
    select pg_get_functiondef(p.oid) ~ *'/sightings''::text'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_personal_notifications'
  )
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_personal_notifications'
      and pg_get_functiondef(p.oid) ~ *'/sightings/'' \|\| me\.contribution_id'
  ),
  'sighting moderation link is /sightings (not /sightings/<uuid>)'
);

-- Bounty moderation link is '/bounties/<uuid>'
select ok(
  (
    select pg_get_functiondef(p.oid) ~ *'/bounties/'' \|\| me\.contribution_id'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_personal_notifications'
  ),
  'bounty moderation link is /bounties/<uuid>'
);

-- Results ordered by occurred_at desc
select ok(
  (
    select pg_get_functiondef(p.oid) ~ *'order by t\.occurred_at desc'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_personal_notifications'
  ),
  'results ordered by occurred_at desc'
);

-- Limit clamped to max 50
select ok(
  (
    select pg_get_functiondef(p.oid) ~ *'limit least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_personal_notifications'
  ),
  'p_limit clamped to max 50'
);

select * from finish();

rollback;
