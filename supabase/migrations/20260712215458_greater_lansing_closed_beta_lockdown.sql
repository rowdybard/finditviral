-- Greater Lansing closed-beta lockdown.
-- The public site accepts early-access requests through the Cloudflare Worker;
-- every other application surface is restricted to explicitly enrolled owners.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.app_owners enable row level security;
revoke all on private.app_owners from public, anon, authenticated;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.app_owners
      where user_id = auth.uid()
    );
$$;

revoke all on function public.is_app_owner() from public, anon, authenticated;
grant execute on function public.is_app_owner() to authenticated;

alter table public.profiles
  add column if not exists preferred_cities text[] not null default '{}';

alter table public.profiles
  drop constraint if exists profiles_preferred_cities_limit;
alter table public.profiles
  add constraint profiles_preferred_cities_limit
  check (cardinality(preferred_cities) between 0 and 10);

drop function if exists public.complete_onboarding(text, text, text, text);
drop function if exists public.complete_onboarding(text, text, text, text, text[]);

create function public.complete_onboarding(
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
  v_clean_username text := lower(trim(p_username));
  v_clean_zip text := nullif(trim(p_zip_code), '');
  v_clean_looking_for text := nullif(trim(p_looking_for), '');
  v_cities text[];
  v_already_onboarded boolean;
  v_allowed_cities constant text[] := array[
    'Lansing', 'East Lansing', 'Okemos', 'Haslett', 'Holt',
    'Delta Township', 'Waverly', 'DeWitt', 'Grand Ledge', 'Mason'
  ];
begin
  if v_user_id is null or not public.is_app_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  select onboarding_completed
    into v_already_onboarded
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_already_onboarded then
    raise exception 'Onboarding has already been completed' using errcode = '55006';
  end if;

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

  if v_clean_zip is not null and v_clean_zip !~ '^[0-9]{5}$' then
    raise exception 'Invalid ZIP code' using errcode = '22023';
  end if;

  if v_clean_looking_for is not null and char_length(v_clean_looking_for) > 500 then
    raise exception 'Looking for must be 500 characters or fewer' using errcode = '22023';
  end if;

  select coalesce(array_agg(city order by first_position), '{}')
    into v_cities
  from (
    select btrim(city) as city, min(position) as first_position
    from unnest(coalesce(p_preferred_cities, '{}')) with ordinality as input(city, position)
    where btrim(city) <> ''
    group by btrim(city)
  ) deduplicated;

  if cardinality(v_cities) not between 1 and 10
    or exists (select 1 from unnest(v_cities) city where not (city = any(v_allowed_cities)))
  then
    raise exception 'Please select at least one valid Greater Lansing city'
      using errcode = '22023';
  end if;

  if nullif(trim(p_referrer_username), '') is not null then
    raise exception 'Referrals are unavailable during closed beta' using errcode = '22023';
  end if;

  update public.profiles
  set username = v_clean_username,
      onboarding_completed = true,
      looking_for = v_clean_looking_for,
      preferred_cities = v_cities,
      referred_by = null
  where id = v_user_id;

  if v_clean_zip is not null then
    insert into public.profile_locations (user_id, zip_code)
    values (v_user_id, v_clean_zip)
    on conflict (user_id) do update
      set zip_code = excluded.zip_code,
          updated_at = now();
  end if;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding(text, text, text, text, text[])
  to authenticated;

-- Stop granting promotional Pro access to newly provisioned accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username, karma, is_pro)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
    0,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- A caller with a user JWT must be an enrolled owner, including when a
-- SECURITY DEFINER RPC performs the write. Direct administrative migration and
-- service-key operations have no auth.uid() and remain available for rollout.
create or replace function public.enforce_app_owner_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_app_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_app_owner_write() from public, anon, authenticated;

do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'trends', 'products', 'profiles', 'profile_contacts', 'bounties',
    'sightings', 'profile_locations', 'bounty_claims', 'zip_codes'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_row.policyname, table_name);
    end loop;

    execute format(
      'create policy owner_only_access on public.%I for all to authenticated using ((select public.is_app_owner())) with check ((select public.is_app_owner()))',
      table_name
    );

    execute format('drop trigger if exists app_owner_write_guard on public.%I', table_name);
    execute format(
      'create trigger app_owner_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_app_owner_write()',
      table_name
    );
  end loop;
end;
$$;

alter table public.early_access_requests enable row level security;
revoke all on public.early_access_requests from public, anon, authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'early_access_requests'
  loop
    execute format('drop policy %I on public.early_access_requests', policy_row.policyname);
  end loop;
end;
$$;

revoke all on function public.request_early_access(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_early_access(text, text) to service_role;

comment on function public.is_app_owner() is
  'Returns true only for authenticated users explicitly enrolled in private.app_owners.';
comment on function public.complete_onboarding(text, text, text, text, text[]) is
  'Completes one-time closed-beta owner onboarding and stores private location preferences.';
