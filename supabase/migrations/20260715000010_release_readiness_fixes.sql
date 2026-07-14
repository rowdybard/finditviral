-- Release readiness fixes: bounty lifecycle, admin catalog, security, search.
--
-- Fixes:
-- 1A. Draft payload validator: add bounty fields quantityNeeded, variantRequirements,
--     acceptEquivalent, selectedRetailers, selectedStores to allowlist.
-- 1B. Draft refresh: fix zip_code -> zipCode field name mismatch.
-- 1C. Bounty creation: retailer scope now requires ZIP + radius.
-- 1D. Association validation: drop immediate trigger, validate inside create_bounty.
-- 1E. Bounty claim: retailer scope now checks ZIP/radius distance.
-- 1F. Listing/detail RPCs: return retailer_names, store_names, quantity, variant, equivalent.
-- 2A. Admin store RPCs: remove phone/website_url, use real schema columns.
-- 2B. Admin product RPC: replace retailer with brand.
-- 3C. Personal notifications: revoke from public/anon.
-- 3D. Username partial unique index for non-legacy normalized names.
-- 3F. Stable error code hints on RPC exceptions.
-- 4A. Product search: include brand in search and ranking.

begin;

-- ---------------------------------------------------------------------------
-- 1A. Recreate validate_draft_payload with new bounty fields
-- ---------------------------------------------------------------------------
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
  v_scope text;
  v_keys text[];
  v_key text;
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
      'quantityNeeded', 'variantRequirements', 'acceptEquivalent',
      'selectedRetailers', 'selectedStores',
      'productSuggestionName', 'storeSuggestionName'
    ];
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_payload) key
    where not (key = any(v_allowed))
  ) then
    raise exception 'Contribution draft contains unsupported fields'
      using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_FIELD';
  end if;

  if not (p_payload ? 'version')
    or jsonb_typeof(p_payload -> 'version') <> 'number'
    or (p_payload ->> 'version') <> '1'
  then
    raise exception 'Unsupported contribution draft version'
      using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
  end if;

  if p_payload ? 'notes' and char_length(coalesce(p_payload ->> 'notes', '')) > 2000 then
    raise exception 'Draft notes are too long' using errcode = '22023';
  end if;
  if p_payload ? 'requirements' and char_length(coalesce(p_payload ->> 'requirements', '')) > 2000 then
    raise exception 'Draft requirements are too long' using errcode = '22023';
  end if;

  -- Bounty-specific validation
  if p_draft_type = 'bounty' then
    v_scope := p_payload ->> 'scope';
    if v_scope is not null and v_scope not in ('region', 'retailers', 'stores') then
      raise exception 'Invalid bounty scope' using errcode = '22023', hint = 'INVALID_SCOPE';
    end if;

    if p_payload ? 'zipCode' then
      declare v_zip text := p_payload ->> 'zipCode'; begin
        if v_zip is not null and v_zip !~ '^[0-9]{5}$' then
          raise exception 'Invalid ZIP code' using errcode = '22023', hint = 'INVALID_LOCATION';
        end if;
      end;
    end if;

    if p_payload ? 'radiusMiles' then
      declare v_radius text := p_payload ->> 'radiusMiles'; begin
        if v_radius is not null and v_radius ~ '^[0-9]+$'
          and v_radius::int not in (10, 25, 50, 100, 250)
        then
          raise exception 'Invalid radius' using errcode = '22023', hint = 'INVALID_LOCATION';
        end if;
      end;
    end if;

    if p_payload ? 'quantityNeeded' then
      declare v_qty text := p_payload ->> 'quantityNeeded'; begin
        if v_qty is not null and char_length(v_qty) > 3 then
          raise exception 'Quantity needed is too large' using errcode = '22023';
        end if;
      end;
    end if;

    if p_payload ? 'variantRequirements'
      and char_length(coalesce(p_payload ->> 'variantRequirements', '')) > 1000
    then
      raise exception 'Variant requirements are too long' using errcode = '22023';
    end if;

    if p_payload ? 'selectedRetailers' then
      declare v_arr jsonb := p_payload -> 'selectedRetailers'; begin
        if jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 12 then
          raise exception 'Too many selected retailers' using errcode = '22023';
        end if;
      end;
    end if;

    if p_payload ? 'selectedStores' then
      declare v_arr jsonb := p_payload -> 'selectedStores'; begin
        if jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 12 then
          raise exception 'Too many selected stores' using errcode = '22023';
        end if;
      end;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1B. Recreate refresh_contribution_draft: fix zip_code -> zipCode
-- ---------------------------------------------------------------------------
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
      or coalesce(v_draft.payload ->> 'zipCode', '') ~ '^[0-9]{5}$'
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
-- 1C + 1D. Recreate create_bounty: retailer scope requires ZIP+radius,
--           validate associations inside RPC after inserts, drop trigger
-- ---------------------------------------------------------------------------

-- Drop the immediate trigger and function
drop trigger if exists trg_validate_bounty_scope on public.bounties;
drop function if exists public.validate_bounty_scope();

-- Update bounties_scope_check to allow ZIP+radius for retailers scope
alter table public.bounties drop constraint if exists bounties_scope_check;
alter table public.bounties add constraint bounties_scope_check check (
  (scope_type = 'region' and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
  or (scope_type = 'stores' and store_id is not null and zip_code is null and radius_miles is null)
  or (scope_type = 'stores' and store_id is null and zip_code is null and radius_miles is null)
  or (scope_type = 'retailers' and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
);

create or replace function public.create_bounty(
  p_product_id uuid,
  p_scope_type text default 'region',
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_retailer_ids uuid[] default null,
  p_store_ids uuid[] default null,
  p_reward_cents integer default null,
  p_deadline timestamptz default null,
  p_requirements text default null,
  p_quantity_needed integer default null,
  p_variant_requirements text default null,
  p_accept_equivalent boolean default false,
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
  v_variant_req text := nullif(btrim(p_variant_requirements), '');
  v_scope text := coalesce(p_scope_type, 'region');
begin
  perform private.check_contribution_rate_limit(v_user_id, 'bounty');

  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023', hint = 'PRODUCT_UNAVAILABLE';
  end if;

  if v_scope = 'region' then
    if p_store_id is not null or p_retailer_ids is not null or p_store_ids is not null
      or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
    then
      raise exception 'Choose a valid Greater Lansing ZIP radius'
        using errcode = '22023', hint = 'INVALID_LOCATION';
    end if;
  elsif v_scope = 'stores' then
    if p_store_id is not null then
      if v_zip is not null or p_radius_miles is not null
        or not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active)
      then
        raise exception 'Choose a valid store' using errcode = '22023', hint = 'INVALID_LOCATION';
      end if;
    elsif p_store_ids is not null and array_length(p_store_ids, 1) > 0 then
      if v_zip is not null or p_radius_miles is not null
        or not exists (
          select 1 from public.stores s
          where s.id = any(p_store_ids) and s.is_active
          having count(*) = array_length(p_store_ids, 1)
        )
      then
        raise exception 'Choose valid stores' using errcode = '22023', hint = 'INVALID_LOCATION';
      end if;
    else
      raise exception 'Choose at least one store' using errcode = '22023', hint = 'INVALID_SCOPE';
    end if;
  elsif v_scope = 'retailers' then
    if p_retailer_ids is null or array_length(p_retailer_ids, 1) is null
      or array_length(p_retailer_ids, 1) = 0
      or p_store_id is not null or p_store_ids is not null
      or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
      or not exists (
        select 1 from public.retailers r
        where r.id = any(p_retailer_ids) and r.is_active
        having count(*) = array_length(p_retailer_ids, 1)
      )
    then
      raise exception 'Choose valid retailers within a ZIP radius'
        using errcode = '22023', hint = 'INVALID_SCOPE';
    end if;
  else
    raise exception 'Invalid scope type' using errcode = '22023', hint = 'INVALID_SCOPE';
  end if;

  if p_reward_cents not between 100 and 1000000
    or p_deadline is null
    or p_deadline < now() + interval '1 hour'
    or p_deadline > now() + interval '30 days'
    or (v_requirements is not null and char_length(v_requirements) > 2000)
    or (v_variant_req is not null and char_length(v_variant_req) > 1000)
    or (p_quantity_needed is not null and p_quantity_needed not between 1 and 999)
  then
    raise exception 'Invalid bounty details' using errcode = '22023', hint = 'INVALID_BOUNTY_DETAILS';
  end if;

  perform private.assert_ready_draft(
    p_draft_id, v_user_id, 'bounty', p_product_id,
    case when v_scope = 'stores' and p_store_id is not null then p_store_id
         when v_scope = 'stores' and p_store_ids is not null then p_store_ids[1]
         else null end
  );

  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status, scope_type,
    quantity_needed, variant_requirements, accept_equivalent
  ) values (
    v_user_id, p_product_id,
    case when v_scope = 'stores' and p_store_id is not null then p_store_id else null end,
    p_reward_cents::numeric / 100, p_reward_cents,
    case when v_scope in ('region', 'retailers') then v_zip else null end,
    case when v_scope in ('region', 'retailers') then p_radius_miles else null end,
    v_requirements, v_requirements, p_deadline, 'open', 'pending', v_scope,
    p_quantity_needed, v_variant_req, p_accept_equivalent
  ) returning id into v_bounty_id;

  -- Insert associations
  if v_scope = 'retailers' and p_retailer_ids is not null then
    insert into public.bounty_retailers (bounty_id, retailer_id)
    select v_bounty_id, unnest(p_retailer_ids)
    on conflict do nothing;
  end if;

  if v_scope = 'stores' and p_store_ids is not null then
    insert into public.bounty_stores (bounty_id, store_id)
    select v_bounty_id, unnest(p_store_ids)
    on conflict do nothing;
  end if;

  -- Validate associations after inserts (replaces the dropped trigger)
  if v_scope = 'stores' and p_store_id is null then
    if not exists (select 1 from public.bounty_stores bs where bs.bounty_id = v_bounty_id) then
      raise exception 'Bounty with stores scope must have at least one store association'
        using errcode = '23514', hint = 'INVALID_SCOPE';
    end if;
  end if;
  if v_scope = 'retailers' then
    if not exists (select 1 from public.bounty_retailers br where br.bounty_id = v_bounty_id) then
      raise exception 'Bounty with retailers scope must have at least one retailer association'
        using errcode = '23514', hint = 'INVALID_SCOPE';
    end if;
  end if;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_bounty_id;
end;
$$;

-- Re-grant create_bounty
revoke all on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, integer, text, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, integer, text, boolean, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 1E. Recreate submit_bounty_claim: retailer scope checks ZIP/radius distance
-- ---------------------------------------------------------------------------
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
    raise exception 'Bounty is unavailable' using errcode = '55000', hint = 'BOUNTY_CLOSED';
  end if;
  if v_bounty.user_id = v_user_id then
    raise exception 'You cannot claim your own bounty' using errcode = '42501', hint = 'UNAUTHORIZED';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id and s.is_active;
  if not found then
    raise exception 'Store is unavailable' using errcode = '22023', hint = 'STORE_UNAVAILABLE';
  end if;

  -- Scope validation
  if v_bounty.scope_type = 'stores' and v_bounty.store_id is not null
    and v_bounty.store_id <> v_store.id
  then
    raise exception 'This bounty requires a different store' using errcode = '22023', hint = 'STORE_OUT_OF_SCOPE';
  elsif v_bounty.scope_type = 'stores' and v_bounty.store_id is null then
    if not exists (
      select 1 from public.bounty_stores bs
      where bs.bounty_id = v_bounty.id and bs.store_id = v_store.id
    ) then
      raise exception 'This store is not in the bounty scope' using errcode = '22023', hint = 'STORE_OUT_OF_SCOPE';
    end if;
  elsif v_bounty.scope_type = 'retailers' then
    -- Store must belong to an allowed retailer AND be within ZIP/radius
    if not exists (
      select 1 from public.bounty_retailers br
      join public.stores s on s.retailer_id = br.retailer_id and s.id = v_store.id
      where br.bounty_id = v_bounty.id
    ) then
      raise exception 'This store does not belong to a retailer in the bounty scope'
        using errcode = '22023', hint = 'STORE_OUT_OF_SCOPE';
    end if;
    if not exists (
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
      raise exception 'This store is outside the bounty radius'
        using errcode = '22023', hint = 'STORE_OUT_OF_SCOPE';
    end if;
  elsif v_bounty.scope_type = 'region' and v_bounty.store_id is null then
    if not exists (
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
      raise exception 'This store is outside the bounty radius'
        using errcode = '22023', hint = 'STORE_OUT_OF_SCOPE';
    end if;
  end if;

  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '5 minutes'
    or p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown')
    or (p_quantity is not null and p_quantity not between 1 and 99)
    or (v_notes is not null and char_length(v_notes) > 2000)
  then
    raise exception 'Invalid claim sighting' using errcode = '22023', hint = 'INVALID_CLAIM';
  end if;

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, moderation_status
  ) values (
    v_user_id, v_bounty.product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case p_availability
      when 'in_stock' then 'in_stock'
      when 'low_stock' then 'low'
      when 'sold_out' then 'none'
      when 'unknown' then 'none'
    end,
    p_availability, p_quantity, v_notes, p_seen_at, false,
    v_bounty.id, 'approved'
  ) returning id into v_sighting_id;

  insert into public.bounty_claims (bounty_id, finder_id, sighting_id)
  values (v_bounty.id, v_user_id, v_sighting_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

-- Re-grant submit_bounty_claim (store_id variant)
revoke all on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 1F. Recreate list_public_bounties with scope details
-- ---------------------------------------------------------------------------
drop function if exists public.list_public_bounties(uuid, text, integer, integer);

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
  scope_type text,
  quantity_needed integer,
  variant_requirements text,
  accept_equivalent boolean,
  retailer_names text[],
  store_names text[],
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
    b.scope_type,
    b.quantity_needed,
    b.variant_requirements,
    b.accept_equivalent,
    case
      when b.scope_type = 'retailers' then (
        select array_agg(br_r.name order by br_r.name)
        from public.bounty_retailers br
        join public.retailers br_r on br_r.id = br.retailer_id
        where br.bounty_id = b.id
      )
      else null
    end,
    case
      when b.scope_type = 'stores' and b.store_id is null then (
        select array_agg(bs_s.name order by bs_s.name)
        from public.bounty_stores bs
        join public.stores bs_s on bs_s.id = bs.store_id
        where bs.bounty_id = b.id
      )
      else null
    end,
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
      or b.scope_type in ('retailers', 'stores')
      or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
    )
  order by b.created_at desc, b.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_public_bounties(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_bounties(uuid, text, integer, integer)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1F. Recreate get_bounty_detail with retailer_names and store_names
-- ---------------------------------------------------------------------------
drop function if exists public.get_bounty_detail(uuid);

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
  accepted_finder_contact_info text,
  scope_type text,
  quantity_needed integer,
  variant_requirements text,
  accept_equivalent boolean,
  retailer_names text[],
  store_names text[]
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
      then finder_contact.contact_info end,
    b.scope_type,
    b.quantity_needed,
    b.variant_requirements,
    b.accept_equivalent,
    case
      when b.scope_type = 'retailers' then (
        select array_agg(br_r.name order by br_r.name)
        from public.bounty_retailers br
        join public.retailers br_r on br_r.id = br.retailer_id
        where br.bounty_id = b.id
      )
      else null
    end,
    case
      when b.scope_type = 'stores' and b.store_id is null then (
        select array_agg(bs_s.name order by bs_s.name)
        from public.bounty_stores bs
        join public.stores bs_s on bs_s.id = bs.store_id
        where bs.bounty_id = b.id
      )
      else null
    end
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

revoke all on function public.get_bounty_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_bounty_detail(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 2A. Recreate admin_create_store: remove phone/website_url, use real schema
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_store(text, text, text, text, text, text, text, text, numeric, numeric);

create or replace function public.admin_create_store(
  p_retailer_name text,
  p_store_name text,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_zip_code text,
  p_source_url text default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_retailer_id uuid;
  v_store_id uuid;
  v_retailer_slug text;
  v_store_slug text;
  v_source_url text := nullif(btrim(p_source_url), '');
begin
  if btrim(p_retailer_name) is null or char_length(btrim(p_retailer_name)) > 120
    or btrim(p_store_name) is null or char_length(btrim(p_store_name)) > 160
    or btrim(p_address_line1) is null or char_length(btrim(p_address_line1)) > 160
    or btrim(p_city) is null or char_length(btrim(p_city)) > 100
    or upper(btrim(p_state)) !~ '^[A-Z]{2}$'
    or btrim(p_zip_code) !~ '^[0-9]{5}$'
    or (v_source_url is not null and v_source_url !~ '^https://')
  then
    raise exception 'Invalid store details' using errcode = '22023', hint = 'INVALID_STORE';
  end if;

  -- Find or create retailer
  select id into v_retailer_id
  from public.retailers r
  where lower(r.name) = lower(btrim(p_retailer_name))
  for update;

  if not found then
    v_retailer_slug := lower(regexp_replace(btrim(p_retailer_name), '[^a-z0-9]+', '-', 'gi'));
    v_retailer_slug := trim(both '-' from v_retailer_slug);
    insert into public.retailers (name, slug)
    values (btrim(p_retailer_name), v_retailer_slug)
    returning id into v_retailer_id;
  end if;

  v_store_slug := lower(regexp_replace(btrim(p_store_name) || '-' || btrim(p_city) || '-' || btrim(p_state), '[^a-z0-9]+', '-', 'gi'));
  v_store_slug := trim(both '-' from v_store_slug);

  insert into public.stores (
    retailer_id, name, slug, address_line1, city, state, zip_code,
    source_url, verification_method, verified_at, latitude, longitude, is_active
  ) values (
    v_retailer_id, btrim(p_store_name), v_store_slug,
    btrim(p_address_line1), btrim(p_city), upper(btrim(p_state)),
    btrim(p_zip_code), v_source_url,
    case when v_source_url is null then 'owner_verified' else 'official_source' end,
    now(), p_latitude, p_longitude, true
  )
  on conflict (slug) do update set
    name = excluded.name,
    address_line1 = excluded.address_line1,
    city = excluded.city,
    state = excluded.state,
    zip_code = excluded.zip_code,
    source_url = excluded.source_url,
    verification_method = excluded.verification_method,
    verified_at = excluded.verified_at,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    is_active = true,
    updated_at = now()
  returning id into v_store_id;

  return v_store_id;
end;
$$;

-- Recreate admin_update_store: remove phone/website_url
drop function if exists public.admin_update_store(uuid, text, text, text, text, boolean);

create or replace function public.admin_update_store(
  p_store_id uuid,
  p_store_name text default null,
  p_address_line1 text default null,
  p_source_url text default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_source_url text := nullif(btrim(p_source_url), '');
begin
  if v_source_url is not null and v_source_url !~ '^https://' then
    raise exception 'Invalid source URL' using errcode = '22023', hint = 'INVALID_STORE';
  end if;

  update public.stores set
    name = coalesce(nullif(btrim(p_store_name), ''), name),
    address_line1 = coalesce(nullif(btrim(p_address_line1), ''), address_line1),
    source_url = case when p_source_url is not null then v_source_url else source_url end,
    verification_method = case
      when p_source_url is not null then
        case when v_source_url is null then 'owner_verified' else 'official_source' end
      else verification_method end,
    verified_at = case when p_source_url is not null then now() else verified_at end,
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_store_id;
end;
$$;

-- Recreate admin_disable_store (unchanged but re-granted)
create or replace function public.admin_disable_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
begin
  update public.stores set is_active = false, updated_at = now()
  where id = p_store_id;
end;
$$;

-- Re-grant admin store functions
revoke all on function public.admin_create_store(text, text, text, text, text, text, text, numeric, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_store(uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_disable_store(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_store(text, text, text, text, text, text, text, numeric, numeric),
  public.admin_update_store(uuid, text, text, text, boolean),
  public.admin_disable_store(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 2B. Fix admin_create_product: replace retailer with brand
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_product(
  p_trend_id uuid,
  p_name text,
  p_availability_status text default 'available',
  p_release_date date default null,
  p_source_url text default null,
  p_brand text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_product_id uuid;
  v_slug text;
  v_brand text := nullif(btrim(p_brand), '');
  v_source_url text := nullif(btrim(p_source_url), '');
begin
  if btrim(p_name) is null or char_length(btrim(p_name)) > 160 then
    raise exception 'Invalid product name' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if p_availability_status not in ('available', 'backorder', 'preorder', 'announced', 'limited', 'retired') then
    raise exception 'Invalid availability status' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if v_source_url is not null and v_source_url !~ '^https://' then
    raise exception 'Invalid source URL' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  v_slug := lower(regexp_replace(btrim(p_name), '[^a-z0-9]+', '-', 'gi'));
  v_slug := trim(both '-' from v_slug);

  insert into public.products (
    trend_id, name, slug, availability_status, release_date, source_url, brand,
    verified_at, verification_method, is_active
  ) values (
    p_trend_id, btrim(p_name), v_slug,
    p_availability_status, p_release_date, v_source_url, v_brand,
    now(),
    case when v_source_url is null then 'owner_verified' else 'official_source' end,
    true
  )
  on conflict (slug) do update set
    name = excluded.name,
    availability_status = excluded.availability_status,
    release_date = excluded.release_date,
    source_url = excluded.source_url,
    brand = excluded.brand,
    verified_at = now(),
    verification_method = excluded.verification_method,
    is_active = true
  returning id into v_product_id;

  return v_product_id;
end;
$$;

-- Re-grant admin product functions
revoke all on function public.admin_create_product(uuid, text, text, date, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_product(uuid, text, text, date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_disable_product(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_product(uuid, text, text, date, text, text),
  public.admin_update_product(uuid, text, text, date, boolean),
  public.admin_disable_product(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 3C. Personal notification permissions: revoke from public/anon
-- ---------------------------------------------------------------------------
revoke all on function public.get_personal_notifications(integer)
  from public, anon;
grant execute on function public.get_personal_notifications(integer)
  to authenticated;

-- Fix notification links to valid routes
create or replace function public.get_personal_notifications(p_limit integer default 20)
returns table (
  id uuid,
  event_type text,
  title text,
  subtitle text,
  link text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false)
  then
    return;
  end if;

  return query
  -- Product suggestion resolution
  select
    ps.id,
    'suggestion_resolved'::text,
    'Product suggestion ' || ps.status,
    ps.name,
    '/drafts',
    coalesce(ps.reviewed_at, ps.created_at)
  from private.product_suggestions ps
  where ps.user_id = v_user_id
    and ps.status in ('approved', 'rejected', 'duplicate')

  union all

  -- Store suggestion resolution
  select
    ss.id,
    'suggestion_resolved'::text,
    'Store suggestion ' || ss.status,
    coalesce(ss.store_name, ss.retailer_name),
    '/drafts',
    coalesce(ss.reviewed_at, ss.created_at)
  from private.store_suggestions ss
  where ss.user_id = v_user_id
    and ss.status in ('approved', 'rejected', 'duplicate')

  union all

  -- Draft state changes
  select
    cd.id,
    'draft_state'::text,
    case cd.state
      when 'ready' then 'Draft ready to submit'
      when 'needs_attention' then 'Draft needs attention'
      else 'Draft updated'
    end,
    case cd.draft_type
      when 'sighting' then 'Sighting draft'
      when 'bounty' then 'Bounty draft'
    end,
    '/drafts',
    cd.updated_at
  from private.contribution_drafts cd
  where cd.user_id = v_user_id
    and cd.state in ('ready', 'needs_attention')

  union all

  -- Bounty claim status changes (for bounty owners)
  select
    bc.id,
    'bounty_claim'::text,
    'Bounty claim ' || bc.status,
    coalesce(p.name, 'Unknown product'),
    '/bounties/' || b.id::text,
    bc.created_at
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  join public.products p on p.id = b.product_id
  where b.user_id = v_user_id
    and bc.status in ('accepted', 'rejected')

  union all

  -- Moderation actions on user's contributions
  select
    me.id,
    'moderation'::text,
    case me.new_status
      when 'approved' then 'Your contribution was approved'
      when 'rejected' then 'Your contribution was rejected'
      when 'hidden' then 'Your contribution was hidden'
      else 'Contribution moderated'
    end,
    case me.contribution_type
      when 'sighting' then 'Sighting'
      when 'bounty' then 'Bounty'
    end,
    case me.contribution_type
      when 'sighting' then '/sightings'
      when 'bounty' then '/bounties/' || me.contribution_id::text
    end,
    me.created_at
  from private.contribution_moderation_events me
  where me.actor_id <> v_user_id
    and exists (
      select 1
      from public.sightings s
      where s.id = me.contribution_id
        and s.user_id = v_user_id
        and me.contribution_type = 'sighting'
      union all
      select 1
      from public.bounties b
      where b.id = me.contribution_id
        and b.user_id = v_user_id
        and me.contribution_type = 'bounty'
    )

  order by occurred_at desc, id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.get_personal_notifications(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_personal_notifications(integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3D. Username partial unique index for non-legacy normalized names
-- ---------------------------------------------------------------------------
create unique index if not exists username_claims_normalized_unique_idx
  on private.username_claims (normalized_username)
  where normalized_username is not null and is_legacy = false;

-- ---------------------------------------------------------------------------
-- 4A. Recreate search_products to include brand
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
      or p.brand ilike '%' || btrim(p_query) || '%'
      or coalesce(p.brand || ' ', '') || p.name ilike '%' || btrim(p_query) || '%'
    )
  order by
    case
      when p.name ilike btrim(p_query) || '%' then 0
      when p.brand ilike btrim(p_query) || '%' then 1
      when t.name ilike btrim(p_query) || '%' then 2
      else 3
    end,
    p.name,
    p.id
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

revoke all on function public.search_products(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_products(text, integer)
to anon, authenticated, service_role;

-- Add index on products brand for search performance
create index if not exists products_brand_idx
  on public.products (brand)
  where brand is not null and is_active;

notify pgrst, 'reload schema';

commit;
