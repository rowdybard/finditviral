-- Issue 8: Legacy username protection via protection_name column
--
-- Adds a protection_name column to username_claims that stores the alpha-only
-- portion of legacy claimed usernames. This prevents new users from claiming
-- usernames that are confusingly similar to legacy usernames even when the
-- normalized_username differs due to non-alpha characters.
--
-- UUID placeholder usernames (user_xxxxxxxxxxxxxxx) are excluded from
-- protection_name backfill so they don't block legitimate new claims.

alter table private.username_claims
  add column if not exists protection_name text
  check (protection_name is null or char_length(protection_name) <= 64);

-- Backfill protection_name for legacy claims, excluding UUID placeholders.
-- The alpha-only extraction strips digits, hyphens, underscores, etc.
update private.username_claims
  set protection_name = nullif(regexp_replace(lower(claimed_username), '[^a-z]', '', 'g'), '')
  where is_legacy = true
    and not private.username_is_placeholder(claimed_username);

create index if not exists username_claims_protection_name_idx
  on private.username_claims (protection_name)
  where protection_name is not null;

-- Recreate is_username_available with protection_name check and 20-char max.
create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean text := private.normalize_username(p_username);
begin
  if v_user_id is null
    or coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false)
    or v_clean is null
    or v_clean !~ '^[a-z]{3,20}$'
    or exists (select 1 from private.username_reserved_terms r where r.term = v_clean)
  then
    return false;
  end if;

  return not exists (
    select 1
    from private.username_claims uc
    where uc.user_id <> v_user_id
      and (
        (uc.normalized_username is not null
          and (
            uc.normalized_username = v_clean
            or (
              char_length(v_clean) >= 5
              and char_length(uc.normalized_username) >= 5
              and private.username_within_one_edit(v_clean, uc.normalized_username)
            )
          )
        )
        or (uc.protection_name is not null
          and (
            uc.protection_name = v_clean
            or (
              char_length(v_clean) >= 5
              and char_length(uc.protection_name) >= 5
              and private.username_within_one_edit(v_clean, uc.protection_name)
            )
          )
        )
      )
  );
end;
$$;

-- Recreate complete_onboarding with protection_name check, 20-char max,
-- NULL email for onboarding events, and stable error code hints.
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
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_username text;
  v_clean_zip text := nullif(btrim(p_zip_code), '');
  v_clean_looking_for text := nullif(btrim(p_looking_for), '');
  v_cities text[];
  v_profile public.profiles%rowtype;
  v_email text;
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
    or coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false)
  then
    raise exception 'Permanent authenticated account required'
      using errcode = '42501', hint = 'ONBOARDING_AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(7463115459864001);

  select u.email into v_email
  from auth.users u
  where u.id = v_user_id
    and u.deleted_at is null
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now());
  if not found then
    raise exception 'Permanent authenticated account required'
      using errcode = '42501', hint = 'ONBOARDING_AUTH_REQUIRED';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;
  if not found then
    raise exception 'Profile not found'
      using errcode = 'P0002', hint = 'ONBOARDING_PROFILE_NOT_FOUND';
  end if;
  if v_profile.onboarding_completed then
    raise exception 'Onboarding has already been completed'
      using errcode = '55006', hint = 'ONBOARDING_ALREADY_COMPLETED';
  end if;

  v_clean_username := private.normalize_username(p_username);
  if v_clean_username is null or v_clean_username !~ '^[a-z]{3,20}$' then
    raise exception 'Username must be 3-20 letters only'
      using errcode = '22023', hint = 'USERNAME_INVALID';
  end if;

  if exists (
    select 1 from private.username_reserved_terms r where r.term = v_clean_username
  ) or exists (
    select 1
    from private.username_claims uc
    where uc.user_id <> v_user_id
      and (
        (uc.normalized_username is not null
          and (
            uc.normalized_username = v_clean_username
            or (
              char_length(v_clean_username) >= 5
              and char_length(uc.normalized_username) >= 5
              and private.username_within_one_edit(v_clean_username, uc.normalized_username)
            )
          )
        )
        or (uc.protection_name is not null
          and (
            uc.protection_name = v_clean_username
            or (
              char_length(v_clean_username) >= 5
              and char_length(uc.protection_name) >= 5
              and private.username_within_one_edit(v_clean_username, uc.protection_name)
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'username_unavailable',
      detail = 'The requested username conflicts with an existing or protected claim.',
      constraint = 'username_claim_policy',
      hint = 'USERNAME_UNAVAILABLE';
  end if;

  if v_clean_zip is null
    or v_clean_zip !~ '^[0-9]{5}$'
    or not (v_clean_zip = any(v_allowed_zips))
    or not exists (
      select 1 from public.zip_codes z
      where z.zip_code = v_clean_zip and z.state = 'MI'
    )
  then
    raise exception 'ZIP code must be in the Greater Lansing beta area'
      using errcode = '22023', hint = 'ZIP_INVALID';
  end if;

  if v_clean_looking_for is not null and char_length(v_clean_looking_for) > 500 then
    raise exception 'Looking for must be 500 characters or fewer'
      using errcode = '22023', hint = 'LOOKING_FOR_TOO_LONG';
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
      select 1 from unnest(v_cities) city
      where not (city = any(v_allowed_cities))
    )
  then
    raise exception 'Please select at least one valid Greater Lansing city'
      using errcode = '22023', hint = 'CITY_INVALID';
  end if;

  if nullif(btrim(p_referrer_username), '') is not null then
    raise exception 'Referrals are unavailable during beta'
      using errcode = '22023', hint = 'REFERRALS_UNAVAILABLE';
  end if;

  insert into private.username_claims (
    user_id, claimed_username, normalized_username, protection_name, is_legacy, updated_at
  ) values (
    v_user_id, v_clean_username, v_clean_username, v_clean_username, false, now()
  ) on conflict (user_id) do update set
    claimed_username = excluded.claimed_username,
    normalized_username = excluded.normalized_username,
    protection_name = excluded.protection_name,
    is_legacy = false,
    updated_at = now();

  perform set_config('finditviral.username_write', 'on', true);
  update public.profiles
  set username = v_clean_username,
      onboarding_completed = true,
      looking_for = v_clean_looking_for,
      preferred_cities = v_cities,
      referred_by = null
  where id = v_user_id;

  insert into public.profile_locations (user_id, zip_code)
  values (v_user_id, v_clean_zip)
  on conflict (user_id) do update set
    zip_code = excluded.zip_code,
    updated_at = now();

  if v_clean_looking_for is not null then
    insert into private.interest_events (
      dedupe_key, source, source_record_id, actor_user_id, email, username,
      interest, occurred_at
    ) values (
      'onboarding_looking_for:' || v_user_id::text,
      'onboarding_looking_for',
      v_user_id,
      v_user_id,
      null,
      v_clean_username,
      v_clean_looking_for,
      now()
    ) on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

notify pgrst, 'reload schema';
