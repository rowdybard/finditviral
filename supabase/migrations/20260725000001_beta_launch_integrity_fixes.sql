-- Beta launch integrity fixes:
-- B1: create_sightings_batch missing 7-day past-date validation
-- B3: consume_public_request_limit breaks with modern sb_secret_ keys (auth.jwt() check)
-- B4: admin_list_recent_contributions hides approved/active leads from admin queue
-- B5: sync_lead_confirmation_from_sighting doesn't unconfirm lead when approved sighting is hidden
-- M1: validate_draft_payload photo limit mismatch (6 vs 4)

begin;

-- ---------------------------------------------------------------------------
-- B1: Add 7-day past-date check to create_sightings_batch
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
  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '5 minutes'
  then
    raise exception 'Invalid sighting time' using errcode = '22023';
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

revoke all on function public.create_sightings_batch(uuid, uuid[], timestamptz, text, integer, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_sightings_batch(uuid, uuid[], timestamptz, text, integer, text, uuid, text[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- B3: Remove auth.jwt() role check from consume_public_request_limit
-- Modern sb_secret_ keys are not JWT-based, so auth.jwt() returns null and
-- the check raises 42501. The EXECUTE grant restricted to service_role is
-- the correct authorization mechanism.
-- ---------------------------------------------------------------------------

create or replace function public.consume_public_request_limit(
  p_scope text,
  p_key_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_primary_count integer := 0;
  v_daily_count integer := 0;
begin
  if p_scope not in ('early_access', 'product_click') then
    raise exception 'Unknown rate-limit scope' using errcode = '22023';
  end if;

  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key' using errcode = '22023';
  end if;

  -- Opportunistic bounded cleanup keeps the private table from growing forever.
  delete from private.public_request_rate_limits r
  where r.updated_at < v_now - interval '2 days';

  if p_scope = 'early_access' then
    -- Always lock the daily window before the shorter window to avoid deadlocks.
    perform pg_advisory_xact_lock(
      hashtextextended('public-rate:early_access_daily:' || p_key_hash, 0)
    );
    perform pg_advisory_xact_lock(
      hashtextextended('public-rate:early_access_primary:' || p_key_hash, 0)
    );

    select case
      when r.window_started_at > v_now - interval '1 day' then r.request_count
      else 0
    end
    into v_daily_count
    from private.public_request_rate_limits r
    where r.scope = 'early_access_daily' and r.key_hash = p_key_hash;

    select case
      when r.window_started_at > v_now - interval '10 minutes' then r.request_count
      else 0
    end
    into v_primary_count
    from private.public_request_rate_limits r
    where r.scope = 'early_access_primary' and r.key_hash = p_key_hash;

    v_daily_count := coalesce(v_daily_count, 0);
    v_primary_count := coalesce(v_primary_count, 0);

    if v_daily_count >= 20 or v_primary_count >= 5 then
      return false;
    end if;

    insert into private.public_request_rate_limits as existing
      (scope, key_hash, window_started_at, request_count, updated_at)
    values ('early_access_daily', p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set request_count = case
            when existing.window_started_at <= v_now - interval '1 day' then 1
            else existing.request_count + 1
          end,
          window_started_at = case
            when existing.window_started_at <= v_now - interval '1 day' then v_now
            else existing.window_started_at
          end,
          updated_at = v_now;

    insert into private.public_request_rate_limits as existing
      (scope, key_hash, window_started_at, request_count, updated_at)
    values ('early_access_primary', p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set request_count = case
            when existing.window_started_at <= v_now - interval '10 minutes' then 1
            else existing.request_count + 1
          end,
          window_started_at = case
            when existing.window_started_at <= v_now - interval '10 minutes' then v_now
            else existing.window_started_at
          end,
          updated_at = v_now;

    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public-rate:product_click:' || p_key_hash, 0)
  );

  select case
    when r.window_started_at > v_now - interval '10 minutes' then r.request_count
    else 0
  end
  into v_primary_count
  from private.public_request_rate_limits r
  where r.scope = 'product_click' and r.key_hash = p_key_hash;

  v_primary_count := coalesce(v_primary_count, 0);

  if v_primary_count >= 60 then
    return false;
  end if;

  insert into private.public_request_rate_limits as existing
    (scope, key_hash, window_started_at, request_count, updated_at)
  values ('product_click', p_key_hash, v_now, 1, v_now)
  on conflict (scope, key_hash) do update
    set request_count = case
          when existing.window_started_at <= v_now - interval '10 minutes' then 1
          else existing.request_count + 1
        end,
        window_started_at = case
          when existing.window_started_at <= v_now - interval '10 minutes' then v_now
          else existing.window_started_at
        end,
        updated_at = v_now;

  return true;
end;
$$;

revoke all on function public.consume_public_request_limit(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_public_request_limit(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- B4: Remove status = 'pending' filter from admin_list_recent_contributions
-- leads branch so admins can see and moderate approved/active leads too.
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
  ) recent
  order by occurred_at desc, contribution_id
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

revoke all on function public.admin_list_recent_contributions(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_recent_contributions(integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- B5: Broaden sync_lead_confirmation_from_sighting to handle approved -> hidden/rejected
-- When an approved confirmation sighting is later hidden or rejected, reset
-- the lead to active and clear confirmed_sighting_id.
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
    set confirmed_sighting_id = null, updated_at = now()
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
-- M1: Fix draft validator photo limit from 6 to 4 to match PhotoUpload and
-- assert_owned_sighting_photo_paths enforcement.
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
      'version', 'product', 'store', 'selectedStores', 'seenAt', 'availability',
      'quantity', 'notes', 'photoUrls',
      'productSuggestionName', 'storeSuggestionName'
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
  then
    raise exception 'Unsupported contribution draft version'
      using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
  end if;

  if p_draft_type = 'sighting' then
    if (p_payload ->> 'version') not in ('1', '2') then
      raise exception 'Unsupported contribution draft version'
        using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
    end if;
  else
    if (p_payload ->> 'version') <> '1' then
      raise exception 'Unsupported contribution draft version'
        using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
    end if;
  end if;

  if p_payload ? 'notes' and char_length(coalesce(p_payload ->> 'notes', '')) > 2000 then
    raise exception 'Draft notes are too long' using errcode = '22023';
  end if;
  if p_payload ? 'requirements' and char_length(coalesce(p_payload ->> 'requirements', '')) > 2000 then
    raise exception 'Draft requirements are too long' using errcode = '22023';
  end if;

  -- Sighting-specific: validate photoUrls
  if p_draft_type = 'sighting' then
    if p_payload ? 'photoUrls' then
      declare v_photos jsonb := p_payload -> 'photoUrls'; begin
        if jsonb_typeof(v_photos) = 'array' and jsonb_array_length(v_photos) > 4 then
          raise exception 'Too many photos' using errcode = '22023';
        end if;
        if jsonb_typeof(v_photos) = 'array' then
          declare v_photo text; begin
            for v_photo in select jsonb_array_elements_text(v_photos)
            loop
              if char_length(v_photo) > 2048 then
                raise exception 'Photo URL is too long' using errcode = '22023';
              end if;
            end loop;
          end;
        end if;
      end;
    end if;
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

notify pgrst, 'reload schema';

commit;
