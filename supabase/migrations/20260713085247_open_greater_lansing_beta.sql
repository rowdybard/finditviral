-- Open the Greater Lansing beta to permanent email/password accounts while
-- keeping anonymous visitors and private account fields out of the Data API.

begin;

revoke usage on schema public from public, anon;
grant usage on schema public to authenticated, service_role;

revoke all privileges on table
  public.trends,
  public.products,
  public.profiles,
  public.profile_contacts,
  public.profile_locations,
  public.bounties,
  public.sightings,
  public.bounty_claims,
  public.zip_codes,
  public.early_access_requests
from public, anon, authenticated;

-- Shared catalog and community records. Profiles are deliberately limited to
-- the fields rendered on public member cards; private preferences are exposed
-- only through get_my_profile().
grant select on table
  public.trends,
  public.products,
  public.bounties,
  public.sightings,
  public.bounty_claims,
  public.zip_codes,
  public.profile_contacts,
  public.profile_locations
to authenticated;

grant select (id, username, karma, is_pro, created_at)
  on public.profiles to authenticated;

-- The clients omit ownership. Derive it from the JWT and do not grant callers
-- permission to supply a different user_id.
alter table public.bounties
  alter column user_id set default auth.uid();

alter table public.sightings
  alter column user_id set default auth.uid();

grant insert (product_id, reward_amount, zip_code, radius_miles, notes)
  on public.bounties to authenticated;

grant insert (
  product_id, store_name, city, state, zip_code,
  stock_level, is_public, bounty_id
) on public.sightings to authenticated;

grant insert (user_id, contact_info),
      update (user_id, contact_info)
  on public.profile_contacts to authenticated;

-- Future tables and functions start closed until a migration grants the exact
-- access they need.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- Remove every old policy first so permissive policies cannot combine with the
-- new rules using OR.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'trends', 'products', 'profiles', 'profile_contacts',
    'profile_locations', 'bounties', 'sightings',
    'bounty_claims', 'zip_codes'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);

    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;

    -- Supabase anonymous-auth users receive the authenticated database role.
    -- Keep them out even if anonymous Auth is enabled accidentally later.
    execute format(
      'create policy permanent_users_only on public.%I
         as restrictive for all to authenticated
         using (not coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false))
         with check (not coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false))',
      v_table
    );
  end loop;
end
$$;

-- Replace the owner-only write guard with defense in depth against anonymous
-- Auth identities. Normal table privileges and RLS remain the primary guard.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'trends', 'products', 'profiles', 'profile_contacts',
    'profile_locations', 'bounties', 'sightings',
    'bounty_claims', 'zip_codes'
  ]
  loop
    execute format('drop trigger if exists app_owner_write_guard on public.%I', v_table);
    execute format('drop trigger if exists permanent_user_write_guard on public.%I', v_table);
  end loop;
end
$$;

drop function if exists public.enforce_app_owner_write();

create function public.enforce_permanent_user_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  then
    raise exception 'Permanent authenticated account required' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_permanent_user_write()
  from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'trends', 'products', 'profiles', 'profile_contacts',
    'profile_locations', 'bounties', 'sightings',
    'bounty_claims', 'zip_codes'
  ]
  loop
    execute format(
      'create trigger permanent_user_write_guard
         before insert or update or delete on public.%I
         for each row execute function public.enforce_permanent_user_write()',
      v_table
    );
  end loop;
end
$$;

-- Shared catalog and public member-card reads.
create policy authenticated_trends_read
  on public.trends for select to authenticated using (true);

create policy authenticated_products_read
  on public.products for select to authenticated using (true);

create policy authenticated_profiles_read
  on public.profiles for select to authenticated using (true);

create policy authenticated_zip_codes_read
  on public.zip_codes for select to authenticated using (true);

-- Contact information is visible only to its owner or to the opposite party
-- after a bounty claim has been accepted.
create policy profile_contacts_participant_read
  on public.profile_contacts for select to authenticated
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

create policy profile_contacts_self_insert
  on public.profile_contacts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy profile_contacts_self_update
  on public.profile_contacts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ZIP preferences never become community data.
create policy profile_locations_self_read
  on public.profile_locations for select to authenticated
  using ((select auth.uid()) = user_id);

-- Bounties are shared. Direct clients may only create a caller-owned open row;
-- status changes remain inside the ownership-checking RPCs.
create policy authenticated_bounties_read
  on public.bounties for select to authenticated using (true);

create policy bounties_self_insert
  on public.bounties for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'open');

-- Public sightings are shared. Claim sightings stay visible only to their
-- finder and bounty owner.
create policy authenticated_public_sightings_read
  on public.sightings for select to authenticated
  using (is_public = true);

create policy sightings_private_participant_read
  on public.sightings for select to authenticated
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

create policy sightings_self_public_insert
  on public.sightings for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and is_public = true
    and bounty_id is null
  );

-- Claim creation and status changes remain atomic SECURITY DEFINER RPCs.
create policy claims_participant_read
  on public.bounty_claims for select to authenticated
  using (
    (select auth.uid()) = finder_id
    or exists (
      select 1
      from public.bounties b
      where b.id = bounty_id
        and b.user_id = (select auth.uid())
    )
  );

-- Private self-profile fetch. Direct profile SELECT stays limited to member-card
-- columns so looking_for, cities, referral state, and onboarding state do not
-- leak through the REST API.
create or replace function public.get_my_profile()
returns table (
  id uuid,
  username text,
  karma integer,
  is_pro boolean,
  created_at timestamptz,
  onboarding_completed boolean,
  looking_for text,
  preferred_cities text[]
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    p.id,
    p.username,
    p.karma,
    p.is_pro,
    p.created_at,
    p.onboarding_completed,
    p.looking_for,
    p.preferred_cities
  from public.profiles p
  where p.id = auth.uid()
    and auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

revoke all on function public.get_my_profile()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to authenticated;

-- Username availability is intentionally narrow; clients never need to read
-- private profile columns to validate onboarding.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and lower(trim(p_username)) ~ '^[a-z0-9_]{3,20}$'
    and not exists (
      select 1
      from public.profiles p
      where p.username = lower(trim(p_username))
        and p.id <> auth.uid()
    );
$$;

revoke all on function public.is_username_available(text)
  from public, anon, authenticated, service_role;
grant execute on function public.is_username_available(text) to authenticated;

-- One authenticated, permanent account can complete onboarding exactly once.
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
set search_path = pg_catalog, pg_temp
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
  v_allowed_zips constant text[] := array[
    '48820', '48823', '48824', '48837', '48840', '48842', '48854',
    '48864', '48906', '48910', '48911', '48912', '48915', '48917'
  ];
begin
  if v_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  then
    raise exception 'Permanent authenticated account required' using errcode = '42501';
  end if;

  select p.onboarding_completed
    into v_already_onboarded
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_already_onboarded then
    raise exception 'Onboarding has already been completed' using errcode = '55006';
  end if;

  if v_clean_username is null
    or v_clean_username !~ '^[a-z0-9_]{3,20}$'
  then
    raise exception 'Username must be 3-20 characters, letters/numbers/underscore only'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.username = v_clean_username and p.id <> v_user_id
  ) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  if v_clean_zip is null
    or v_clean_zip !~ '^[0-9]{5}$'
    or not (v_clean_zip = any(v_allowed_zips))
    or not exists (
      select 1
      from public.zip_codes z
      where z.zip_code = v_clean_zip and z.state = 'MI'
    )
  then
    raise exception 'ZIP code must be in the Greater Lansing beta area'
      using errcode = '22023';
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
    or exists (
      select 1
      from unnest(v_cities) city
      where not (city = any(v_allowed_cities))
    )
  then
    raise exception 'Please select at least one valid Greater Lansing city'
      using errcode = '22023';
  end if;

  if nullif(trim(p_referrer_username), '') is not null then
    raise exception 'Referrals are unavailable during beta' using errcode = '22023';
  end if;

  update public.profiles
  set username = v_clean_username,
      onboarding_completed = true,
      looking_for = v_clean_looking_for,
      preferred_cities = v_cities,
      referred_by = null
  where id = v_user_id;

  insert into public.profile_locations (user_id, zip_code)
  values (v_user_id, v_clean_zip)
  on conflict (user_id) do update
    set zip_code = excluded.zip_code,
        updated_at = now();
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding(text, text, text, text, text[])
  to authenticated;

-- Provision every account with a non-promotional placeholder profile. The
-- 60-bit suffix keeps the value within the 20-character username constraint.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.profiles (id, username, karma, is_pro)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 15),
    0,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

-- Normalize every user-action RPC to authenticated callers only. The functions
-- already derive auth.uid(), lock the affected rows, and verify ownership.
revoke all on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  to authenticated;

revoke all on function public.accept_bounty_claim(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_bounty_claim(uuid) to authenticated;

revoke all on function public.reject_bounty_claim(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reject_bounty_claim(uuid) to authenticated;

revoke all on function public.close_bounty(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.close_bounty(uuid) to authenticated;

-- The waitlist remains Worker/service-role only even after account signup opens.
alter table public.early_access_requests enable row level security;
revoke all on public.early_access_requests from public, anon, authenticated;
revoke all on function public.request_early_access(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_early_access(text, text) to service_role;

comment on function public.get_my_profile() is
  'Returns private profile fields only for the permanent authenticated caller.';
comment on function public.is_username_available(text) is
  'Checks a normalized onboarding username without exposing private profile fields.';
comment on function public.complete_onboarding(text, text, text, text, text[]) is
  'Completes one-time Greater Lansing onboarding for the permanent authenticated caller.';

notify pgrst, 'reload schema';

commit;
