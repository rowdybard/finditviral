-- Issue 10: Sighting freshness 7 days → 72 hours
-- Adds a freshness classification function and updates list_public_sightings
-- to filter at 72 hours and return a freshness_status column.

create or replace function private.sighting_freshness(p_seen_at timestamptz)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  case
    when p_seen_at >= now() - interval '24 hours' then 'fresh'
    when p_seen_at >= now() - interval '72 hours' then 'possibly_outdated'
    else 'expired'
  end
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
  distance_miles numeric,
  freshness_status text
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
    round(distance.value::numeric, 1),
    private.sighting_freshness(si.seen_at)
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
    and si.seen_at >= now() - interval '72 hours'
    and (p_product_id is null or si.product_id = p_product_id)
    and (p_store_id is null or si.store_id = p_store_id)
    and (
      p_zip_code is null
      or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
    )
  order by si.seen_at desc, si.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Re-grant execute on the recreated function (signature unchanged).
revoke all on function public.list_public_sightings(uuid, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_sightings(uuid, uuid, text, integer, integer)
  to anon, authenticated, service_role;
