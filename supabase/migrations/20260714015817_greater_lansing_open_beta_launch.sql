-- Greater Lansing open-beta launch contract.
--
-- This migration is intentionally additive for existing rows. It moves all
-- new contribution writes behind narrowly granted RPCs, adds canonical store
-- data and moderation, and keeps private workflow state outside the exposed
-- schemas.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Username claims and permanent-member eligibility
-- ---------------------------------------------------------------------------

create table if not exists private.username_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_username text not null,
  normalized_username text,
  is_legacy boolean not null default false,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_claims_normalized_length
    check (normalized_username is null or char_length(normalized_username) <= 64)
);

create index if not exists username_claims_normalized_idx
  on private.username_claims (normalized_username)
  where normalized_username is not null;

create table if not exists private.username_reserved_terms (
  term text primary key,
  created_at timestamptz not null default now()
);

insert into private.username_reserved_terms (term) values
  ('admin'), ('administrator'), ('finditviral'), ('fiv'), ('moderator'),
  ('official'), ('owner'), ('root'), ('staff'), ('support'), ('system')
on conflict (term) do nothing;

create table if not exists private.member_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('suspended', 'disabled')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_restrictions_expiry check (
    status = 'suspended' or expires_at is null
  )
);

alter table private.username_claims enable row level security;
alter table private.username_reserved_terms enable row level security;
alter table private.member_restrictions enable row level security;

revoke all on private.username_claims,
  private.username_reserved_terms,
  private.member_restrictions
from public, anon, authenticated;

create or replace function private.normalize_username(p_username text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select lower(btrim(normalize(p_username, NFKC)));
$$;

create or replace function private.username_is_placeholder(p_username text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select p_username ~ '^user_[0-9a-f]{15}$';
$$;

-- Returns true when the two strings are no more than one insertion, deletion,
-- substitution, or adjacent transposition apart. Callers handle exact matches
-- separately so this remains a compact one-edit guard rather than a fuzzy
-- search primitive.
create or replace function private.username_within_one_edit(
  p_left text,
  p_right text
)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v_left_len integer := char_length(p_left);
  v_right_len integer := char_length(p_right);
  v_short text;
  v_long text;
  v_index integer;
  v_mismatches integer := 0;
  v_first_mismatch integer := 0;
begin
  if abs(v_left_len - v_right_len) > 1 then
    return false;
  end if;

  if v_left_len = v_right_len then
    for v_index in 1..v_left_len loop
      if substr(p_left, v_index, 1) <> substr(p_right, v_index, 1) then
        v_mismatches := v_mismatches + 1;
        if v_first_mismatch = 0 then
          v_first_mismatch := v_index;
        end if;
        if v_mismatches > 2 then
          return false;
        end if;
      end if;
    end loop;

    if v_mismatches <= 1 then
      return true;
    end if;

    return v_first_mismatch < v_left_len
      and substr(p_left, v_first_mismatch, 1)
        = substr(p_right, v_first_mismatch + 1, 1)
      and substr(p_left, v_first_mismatch + 1, 1)
        = substr(p_right, v_first_mismatch, 1)
      and substr(p_left, v_first_mismatch + 2)
        = substr(p_right, v_first_mismatch + 2);
  end if;

  if v_left_len < v_right_len then
    v_short := p_left;
    v_long := p_right;
  else
    v_short := p_right;
    v_long := p_left;
  end if;

  for v_index in 1..char_length(v_long) loop
    if substr(v_short, v_index, 1) <> substr(v_long, v_index, 1) then
      return substr(v_long, 1, v_index - 1)
        || substr(v_long, v_index + 1) = v_short;
    end if;
  end loop;

  return true;
end;
$$;

-- Preserve every profile username byte-for-byte. Only the registry's
-- protection key is normalized, and generated placeholders deliberately have
-- no protection key.
insert into private.username_claims (
  user_id,
  claimed_username,
  normalized_username,
  is_legacy,
  claimed_at,
  updated_at
)
select
  p.id,
  p.username,
  case
    when private.username_is_placeholder(p.username) then null
    else private.normalize_username(p.username)
  end,
  true,
  p.created_at,
  now()
from public.profiles p
on conflict (user_id) do nothing;

create or replace function private.is_app_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
  select p_user_id is not null
    and exists (
      select 1
      from private.app_owners ao
      where ao.user_id = p_user_id
    );
$$;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
  select private.is_app_owner(auth.uid());
$$;

revoke all on function public.is_app_owner()
  from public, anon, authenticated, service_role;
grant execute on function public.is_app_owner() to authenticated;

create or replace function private.is_permanent_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and not coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1
      from auth.users u
      where u.id = p_user_id
        and u.deleted_at is null
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until <= now())
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = p_user_id
        and p.onboarding_completed
    )
    and (
      select count(*)
      from private.username_claims uc
      where uc.user_id = p_user_id
    ) = 1
    and not exists (
      select 1
      from private.member_restrictions mr
      where mr.user_id = p_user_id
        and (
          mr.status = 'disabled'
          or mr.expires_at is null
          or mr.expires_at > now()
        )
    );
$$;

create or replace function private.assert_permanent_member()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if not private.is_permanent_member(v_user_id) then
    raise exception 'Permanent member account required' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.guard_profile_username_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  if new.username is distinct from old.username
    and coalesce(current_setting('finditviral.username_write', true), '') <> 'on'
  then
    raise exception 'Username changes require the onboarding claim transaction'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_username_update on public.profiles;
create trigger guard_profile_username_update
  before update of username on public.profiles
  for each row execute function private.guard_profile_username_update();

-- ---------------------------------------------------------------------------
-- Canonical retailers, stores, product provenance, and Greater Lansing ZIPs
-- ---------------------------------------------------------------------------

create table if not exists public.retailers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  website_url text check (website_url is null or website_url ~ '^https://'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  address_line1 text not null check (char_length(btrim(address_line1)) between 1 and 160),
  address_line2 text check (address_line2 is null or char_length(btrim(address_line2)) <= 120),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  state text not null check (state ~ '^[A-Z]{2}$'),
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  latitude double precision,
  longitude double precision,
  source_url text check (source_url is null or source_url ~ '^https://'),
  verification_method text not null default 'official_source'
    check (verification_method in ('official_source', 'owner_verified')),
  verified_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_coordinates_pair check (
    (latitude is null and longitude is null)
    or (
      latitude is not null
      and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  ),
  constraint stores_verification_check check (
    source_url is not null or verification_method = 'owner_verified'
  ),
  unique (retailer_id, address_line1, city, state, zip_code)
);

create index if not exists stores_active_city_idx
  on public.stores (city, name) where is_active;
create index if not exists stores_retailer_idx on public.stores (retailer_id);
create index if not exists stores_zip_idx on public.stores (zip_code);

alter table public.products
  add column if not exists image_url text,
  add column if not exists image_source_url text,
  add column if not exists image_license text,
  add column if not exists image_attribution text,
  add column if not exists image_verified_at timestamptz,
  add column if not exists brand text,
  add column if not exists verification_method text not null default 'official_source';

alter table public.products drop constraint if exists products_brand_length;
alter table public.products add constraint products_brand_length
  check (brand is null or char_length(btrim(brand)) <= 120);

alter table public.products drop constraint if exists products_verification_method_check;
alter table public.products add constraint products_verification_method_check
  check (verification_method in ('official_source', 'owner_verified'));

alter table public.products drop constraint if exists products_active_verification_check;
alter table public.products add constraint products_active_verification_check check (
  not is_active
  or (
    availability_status <> 'retired'
    and verified_at is not null
    and (source_url is not null or verification_method = 'owner_verified')
    and (availability_status not in ('preorder', 'announced') or source_url is not null)
  )
);

alter table public.products drop constraint if exists products_image_rights_check;
alter table public.products add constraint products_image_rights_check check (
  image_url is null
  or (
    image_url ~ '^https://'
    and image_source_url is not null
    and image_source_url ~ '^https://'
    and nullif(btrim(image_license), '') is not null
    and nullif(btrim(image_attribution), '') is not null
    and image_verified_at is not null
  )
);

insert into public.zip_codes (zip_code, latitude, longitude, city, state) values
  ('48906', 42.7635, -84.5580, 'Lansing', 'MI'),
  ('48910', 42.7008, -84.5490, 'Lansing', 'MI'),
  ('48911', 42.6797, -84.5772, 'Lansing', 'MI'),
  ('48912', 42.7371, -84.5244, 'Lansing', 'MI'),
  ('48915', 42.7391, -84.5704, 'Lansing', 'MI'),
  ('48917', 42.7376, -84.6244, 'Lansing', 'MI'),
  ('48820', 42.8428, -84.5797, 'DeWitt', 'MI'),
  ('48823', 42.7388, -84.4764, 'East Lansing', 'MI'),
  ('48824', 42.7283, -84.4882, 'East Lansing', 'MI'),
  ('48837', 42.7529, -84.7373, 'Grand Ledge', 'MI'),
  ('48840', 42.7531, -84.3989, 'Haslett', 'MI'),
  ('48842', 42.6394, -84.5242, 'Holt', 'MI'),
  ('48854', 42.5796, -84.4561, 'Mason', 'MI'),
  ('48864', 42.7053, -84.4187, 'Okemos', 'MI')
on conflict (zip_code) do update set
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  city = excluded.city,
  state = excluded.state;

insert into public.retailers (name, slug, website_url) values
  ('Best Buy', 'best-buy', 'https://www.bestbuy.com/'),
  ('Costco', 'costco', 'https://www.costco.com/'),
  ('Five Below', 'five-below', 'https://www.fivebelow.com/'),
  ('Sam''s Club', 'sams-club', 'https://www.samsclub.com/'),
  ('Target', 'target', 'https://www.target.com/'),
  ('Ulta Beauty', 'ulta-beauty', 'https://www.ulta.com/'),
  ('Walmart', 'walmart', 'https://www.walmart.com/')
on conflict (slug) do update set
  name = excluded.name,
  website_url = excluded.website_url,
  is_active = true,
  updated_at = now();

with store_seed(
  retailer_slug, name, slug, address_line1, city, state, zip_code, source_url
) as (values
  ('target', 'Target East Lansing Downtown', 'target-east-lansing-downtown', '201 E Grand River Ave', 'East Lansing', 'MI', '48823', 'https://www.target.com/sl/east-lansing-downtown/3278'),
  ('target', 'Target West Lansing', 'target-west-lansing', '5609 W Saginaw Hwy', 'Lansing', 'MI', '48917', 'https://www.target.com/store-locator/find-stores/lansing%2Cmi'),
  ('target', 'Target Lansing South', 'target-lansing-south', '500 E Edgewood Blvd', 'Lansing', 'MI', '48911', 'https://www.target.com/sl/lansing-south/361'),
  ('target', 'Target Okemos', 'target-okemos', '4890 Marsh Rd', 'Okemos', 'MI', '48864', 'https://www.target.com/sl/okemos/365'),
  ('five-below', 'Five Below Mall Court', 'five-below-mall-court-lansing', '511 Mall Ct', 'Lansing', 'MI', '48912', 'https://locations.fivebelow.com/mi/lansing'),
  ('five-below', 'Five Below Delta Township', 'five-below-delta-township', '333B North Marketplace Boulevard', 'Lansing', 'MI', '48917', 'https://locations.fivebelow.com/mi/lansing'),
  ('five-below', 'Five Below Edgewood', 'five-below-edgewood-lansing', '462 E Edgewood Blvd', 'Lansing', 'MI', '48911', 'https://locations.fivebelow.com/mi/lansing'),
  ('ulta-beauty', 'Ulta Beauty Frandor Shopping Center', 'ulta-beauty-frandor', '350 Frandor Avenue # 2', 'Lansing', 'MI', '48912', 'https://www.ulta.com/stores/lansing-mi-1268'),
  ('ulta-beauty', 'Ulta Beauty Marketplace at Delta Towns', 'ulta-beauty-delta-towns', '333 North Marketplace Boulevard Ste A', 'Lansing', 'MI', '48917', 'https://www.ulta.com/stores/lansing-mi-702'),
  ('best-buy', 'Best Buy Lansing', 'best-buy-lansing-803', '8108 W Saginaw Hwy', 'Lansing', 'MI', '48917', 'https://stores.bestbuy.com/mi/lansing.html'),
  ('walmart', 'Walmart Lansing #2867', 'walmart-lansing-2867', '3225 Towne Centre Blvd', 'Lansing', 'MI', '48912', 'https://www.walmart.com/store/2867-lansing-mi'),
  ('walmart', 'Walmart West Lansing #2869', 'walmart-west-lansing-2869', '409 N Marketplace Blvd', 'Lansing', 'MI', '48917', 'https://www.walmart.com/store/2869-lansing-mi'),
  ('walmart', 'Walmart Okemos #2866', 'walmart-okemos-2866', '5110 Times Square Pl', 'Okemos', 'MI', '48864', 'https://www.walmart.com/store/2866-okemos-mi'),
  ('costco', 'Costco East Lansing #1277', 'costco-east-lansing-1277', '2540 E Saginaw Hwy', 'East Lansing', 'MI', '48823', 'https://www.costco.com/w/-/mi/east-lansing-michigan/1277'),
  ('sams-club', 'Sam''s Club Lansing #4781', 'sams-club-lansing-4781', '2925 Towne Centre Blvd', 'Lansing', 'MI', '48912', 'https://www.samsclub.com/club/4781-lansing-mi')
)
insert into public.stores (
  retailer_id, name, slug, address_line1, city, state, zip_code,
  source_url, verified_at, is_active
)
select
  r.id, s.name, s.slug, s.address_line1, s.city, s.state, s.zip_code,
  s.source_url, timestamptz '2026-07-13 00:00:00-04', true
from store_seed s
join public.retailers r on r.slug = s.retailer_slug
on conflict (slug) do update set
  retailer_id = excluded.retailer_id,
  name = excluded.name,
  address_line1 = excluded.address_line1,
  city = excluded.city,
  state = excluded.state,
  zip_code = excluded.zip_code,
  source_url = excluded.source_url,
  verified_at = excluded.verified_at,
  is_active = true,
  updated_at = now();

alter table public.retailers enable row level security;
alter table public.stores enable row level security;

-- ---------------------------------------------------------------------------
-- Private catalog suggestions and persistent contribution drafts
-- ---------------------------------------------------------------------------

create table if not exists private.product_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  brand text check (brand is null or char_length(btrim(brand)) <= 120),
  source_url text check (source_url is null or source_url ~ '^https://'),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'duplicate')),
  canonical_product_id uuid references public.products(id) on delete restrict,
  reviewer_id uuid references auth.users(id) on delete restrict,
  review_reason text check (review_reason is null or char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint product_suggestions_resolution check (
    (status = 'pending' and canonical_product_id is null and reviewer_id is null and reviewed_at is null)
    or (status in ('approved', 'duplicate') and canonical_product_id is not null and reviewer_id is not null and reviewed_at is not null)
    or (status = 'rejected' and canonical_product_id is null and reviewer_id is not null and reviewed_at is not null)
  )
);

create table if not exists private.store_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer_name text not null check (char_length(btrim(retailer_name)) between 1 and 120),
  store_name text check (store_name is null or char_length(btrim(store_name)) <= 160),
  address_line1 text not null check (char_length(btrim(address_line1)) between 1 and 160),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  state text not null check (state ~ '^[A-Z]{2}$'),
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  phone text check (phone is null or char_length(btrim(phone)) <= 40),
  source_url text check (source_url is null or source_url ~ '^https://'),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'duplicate')),
  canonical_store_id uuid references public.stores(id) on delete restrict,
  reviewer_id uuid references auth.users(id) on delete restrict,
  review_reason text check (review_reason is null or char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint store_suggestions_resolution check (
    (status = 'pending' and canonical_store_id is null and reviewer_id is null and reviewed_at is null)
    or (status in ('approved', 'duplicate') and canonical_store_id is not null and reviewer_id is not null and reviewed_at is not null)
    or (status = 'rejected' and canonical_store_id is null and reviewer_id is not null and reviewed_at is not null)
  )
);

create table if not exists private.contribution_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_type text not null check (draft_type in ('sighting', 'bounty')),
  payload_version smallint not null default 1 check (payload_version = 1),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  product_id uuid references public.products(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  product_suggestion_id uuid references private.product_suggestions(id) on delete set null,
  store_suggestion_id uuid references private.store_suggestions(id) on delete set null,
  state text not null default 'editing'
    check (state in ('editing', 'waiting_for_approval', 'ready', 'needs_attention')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists product_suggestions_pending_idx
  on private.product_suggestions (created_at) where status = 'pending';
create index if not exists store_suggestions_pending_idx
  on private.store_suggestions (created_at) where status = 'pending';
create index if not exists contribution_drafts_user_idx
  on private.contribution_drafts (user_id, updated_at desc);
create index if not exists contribution_drafts_expiry_idx
  on private.contribution_drafts (expires_at);

alter table private.product_suggestions enable row level security;
alter table private.store_suggestions enable row level security;
alter table private.contribution_drafts enable row level security;

revoke all on private.product_suggestions,
  private.store_suggestions,
  private.contribution_drafts
from public, anon, authenticated;

create or replace function private.validate_draft_payload(
  p_draft_type text,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_allowed text[];
begin
  if p_draft_type not in ('sighting', 'bounty')
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'Invalid contribution draft' using errcode = '22023';
  end if;

  if pg_column_size(p_payload) > 16384 then
    raise exception 'Contribution draft is too large' using errcode = '22023';
  end if;

  if p_draft_type = 'sighting' then
    v_allowed := array[
      'version', 'product', 'store', 'seenAt', 'availability', 'quantity',
      'notes', 'productSuggestionName', 'storeSuggestionName'
    ];
  else
    v_allowed := array[
      'version', 'product', 'scope', 'store', 'zipCode', 'radiusMiles',
      'rewardAmount', 'deadline', 'requirements',
      'productSuggestionName', 'storeSuggestionName'
    ];
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_payload) key
    where not (key = any(v_allowed))
  ) then
    raise exception 'Contribution draft contains unsupported fields' using errcode = '22023';
  end if;

  if not (p_payload ? 'version')
    or jsonb_typeof(p_payload -> 'version') <> 'number'
    or (p_payload ->> 'version') <> '1'
  then
    raise exception 'Unsupported contribution draft version' using errcode = '22023';
  end if;

  if p_payload ? 'notes' and char_length(coalesce(p_payload ->> 'notes', '')) > 2000 then
    raise exception 'Draft notes are too long' using errcode = '22023';
  end if;
  if p_payload ? 'requirements' and char_length(coalesce(p_payload ->> 'requirements', '')) > 2000 then
    raise exception 'Draft requirements are too long' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.refresh_contribution_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_draft private.contribution_drafts%rowtype;
  v_product_status text;
  v_store_status text;
  v_location_ready boolean;
begin
  select * into v_draft
  from private.contribution_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return;
  end if;

  if v_draft.product_suggestion_id is not null then
    select ps.status into v_product_status
    from private.product_suggestions ps
    where ps.id = v_draft.product_suggestion_id;
  end if;
  if v_draft.store_suggestion_id is not null then
    select ss.status into v_store_status
    from private.store_suggestions ss
    where ss.id = v_draft.store_suggestion_id;
  end if;

  v_location_ready := case
    when v_draft.draft_type = 'sighting' then v_draft.store_id is not null
    else v_draft.store_id is not null
      or coalesce(v_draft.payload ->> 'zip_code', '') ~ '^[0-9]{5}$'
  end;

  update private.contribution_drafts
  set state = case
        when v_product_status = 'rejected' or v_store_status = 'rejected'
          then 'needs_attention'
        when v_draft.product_id is not null and v_location_ready
          then 'ready'
        when v_product_status = 'pending' or v_store_status = 'pending'
          then 'waiting_for_approval'
        else 'editing'
      end,
      updated_at = now(),
      expires_at = now() + interval '90 days'
  where id = p_draft_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contribution columns and moderation history
-- ---------------------------------------------------------------------------

alter table public.sightings
  add column if not exists store_id uuid references public.stores(id) on delete restrict,
  add column if not exists seen_at timestamptz,
  add column if not exists availability text,
  add column if not exists quantity integer,
  add column if not exists notes text,
  add column if not exists moderation_status text,
  add column if not exists moderated_by uuid references auth.users(id) on delete restrict,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_reason text;

update public.sightings
set seen_at = coalesce(seen_at, created_at),
    availability = coalesce(
      availability,
      case stock_level when 'low' then 'low' when 'none' then 'low' else 'high' end
    ),
    moderation_status = coalesce(moderation_status, 'approved');

alter table public.sightings
  alter column seen_at set default now(),
  alter column seen_at set not null,
  alter column availability set default 'medium',
  alter column availability set not null,
  alter column moderation_status set default 'approved',
  alter column moderation_status set not null;

alter table public.sightings drop constraint if exists sightings_availability_check;
alter table public.sightings add constraint sightings_availability_check
  check (availability in ('low', 'medium', 'high'));
alter table public.sightings drop constraint if exists sightings_quantity_check;
alter table public.sightings add constraint sightings_quantity_check
  check (quantity is null or quantity between 1 and 99);
alter table public.sightings drop constraint if exists sightings_notes_launch_length;
alter table public.sightings add constraint sightings_notes_launch_length
  check (notes is null or char_length(notes) <= 2000);
alter table public.sightings drop constraint if exists sightings_moderation_status_check;
alter table public.sightings add constraint sightings_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected', 'hidden'));
alter table public.sightings drop constraint if exists sightings_moderation_metadata_check;
alter table public.sightings add constraint sightings_moderation_metadata_check check (
  (moderation_status = 'approved' and (moderated_by is null) = (moderated_at is null))
  or (moderation_status in ('pending') and moderated_by is null and moderated_at is null)
  or (moderation_status in ('rejected', 'hidden') and moderated_by is not null and moderated_at is not null)
);

alter table public.bounties
  add column if not exists reward_cents integer,
  add column if not exists store_id uuid references public.stores(id) on delete restrict,
  add column if not exists deadline timestamptz,
  add column if not exists requirements text,
  add column if not exists moderation_status text,
  add column if not exists moderated_by uuid references auth.users(id) on delete restrict,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_reason text;

update public.bounties
set reward_cents = coalesce(reward_cents, round(reward_amount * 100)::integer),
    deadline = coalesce(deadline, created_at + interval '30 days'),
    requirements = coalesce(requirements, notes),
    moderation_status = coalesce(moderation_status, 'approved');

alter table public.bounties
  alter column reward_cents set not null,
  alter column deadline set not null,
  alter column moderation_status set default 'approved',
  alter column moderation_status set not null,
  alter column zip_code drop not null;

alter table public.bounties drop constraint if exists bounties_reward_cents_check;
alter table public.bounties add constraint bounties_reward_cents_check
  check (reward_cents between 100 and 1000000);
alter table public.bounties drop constraint if exists bounties_reward_consistency_check;
alter table public.bounties add constraint bounties_reward_consistency_check
  check (reward_amount = reward_cents::numeric / 100);
alter table public.bounties drop constraint if exists bounties_requirements_launch_length;
alter table public.bounties add constraint bounties_requirements_launch_length
  check (requirements is null or char_length(requirements) <= 2000);
alter table public.bounties drop constraint if exists bounties_scope_check;
alter table public.bounties add constraint bounties_scope_check check (
  (store_id is not null and zip_code is null and radius_miles is null)
  or (store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
);
alter table public.bounties drop constraint if exists bounties_moderation_status_check;
alter table public.bounties add constraint bounties_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected', 'hidden'));
alter table public.bounties drop constraint if exists bounties_moderation_metadata_check;
alter table public.bounties add constraint bounties_moderation_metadata_check check (
  (moderation_status = 'approved' and (moderated_by is null) = (moderated_at is null))
  or (moderation_status = 'pending' and moderated_by is null and moderated_at is null)
  or (moderation_status in ('rejected', 'hidden') and moderated_by is not null and moderated_at is not null)
);

create index if not exists sightings_public_launch_idx
  on public.sightings (seen_at desc)
  where is_public and moderation_status = 'approved';
create index if not exists sightings_store_seen_idx
  on public.sightings (store_id, seen_at desc)
  where is_public and moderation_status = 'approved';
create index if not exists bounties_public_launch_idx
  on public.bounties (deadline, created_at desc)
  where status = 'open' and moderation_status = 'approved';

create table if not exists private.contribution_moderation_events (
  id uuid primary key default gen_random_uuid(),
  contribution_type text not null check (contribution_type in ('sighting', 'bounty')),
  contribution_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  previous_status text not null,
  new_status text not null check (new_status in ('approved', 'rejected', 'hidden')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists moderation_events_target_idx
  on private.contribution_moderation_events
  (contribution_type, contribution_id, created_at desc);

alter table private.contribution_moderation_events enable row level security;
revoke all on private.contribution_moderation_events
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sanitized catalog search and member draft APIs
-- ---------------------------------------------------------------------------

create or replace function public.search_products(
  p_query text,
  p_limit integer default 12
)
returns table (
  id uuid,
  name text,
  slug text,
  trend_name text,
  availability_status text,
  release_date date,
  image_url text
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    p.id,
    p.name,
    p.slug,
    t.name,
    p.availability_status,
    p.release_date,
    p.image_url
  from public.products p
  join public.trends t on t.id = p.trend_id
  where p.is_active
    and t.is_active
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and (
      p.name ilike '%' || btrim(p_query) || '%'
      or t.name ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when p.name ilike btrim(p_query) || '%' then 0 else 1 end,
    p.name,
    p.id
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

create or replace function public.search_stores(
  p_query text,
  p_limit integer default 12
)
returns table (
  id uuid,
  slug text,
  retailer_name text,
  store_name text,
  address_line1 text,
  city text,
  state text,
  zip_code text
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    s.id,
    s.slug,
    r.name,
    s.name,
    s.address_line1,
    s.city,
    s.state,
    s.zip_code
  from public.stores s
  join public.retailers r on r.id = s.retailer_id
  where s.is_active
    and r.is_active
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and (
      s.name ilike '%' || btrim(p_query) || '%'
      or r.name ilike '%' || btrim(p_query) || '%'
      or s.address_line1 ilike '%' || btrim(p_query) || '%'
      or s.city ilike '%' || btrim(p_query) || '%'
      or s.zip_code = btrim(p_query)
    )
  order by
    case
      when r.name ilike btrim(p_query) || '%' or s.name ilike btrim(p_query) || '%' then 0
      else 1
    end,
    r.name,
    s.name,
    s.id
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

create or replace function public.save_contribution_draft(
  p_draft_id uuid default null,
  p_draft_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_product_id uuid default null,
  p_store_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_draft_id uuid;
begin
  perform private.validate_draft_payload(p_draft_type, p_payload);

  if p_product_id is not null and not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (
    select 1 from public.stores s where s.id = p_store_id and s.is_active
  ) then
    raise exception 'Store is unavailable' using errcode = '22023';
  end if;

  delete from private.contribution_drafts d
  where d.expires_at <= now();

  if p_draft_id is null then
    insert into private.contribution_drafts (
      user_id, draft_type, payload, product_id, store_id
    ) values (
      v_user_id, p_draft_type, p_payload, p_product_id, p_store_id
    ) returning id into v_draft_id;
  else
    update private.contribution_drafts d
    set draft_type = p_draft_type,
        payload = p_payload,
        product_id = p_product_id,
        store_id = p_store_id,
        product_suggestion_id = case when p_product_id is null then d.product_suggestion_id else null end,
        store_suggestion_id = case when p_store_id is null then d.store_suggestion_id else null end,
        updated_at = now(),
        expires_at = now() + interval '90 days'
    where d.id = p_draft_id
      and d.user_id = v_user_id
    returning d.id into v_draft_id;

    if v_draft_id is null then
      raise exception 'Draft not found' using errcode = 'P0002';
    end if;
  end if;

  perform private.refresh_contribution_draft(v_draft_id);
  return v_draft_id;
end;
$$;

create or replace function public.get_my_contribution_drafts()
returns table (
  id uuid,
  draft_type text,
  payload jsonb,
  product_id uuid,
  store_id uuid,
  state text,
  product_suggestion_id uuid,
  store_suggestion_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  delete from private.contribution_drafts d where d.expires_at <= now();
  return query
  select
    d.id,
    d.draft_type,
    d.payload,
    d.product_id,
    d.store_id,
    d.state,
    d.product_suggestion_id,
    d.store_suggestion_id,
    d.updated_at
  from private.contribution_drafts d
  where d.user_id = v_user_id
  order by d.updated_at desc, d.id;
end;
$$;

create or replace function public.discard_contribution_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  delete from private.contribution_drafts d
  where d.id = p_draft_id and d.user_id = v_user_id;
  if not found then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.suggest_product_for_draft(
  p_draft_id uuid default null,
  p_draft_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_name text default null,
  p_brand text default null,
  p_source_url text default null,
  p_store_id uuid default null
)
returns table (draft_id uuid, suggestion_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_draft_id uuid;
  v_suggestion_id uuid;
  v_name text := btrim(p_name);
  v_brand text := nullif(btrim(p_brand), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_store_id uuid := p_store_id;
begin
  if v_name is null or char_length(v_name) not between 2 and 160
    or (v_brand is not null and char_length(v_brand) > 120)
    or (v_source_url is not null and v_source_url !~ '^https://')
  then
    raise exception 'Invalid product suggestion' using errcode = '22023';
  end if;

  if p_draft_id is not null and v_store_id is null then
    select d.store_id into v_store_id
    from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  end if;

  v_draft_id := public.save_contribution_draft(
    p_draft_id,
    p_draft_type,
    p_payload,
    null,
    v_store_id
  );

  insert into private.product_suggestions (user_id, name, brand, source_url)
  values (v_user_id, v_name, v_brand, v_source_url)
  returning id into v_suggestion_id;

  update private.contribution_drafts d
  set product_id = null,
      product_suggestion_id = v_suggestion_id,
      state = 'waiting_for_approval',
      updated_at = now(),
      expires_at = now() + interval '90 days'
  where d.id = v_draft_id and d.user_id = v_user_id;

  return query select v_draft_id, v_suggestion_id;
end;
$$;

create or replace function public.suggest_store_for_draft(
  p_draft_id uuid default null,
  p_draft_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_product_id uuid default null,
  p_retailer_name text default null,
  p_store_name text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_state text default null,
  p_zip_code text default null,
  p_source_url text default null,
  p_notes text default null
)
returns table (draft_id uuid, suggestion_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_draft_id uuid;
  v_suggestion_id uuid;
  v_retailer text := btrim(p_retailer_name);
  v_store text := nullif(btrim(p_store_name), '');
  v_address text := btrim(p_address_line1);
  v_city text := btrim(p_city);
  v_state text := upper(btrim(p_state));
  v_zip text := btrim(p_zip_code);
  v_phone text := nullif(btrim(p_notes), '');
  v_source text := nullif(btrim(p_source_url), '');
  v_product_id uuid := p_product_id;
begin
  if v_retailer is null or char_length(v_retailer) not between 1 and 120
    or v_address is null or char_length(v_address) not between 1 and 160
    or v_city is null or char_length(v_city) not between 1 and 100
    or v_state !~ '^[A-Z]{2}$'
    or v_zip !~ '^[0-9]{5}$'
    or (v_source is not null and v_source !~ '^https://')
    or (v_phone is not null and char_length(v_phone) > 40)
  then
    raise exception 'Invalid store suggestion' using errcode = '22023';
  end if;

  if p_draft_id is not null and v_product_id is null then
    select d.product_id into v_product_id
    from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  end if;

  v_draft_id := public.save_contribution_draft(
    p_draft_id,
    p_draft_type,
    p_payload,
    v_product_id,
    null
  );

  insert into private.store_suggestions (
    user_id, retailer_name, store_name, address_line1, city, state,
    zip_code, phone, source_url
  ) values (
    v_user_id, v_retailer, v_store, v_address, v_city, v_state,
    v_zip, v_phone, v_source
  ) returning id into v_suggestion_id;

  update private.contribution_drafts d
  set store_id = null,
      store_suggestion_id = v_suggestion_id,
      state = 'waiting_for_approval',
      updated_at = now(),
      expires_at = now() + interval '90 days'
  where d.id = v_draft_id and d.user_id = v_user_id;

  return query select v_draft_id, v_suggestion_id;
end;
$$;

alter table public.bounties alter column radius_miles drop not null;

create or replace function private.assert_ready_draft(
  p_draft_id uuid,
  p_user_id uuid,
  p_draft_type text,
  p_product_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_draft private.contribution_drafts%rowtype;
begin
  if p_draft_id is null then
    return;
  end if;

  select * into v_draft
  from private.contribution_drafts d
  where d.id = p_draft_id and d.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_draft.expires_at <= now()
    or v_draft.draft_type <> p_draft_type
    or not (
      v_draft.state = 'ready'
      or (
        v_draft.state = 'editing'
        and v_draft.product_suggestion_id is null
        and v_draft.store_suggestion_id is null
      )
    )
    or v_draft.product_id is distinct from p_product_id
    or v_draft.store_id is distinct from p_store_id
  then
    raise exception 'Draft must be reviewed before submission' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.create_sighting(
  p_product_id uuid,
  p_store_id uuid,
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_draft_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_store public.stores%rowtype;
  v_sighting_id uuid;
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id and s.is_active;
  if not found then
    raise exception 'Store is unavailable' using errcode = '22023';
  end if;

  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '15 minutes'
    or p_availability not in ('low', 'medium', 'high')
    or (p_quantity is not null and p_quantity not between 1 and 99)
    or (v_notes is not null and char_length(v_notes) > 2000)
  then
    raise exception 'Invalid sighting details' using errcode = '22023';
  end if;

  perform private.assert_ready_draft(
    p_draft_id, v_user_id, 'sighting', p_product_id, p_store_id
  );

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, moderation_status
  ) values (
    v_user_id, p_product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case when p_availability = 'low' then 'low' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, true, null, 'approved'
  ) returning id into v_sighting_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_id;
end;
$$;

create or replace function public.create_bounty(
  p_product_id uuid,
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_reward_cents integer default null,
  p_deadline timestamptz default null,
  p_requirements text default null,
  p_draft_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_bounty_id uuid;
  v_zip text := nullif(btrim(p_zip_code), '');
  v_requirements text := nullif(btrim(p_requirements), '');
begin
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  if p_store_id is not null then
    if v_zip is not null or p_radius_miles is not null
      or not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active)
    then
      raise exception 'Choose either one store or a ZIP radius' using errcode = '22023';
    end if;
  elsif v_zip is null or v_zip !~ '^[0-9]{5}$'
    or p_radius_miles not in (10, 25, 50, 100, 250)
    or not exists (
      select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI'
    )
  then
    raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
  end if;

  if p_reward_cents not between 100 and 1000000
    or p_deadline is null
    or p_deadline < now() + interval '1 hour'
    or p_deadline > now() + interval '90 days'
    or (v_requirements is not null and char_length(v_requirements) > 2000)
  then
    raise exception 'Invalid bounty details' using errcode = '22023';
  end if;

  perform private.assert_ready_draft(
    p_draft_id, v_user_id, 'bounty', p_product_id, p_store_id
  );

  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status
  ) values (
    v_user_id, p_product_id, p_store_id,
    p_reward_cents::numeric / 100, p_reward_cents,
    case when p_store_id is null then v_zip else null end,
    case when p_store_id is null then p_radius_miles else null end,
    v_requirements, v_requirements, p_deadline, 'open', 'approved'
  ) returning id into v_bounty_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_bounty_id;
end;
$$;

-- Canonical-store bounty participation. Claim sightings stay private to the
-- two participants but still carry the independent moderation state.
create or replace function public.submit_bounty_claim(
  p_bounty_id uuid,
  p_store_id uuid,
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_bounty public.bounties%rowtype;
  v_store public.stores%rowtype;
  v_sighting_id uuid;
  v_claim_id uuid;
  v_notes text := nullif(btrim(p_notes), '');
begin
  select * into v_bounty
  from public.bounties b
  where b.id = p_bounty_id
  for update;

  if not found
    or v_bounty.status <> 'open'
    or v_bounty.moderation_status <> 'approved'
    or v_bounty.deadline <= now()
  then
    raise exception 'Bounty is unavailable' using errcode = '55000';
  end if;
  if v_bounty.user_id = v_user_id then
    raise exception 'You cannot claim your own bounty' using errcode = '42501';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id and s.is_active;
  if not found then
    raise exception 'Store is unavailable' using errcode = '22023';
  end if;
  if v_bounty.store_id is not null and v_bounty.store_id <> v_store.id then
    raise exception 'This bounty requires a different store' using errcode = '22023';
  end if;
  if v_bounty.store_id is null and not exists (
    select 1
    from public.zip_codes z
    join public.zip_codes store_zip
      on store_zip.zip_code = v_store.zip_code
      and store_zip.state = v_store.state
    where z.zip_code = v_bounty.zip_code
      and z.latitude is not null
      and z.longitude is not null
      and coalesce(v_store.latitude, store_zip.latitude) is not null
      and coalesce(v_store.longitude, store_zip.longitude) is not null
      and private.distance_miles(
        z.latitude,
        z.longitude,
        coalesce(v_store.latitude, store_zip.latitude),
        coalesce(v_store.longitude, store_zip.longitude)
      ) <= v_bounty.radius_miles
  ) then
    raise exception 'This store is outside the bounty radius' using errcode = '22023';
  end if;

  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '15 minutes'
    or p_availability not in ('low', 'medium', 'high')
    or (p_quantity is not null and p_quantity not between 1 and 99)
    or (v_notes is not null and char_length(v_notes) > 2000)
  then
    raise exception 'Invalid claim sighting' using errcode = '22023';
  end if;

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, moderation_status
  ) values (
    v_user_id, v_bounty.product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case when p_availability = 'low' then 'low' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, false,
    v_bounty.id, 'approved'
  ) returning id into v_sighting_id;

  insert into public.bounty_claims (bounty_id, finder_id, sighting_id)
  values (v_bounty.id, v_user_id, v_sighting_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

create or replace function public.accept_bounty_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_claim record;
begin
  select
    bc.id,
    bc.bounty_id,
    bc.finder_id,
    bc.status as claim_status,
    b.user_id as bounty_user_id,
    b.status as bounty_status,
    b.moderation_status as bounty_moderation_status,
    b.deadline,
    b.product_id as bounty_product_id,
    s.user_id as sighting_user_id,
    s.product_id as sighting_product_id,
    s.bounty_id as sighting_bounty_id,
    s.is_public as sighting_is_public,
    s.store_id as sighting_store_id
  into v_claim
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  join public.sightings s on s.id = bc.sighting_id
  where bc.id = p_claim_id
  for update of bc, b, s;

  if not found then
    raise exception 'Claim not found' using errcode = 'P0002';
  end if;
  if v_claim.bounty_user_id <> v_user_id then
    raise exception 'Only the bounty owner can accept this claim' using errcode = '42501';
  end if;
  if v_claim.claim_status <> 'pending'
    or v_claim.bounty_status <> 'open'
    or v_claim.bounty_moderation_status not in ('approved', 'hidden')
    or v_claim.deadline <= now()
  then
    raise exception 'Claim is unavailable' using errcode = '55000';
  end if;
  if v_claim.finder_id = v_claim.bounty_user_id
    or v_claim.sighting_user_id <> v_claim.finder_id
    or v_claim.sighting_bounty_id <> v_claim.bounty_id
    or v_claim.sighting_product_id <> v_claim.bounty_product_id
    or v_claim.sighting_is_public
    or v_claim.sighting_store_id is null
  then
    raise exception 'Claim data is inconsistent' using errcode = '23514';
  end if;

  update public.bounty_claims set status = 'accepted' where id = v_claim.id;
  update public.bounty_claims
  set status = 'rejected'
  where bounty_id = v_claim.bounty_id and id <> v_claim.id and status = 'pending';
  update public.bounties set status = 'claimed' where id = v_claim.bounty_id;
  update public.profiles set karma = karma + 1 where id = v_claim.finder_id;
end;
$$;

create or replace function public.reject_bounty_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_claim record;
begin
  select bc.id, bc.status as claim_status, b.user_id as bounty_user_id
  into v_claim
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  where bc.id = p_claim_id
  for update of bc, b;

  if not found then
    raise exception 'Claim not found' using errcode = 'P0002';
  end if;
  if v_claim.bounty_user_id <> v_user_id then
    raise exception 'Only the bounty owner can reject this claim' using errcode = '42501';
  end if;
  if v_claim.claim_status <> 'pending' then
    raise exception 'Claim is not pending' using errcode = '55000';
  end if;

  update public.bounty_claims set status = 'rejected' where id = v_claim.id;
end;
$$;

create or replace function public.close_bounty(p_bounty_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_bounty public.bounties%rowtype;
begin
  select * into v_bounty
  from public.bounties b
  where b.id = p_bounty_id
  for update;

  if not found then
    raise exception 'Bounty not found' using errcode = 'P0002';
  end if;
  if v_bounty.user_id <> v_user_id then
    raise exception 'Only the bounty owner can close this bounty' using errcode = '42501';
  end if;
  if v_bounty.status not in ('open', 'claimed') then
    raise exception 'Only active bounties can be closed' using errcode = '55000';
  end if;

  update public.bounties set status = 'closed' where id = v_bounty.id;
  update public.bounty_claims
  set status = 'rejected'
  where bounty_id = v_bounty.id and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Sanitized public discovery and member-specific bounty detail
-- ---------------------------------------------------------------------------

create or replace function private.distance_miles(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select 3958.7613 * 2 * asin(sqrt(least(1.0,
    power(sin(radians(p_latitude_b - p_latitude_a) / 2), 2)
    + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
      * power(sin(radians(p_longitude_b - p_longitude_a) / 2), 2)
  )));
$$;

create or replace function public.get_public_product(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  trend_id uuid,
  trend_name text,
  trend_slug text,
  availability_status text,
  release_date date,
  retailer text,
  source_url text,
  image_url text,
  image_attribution text,
  latest_seen_at timestamptz,
  approved_sighting_count bigint,
  open_bounty_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    p.id,
    p.name,
    p.slug,
    t.id,
    t.name,
    t.slug,
    p.availability_status,
    p.release_date,
    p.retailer,
    p.source_url,
    p.image_url,
    p.image_attribution,
    (
      select max(s.seen_at)
      from public.sightings s
      where s.product_id = p.id
        and s.is_public
        and s.moderation_status = 'approved'
        and s.seen_at >= now() - interval '7 days'
    ),
    (
      select count(*)
      from public.sightings s
      where s.product_id = p.id
        and s.is_public
        and s.moderation_status = 'approved'
        and s.seen_at >= now() - interval '7 days'
    ),
    (
      select count(*)
      from public.bounties b
      where b.product_id = p.id
        and b.status = 'open'
        and b.moderation_status = 'approved'
        and b.deadline > now()
    )
  from public.products p
  join public.trends t on t.id = p.trend_id
  where p.slug = btrim(p_slug)
    and p.is_active
    and t.is_active;
$$;

create or replace function public.list_public_stores(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_zip_code text default '48910',
  p_radius_miles integer default 50
)
returns table (
  id uuid,
  slug text,
  retailer_name text,
  store_name text,
  address_line1 text,
  city text,
  state text,
  zip_code text,
  latest_seen_at timestamptz,
  approved_sighting_count bigint,
  distance_miles numeric
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with origin as (
    select z.latitude, z.longitude
    from public.zip_codes z
    where z.zip_code = p_zip_code
  )
  select
    s.id,
    s.slug,
    r.name,
    s.name,
    s.address_line1,
    s.city,
    s.state,
    s.zip_code,
    stats.latest_seen_at,
    stats.sighting_count,
    round(distance.value::numeric, 1)
  from public.stores s
  join public.retailers r on r.id = s.retailer_id
  join public.zip_codes sz on sz.zip_code = s.zip_code
  left join origin o on true
  cross join lateral (
    select case when p_zip_code is null then null
      else private.distance_miles(o.latitude, o.longitude, sz.latitude, sz.longitude)
    end as value
  ) distance
  cross join lateral (
    select max(si.seen_at) as latest_seen_at, count(*) as sighting_count
    from public.sightings si
    where si.store_id = s.id
      and si.is_public
      and si.moderation_status = 'approved'
      and si.seen_at >= now() - interval '7 days'
  ) stats
  where s.is_active and r.is_active
    and (
      nullif(btrim(p_query), '') is null
      or s.name ilike '%' || btrim(p_query) || '%'
      or r.name ilike '%' || btrim(p_query) || '%'
      or s.city ilike '%' || btrim(p_query) || '%'
      or s.zip_code = btrim(p_query)
    )
    and (
      p_zip_code is null
      or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
    )
  order by distance.value nulls last, r.name, s.name, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_public_store(p_slug text)
returns table (
  id uuid,
  slug text,
  retailer_name text,
  store_name text,
  address_line1 text,
  city text,
  state text,
  zip_code text,
  latest_seen_at timestamptz,
  approved_sighting_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    s.id,
    s.slug,
    r.name,
    s.name,
    s.address_line1,
    s.city,
    s.state,
    s.zip_code,
    max(si.seen_at),
    count(si.id)
  from public.stores s
  join public.retailers r on r.id = s.retailer_id
  left join public.sightings si
    on si.store_id = s.id
   and si.is_public
   and si.moderation_status = 'approved'
   and si.seen_at >= now() - interval '7 days'
  where s.slug = btrim(p_slug)
    and s.is_active
    and r.is_active
  group by s.id, s.slug, r.name, s.name, s.address_line1, s.city, s.state, s.zip_code;
$$;

create or replace function public.list_public_sightings(
  p_product_id uuid default null,
  p_store_id uuid default null,
  p_zip_code text default '48910',
  p_radius_miles integer default 50,
  p_limit integer default 50
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  store_id uuid,
  store_slug text,
  store_name text,
  retailer_name text,
  city text,
  state text,
  zip_code text,
  seen_at timestamptz,
  availability text,
  quantity integer,
  notes text,
  created_at timestamptz,
  distance_miles numeric
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with origin as (
    select z.latitude, z.longitude
    from public.zip_codes z
    where z.zip_code = p_zip_code
  )
  select
    si.id,
    p.id,
    p.name,
    p.slug,
    st.id,
    st.slug,
    st.name,
    r.name,
    st.city,
    st.state,
    st.zip_code,
    si.seen_at,
    si.availability,
    si.quantity,
    si.notes,
    si.created_at,
    round(distance.value::numeric, 1)
  from public.sightings si
  join public.products p on p.id = si.product_id and p.is_active
  join public.stores st on st.id = si.store_id and st.is_active
  join public.retailers r on r.id = st.retailer_id and r.is_active
  join public.zip_codes sz on sz.zip_code = st.zip_code
  left join origin o on true
  cross join lateral (
    select case when p_zip_code is null then null
      else private.distance_miles(o.latitude, o.longitude, sz.latitude, sz.longitude)
    end as value
  ) distance
  where si.is_public
    and si.moderation_status = 'approved'
    and si.seen_at >= now() - interval '7 days'
    and (p_product_id is null or si.product_id = p_product_id)
    and (p_store_id is null or si.store_id = p_store_id)
    and (
      p_zip_code is null
      or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
    )
  order by si.seen_at desc, si.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.list_public_bounties(
  p_product_id uuid default null,
  p_zip_code text default '48910',
  p_radius_miles integer default 50,
  p_limit integer default 50
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  store_id uuid,
  store_slug text,
  store_name text,
  retailer_name text,
  zip_code text,
  radius_miles integer,
  reward_cents integer,
  deadline timestamptz,
  requirements text,
  status text,
  created_at timestamptz,
  distance_miles numeric
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with origin as (
    select z.latitude, z.longitude
    from public.zip_codes z
    where z.zip_code = p_zip_code
  )
  select
    b.id,
    p.id,
    p.name,
    p.slug,
    st.id,
    st.slug,
    st.name,
    r.name,
    b.zip_code,
    b.radius_miles,
    b.reward_cents,
    b.deadline,
    b.requirements,
    b.status,
    b.created_at,
    round(distance.value::numeric, 1)
  from public.bounties b
  join public.products p on p.id = b.product_id and p.is_active
  left join public.stores st on st.id = b.store_id and st.is_active
  left join public.retailers r on r.id = st.retailer_id and r.is_active
  left join public.zip_codes bz on bz.zip_code = coalesce(st.zip_code, b.zip_code)
  left join origin o on true
  cross join lateral (
    select case when p_zip_code is null then null
      else private.distance_miles(o.latitude, o.longitude, bz.latitude, bz.longitude)
    end as value
  ) distance
  where b.status = 'open'
    and b.moderation_status = 'approved'
    and b.deadline > now()
    and (p_product_id is null or b.product_id = p_product_id)
    and (
      p_zip_code is null
      or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
    )
  order by b.created_at desc, b.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.get_bounty_detail(p_bounty_id uuid)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  store_id uuid,
  store_name text,
  zip_code text,
  radius_miles integer,
  reward_cents integer,
  deadline timestamptz,
  requirements text,
  status text,
  moderation_status text,
  created_at timestamptz,
  owner_username text,
  is_owner boolean,
  caller_claim_id uuid,
  caller_claim_status text,
  owner_contact_info text,
  accepted_finder_contact_info text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  return query
  select
    b.id,
    b.product_id,
    p.name,
    p.slug,
    b.store_id,
    st.name,
    b.zip_code,
    b.radius_miles,
    b.reward_cents,
    b.deadline,
    b.requirements,
    b.status,
    b.moderation_status,
    b.created_at,
    owner_profile.username,
    b.user_id = v_user_id,
    caller_claim.id,
    caller_claim.status,
    case when caller_claim.status = 'accepted' then owner_contact.contact_info end,
    case when b.user_id = v_user_id and accepted_claim.status = 'accepted'
      then finder_contact.contact_info end
  from public.bounties b
  join public.products p on p.id = b.product_id
  join public.profiles owner_profile on owner_profile.id = b.user_id
  left join public.stores st on st.id = b.store_id
  left join public.bounty_claims caller_claim
    on caller_claim.bounty_id = b.id and caller_claim.finder_id = v_user_id
  left join public.bounty_claims accepted_claim
    on accepted_claim.bounty_id = b.id and accepted_claim.status = 'accepted'
  left join public.profile_contacts owner_contact on owner_contact.user_id = b.user_id
  left join public.profile_contacts finder_contact on finder_contact.user_id = accepted_claim.finder_id
  where b.id = p_bounty_id
    and (
      (b.moderation_status = 'approved' and b.deadline > now())
      or b.user_id = v_user_id
      or caller_claim.id is not null
    );
end;
$$;

create or replace function public.list_my_bounty_claims(p_bounty_id uuid)
returns table (
  id uuid,
  finder_id uuid,
  finder_username text,
  status text,
  sighting_id uuid,
  store_id uuid,
  store_name text,
  seen_at timestamptz,
  availability text,
  quantity integer,
  notes text,
  contact_info text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  return query
  select
    bc.id,
    bc.finder_id,
    fp.username,
    bc.status,
    si.id,
    si.store_id,
    st.name,
    si.seen_at,
    si.availability,
    si.quantity,
    si.notes,
    case
      when bc.status = 'accepted' and (b.user_id = v_user_id or bc.finder_id = v_user_id)
        then pc.contact_info
    end,
    bc.created_at
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  join public.sightings si on si.id = bc.sighting_id
  join public.profiles fp on fp.id = bc.finder_id
  left join public.stores st on st.id = si.store_id
  left join public.profile_contacts pc on pc.user_id = bc.finder_id
  where bc.bounty_id = p_bounty_id
    and (b.user_id = v_user_id or bc.finder_id = v_user_id)
  order by bc.created_at desc, bc.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner moderation and catalog-suggestion operations
-- ---------------------------------------------------------------------------

insert into public.trends (name, slug, description, is_active) values (
  'Community Verified',
  'community-verified',
  'Products verified by the FindItViral owner from local member suggestions.',
  true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = true;

create or replace function private.assert_app_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if not private.is_app_owner(v_user_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.slugify(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(lower(normalize(p_value, NFKD)), '[^a-z0-9]+', '-', 'g'),
    '-+', '-', 'g'
  ));
$$;

create or replace function public.admin_list_product_suggestions(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  brand text,
  source_url text,
  notes text,
  status text,
  canonical_product_id uuid,
  created_at timestamptz,
  reviewed_at timestamptz,
  review_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select ps.id, ps.user_id, ps.name, ps.brand, ps.source_url, ps.notes,
    ps.status, ps.canonical_product_id, ps.created_at, ps.reviewed_at,
    ps.review_reason
  from private.product_suggestions ps
  where p_status is null or ps.status = p_status
  order by case when ps.status = 'pending' then 0 else 1 end, ps.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

create or replace function public.admin_list_store_suggestions(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  retailer_name text,
  store_name text,
  address_line1 text,
  city text,
  state text,
  zip_code text,
  phone text,
  source_url text,
  notes text,
  status text,
  canonical_store_id uuid,
  created_at timestamptz,
  reviewed_at timestamptz,
  review_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select ss.id, ss.user_id, ss.retailer_name, ss.store_name,
    ss.address_line1, ss.city, ss.state, ss.zip_code, ss.phone,
    ss.source_url, ss.notes, ss.status, ss.canonical_store_id,
    ss.created_at, ss.reviewed_at, ss.review_reason
  from private.store_suggestions ss
  where p_status is null or ss.status = p_status
  order by case when ss.status = 'pending' then 0 else 1 end, ss.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

create or replace function public.admin_resolve_product_suggestion(
  p_suggestion_id uuid,
  p_decision text,
  p_canonical_id uuid default null,
  p_reason text default null,
  p_availability_status text default null,
  p_release_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_suggestion private.product_suggestions%rowtype;
  v_product_id uuid := p_canonical_id;
  v_trend_id uuid;
  v_slug text;
  v_draft record;
begin
  if p_decision not in ('approved', 'rejected', 'duplicate')
    or (p_reason is not null and char_length(btrim(p_reason)) > 500)
  then
    raise exception 'Invalid suggestion decision' using errcode = '22023';
  end if;

  select * into v_suggestion
  from private.product_suggestions ps
  where ps.id = p_suggestion_id
  for update;
  if not found then
    raise exception 'Product suggestion not found' using errcode = 'P0002';
  end if;
  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion has already been reviewed' using errcode = '55000';
  end if;

  if p_decision = 'duplicate' then
    if v_product_id is null or not exists (
      select 1 from public.products p where p.id = v_product_id and p.is_active
    ) then
      raise exception 'Duplicate resolution requires an active product' using errcode = '22023';
    end if;
  elsif p_decision = 'approved' and v_product_id is null then
    if p_availability_status not in (
      'available', 'backorder', 'preorder', 'announced', 'limited'
    ) then
      raise exception 'Choose a valid product availability state' using errcode = '22023';
    end if;
    if p_availability_status in ('preorder', 'announced')
      and v_suggestion.source_url is null
    then
      raise exception 'Prerelease products require a supporting source' using errcode = '22023';
    end if;

    select t.id into v_trend_id
    from public.trends t where t.slug = 'community-verified';
    v_slug := coalesce(nullif(private.slugify(v_suggestion.name), ''), 'product')
      || '-' || substr(replace(v_suggestion.id::text, '-', ''), 1, 8);

    insert into public.products (
      trend_id, name, slug, availability_status, source_url, brand, verified_at,
      release_date, verification_method, is_active
    ) values (
      v_trend_id, v_suggestion.name, v_slug, p_availability_status,
      v_suggestion.source_url, v_suggestion.brand, now(),
      p_release_date,
      case when v_suggestion.source_url is null then 'owner_verified' else 'official_source' end,
      true
    ) returning id into v_product_id;
  elsif p_decision = 'approved' and not exists (
    select 1 from public.products p where p.id = v_product_id and p.is_active
  ) then
    raise exception 'Approved resolution requires an active product' using errcode = '22023';
  elsif p_decision = 'rejected' then
    v_product_id := null;
  end if;

  update private.product_suggestions
  set status = p_decision,
      canonical_product_id = v_product_id,
      reviewer_id = v_owner_id,
      reviewed_at = now(),
      review_reason = nullif(btrim(p_reason), '')
  where id = p_suggestion_id;

  if p_decision in ('approved', 'duplicate') then
    update private.contribution_drafts d
    set product_id = v_product_id, updated_at = now()
    where d.product_suggestion_id = p_suggestion_id;
  end if;

  for v_draft in
    select d.id from private.contribution_drafts d
    where d.product_suggestion_id = p_suggestion_id
  loop
    perform private.refresh_contribution_draft(v_draft.id);
  end loop;

  return v_product_id;
end;
$$;

create or replace function public.admin_resolve_store_suggestion(
  p_suggestion_id uuid,
  p_decision text,
  p_canonical_id uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_suggestion private.store_suggestions%rowtype;
  v_store_id uuid := p_canonical_id;
  v_retailer_id uuid;
  v_retailer_slug text;
  v_store_slug text;
  v_store_name text;
  v_draft record;
begin
  if p_decision not in ('approved', 'rejected', 'duplicate')
    or (p_reason is not null and char_length(btrim(p_reason)) > 500)
  then
    raise exception 'Invalid suggestion decision' using errcode = '22023';
  end if;

  select * into v_suggestion
  from private.store_suggestions ss
  where ss.id = p_suggestion_id
  for update;
  if not found then
    raise exception 'Store suggestion not found' using errcode = 'P0002';
  end if;
  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion has already been reviewed' using errcode = '55000';
  end if;

  if p_decision = 'duplicate' then
    if v_store_id is null or not exists (
      select 1 from public.stores s where s.id = v_store_id and s.is_active
    ) then
      raise exception 'Duplicate resolution requires an active store' using errcode = '22023';
    end if;
  elsif p_decision = 'approved' and v_store_id is null then
    perform pg_advisory_xact_lock(7463115459864002);
    select r.id into v_retailer_id
    from public.retailers r
    where lower(r.name) = lower(v_suggestion.retailer_name)
    order by r.created_at
    limit 1;

    if v_retailer_id is null then
      v_retailer_slug := coalesce(nullif(private.slugify(v_suggestion.retailer_name), ''), 'retailer')
        || '-' || substr(replace(v_suggestion.id::text, '-', ''), 1, 6);
      insert into public.retailers (name, slug, is_active)
      values (v_suggestion.retailer_name, v_retailer_slug, true)
      returning id into v_retailer_id;
    end if;

    v_store_name := coalesce(
      nullif(v_suggestion.store_name, ''),
      v_suggestion.retailer_name || ' ' || v_suggestion.city
    );
    v_store_slug := coalesce(nullif(private.slugify(v_store_name), ''), 'store')
      || '-' || substr(replace(v_suggestion.id::text, '-', ''), 1, 8);

    insert into public.stores (
      retailer_id, name, slug, address_line1, city, state, zip_code,
      source_url, verification_method, verified_at, is_active
    ) values (
      v_retailer_id, v_store_name, v_store_slug, v_suggestion.address_line1,
      v_suggestion.city, v_suggestion.state, v_suggestion.zip_code,
      v_suggestion.source_url,
      case when v_suggestion.source_url is null then 'owner_verified' else 'official_source' end,
      now(), true
    ) returning id into v_store_id;
  elsif p_decision = 'approved' and not exists (
    select 1 from public.stores s where s.id = v_store_id and s.is_active
  ) then
    raise exception 'Approved resolution requires an active store' using errcode = '22023';
  elsif p_decision = 'rejected' then
    v_store_id := null;
  end if;

  update private.store_suggestions
  set status = p_decision,
      canonical_store_id = v_store_id,
      reviewer_id = v_owner_id,
      reviewed_at = now(),
      review_reason = nullif(btrim(p_reason), '')
  where id = p_suggestion_id;

  if p_decision in ('approved', 'duplicate') then
    update private.contribution_drafts d
    set store_id = v_store_id, updated_at = now()
    where d.store_suggestion_id = p_suggestion_id;
  end if;

  for v_draft in
    select d.id from private.contribution_drafts d
    where d.store_suggestion_id = p_suggestion_id
  loop
    perform private.refresh_contribution_draft(v_draft.id);
  end loop;

  return v_store_id;
end;
$$;

create or replace function public.admin_set_contribution_moderation(
  p_contribution_type text,
  p_contribution_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_previous_status text;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_status text;
begin
  if p_contribution_type not in ('sighting', 'bounty')
    or p_action not in ('hide', 'restore', 'reject')
    or (v_reason is not null and char_length(v_reason) > 500)
  then
    raise exception 'Invalid moderation action' using errcode = '22023';
  end if;

  v_new_status := case p_action
    when 'hide' then 'hidden'
    when 'reject' then 'rejected'
    else 'approved'
  end;

  if p_contribution_type = 'sighting' then
    select s.moderation_status into v_previous_status
    from public.sightings s where s.id = p_contribution_id for update;
    if not found then raise exception 'Sighting not found' using errcode = 'P0002'; end if;
    update public.sightings
    set moderation_status = v_new_status,
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  else
    select b.moderation_status into v_previous_status
    from public.bounties b where b.id = p_contribution_id for update;
    if not found then raise exception 'Bounty not found' using errcode = 'P0002'; end if;
    update public.bounties
    set moderation_status = v_new_status,
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  end if;

  insert into private.contribution_moderation_events (
    contribution_type, contribution_id, actor_id, previous_status, new_status, reason
  ) values (
    p_contribution_type, p_contribution_id, v_owner_id, v_previous_status, v_new_status, v_reason
  );
end;
$$;

create or replace function public.admin_list_recent_contributions(p_limit integer default 100)
returns table (
  contribution_type text,
  contribution_id uuid,
  username text,
  product_name text,
  moderation_status text,
  lifecycle_status text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select * from (
    select 'sighting'::text, s.id, pr.username, p.name, s.moderation_status,
      case when s.seen_at >= now() - interval '7 days' then 'fresh' else 'expired' end,
      s.created_at
    from public.sightings s
    join public.profiles pr on pr.id = s.user_id
    join public.products p on p.id = s.product_id
    union all
    select 'bounty'::text, b.id, pr.username, p.name, b.moderation_status,
      b.status, b.created_at
    from public.bounties b
    join public.profiles pr on pr.id = b.user_id
    join public.products p on p.id = b.product_id
  ) recent
  order by occurred_at desc, contribution_id
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

create or replace function public.admin_list_moderation_history(p_limit integer default 100)
returns table (
  id uuid,
  contribution_type text,
  contribution_id uuid,
  actor_id uuid,
  previous_status text,
  new_status text,
  reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select e.id, e.contribution_type, e.contribution_id, e.actor_id,
    e.previous_status, e.new_status, e.reason, e.created_at
  from private.contribution_moderation_events e
  order by e.created_at desc, e.id
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

create or replace function public.admin_list_member_restrictions()
returns table (
  user_id uuid,
  username text,
  status text,
  reason text,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select mr.user_id, p.username, mr.status, mr.reason, mr.expires_at,
    mr.created_at, mr.updated_at
  from private.member_restrictions mr
  join public.profiles p on p.id = mr.user_id
  order by mr.updated_at desc, mr.user_id;
end;
$$;

create or replace function public.admin_set_member_restriction(
  p_user_id uuid,
  p_status text default null,
  p_reason text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_status is null then
    delete from private.member_restrictions mr where mr.user_id = p_user_id;
    return;
  end if;

  if p_status not in ('suspended', 'disabled')
    or v_reason is null
    or char_length(v_reason) > 500
    or (p_status = 'disabled' and p_expires_at is not null)
    or (p_status = 'suspended' and p_expires_at is not null and p_expires_at <= now())
  then
    raise exception 'Invalid member restriction' using errcode = '22023';
  end if;

  insert into private.member_restrictions (
    user_id, status, reason, expires_at, created_by
  ) values (
    p_user_id, p_status, v_reason, p_expires_at, v_owner_id
  )
  on conflict (user_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    created_by = excluded.created_by,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only interest outbox and daily digest delivery state
-- ---------------------------------------------------------------------------

create table if not exists private.interest_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  source text not null check (source in ('early_access', 'onboarding_looking_for')),
  source_record_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  email text check (email is null or char_length(email) <= 320),
  username text check (username is null or char_length(username) <= 64),
  interest text not null check (char_length(btrim(interest)) between 1 and 1200),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists private.digest_runs (
  id uuid primary key default gen_random_uuid(),
  run_local_date date not null unique,
  cutoff_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'completed', 'completed_noop', 'exhausted')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists private.digest_run_items (
  run_id uuid not null references private.digest_runs(id) on delete restrict,
  event_id uuid not null unique references private.interest_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (run_id, event_id)
);

create table if not exists private.digest_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.digest_runs(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 3),
  lease_token uuid not null unique,
  lease_expires_at timestamptz not null,
  outcome text check (
    outcome is null
    or outcome in ('accepted', 'transient_failure', 'permanent_failure', 'uncertain')
  ),
  message_id text check (message_id is null or char_length(message_id) <= 500),
  error_code text check (error_code is null or char_length(error_code) <= 100),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  started_at timestamptz not null,
  completed_at timestamptz,
  unique (run_id, attempt_number),
  constraint digest_attempt_completion_check check (
    (outcome is null and completed_at is null)
    or (outcome is not null and completed_at is not null)
  )
);

create index if not exists interest_events_occurred_idx
  on private.interest_events (occurred_at, id);
create index if not exists digest_runs_retry_idx
  on private.digest_runs (run_local_date) where status = 'pending';
create index if not exists digest_attempts_lease_idx
  on private.digest_delivery_attempts (lease_expires_at) where outcome is null;

alter table private.interest_events enable row level security;
alter table private.digest_runs enable row level security;
alter table private.digest_run_items enable row level security;
alter table private.digest_delivery_attempts enable row level security;

revoke all on private.interest_events,
  private.digest_runs,
  private.digest_run_items,
  private.digest_delivery_attempts
from public, anon, authenticated;

create or replace function private.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'Append-only records cannot be changed' using errcode = '55000';
end;
$$;

drop trigger if exists prevent_interest_event_mutation on private.interest_events;
create trigger prevent_interest_event_mutation
  before update or delete on private.interest_events
  for each row execute function private.prevent_append_only_mutation();

drop trigger if exists prevent_digest_run_item_mutation on private.digest_run_items;
create trigger prevent_digest_run_item_mutation
  before update or delete on private.digest_run_items
  for each row execute function private.prevent_append_only_mutation();

-- Backfill pre-launch data once. Stable source-record keys make this safe on a
-- restored database or a retried migration.
insert into private.interest_events (
  dedupe_key, source, source_record_id, email, interest, occurred_at
)
select
  'early_access:' || ear.id::text || ':'
    || encode(extensions.digest(btrim(ear.reason), 'sha256'), 'hex'),
  'early_access',
  ear.id,
  lower(btrim(ear.email)),
  btrim(ear.reason),
  ear.created_at
from public.early_access_requests ear
where nullif(btrim(ear.reason), '') is not null
on conflict (dedupe_key) do nothing;

insert into private.interest_events (
  dedupe_key, source, source_record_id, actor_user_id, email, username,
  interest, occurred_at
)
select
  'onboarding_looking_for:' || p.id::text,
  'onboarding_looking_for',
  p.id,
  p.id,
  lower(u.email),
  p.username,
  btrim(p.looking_for),
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id
where nullif(btrim(p.looking_for), '') is not null
on conflict (dedupe_key) do nothing;

-- Preserve the Pages Worker contract while atomically recording the accepted
-- interest. Exact duplicate reasons dedupe; a genuinely updated reason becomes
-- a new append-only event attached to the same request row.
create or replace function public.request_early_access(
  p_email text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_email text := lower(btrim(p_email));
  v_reason text := btrim(p_reason);
  v_request_id uuid;
  v_event_key text;
begin
  if v_email is null
    or v_reason is null
    or char_length(v_email) not between 3 and 320
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_reason) not between 10 and 1200
  then
    raise exception 'Invalid early-access request' using errcode = '22023';
  end if;

  delete from public.early_access_requests ear where ear.expires_at <= now();

  insert into public.early_access_requests (email, reason)
  values (v_email, v_reason)
  on conflict ((lower(email))) do update set
    reason = excluded.reason,
    expires_at = now() + interval '24 months'
  returning id into v_request_id;

  v_event_key := 'early_access:' || v_request_id::text || ':'
    || encode(extensions.digest(v_reason, 'sha256'), 'hex');

  insert into private.interest_events (
    dedupe_key, source, source_record_id, email, interest, occurred_at
  ) values (
    v_event_key, 'early_access', v_request_id, v_email, v_reason, now()
  ) on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.claim_interest_digest_attempt(
  p_scheduled_at timestamptz
)
returns table (
  run_id uuid,
  run_local_date date,
  cutoff_at timestamptz,
  attempt_id uuid,
  attempt_number integer,
  lease_token uuid,
  items jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_local_date date;
  v_local_time time;
  v_cutoff_at timestamptz;
  v_run private.digest_runs%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_lease_token uuid := gen_random_uuid();
  v_items jsonb;
begin
  if p_scheduled_at is null then
    raise exception 'Scheduled time is required' using errcode = '22023';
  end if;

  v_local_date := (p_scheduled_at at time zone 'America/Detroit')::date;
  v_local_time := (p_scheduled_at at time zone 'America/Detroit')::time;
  if v_local_time < time '08:00:00' then
    return;
  end if;
  v_cutoff_at := (v_local_date::timestamp + time '08:00:00')
    at time zone 'America/Detroit';

  perform pg_advisory_xact_lock(7463115459864010);

  with expired as (
    update private.digest_delivery_attempts a
    set outcome = 'uncertain',
        error_code = 'lease_expired',
        error_message = 'The delivery lease expired before completion was recorded.',
        completed_at = p_scheduled_at
    where a.outcome is null
      and a.lease_expires_at <= p_scheduled_at
    returning a.run_id
  )
  update private.digest_runs r
  set status = case when r.attempt_count >= 3 then 'exhausted' else 'pending' end,
      completed_at = case when r.attempt_count >= 3 then p_scheduled_at else null end
  where r.id in (select e.run_id from expired e);

  insert into private.digest_runs (run_local_date, cutoff_at)
  values (v_local_date, v_cutoff_at)
  on conflict on constraint digest_runs_run_local_date_key do nothing;

  insert into private.digest_run_items (run_id, event_id)
  select r.id, e.id
  from private.digest_runs r
  join private.interest_events e on e.occurred_at <= r.cutoff_at
  where r.run_local_date = v_local_date
    and r.status = 'pending'
    and not exists (
      select 1 from private.digest_run_items existing
      where existing.event_id = e.id
    )
  on conflict (event_id) do nothing;

  update private.digest_runs r
  set status = 'completed_noop', completed_at = p_scheduled_at
  where r.run_local_date = v_local_date
    and r.status = 'pending'
    and not exists (
      select 1 from private.digest_run_items ri where ri.run_id = r.id
    );

  select r.* into v_run
  from private.digest_runs r
  where r.status = 'pending' and r.attempt_count < 3
  order by r.run_local_date
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  v_attempt_number := v_run.attempt_count + 1;
  insert into private.digest_delivery_attempts (
    run_id, attempt_number, lease_token, lease_expires_at, started_at
  ) values (
    v_run.id, v_attempt_number, v_lease_token,
    p_scheduled_at + interval '10 minutes', p_scheduled_at
  ) returning id into v_attempt_id;

  update private.digest_runs
  set status = 'sending', attempt_count = v_attempt_number
  where id = v_run.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', e.id::text,
        'source', e.source,
        'occurred_at', to_jsonb(e.occurred_at),
        'email', e.email,
        'username', e.username,
        'interest', e.interest
      ) order by e.occurred_at, e.id
    ),
    '[]'::jsonb
  ) into v_items
  from private.digest_run_items ri
  join private.interest_events e on e.id = ri.event_id
  where ri.run_id = v_run.id;

  return query select
    v_run.id,
    v_run.run_local_date,
    v_run.cutoff_at,
    v_attempt_id,
    v_attempt_number,
    v_lease_token,
    v_items;
end;
$$;

create or replace function public.complete_interest_digest_attempt(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_attempt private.digest_delivery_attempts%rowtype;
  v_message_id text := nullif(btrim(p_message_id), '');
  v_error_code text := left(nullif(btrim(p_error_code), ''), 100);
  v_error_message text := left(nullif(btrim(p_error_message), ''), 1000);
begin
  if p_outcome not in ('accepted', 'transient_failure', 'permanent_failure', 'uncertain')
    or (p_outcome = 'accepted' and v_message_id is null)
    or (v_message_id is not null and char_length(v_message_id) > 500)
  then
    raise exception 'Invalid digest completion' using errcode = '22023';
  end if;

  select * into v_attempt
  from private.digest_delivery_attempts a
  where a.id = p_attempt_id
  for update;
  if not found then
    raise exception 'Digest attempt not found' using errcode = 'P0002';
  end if;

  if v_attempt.outcome is not null then
    if v_attempt.lease_token = p_lease_token
      and v_attempt.outcome = p_outcome
      and v_attempt.message_id is not distinct from v_message_id
      and v_attempt.error_code is not distinct from v_error_code
      and v_attempt.error_message is not distinct from v_error_message
    then
      return;
    end if;
    raise exception 'Digest attempt is already complete' using errcode = '55000';
  end if;

  if v_attempt.lease_token <> p_lease_token
    or v_attempt.lease_expires_at <= now()
  then
    raise exception 'Digest attempt lease is invalid or expired' using errcode = '55000';
  end if;

  update private.digest_delivery_attempts
  set outcome = p_outcome,
      message_id = v_message_id,
      error_code = v_error_code,
      error_message = v_error_message,
      completed_at = now()
  where id = p_attempt_id;

  update private.digest_runs r
  set status = case
        when p_outcome = 'accepted' then 'completed'
        when p_outcome = 'permanent_failure' then 'exhausted'
        when v_attempt.attempt_number >= 3 then 'exhausted'
        else 'pending'
      end,
      completed_at = case
        when p_outcome in ('accepted', 'permanent_failure')
          or v_attempt.attempt_number >= 3 then now()
        else null
      end
  where r.id = v_attempt.run_id and r.status = 'sending';
end;
$$;

create or replace function public.admin_list_interest_events(p_limit integer default 250)
returns table (
  id uuid,
  source text,
  email text,
  reason text,
  looking_for text,
  created_at timestamptz,
  username text,
  digest_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
  select e.id, e.source, e.email,
    case when e.source = 'early_access' then e.interest end,
    case when e.source = 'onboarding_looking_for' then e.interest end,
    e.occurred_at,
    e.username,
    coalesce(r.status, 'unassigned')
  from private.interest_events e
  left join private.digest_run_items ri on ri.event_id = e.id
  left join private.digest_runs r on r.id = ri.run_id
  order by e.occurred_at desc, e.id
  limit least(greatest(coalesce(p_limit, 250), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative username onboarding transaction
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_placeholder text := 'user_' || substr(replace(new.id::text, '-', ''), 1, 15);
begin
  -- Fixed global lock key for every username-writing transaction.
  perform pg_advisory_xact_lock(7463115459864001);

  insert into public.profiles (id, username, karma, is_pro)
  values (new.id, v_placeholder, 0, false)
  on conflict (id) do nothing;

  insert into private.username_claims (
    user_id, claimed_username, normalized_username, is_legacy
  ) values (
    new.id, v_placeholder, null, false
  ) on conflict (user_id) do nothing;

  return new;
end;
$$;

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
    or v_clean !~ '^[a-z]{3,24}$'
    or exists (select 1 from private.username_reserved_terms r where r.term = v_clean)
  then
    return false;
  end if;

  return not exists (
    select 1
    from private.username_claims uc
    where uc.user_id <> v_user_id
      and uc.normalized_username is not null
      and (
        uc.normalized_username = v_clean
        or (
          char_length(v_clean) >= 5
          and char_length(uc.normalized_username) >= 5
          and private.username_within_one_edit(v_clean, uc.normalized_username)
        )
      )
  );
end;
$$;

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
    raise exception 'Permanent authenticated account required' using errcode = '42501';
  end if;

  -- Serialize all claim validation and writes before taking a profile row lock.
  perform pg_advisory_xact_lock(7463115459864001);

  select u.email into v_email
  from auth.users u
  where u.id = v_user_id
    and u.deleted_at is null
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now());
  if not found then
    raise exception 'Permanent authenticated account required' using errcode = '42501';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_profile.onboarding_completed then
    raise exception 'Onboarding has already been completed' using errcode = '55006';
  end if;

  v_clean_username := private.normalize_username(p_username);
  if v_clean_username is null or v_clean_username !~ '^[a-z]{3,24}$' then
    raise exception 'Username must be 3-24 letters only' using errcode = '22023';
  end if;

  if exists (
    select 1 from private.username_reserved_terms r where r.term = v_clean_username
  ) or exists (
    select 1
    from private.username_claims uc
    where uc.user_id <> v_user_id
      and uc.normalized_username is not null
      and (
        uc.normalized_username = v_clean_username
        or (
          char_length(v_clean_username) >= 5
          and char_length(uc.normalized_username) >= 5
          and private.username_within_one_edit(v_clean_username, uc.normalized_username)
        )
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'username_unavailable',
      detail = 'The requested username conflicts with an existing or protected claim.',
      constraint = 'username_claim_policy';
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
      select 1 from unnest(v_cities) city
      where not (city = any(v_allowed_cities))
    )
  then
    raise exception 'Please select at least one valid Greater Lansing city'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_referrer_username), '') is not null then
    raise exception 'Referrals are unavailable during beta' using errcode = '22023';
  end if;

  insert into private.username_claims (
    user_id, claimed_username, normalized_username, is_legacy, updated_at
  ) values (
    v_user_id, v_clean_username, v_clean_username, false, now()
  ) on conflict (user_id) do update set
    claimed_username = excluded.claimed_username,
    normalized_username = excluded.normalized_username,
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
      lower(v_email),
      v_clean_username,
      v_clean_looking_for,
      now()
    ) on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS, explicit Data API grants, and RPC allowlist
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

revoke all on table public.retailers, public.stores from public, anon, authenticated;
grant select on table public.retailers, public.stores to authenticated;
grant all on table public.retailers, public.stores to service_role;

drop policy if exists permanent_users_only on public.retailers;
create policy permanent_users_only on public.retailers
  as restrictive for all to authenticated
  using (not coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false));
drop policy if exists authenticated_retailers_read on public.retailers;
create policy authenticated_retailers_read on public.retailers
  for select to authenticated using (is_active);

drop policy if exists permanent_users_only on public.stores;
create policy permanent_users_only on public.stores
  as restrictive for all to authenticated
  using (not coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false));
drop policy if exists authenticated_stores_read on public.stores;
create policy authenticated_stores_read on public.stores
  for select to authenticated using (is_active);

-- Remove direct contribution writes and every legacy permissive contribution
-- policy. The permanent-user restrictive policy is retained from the open-beta
-- migration and combined with the new read policies below.
revoke insert, update, delete on table public.bounties, public.sightings,
  public.bounty_claims from authenticated;

do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['bounties', 'sightings', 'bounty_claims'] loop
    for v_policy in
      select policyname from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname <> 'permanent_users_only'
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$$;

create policy authenticated_bounties_read
  on public.bounties for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.bounty_claims bc
      where bc.bounty_id = bounties.id and bc.finder_id = (select auth.uid())
    )
  );

create policy authenticated_sightings_read
  on public.sightings for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.bounty_claims bc
      join public.bounties b on b.id = bc.bounty_id
      where bc.sighting_id = sightings.id and b.user_id = (select auth.uid())
    )
  );

create policy claims_participant_read
  on public.bounty_claims for select to authenticated
  using (
    (select auth.uid()) = finder_id
    or exists (
      select 1 from public.bounties b
      where b.id = bounty_id and b.user_id = (select auth.uid())
    )
  );

grant select on table public.trends, public.products, public.retailers,
  public.stores, public.zip_codes, public.profile_contacts,
  public.profile_locations
to authenticated;

revoke select on table public.bounties, public.sightings, public.bounty_claims
  from authenticated;
grant select (
  id, user_id, product_id, reward_amount, reward_cents, store_id, zip_code,
  radius_miles, notes, requirements, deadline, status, moderation_status,
  created_at
) on public.bounties to authenticated;
grant select (
  id, user_id, product_id, store_id, store_name, city, state, zip_code,
  stock_level, availability, quantity, notes, seen_at, is_public, bounty_id,
  photo_urls, moderation_status, created_at
) on public.sightings to authenticated;
grant select (id, bounty_id, finder_id, sighting_id, status, created_at)
  on public.bounty_claims to authenticated;
grant select (id, username, karma, is_pro, created_at)
  on public.profiles to authenticated;

-- Profile contact updates remain the member's only direct application write;
-- their existing owner/accepted-participant RLS policies continue to apply.
grant insert (user_id, contact_info), update (user_id, contact_info)
  on public.profile_contacts to authenticated;

revoke execute on all functions in schema private
  from public, anon, authenticated;

-- Public sanitized discovery.
revoke all on function public.search_products(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.search_stores(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_product(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_public_stores(text, integer, integer, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_store(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_public_sightings(uuid, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.list_public_bounties(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.search_products(text, integer),
  public.search_stores(text, integer),
  public.get_public_product(text),
  public.list_public_stores(text, integer, integer, text, integer),
  public.get_public_store(text),
  public.list_public_sightings(uuid, uuid, text, integer, integer),
  public.list_public_bounties(uuid, text, integer, integer)
to anon, authenticated, service_role;

-- Authenticated member workflows.
revoke all on function public.save_contribution_draft(uuid, text, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_contribution_drafts()
  from public, anon, authenticated, service_role;
revoke all on function public.discard_contribution_draft(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.suggest_product_for_draft(uuid, text, jsonb, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.suggest_store_for_draft(uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_bounty(uuid, uuid, text, integer, integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_bounty_detail(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_bounty_claims(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.accept_bounty_claim(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_bounty_claim(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.close_bounty(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.is_username_available(text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_onboarding(text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.save_contribution_draft(uuid, text, jsonb, uuid, uuid),
  public.get_my_contribution_drafts(),
  public.discard_contribution_draft(uuid),
  public.suggest_product_for_draft(uuid, text, jsonb, text, text, text, uuid),
  public.suggest_store_for_draft(uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text),
  public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid),
  public.create_bounty(uuid, uuid, text, integer, integer, timestamptz, text, uuid),
  public.get_bounty_detail(uuid),
  public.list_my_bounty_claims(uuid),
  public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text),
  public.submit_bounty_claim(uuid, text, text, text, text, text),
  public.accept_bounty_claim(uuid),
  public.reject_bounty_claim(uuid),
  public.close_bounty(uuid),
  public.is_username_available(text),
  public.complete_onboarding(text, text, text, text, text[])
to authenticated;

-- Owner operations.
revoke all on function public.admin_list_product_suggestions(text, integer),
  public.admin_list_store_suggestions(text, integer),
  public.admin_resolve_product_suggestion(uuid, text, uuid, text, text, date),
  public.admin_resolve_store_suggestion(uuid, text, uuid, text),
  public.admin_set_contribution_moderation(text, uuid, text, text),
  public.admin_list_recent_contributions(integer),
  public.admin_list_moderation_history(integer),
  public.admin_list_member_restrictions(),
  public.admin_set_member_restriction(uuid, text, text, timestamptz),
  public.admin_list_interest_events(integer)
from public, anon, authenticated, service_role;

grant execute on function public.admin_list_product_suggestions(text, integer),
  public.admin_list_store_suggestions(text, integer),
  public.admin_resolve_product_suggestion(uuid, text, uuid, text, text, date),
  public.admin_resolve_store_suggestion(uuid, text, uuid, text),
  public.admin_set_contribution_moderation(text, uuid, text, text),
  public.admin_list_recent_contributions(integer),
  public.admin_list_moderation_history(integer),
  public.admin_list_member_restrictions(),
  public.admin_set_member_restriction(uuid, text, text, timestamptz),
  public.admin_list_interest_events(integer)
to authenticated;

-- Server-only waitlist and digest operations.
revoke all on function public.request_early_access(text, text),
  public.claim_interest_digest_attempt(timestamptz),
  public.complete_interest_digest_attempt(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.request_early_access(text, text),
  public.claim_interest_digest_attempt(timestamptz),
  public.complete_interest_digest_attempt(uuid, uuid, text, text, text, text)
to service_role;

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

comment on function public.complete_onboarding(text, text, text, text, text[]) is
  'Claims a normalized letters-only username under a global transaction lock and completes Greater Lansing onboarding once.';
comment on function public.request_early_access(text, text) is
  'Worker-only early-access upsert that atomically appends a deduplicated private interest event.';
comment on function public.claim_interest_digest_attempt(timestamptz) is
  'Worker-only hourly claim for the America/Detroit 08:00 interest digest with a ten-minute lease.';

notify pgrst, 'reload schema';






-- Compatibility wrapper for clients deployed before canonical store IDs. It
-- succeeds only when the submitted address resolves to exactly one active
-- canonical store; it never creates a raw-address sighting.
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
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_store_id uuid;
  v_match_count integer;
begin
  select count(*), (array_agg(s.id order by s.id))[1]
    into v_match_count, v_store_id
  from public.stores s
  join public.retailers r on r.id = s.retailer_id
  where s.is_active
    and (
      lower(s.name) = lower(btrim(p_store_name))
      or lower(r.name) = lower(btrim(p_store_name))
    )
    and (nullif(btrim(p_city), '') is null or lower(s.city) = lower(btrim(p_city)))
    and (nullif(btrim(p_state), '') is null or s.state = upper(btrim(p_state)))
    and (nullif(btrim(p_zip_code), '') is null or s.zip_code = btrim(p_zip_code));

  if v_match_count <> 1 then
    raise exception 'Select a canonical store before submitting this claim'
      using errcode = '22023';
  end if;

  return public.submit_bounty_claim(
    p_bounty_id,
    v_store_id,
    now(),
    case when p_stock_level in ('low', 'none') then 'low' else 'high' end,
    null,
    null
  );
end;
$$;

commit;
