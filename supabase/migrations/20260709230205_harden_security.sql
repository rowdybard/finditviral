-- Harden profile privacy, claim integrity, and Data API grants.

create table if not exists public.profile_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  contact_info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_contacts (user_id, contact_info)
select id, contact_info
from public.profiles
where contact_info is not null
on conflict (user_id) do update
  set contact_info = excluded.contact_info,
      updated_at = now();

alter table public.profiles drop column if exists contact_info;

-- Existing invalid rows should not block the migration, but future rows must comply.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bounties_zip_code_format'
  ) then
    alter table public.bounties
      add constraint bounties_zip_code_format
      check (zip_code ~ '^[0-9]{5}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bounties_radius_miles_allowed'
  ) then
    alter table public.bounties
      add constraint bounties_radius_miles_allowed
      check (radius_miles in (10, 25, 50, 100, 250)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sightings_state_format'
  ) then
    alter table public.sightings
      add constraint sightings_state_format
      check (state is null or state ~ '^[A-Z]{2}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sightings_zip_code_format'
  ) then
    alter table public.sightings
      add constraint sightings_zip_code_format
      check (zip_code is null or zip_code ~ '^[0-9]{5}$') not valid;
  end if;
end $$;

delete from public.bounty_claims a
using public.bounty_claims b
where a.ctid < b.ctid
  and a.bounty_id = b.bounty_id
  and a.finder_id = b.finder_id;

delete from public.bounty_claims a
using public.bounty_claims b
where a.ctid < b.ctid
  and a.sighting_id = b.sighting_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bounty_claims_bounty_id_finder_id_key'
  ) then
    alter table public.bounty_claims
      add constraint bounty_claims_bounty_id_finder_id_key unique (bounty_id, finder_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bounty_claims_sighting_id_key'
  ) then
    alter table public.bounty_claims
      add constraint bounty_claims_sighting_id_key unique (sighting_id);
  end if;
end $$;

create or replace function public.touch_profile_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profile_contacts_updated on public.profile_contacts;
create trigger on_profile_contacts_updated
  before update on public.profile_contacts
  for each row execute function public.touch_profile_contacts_updated_at();

create or replace function public.submit_bounty_claim(
  p_bounty_id uuid,
  p_store_name text,
  p_city text default null,
  p_state text default null,
  p_zip_code text default null,
  p_stock_level text default 'in_stock'
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bounty public.bounties%rowtype;
  v_sighting_id uuid;
  v_claim_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_store_name), '') is null then
    raise exception 'Store name is required';
  end if;

  if p_stock_level not in ('in_stock', 'low', 'none') then
    raise exception 'Invalid stock level';
  end if;

  if p_zip_code is not null and p_zip_code !~ '^[0-9]{5}$' then
    raise exception 'Invalid ZIP code';
  end if;

  if p_state is not null and p_state !~ '^[A-Z]{2}$' then
    raise exception 'Invalid state';
  end if;

  select *
    into v_bounty
    from public.bounties
    where id = p_bounty_id
    for update;

  if not found then
    raise exception 'Bounty not found';
  end if;

  if v_bounty.status <> 'open' then
    raise exception 'Bounty is not open';
  end if;

  if v_bounty.user_id = v_user_id then
    raise exception 'You cannot claim your own bounty';
  end if;

  insert into public.sightings (
    user_id,
    product_id,
    store_name,
    city,
    state,
    zip_code,
    stock_level,
    is_public,
    bounty_id
  )
  values (
    v_user_id,
    v_bounty.product_id,
    trim(p_store_name),
    nullif(trim(p_city), ''),
    nullif(trim(p_state), ''),
    nullif(trim(p_zip_code), ''),
    p_stock_level,
    false,
    v_bounty.id
  )
  returning id into v_sighting_id;

  insert into public.bounty_claims (bounty_id, finder_id, sighting_id)
  values (v_bounty.id, v_user_id, v_sighting_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

create or replace function public.accept_bounty_claim(p_claim_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    bc.id,
    bc.bounty_id,
    bc.finder_id,
    bc.status as claim_status,
    b.user_id as bounty_user_id,
    b.status as bounty_status,
    b.product_id as bounty_product_id,
    s.user_id as sighting_user_id,
    s.product_id as sighting_product_id,
    s.bounty_id as sighting_bounty_id,
    s.is_public as sighting_is_public
  into v_claim
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  join public.sightings s on s.id = bc.sighting_id
  where bc.id = p_claim_id
  for update of bc, b, s;

  if not found then
    raise exception 'Claim not found';
  end if;

  if v_claim.bounty_user_id <> v_user_id then
    raise exception 'Only the bounty owner can accept this claim';
  end if;

  if v_claim.claim_status <> 'pending' then
    raise exception 'Claim is not pending';
  end if;

  if v_claim.bounty_status <> 'open' then
    raise exception 'Bounty is not open';
  end if;

  if v_claim.finder_id = v_claim.bounty_user_id
    or v_claim.sighting_user_id <> v_claim.finder_id
    or v_claim.sighting_bounty_id <> v_claim.bounty_id
    or v_claim.sighting_product_id <> v_claim.bounty_product_id
    or v_claim.sighting_is_public
  then
    raise exception 'Claim data is inconsistent';
  end if;

  update public.bounty_claims
    set status = 'accepted'
    where id = v_claim.id;

  update public.bounty_claims
    set status = 'rejected'
    where bounty_id = v_claim.bounty_id
      and id <> v_claim.id
      and status = 'pending';

  update public.bounties
    set status = 'claimed'
    where id = v_claim.bounty_id;

  update public.profiles
    set karma = karma + 1
    where id = v_claim.finder_id;
end;
$$;

create or replace function public.reject_bounty_claim(p_claim_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    bc.id,
    bc.status as claim_status,
    b.user_id as bounty_user_id
  into v_claim
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  where bc.id = p_claim_id
  for update of bc, b;

  if not found then
    raise exception 'Claim not found';
  end if;

  if v_claim.bounty_user_id <> v_user_id then
    raise exception 'Only the bounty owner can reject this claim';
  end if;

  if v_claim.claim_status <> 'pending' then
    raise exception 'Claim is not pending';
  end if;

  update public.bounty_claims
    set status = 'rejected'
    where id = v_claim.id;
end;
$$;

create or replace function public.close_bounty(p_bounty_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bounty public.bounties%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_bounty
    from public.bounties
    where id = p_bounty_id
    for update;

  if not found then
    raise exception 'Bounty not found';
  end if;

  if v_bounty.user_id <> v_user_id then
    raise exception 'Only the bounty owner can close this bounty';
  end if;

  if v_bounty.status <> 'open' then
    raise exception 'Only open bounties can be closed';
  end if;

  update public.bounties
    set status = 'closed'
    where id = v_bounty.id;

  update public.bounty_claims
    set status = 'rejected'
    where bounty_id = v_bounty.id
      and status = 'pending';
end;
$$;

grant usage on schema public to anon, authenticated;

revoke all on public.trends from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.profile_contacts from anon, authenticated;
revoke all on public.bounties from anon, authenticated;
revoke all on public.sightings from anon, authenticated;
revoke all on public.bounty_claims from anon, authenticated;
revoke all on public.zip_codes from anon, authenticated;

grant select on public.trends, public.products, public.profiles, public.bounties, public.sightings, public.zip_codes to anon, authenticated;
grant select on public.profile_contacts, public.bounty_claims to authenticated;
grant insert (user_id, contact_info), update (user_id, contact_info) on public.profile_contacts to authenticated;
grant insert (user_id, product_id, reward_amount, zip_code, radius_miles, notes) on public.bounties to authenticated;
grant insert (user_id, product_id, store_name, city, state, zip_code, stock_level, is_public, bounty_id) on public.sightings to authenticated;

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

alter table public.trends enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.bounties enable row level security;
alter table public.sightings enable row level security;
alter table public.bounty_claims enable row level security;
alter table public.zip_codes enable row level security;

drop policy if exists "trends_public_read" on public.trends;
drop policy if exists "products_public_read" on public.products;
drop policy if exists "zip_codes_public_read" on public.zip_codes;
drop policy if exists "profiles_public_read" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profile_contacts_participant_read" on public.profile_contacts;
drop policy if exists "profile_contacts_self_insert" on public.profile_contacts;
drop policy if exists "profile_contacts_self_update" on public.profile_contacts;
drop policy if exists "bounties_public_read" on public.bounties;
drop policy if exists "bounties_self_insert" on public.bounties;
drop policy if exists "bounties_self_update" on public.bounties;
drop policy if exists "bounties_self_delete" on public.bounties;
drop policy if exists "sightings_public_read" on public.sightings;
drop policy if exists "sightings_private_read" on public.sightings;
drop policy if exists "sightings_self_insert" on public.sightings;
drop policy if exists "sightings_self_update" on public.sightings;
drop policy if exists "sightings_self_delete" on public.sightings;
drop policy if exists "claims_participant_read" on public.bounty_claims;
drop policy if exists "claims_self_insert" on public.bounty_claims;
drop policy if exists "claims_bounty_owner_update" on public.bounty_claims;

create policy "trends_public_read" on public.trends
  for select
  to anon, authenticated
  using (true);

create policy "products_public_read" on public.products
  for select
  to anon, authenticated
  using (true);

create policy "zip_codes_public_read" on public.zip_codes
  for select
  to anon, authenticated
  using (true);

create policy "profiles_public_read" on public.profiles
  for select
  to anon, authenticated
  using (true);

create policy "profile_contacts_participant_read" on public.profile_contacts
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.bounty_claims bc
      join public.bounties b on b.id = bc.bounty_id
      where bc.status = 'accepted'
        and bc.finder_id = profile_contacts.user_id
        and b.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.bounty_claims bc
      join public.bounties b on b.id = bc.bounty_id
      where bc.status = 'accepted'
        and b.user_id = profile_contacts.user_id
        and bc.finder_id = (select auth.uid())
    )
  );

create policy "profile_contacts_self_insert" on public.profile_contacts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profile_contacts_self_update" on public.profile_contacts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "bounties_public_read" on public.bounties
  for select
  to anon, authenticated
  using (true);

create policy "bounties_self_insert" on public.bounties
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id and status = 'open');

create policy "sightings_public_read" on public.sightings
  for select
  to anon, authenticated
  using (is_public = true);

create policy "sightings_private_read" on public.sightings
  for select
  to authenticated
  using (
    is_public = false
    and (
      (select auth.uid()) = user_id
      or exists (
        select 1
        from public.bounties b
        join public.bounty_claims bc on bc.bounty_id = b.id
        where bc.sighting_id = sightings.id
          and b.user_id = (select auth.uid())
      )
    )
  );

create policy "sightings_self_insert" on public.sightings
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and is_public = true
    and bounty_id is null
  );

create policy "claims_participant_read" on public.bounty_claims
  for select
  to authenticated
  using (
    (select auth.uid()) = finder_id
    or exists (
      select 1
      from public.bounties
      where id = bounty_id
        and user_id = (select auth.uid())
    )
  );
