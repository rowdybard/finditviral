-- Launch blocker and non-blocker fixes:
-- 1. sync_lead_confirmation_from_sighting: set status='active' when unconfirming
-- 2. submit_bounty_claim: restrict to in_stock/low_stock, remove p_photo_urls
-- 3. get_lead_detail: reject expired leads for non-owner access
-- 4. vote_on_lead: reject votes on expired leads
-- 5. create_lead: reject past expected_date, require HTTPS source_url
-- 6. sighting-photos bucket: enforce file_size_limit and allowed_mime_types

begin;

-- ---------------------------------------------------------------------------
-- 1. Fix sync_lead_confirmation_from_sighting to set status='active' when
--    an approved confirmation sighting is hidden or rejected.
-- ---------------------------------------------------------------------------

create or replace function private.sync_lead_confirmation_from_sighting()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.lead_id is null or new.moderation_status = old.moderation_status then
    return new;
  end if;

  if new.moderation_status = 'approved' then
    update public.leads
    set status = 'confirmed', updated_at = now()
    where id = new.lead_id
      and confirmed_sighting_id = new.id
      and status = 'active';
  elsif old.moderation_status in ('pending', 'approved')
    and new.moderation_status in ('rejected', 'hidden') then
    update public.leads
    set status = 'active', confirmed_sighting_id = null, updated_at = now()
    where id = new.lead_id
      and confirmed_sighting_id = new.id
      and status = 'confirmed';

    update public.leads
    set confirmed_sighting_id = null, updated_at = now()
    where id = new.lead_id
      and confirmed_sighting_id = new.id
      and status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists sightings_sync_lead_confirmation on public.sightings;
create trigger sightings_sync_lead_confirmation
after update of moderation_status on public.sightings
for each row
execute function private.sync_lead_confirmation_from_sighting();

revoke all on function private.sync_lead_confirmation_from_sighting()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Recreate submit_bounty_claim without p_photo_urls and restrict
--    availability to in_stock and low_stock only.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_bounty_claim(
  uuid, uuid, timestamptz, text, integer, text, text[]
);

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
    or p_availability not in ('in_stock', 'low_stock')
    or (p_quantity is not null and p_quantity not between 1 and 99)
    or (v_notes is not null and char_length(v_notes) > 2000)
  then
    raise exception 'Invalid claim sighting' using errcode = '22023', hint = 'INVALID_CLAIM';
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
    end,
    p_availability, p_quantity, v_notes, p_seen_at, false,
    v_bounty.id, 'approved', null
  ) returning id into v_sighting_id;

  insert into public.bounty_claims (bounty_id, finder_id, sighting_id)
  values (v_bounty.id, v_user_id, v_sighting_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

revoke all on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, uuid, timestamptz, text, integer, text)
  to authenticated;

-- Re-grant the compatibility wrapper (signature unchanged, but be safe)
revoke all on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bounty_claim(uuid, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_lead_detail: reject expired leads for non-owner access.
-- ---------------------------------------------------------------------------

create or replace function public.get_lead_detail(
  p_lead_slug text
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  slug text,
  headline text,
  details text,
  expected_date date,
  scope_type text,
  store_id uuid,
  store_name text,
  store_slug text,
  store_city text,
  store_state text,
  zip_code text,
  radius_miles integer,
  source_type text,
  source_url text,
  status text,
  confirmed_sighting_id uuid,
  confirmed_store_name text,
  confirmed_seen_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  username text,
  is_owner boolean,
  caller_vote text,
  credible_count bigint,
  doubtful_count bigint,
  net_score bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  return query
  select
    l.id,
    p.id,
    p.name,
    p.slug,
    l.slug,
    l.headline,
    l.details,
    l.expected_date,
    l.scope_type,
    l.store_id,
    st.name,
    st.slug,
    st.city,
    st.state,
    l.zip_code,
    l.radius_miles,
    l.source_type,
    l.source_url,
    l.status,
    l.confirmed_sighting_id,
    cs.store_name,
    cs.seen_at,
    l.expires_at,
    l.created_at,
    pr.username,
    (l.user_id = v_user_id),
    lv.vote,
    coalesce(vc.credible_count, 0),
    coalesce(vc.doubtful_count, 0),
    coalesce(vc.credible_count, 0) - coalesce(vc.doubtful_count, 0)
  from public.leads l
  join public.products p on p.id = l.product_id
  left join public.stores st on st.id = l.store_id
  left join public.sightings cs on cs.id = l.confirmed_sighting_id
  left join public.profiles pr on pr.id = l.user_id
  left join public.lead_votes lv on lv.lead_id = l.id and lv.user_id = v_user_id
  left join (
    select
      lead_id,
      count(*) filter (where vote = 'credible') as credible_count,
      count(*) filter (where vote = 'doubtful') as doubtful_count
    from public.lead_votes
    group by lead_id
  ) vc on vc.lead_id = l.id
  where l.slug = p_lead_slug
    and (
      (l.status in ('active', 'confirmed') and l.expires_at > now())
      or (l.user_id = v_user_id and l.status in ('pending', 'hidden'))
    );
end;
$$;

revoke all on function public.get_lead_detail(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_lead_detail(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. vote_on_lead: reject votes on expired leads.
-- ---------------------------------------------------------------------------

create or replace function public.vote_on_lead(
  p_lead_id uuid,
  p_vote text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead public.leads%rowtype;
begin
  if p_vote not in ('credible', 'doubtful') then
    raise exception 'Invalid vote value' using errcode = '22023';
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_lead.status not in ('active', 'confirmed') then
    raise exception 'Voting is only available on active or confirmed leads' using errcode = '55000';
  end if;

  if v_lead.expires_at <= now() then
    raise exception 'Lead has expired' using errcode = '55000';
  end if;

  insert into public.lead_votes (lead_id, user_id, vote, created_at, updated_at)
  values (p_lead_id, v_user_id, p_vote, now(), now())
  on conflict (lead_id, user_id)
  do update set vote = excluded.vote, updated_at = now();
end;
$$;

revoke all on function public.vote_on_lead(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.vote_on_lead(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_lead: reject past expected_date and require HTTPS source_url.
-- ---------------------------------------------------------------------------

create or replace function public.create_lead(
  p_product_id uuid,
  p_headline text,
  p_details text default null,
  p_expected_date date default null,
  p_scope_type text default 'region',
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_source_type text default 'other',
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead_id uuid;
  v_headline text := nullif(btrim(p_headline), '');
  v_details text := nullif(btrim(p_details), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_zip text := nullif(btrim(p_zip_code), '');
  v_scope text := coalesce(p_scope_type, 'region');
  v_slug text;
  v_product public.products%rowtype;
  v_expires_at timestamptz;
  v_store public.stores%rowtype;
begin
  perform private.check_contribution_rate_limit(v_user_id, 'lead');

  if v_headline is null or char_length(v_headline) < 3 then
    raise exception 'Headline is required (3-140 characters)' using errcode = '22023';
  end if;
  if char_length(v_headline) > 140 then
    raise exception 'Headline must be 140 characters or fewer' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 2000 then
    raise exception 'Details must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if v_source_url is not null then
    if char_length(v_source_url) > 2000 then
      raise exception 'Source URL is too long' using errcode = '22023';
    end if;
    if v_source_url !~ '^https://' then
      raise exception 'Source URL must use HTTPS' using errcode = '22023';
    end if;
  end if;
  if p_expected_date is not null and p_expected_date < current_date then
    raise exception 'Expected date cannot be in the past' using errcode = '22023';
  end if;
  if p_source_type not in ('employee_tip', 'social_media', 'press_release', 'restock_schedule', 'other') then
    raise exception 'Invalid source type' using errcode = '22023';
  end if;

  select * into v_product from public.products p where p.id = p_product_id and p.is_active;
  if not found then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  if v_scope = 'stores' then
    if p_store_id is null or v_zip is not null or p_radius_miles is not null then
      raise exception 'Store scope requires a store and no ZIP/radius' using errcode = '22023';
    end if;
    select * into v_store from public.stores s where s.id = p_store_id and s.is_active;
    if not found then
      raise exception 'Store is unavailable' using errcode = '22023';
    end if;
  elsif v_scope = 'region' then
    if p_store_id is not null or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
    then
      raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid scope type' using errcode = '22023';
  end if;

  v_expires_at := coalesce(
    (p_expected_date + interval '7 days')::timestamptz,
    now() + interval '14 days'
  );

  v_slug := private.slugify(v_product.name || '-' || v_headline);
  if exists (select 1 from public.leads l where l.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.leads (
    user_id, product_id, slug, headline, details, expected_date,
    scope_type, store_id, zip_code, radius_miles,
    source_type, source_url, status, expires_at
  ) values (
    v_user_id, p_product_id, v_slug, v_headline, v_details, p_expected_date,
    v_scope,
    case when v_scope = 'stores' then v_store.id else null end,
    case when v_scope = 'region' then v_zip else null end,
    case when v_scope = 'region' then p_radius_miles else null end,
    p_source_type, v_source_url, 'pending', v_expires_at
  ) returning id into v_lead_id;

  return v_lead_id;
end;
$$;

revoke all on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storage bucket: enforce file_size_limit and allowed_mime_types.
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = '{"image/jpeg", "image/png", "image/webp"}'
where id = 'sighting-photos';

notify pgrst, 'reload schema';

commit;
