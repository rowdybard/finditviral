-- FindItViral — Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Trends
create table if not exists trends (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Products
create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  trend_id uuid not null references trends(id) on delete cascade,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Profiles (linked to auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  contact_info text,
  karma integer not null default 0,
  is_pro boolean not null default false,
  created_at timestamptz not null default now()
);

-- Bounties
create table if not exists bounties (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  reward_amount numeric not null check (reward_amount > 0),
  zip_code text not null,
  radius_miles integer not null default 50,
  notes text,
  status text not null default 'open' check (status in ('open', 'claimed', 'closed')),
  created_at timestamptz not null default now()
);

-- Sightings
create table if not exists sightings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_name text not null,
  city text,
  state text,
  zip_code text,
  stock_level text not null default 'in_stock' check (stock_level in ('in_stock', 'low', 'none')),
  is_public boolean not null default true,
  bounty_id uuid references bounties(id) on delete set null,
  photo_urls text[],
  created_at timestamptz not null default now()
);

-- Bounty Claims
create table if not exists bounty_claims (
  id uuid primary key default uuid_generate_v4(),
  bounty_id uuid not null references bounties(id) on delete cascade,
  finder_id uuid not null references auth.users(id) on delete cascade,
  sighting_id uuid not null references sightings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
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

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, karma)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    0
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
