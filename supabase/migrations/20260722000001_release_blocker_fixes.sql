-- Release blockers: Lead write hardening, moderation, confirmation, and batch sightings.

begin;

-- ---------------------------------------------------------------------------
-- 1. Leads and votes are writable only through their security-definer RPCs.
-- ---------------------------------------------------------------------------

drop policy if exists leads_self_insert on public.leads;
drop policy if exists leads_self_update on public.leads;
drop policy if exists lead_votes_self_insert on public.lead_votes;
drop policy if exists lead_votes_self_update on public.lead_votes;
drop policy if exists lead_votes_self_delete on public.lead_votes;

revoke insert, update, delete on public.leads from authenticated;
revoke insert, update, delete on public.lead_votes from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Remove the non-functional Lead retailer scope.
-- ---------------------------------------------------------------------------

update public.leads
set scope_type = 'region'
where scope_type = 'retailers';

alter table public.leads drop constraint if exists leads_scope_check;
alter table public.leads add constraint leads_scope_check check (
  (scope_type = 'stores' and store_id is not null and zip_code is null and radius_miles is null)
  or (scope_type = 'region' and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
);

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
  if v_source_url is not null and char_length(v_source_url) > 2000 then
    raise exception 'Source URL is too long' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 3. Leads join the pending moderation queue.
-- ---------------------------------------------------------------------------

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
set search_path = pg_catalog, private, public, pg_temp
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
    union all
    select 'lead'::text, l.id, pr.username, p.name, l.status,
      null::text, l.created_at
    from public.leads l
    join public.profiles pr on pr.id = l.user_id
    join public.products p on p.id = l.product_id
    where l.status = 'pending'
  ) recent
  order by occurred_at desc, contribution_id
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Confirmation sightings must be in scope and moderator approved.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_lead_with_sighting(
  p_lead_id uuid,
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
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead public.leads%rowtype;
  v_store public.stores%rowtype;
  v_sighting_id uuid;
  v_notes text := nullif(btrim(p_notes), '');
  v_scope_distance numeric;
begin
  select * into v_lead from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_lead.status <> 'active' then
    raise exception 'Lead is not active' using errcode = '55000';
  end if;
  if v_lead.expires_at <= now() then
    raise exception 'Lead has expired' using errcode = '55000';
  end if;
  if v_lead.confirmed_sighting_id is not null then
    raise exception 'A confirmation is already awaiting moderation' using errcode = '55000';
  end if;
  if p_availability not in ('in_stock', 'low_stock') then
    raise exception 'Only in-stock sightings can confirm a lead' using errcode = '22023';
  end if;
  if p_quantity is not null and (p_quantity < 1 or p_quantity > 99) then
    raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
  end if;
  if p_seen_at is null or p_seen_at < now() - interval '7 days' or p_seen_at > now() + interval '5 minutes' then
    raise exception 'Invalid sighting time' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long' using errcode = '22023';
  end if;

  select * into v_store from public.stores s where s.id = p_store_id and s.is_active;
  if not found then
    raise exception 'Store is unavailable' using errcode = '22023';
  end if;

  if v_lead.scope_type = 'stores' then
    if v_lead.store_id <> v_store.id then
      raise exception 'Sighting store is outside the Lead scope' using errcode = '22023';
    end if;
  else
    select private.distance_miles(lz.latitude, lz.longitude, sz.latitude, sz.longitude)
    into v_scope_distance
    from public.zip_codes lz
    join public.zip_codes sz on sz.zip_code = v_store.zip_code
    where lz.zip_code = v_lead.zip_code;

    if v_scope_distance is null or v_scope_distance > v_lead.radius_miles then
      raise exception 'Sighting store is outside the Lead scope' using errcode = '22023';
    end if;
  end if;

  perform private.check_contribution_rate_limit(v_user_id, 'sighting');

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, lead_id, moderation_status, photo_urls
  ) values (
    v_user_id, v_lead.product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case when p_availability = 'low_stock' then 'low' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, false, null, v_lead.id, 'pending',
    p_photo_urls
  ) returning id into v_sighting_id;

  update public.leads
  set confirmed_sighting_id = v_sighting_id,
    updated_at = now()
  where id = v_lead.id;

  return v_sighting_id;
end;
$$;

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
  elsif old.moderation_status = 'pending'
    and new.moderation_status in ('rejected', 'hidden') then
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
-- 5. Multi-store sightings are all-or-nothing.
-- ---------------------------------------------------------------------------

create or replace function public.create_sightings_batch(
  p_product_id uuid,
  p_store_ids uuid[],
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_draft_id uuid default null,
  p_photo_urls text[] default null
)
returns uuid[]
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_notes text := nullif(btrim(p_notes), '');
  v_store public.stores%rowtype;
  v_store_id uuid;
  v_sighting_id uuid;
  v_sighting_ids uuid[] := '{}'::uuid[];
begin
  if p_store_ids is null or array_length(p_store_ids, 1) is null
    or array_length(p_store_ids, 1) = 0
    or array_length(p_store_ids, 1) <> cardinality(array(select distinct unnest(p_store_ids)))
  then
    raise exception 'Choose at least one unique store' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.is_active) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;
  if p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown') then
    raise exception 'Invalid availability value' using errcode = '22023';
  end if;
  if p_quantity is not null and (p_quantity < 1 or p_quantity > 999) then
    raise exception 'Quantity must be between 1 and 999' using errcode = '22023';
  end if;
  if p_seen_at is null or p_seen_at > now() + interval '5 minutes' then
    raise exception 'Sighting time cannot be in the future' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long' using errcode = '22023';
  end if;

  perform private.assert_ready_draft(p_draft_id, v_user_id, 'sighting', p_product_id, p_store_ids[1]);

  foreach v_store_id in array p_store_ids loop
    perform private.check_contribution_rate_limit(v_user_id, 'sighting');

    select * into v_store from public.stores s where s.id = v_store_id and s.is_active;
    if not found then
      raise exception 'Store is unavailable' using errcode = '22023';
    end if;

    insert into public.sightings (
      user_id, product_id, store_id, store_name, city, state, zip_code,
      stock_level, availability, quantity, notes, seen_at, is_public,
      bounty_id, moderation_status, photo_urls
    ) values (
      v_user_id, p_product_id, v_store.id, v_store.name, v_store.city,
      v_store.state, v_store.zip_code,
      case when p_availability = 'low_stock' then 'low' when p_availability in ('sold_out', 'unknown') then 'none' else 'in_stock' end,
      p_availability, p_quantity, v_notes, p_seen_at, false, null, 'pending', p_photo_urls
    ) returning id into v_sighting_id;

    v_sighting_ids := array_append(v_sighting_ids, v_sighting_id);
  end loop;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC grants after signature changes.
-- ---------------------------------------------------------------------------

revoke all on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  to authenticated;

revoke all on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text, text[])
  to authenticated;

revoke all on function public.create_sightings_batch(uuid, uuid[], timestamptz, text, integer, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_sightings_batch(uuid, uuid[], timestamptz, text, integer, text, uuid, text[])
  to authenticated;

notify pgrst, 'reload schema';

commit;
