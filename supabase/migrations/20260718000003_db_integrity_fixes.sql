-- Add missing FK indexes for query performance and integrity:
-- sightings.store_id, sightings.bounty_id, bounty_claims.sighting_id

begin;

create index if not exists idx_sightings_store_id
  on public.sightings (store_id);

create index if not exists idx_sightings_bounty_id
  on public.sightings (bounty_id)
  where bounty_id is not null;

create index if not exists idx_bounty_claims_sighting_id
  on public.bounty_claims (sighting_id)
  where sighting_id is not null;

commit;
