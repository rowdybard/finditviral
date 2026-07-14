-- Issue 11: Sighting availability values
--
-- Replace low/medium/high with in_stock/low_stock/sold_out/unknown.
-- Backfill existing rows, update constraints, and recreate affected RPCs.

begin;

-- Backfill existing sightings
update public.sightings
set availability = case availability
    when 'low' then 'low_stock'
    when 'medium' then 'in_stock'
    when 'high' then 'in_stock'
    else 'unknown'
  end
where availability in ('low', 'medium', 'high');

-- Update constraint
alter table public.sightings drop constraint if exists sightings_availability_check;
alter table public.sightings add constraint sightings_availability_check
  check (availability in ('in_stock', 'low_stock', 'sold_out', 'unknown'));

-- Recreate create_sighting with new availability values (carrying forward pending moderation)
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
    or p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown')
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
    case p_availability
      when 'in_stock' then 'in_stock'
      when 'low_stock' then 'low'
      when 'sold_out' then 'none'
      when 'unknown' then 'none'
    end,
    p_availability, p_quantity, v_notes, p_seen_at, false, null, 'pending'
  ) returning id into v_sighting_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_id;
end;
$$;

-- Recreate submit_bounty_claim with new availability values
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

-- Recreate compatibility wrapper for submit_bounty_claim
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
    case when p_stock_level in ('low', 'none') then 'low_stock' else 'in_stock' end,
    null,
    null
  );
end;
$$;

-- Re-grant execute on recreated functions
revoke all on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
to authenticated;

grant execute on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text),
  public.submit_bounty_claim(uuid, text, text, text, text, text)
to authenticated;

notify pgrst, 'reload schema';

commit;
