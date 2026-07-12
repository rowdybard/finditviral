-- FindItViral - Row Level Security Policies
-- Run this in the Supabase SQL Editor after schema.sql

-- Explicit Data API grants. RLS decides which rows are visible after these grants.
grant usage on schema public to anon, authenticated;

revoke all on trends from anon, authenticated;
revoke all on products from anon, authenticated;
revoke all on profiles from anon, authenticated;
revoke all on profile_contacts from anon, authenticated;
revoke all on bounties from anon, authenticated;
revoke all on sightings from anon, authenticated;
revoke all on bounty_claims from anon, authenticated;
revoke all on zip_codes from anon, authenticated;

grant select on trends, products, profiles, bounties, sightings, zip_codes to anon, authenticated;
grant select on profile_contacts, bounty_claims to authenticated;
grant insert (user_id, contact_info), update (user_id, contact_info) on profile_contacts to authenticated;
grant insert (user_id, product_id, reward_amount, zip_code, radius_miles, notes) on bounties to authenticated;
grant insert (user_id, product_id, store_name, city, state, zip_code, stock_level, is_public, bounty_id) on sightings to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_profile_contacts_updated_at() from public, anon, authenticated;
revoke execute on function public.submit_bounty_claim(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.accept_bounty_claim(uuid) from public, anon;
revoke execute on function public.reject_bounty_claim(uuid) from public, anon;
revoke execute on function public.close_bounty(uuid) from public, anon;
grant execute on function public.submit_bounty_claim(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.accept_bounty_claim(uuid) to authenticated;
grant execute on function public.reject_bounty_claim(uuid) to authenticated;
grant execute on function public.close_bounty(uuid) to authenticated;

-- Enable RLS on all exposed tables
alter table trends enable row level security;
alter table products enable row level security;
alter table profiles enable row level security;
alter table profile_contacts enable row level security;
alter table bounties enable row level security;
alter table sightings enable row level security;
alter table bounty_claims enable row level security;
alter table zip_codes enable row level security;

-- Clean up policies so this file is rerunnable
drop policy if exists "trends_public_read" on trends;
drop policy if exists "products_public_read" on products;
drop policy if exists "zip_codes_public_read" on zip_codes;
drop policy if exists "profiles_public_read" on profiles;
drop policy if exists "profiles_self_update" on profiles;
drop policy if exists "profile_contacts_participant_read" on profile_contacts;
drop policy if exists "profile_contacts_self_insert" on profile_contacts;
drop policy if exists "profile_contacts_self_update" on profile_contacts;
drop policy if exists "bounties_public_read" on bounties;
drop policy if exists "bounties_self_insert" on bounties;
drop policy if exists "bounties_self_update" on bounties;
drop policy if exists "bounties_self_delete" on bounties;
drop policy if exists "sightings_public_read" on sightings;
drop policy if exists "sightings_private_read" on sightings;
drop policy if exists "sightings_self_insert" on sightings;
drop policy if exists "sightings_self_update" on sightings;
drop policy if exists "sightings_self_delete" on sightings;
drop policy if exists "claims_participant_read" on bounty_claims;
drop policy if exists "claims_self_insert" on bounty_claims;
drop policy if exists "claims_bounty_owner_update" on bounty_claims;

-- Public catalog data
create policy "trends_public_read" on trends
  for select
  to anon, authenticated
  using (true);

create policy "products_public_read" on products
  for select
  to anon, authenticated
  using (true);

create policy "zip_codes_public_read" on zip_codes
  for select
  to anon, authenticated
  using (true);

-- Public profile data only. Private contact info lives in profile_contacts.
create policy "profiles_public_read" on profiles
  for select
  to anon, authenticated
  using (true);

create policy "profile_contacts_participant_read" on profile_contacts
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from bounty_claims bc
      join bounties b on b.id = bc.bounty_id
      where bc.status = 'accepted'
        and bc.finder_id = profile_contacts.user_id
        and b.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from bounty_claims bc
      join bounties b on b.id = bc.bounty_id
      where bc.status = 'accepted'
        and b.user_id = profile_contacts.user_id
        and bc.finder_id = (select auth.uid())
    )
  );

create policy "profile_contacts_self_insert" on profile_contacts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profile_contacts_self_update" on profile_contacts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Bounties are public, but direct clients can only create their own open bounties.
-- Status changes happen through close_bounty/accept_bounty_claim.
create policy "bounties_public_read" on bounties
  for select
  to anon, authenticated
  using (true);

create policy "bounties_self_insert" on bounties
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id and status = 'open');

-- Public sightings are public. Private claim sightings are only visible to claim participants.
create policy "sightings_public_read" on sightings
  for select
  to anon, authenticated
  using (is_public = true);

create policy "sightings_private_read" on sightings
  for select
  to authenticated
  using (
    is_public = false
    and (
      (select auth.uid()) = user_id
      or exists (
        select 1
        from bounties b
        join bounty_claims bc on bc.bounty_id = b.id
        where bc.sighting_id = sightings.id
          and b.user_id = (select auth.uid())
      )
    )
  );

create policy "sightings_self_insert" on sightings
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and is_public = true
    and bounty_id is null
  );

-- Claims are read by participants. Creation and status changes go through RPCs.
create policy "claims_participant_read" on bounty_claims
  for select
  to authenticated
  using (
    (select auth.uid()) = finder_id
    or exists (
      select 1
      from bounties
      where id = bounty_id
        and user_id = (select auth.uid())
    )
  );
