-- Audit security and integrity fixes.
-- Reflects the current production database state after manual patching.
-- Idempotent where possible; safe to run after all prior migrations.

-- ─── profile_locations ──────────────────────────────────────────────
-- Stores user ZIP code separately from profiles so it is not publicly
-- readable via the profiles table.

create table if not exists public.profile_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_locations enable row level security;

revoke all on public.profile_locations from public, anon, authenticated;
grant select, insert, update on public.profile_locations to authenticated;

drop policy if exists "profile_locations_self_read" on public.profile_locations;
drop policy if exists "profile_locations_self_upsert" on public.profile_locations;

create policy "profile_locations_self_read" on public.profile_locations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "profile_locations_self_insert" on public.profile_locations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profile_locations_self_update" on public.profile_locations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Keep updated_at fresh
create or replace function public.touch_profile_locations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profile_locations_updated on public.profile_locations;
create trigger on_profile_locations_updated
  before update on public.profile_locations
  for each row execute function public.touch_profile_locations_updated_at();

revoke execute on function public.touch_profile_locations_updated_at() from public, anon, authenticated;

-- ─── preferred_cities column on profiles ────────────────────────────
-- Stores the cities the user is interested in (multi-select during onboarding).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'preferred_cities'
  ) then
    alter table public.profiles
      add column preferred_cities text[] default '{}';
  end if;
end $$;

-- ─── Rewrite complete_onboarding ────────────────────────────────────
-- Enforce one-time completion, validate ZIP, store in profile_locations,
-- cap looking_for at 500 chars, atomic referral cap.

create or replace function public.complete_onboarding(
  p_username text,
  p_zip_code text default null,
  p_looking_for text default null,
  p_referrer_username text default null,
  p_preferred_cities text[] default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_username text;
  v_referrer_id uuid;
  v_already_done boolean;
  v_looking_for text;
  v_cities text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- One-time enforcement
  select onboarding_completed into v_already_done
  from public.profiles where id = v_user_id;

  if v_already_done then
    raise exception 'Onboarding already completed' using errcode = '55006';
  end if;

  -- Validate username
  v_clean_username := lower(trim(p_username));
  if v_clean_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 characters, letters/numbers/underscore only'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.profiles
    where username = v_clean_username and id <> v_user_id
  ) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  -- Validate ZIP
  if p_zip_code is not null and nullif(trim(p_zip_code), '') is not null then
    if trim(p_zip_code) !~ '^[0-9]{5}$' then
      raise exception 'Invalid ZIP code' using errcode = '22023';
    end if;
  end if;

  -- Validate looking_for length
  v_looking_for := nullif(trim(p_looking_for), '');
  if v_looking_for is not null and char_length(v_looking_for) > 500 then
    raise exception 'Looking for must be 500 characters or fewer' using errcode = '22023';
  end if;

  -- Validate preferred_cities: at least 1
  v_cities := coalesce(p_preferred_cities, '{}');
  if array_length(v_cities, 1) is null or array_length(v_cities, 1) < 1 then
    raise exception 'Please select at least one city' using errcode = '22023';
  end if;

  -- Resolve referrer (can't be self, must have < 9 referrals)
  v_referrer_id := null;
  if p_referrer_username is not null then
    select id into v_referrer_id from public.profiles
    where username = lower(trim(p_referrer_username))
      and id <> v_user_id
      and referral_count < 9
    limit 1;
  end if;

  -- Update profile
  update public.profiles
  set username = v_clean_username,
    onboarding_completed = true,
    looking_for = v_looking_for,
    preferred_cities = v_cities,
    referred_by = v_referrer_id
  where id = v_user_id;

  -- Store ZIP in profile_locations
  if p_zip_code is not null and nullif(trim(p_zip_code), '') is not null then
    insert into public.profile_locations (user_id, zip_code)
    values (v_user_id, trim(p_zip_code))
    on conflict (user_id) do update
      set zip_code = excluded.zip_code, updated_at = now();
  end if;

  -- Atomic referral cap: only increment if still under 9
  if v_referrer_id is not null then
    update public.profiles
    set referral_count = referral_count + 1
    where id = v_referrer_id
      and referral_count < 9;
  end if;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text, text[]) from anon, authenticated;
grant execute on function public.complete_onboarding(text, text, text, text, text[]) to authenticated;

-- ─── Re-grant request_early_access to anon and authenticated ────────
-- Supersedes migration 20260712000000_revoke_anon_rpc.sql.
-- Production now allows anon+authenticated to call this RPC directly.

revoke execute on function public.request_early_access(text, text) from anon, authenticated, service_role;
grant execute on function public.request_early_access(text, text) to anon, authenticated;

-- ─── Revoke rls_auto_enable from public ─────────────────────────────
-- This administrative function must not be callable by anon/authenticated.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pg_catalog' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function pg_catalog.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

-- ─── Input constraints ──────────────────────────────────────────────

-- Bounty notes: max 2000 chars
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bounties_notes_max_length'
  ) then
    alter table public.bounties
      add constraint bounties_notes_max_length
      check (notes is null or char_length(notes) <= 2000) not valid;
  end if;
end $$;

-- Reward amount: max $10,000, two decimal places
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bounties_reward_max_amount'
  ) then
    alter table public.bounties
      add constraint bounties_reward_max_amount
      check (reward_amount <= 10000) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bounties_reward_two_decimals'
  ) then
    alter table public.bounties
      add constraint bounties_reward_two_decimals
      check (round(reward_amount, 2) = reward_amount) not valid;
  end if;
end $$;

-- Sighting store_name: 1-120 chars
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sightings_store_name_length'
  ) then
    alter table public.sightings
      add constraint sightings_store_name_length
      check (char_length(store_name) between 1 and 120) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sightings_city_max_length'
  ) then
    alter table public.sightings
      add constraint sightings_city_max_length
      check (city is null or char_length(city) <= 100) not valid;
  end if;
end $$;

-- Profile contacts: max 500 chars
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profile_contacts_info_max_length'
  ) then
    alter table public.profile_contacts
      add constraint profile_contacts_info_max_length
      check (contact_info is null or char_length(contact_info) <= 500) not valid;
  end if;
end $$;

-- Profiles looking_for: max 500 chars
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_looking_for_max_length'
  ) then
    alter table public.profiles
      add constraint profiles_looking_for_max_length
      check (looking_for is null or char_length(looking_for) <= 500) not valid;
  end if;
end $$;
