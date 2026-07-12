-- FindItViral — Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable crypto extension for gen_random_uuid()
create extension if not exists pgcrypto;

-- Trends
create table if not exists trends (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Products
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  trend_id uuid not null references trends(id) on delete cascade,
  name text not null,
  slug text not null unique,
  availability_status text not null default 'retired' check (availability_status in ('available', 'backorder', 'preorder', 'announced', 'limited', 'retired')),
  source_url text check (source_url is null or source_url ~ '^https://'),
  retailer text,
  release_date date,
  verified_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Profiles (linked to auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  karma integer not null default 0,
  is_pro boolean not null default false,
  created_at timestamptz not null default now(),
  onboarding_completed boolean not null default false,
  looking_for text check (looking_for is null or char_length(looking_for) <= 500),
  referred_by uuid references auth.users(id) on delete set null,
  referral_count integer not null default 0 check (referral_count >= 0 and referral_count <= 9),
  preferred_cities text[] default '{}'
);

-- Private user ZIP codes, not publicly readable
create table if not exists profile_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private contact info, readable only by the owner or by an accepted bounty participant
create table if not exists profile_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  contact_info text check (contact_info is null or char_length(contact_info) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bounties
create table if not exists bounties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  reward_amount numeric not null check (reward_amount > 0 and reward_amount <= 10000 and round(reward_amount, 2) = reward_amount),
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  radius_miles integer not null default 50 check (radius_miles in (10, 25, 50, 100, 250)),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'open' check (status in ('open', 'claimed', 'closed')),
  created_at timestamptz not null default now()
);

-- Sightings
create table if not exists sightings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_name text not null check (char_length(store_name) between 1 and 120),
  city text check (city is null or char_length(city) <= 100),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$'),
  stock_level text not null default 'in_stock' check (stock_level in ('in_stock', 'low', 'none')),
  is_public boolean not null default true,
  bounty_id uuid references bounties(id) on delete set null,
  photo_urls text[],
  created_at timestamptz not null default now()
);

-- Bounty Claims
create table if not exists bounty_claims (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references bounties(id) on delete cascade,
  finder_id uuid not null references auth.users(id) on delete cascade,
  sighting_id uuid not null references sightings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (bounty_id, finder_id),
  unique (sighting_id)
);

-- Zip Codes (for distance calculation)
create table if not exists zip_codes (
  zip_code text primary key,
  latitude double precision not null,
  longitude double precision not null,
  city text,
  state text
);

-- Indexes
create index if not exists idx_products_trend_id on products(trend_id);
create index if not exists idx_bounties_user_id on bounties(user_id);
create index if not exists idx_bounties_product_id on bounties(product_id);
create index if not exists idx_bounties_status on bounties(status);
create index if not exists idx_sightings_user_id on sightings(user_id);
create index if not exists idx_sightings_product_id on sightings(product_id);
create index if not exists idx_sightings_is_public on sightings(is_public);
create index if not exists idx_bounty_claims_bounty_id on bounty_claims(bounty_id);
create index if not exists idx_bounty_claims_finder_id on bounty_claims(finder_id);

-- Auto-create profile on signup with launch promo
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, karma, is_pro)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
    0,
    now() < '2026-10-12T00:00:00Z'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep private contact timestamps fresh
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

-- Submit a bounty claim atomically so sighting and claim rows cannot disagree
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
  v_bounty bounties%rowtype;
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

-- Accept one pending claim, reject the remaining pending claims, and award karma atomically
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
  v_bounty bounties%rowtype;
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
