-- FindItViral — Row Level Security Policies
-- Run this in the Supabase SQL Editor after schema.sql

-- Enable RLS on all tables
alter table trends enable row level security;
alter table products enable row level security;
alter table profiles enable row level security;
alter table bounties enable row level security;
alter table sightings enable row level security;
alter table bounty_claims enable row level security;
alter table zip_codes enable row level security;

-- Trends: public read, no write (managed via SQL/seed)
create policy "trends_public_read" on trends for select using (true);

-- Products: public read, no write (managed via SQL/seed)
create policy "products_public_read" on products for select using (true);

-- Zip codes: public read, no write
create policy "zip_codes_public_read" on zip_codes for select using (true);

-- Profiles: public read of username/karma; contact_info only visible to self
-- or to users who have an accepted claim with this profile
create policy "profiles_public_read" on profiles for select
  using (true);

-- Note: contact_info is returned to all queries but the app only displays it
-- after an accepted claim. For stricter RLS, you could create a separate
-- contact_info table with restricted access. For MVP this is acceptable.

-- Profiles: users can update their own profile
create policy "profiles_self_update" on profiles for update
  using (auth.uid() = id);

-- Bounties: public read
create policy "bounties_public_read" on bounties for select
  using (true);

-- Bounties: authenticated users can insert their own
create policy "bounties_self_insert" on bounties for insert
  with check (auth.uid() = user_id);

-- Bounties: users can update their own
create policy "bounties_self_update" on bounties for update
  using (auth.uid() = user_id);

-- Bounties: users can delete their own
create policy "bounties_self_delete" on bounties for delete
  using (auth.uid() = user_id);

-- Sightings: public sightings readable by all
create policy "sightings_public_read" on sightings for select
  using (is_public = true);

-- Sightings: private sightings readable by the finder or the bounty poster
create policy "sightings_private_read" on sightings for select
  using (
    is_public = false and (
      auth.uid() = user_id or
      exists (
        select 1 from bounties b
        join bounty_claims bc on bc.bounty_id = b.id
        where bc.sighting_id = sightings.id and b.user_id = auth.uid()
      )
    )
  );

-- Sightings: authenticated users can insert their own
create policy "sightings_self_insert" on sightings for insert
  with check (auth.uid() = user_id);

-- Sightings: users can update/delete their own
create policy "sightings_self_update" on sightings for update
  using (auth.uid() = user_id);

create policy "sightings_self_delete" on sightings for delete
  using (auth.uid() = user_id);

-- Bounty Claims: readable by bounty poster or claim finder
create policy "claims_participant_read" on bounty_claims for select
  using (
    auth.uid() = finder_id or
    exists (select 1 from bounties where id = bounty_id and user_id = auth.uid())
  );

-- Bounty Claims: authenticated users can insert their own claims
create policy "claims_self_insert" on bounty_claims for insert
  with check (auth.uid() = finder_id);

-- Bounty Claims: only bounty poster can update (accept/reject)
create policy "claims_bounty_owner_update" on bounty_claims for update
  using (
    exists (select 1 from bounties where id = bounty_id and user_id = auth.uid())
  );
