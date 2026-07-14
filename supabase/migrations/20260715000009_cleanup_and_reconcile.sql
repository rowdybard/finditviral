-- Forward cleanup migration: reconcile bounty, draft, claim, and rate-limit contracts.
--
-- Fixes:
-- 1. Rate limit function references public.product_suggestions/store_suggestions
--    but those tables are in private schema — causes runtime error.
-- 2. submit_bounty_claim allows 15 min future but create_sighting allows 5 min.
-- 3. list_public_bounties doesn't return scope_type — frontend can't be scope-aware.
-- 4. bounties_scope_check has redundant clause allowing stores scope with null store_id
--    and no store_ids — tighten to require either store_id or store association rows.
-- 5. list_public_bounties doesn't filter by scope_type for retailers/stores scopes.

begin;

-- 1. Fix rate limit function: reference private schema for suggestion tables
create or replace function private.check_contribution_rate_limit(
  p_user_id uuid,
  p_type text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_limit integer;
  v_count integer;
  v_is_owner boolean;
begin
  select exists (
    select 1 from private.app_owners ao where ao.user_id = p_user_id
  ) into v_is_owner;

  if v_is_owner then return; end if;

  v_limit := case p_type
    when 'sighting' then 10
    when 'bounty' then 5
    when 'suggestion' then 5
    else 10
  end;

  select count(*) into v_count
  from public.sightings s
  where s.user_id = p_user_id
    and s.created_at > now() - interval '1 hour';

  if p_type = 'sighting' and v_count >= v_limit then
    raise exception 'Rate limit exceeded for sightings'
      using errcode = '42901',
            hint = 'You can submit at most ' || v_limit || ' sightings per hour. Please try again later.';
  end if;

  select count(*) into v_count
  from public.bounties b
  where b.user_id = p_user_id
    and b.created_at > now() - interval '1 hour';

  if p_type = 'bounty' and v_count >= v_limit then
    raise exception 'Rate limit exceeded for bounties'
      using errcode = '42901',
            hint = 'You can submit at most ' || v_limit || ' bounties per hour. Please try again later.';
  end if;

  if p_type = 'suggestion' then
    select count(*) into v_count
    from (
      select id from private.product_suggestions ps
      where ps.user_id = p_user_id and ps.created_at > now() - interval '1 hour'
      union all
      select id from private.store_suggestions ss
      where ss.user_id = p_user_id and ss.created_at > now() - interval '1 hour'
    ) t;

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for suggestions'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' suggestions per hour. Please try again later.';
    end if;
  end if;
end;
$$;

-- 2. Fix submit_bounty_claim: 15 min -> 5 min future time check
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

  -- Scope validation: exact store, region radius, or retailer/stores association
  if v_bounty.scope_type = 'stores' and v_bounty.store_id is not null
    and v_bounty.store_id <> v_store.id
  then
    raise exception 'This bounty requires a different store' using errcode = '22023';
  elsif v_bounty.scope_type = 'stores' and v_bounty.store_id is null then
    if not exists (
      select 1 from public.bounty_stores bs
      where bs.bounty_id = v_bounty.id and bs.store_id = v_store.id
    ) then
      raise exception 'This store is not in the bounty scope' using errcode = '22023';
    end if;
  elsif v_bounty.scope_type = 'retailers' then
    if not exists (
      select 1 from public.bounty_retailers br
      join public.stores s on s.retailer_id = br.retailer_id and s.id = v_store.id
      where br.bounty_id = v_bounty.id
    ) then
      raise exception 'This store does not belong to a retailer in the bounty scope' using errcode = '22023';
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
      raise exception 'This store is outside the bounty radius' using errcode = '22023';
    end if;
  end if;

  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '5 minutes'
    or p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown')
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

-- 3. Recreate list_public_bounties with scope_type column
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

-- 4. Tighten bounties_scope_check: remove redundant 4th clause
-- (Cannot use subqueries in CHECK constraints, so we validate association rows via trigger)
alter table public.bounties drop constraint if exists bounties_scope_check;
alter table public.bounties add constraint bounties_scope_check check (
  (scope_type = 'region' and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
  or (scope_type = 'stores' and store_id is not null and zip_code is null and radius_miles is null)
  or (scope_type = 'stores' and store_id is null and zip_code is null and radius_miles is null)
  or (scope_type = 'retailers' and store_id is null and zip_code is null and radius_miles is null)
);

-- Trigger to validate that stores/retailers scope bounties have association rows
create or replace function public.validate_bounty_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  if new.scope_type = 'stores' and new.store_id is null then
    if not exists (select 1 from public.bounty_stores bs where bs.bounty_id = new.id) then
      raise exception 'Bounty with stores scope must have at least one store association' using errcode = '23514';
    end if;
  end if;
  if new.scope_type = 'retailers' then
    if not exists (select 1 from public.bounty_retailers br where br.bounty_id = new.id) then
      raise exception 'Bounty with retailers scope must have at least one retailer association' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_bounty_scope on public.bounties;
create trigger trg_validate_bounty_scope
  after insert or update of scope_type, store_id on public.bounties
  for each row execute function public.validate_bounty_scope();

notify pgrst, 'reload schema';

commit;
