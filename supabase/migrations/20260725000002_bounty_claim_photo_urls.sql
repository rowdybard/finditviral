-- H3: Add photo_urls support to submit_bounty_claim
-- Bounty claims are private between participants, but photos help the bounty
-- owner verify the claim.

begin;

-- Drop the old signature so the new one with p_photo_urls replaces it
drop function if exists public.submit_bounty_claim(
  uuid, uuid, timestamptz, text, integer, text
);

create or replace function public.submit_bounty_claim(
  p_bounty_id uuid,
  p_store_id uuid,
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_photo_urls text[] default null
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

  if p_photo_urls is not null and array_length(p_photo_urls, 1) > 4 then
    raise exception 'Too many photos' using errcode = '22023';
  end if;

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, moderation_status, photo_urls
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
    v_bounty.id, 'approved', p_photo_urls
  ) returning id into v_sighting_id;

  insert into public.bounty_claims (bounty_id, finder_id, sighting_id)
  values (v_bounty.id, v_user_id, v_sighting_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

-- Re-grant submit_bounty_claim (new signature with photo_urls)
revoke all on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text, text[])
  to authenticated;

-- The compatibility wrapper (uuid, text, text, text, text, text) calls the
-- main variant internally. Its internal call uses positional args so the
-- new default parameter is picked up automatically. Re-grant to be safe.
revoke all on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
