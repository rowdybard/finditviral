begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(5);

-- Test the sighting_freshness function at boundaries
select is(
  private.sighting_freshness(now() - interval '1 hour'),
  'fresh',
  'sighting 1 hour old is fresh'
);

select is(
  private.sighting_freshness(now() - interval '25 hours'),
  'possibly_outdated',
  'sighting 25 hours old is possibly_outdated'
);

select is(
  private.sighting_freshness(now() - interval '73 hours'),
  'expired',
  'sighting 73 hours old is expired'
);

-- Test that list_public_sightings returns a freshness_status column
select has_column(
  'public',
  'list_public_sightings',
  'freshness_status',
  'list_public_sightings returns freshness_status column'
);

-- Test that list_public_sightings excludes sightings older than 72 hours
-- (This is a structural test — the function definition filters at 72 hours)
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_public_sightings'
      and pg_get_functiondef(p.oid) ~ "interval '72 hours'"
  ),
  'list_public_sightings filters at 72 hours'
);

select * from finish();
rollback;
