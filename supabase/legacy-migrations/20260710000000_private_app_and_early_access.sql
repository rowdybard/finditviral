-- Legacy/manual private-prototype lockdown. Do not include this file in the public launch migration chain.
--
-- Before applying this migration, make sure your owner account already exists in
-- Supabase Auth. After applying it, run the owner enrollment statement at the
-- bottom of this file in the Supabase SQL editor.

do $$
begin
  if to_regprocedure('public.request_early_access(text,text)') is not null then
    raise exception 'Refusing to replay the legacy private-app migration after the public launch migration';
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table private.app_owners from public, anon, authenticated;

-- This is the only owner check used by RLS policies and the private UI. The
-- allow-list itself stays in a non-exposed schema.
create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.app_owners
      where user_id = auth.uid()
    );
$$;

revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

-- Existing SECURITY DEFINER RPCs write to these tables. The trigger ensures
-- that those RPCs cannot be used to bypass the owner-only policy.
create or replace function public.enforce_app_owner_write()
returns trigger
language plpgsql
security definer
set search_path = private, pg_temp
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Owner access required';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_app_owner_write() from public, anon, authenticated;

drop trigger if exists app_owner_write_guard on public.trends;
create trigger app_owner_write_guard
  before insert or update or delete on public.trends
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.products;
create trigger app_owner_write_guard
  before insert or update or delete on public.products
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.profiles;
create trigger app_owner_write_guard
  before insert or update or delete on public.profiles
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.profile_contacts;
create trigger app_owner_write_guard
  before insert or update or delete on public.profile_contacts
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.bounties;
create trigger app_owner_write_guard
  before insert or update or delete on public.bounties
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.sightings;
create trigger app_owner_write_guard
  before insert or update or delete on public.sightings
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.bounty_claims;
create trigger app_owner_write_guard
  before insert or update or delete on public.bounty_claims
  for each row execute function public.enforce_app_owner_write();

drop trigger if exists app_owner_write_guard on public.zip_codes;
create trigger app_owner_write_guard
  before insert or update or delete on public.zip_codes
  for each row execute function public.enforce_app_owner_write();

-- The waitlist is the one public write surface. It has no public read policy.
create table if not exists public.early_access_requests (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists early_access_requests_email_key
  on public.early_access_requests (lower(email));

alter table public.early_access_requests enable row level security;
revoke all on public.early_access_requests from public, anon, authenticated;
grant insert (email, reason) on public.early_access_requests to anon, authenticated;

drop policy if exists "public_early_access_insert" on public.early_access_requests;
create policy "public_early_access_insert" on public.early_access_requests
  for insert
  to anon, authenticated
  with check (
    email = lower(trim(email))
    and char_length(email) between 3 and 320
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and reason = trim(reason)
    and char_length(reason) between 10 and 1200
  );

-- Remove the public read/write policies from the prototype tables.
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
drop policy if exists "owner_only_access" on public.trends;
drop policy if exists "owner_only_access" on public.products;
drop policy if exists "owner_only_access" on public.profiles;
drop policy if exists "owner_only_access" on public.profile_contacts;
drop policy if exists "owner_only_access" on public.bounties;
drop policy if exists "owner_only_access" on public.sightings;
drop policy if exists "owner_only_access" on public.bounty_claims;
drop policy if exists "owner_only_access" on public.zip_codes;

alter table public.trends enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.bounties enable row level security;
alter table public.sightings enable row level security;
alter table public.bounty_claims enable row level security;
alter table public.zip_codes enable row level security;

create policy "owner_only_access" on public.trends
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.products
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.profiles
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.profile_contacts
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.bounties
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.sightings
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.bounty_claims
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

create policy "owner_only_access" on public.zip_codes
  for all to authenticated
  using ((select public.is_app_owner()))
  with check ((select public.is_app_owner()));

revoke all on public.trends, public.products, public.profiles, public.profile_contacts,
  public.bounties, public.sightings, public.bounty_claims, public.zip_codes
  from anon, authenticated;

grant select, insert, update, delete on public.trends, public.products, public.profiles,
  public.profile_contacts, public.bounties, public.sightings, public.bounty_claims,
  public.zip_codes to authenticated;

-- Run this once after this migration, replacing the email with the account you
-- already use to sign in. If no account exists yet, create it before applying
-- this migration because new sign-ups are intentionally blocked afterwards.
--
-- insert into private.app_owners (user_id)
-- select id from auth.users where email = 'you@example.com'
-- on conflict (user_id) do nothing;
