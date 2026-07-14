-- Issue 24: Per-user contribution rate limits
--
-- Add check_contribution_rate_limit and call it from create_sighting,
-- create_bounty, suggest_product_for_draft, suggest_store_for_draft.

begin;

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
  -- Owner bypass
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
      select id from public.product_suggestions ps
      where ps.user_id = p_user_id and ps.created_at > now() - interval '1 hour'
      union all
      select id from public.store_suggestions ss
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

-- Recreate create_sighting with rate limit check
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
  v_sighting_id uuid;
  v_store record;
  v_notes text := nullif(btrim(p_notes), '');
begin
  perform private.check_contribution_rate_limit(v_user_id, 'sighting');

  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  select s.id, s.name, s.city, s.state, s.zip_code
  into v_store
  from public.stores s
  where s.id = p_store_id and s.is_active;

  if not found then
    raise exception 'Store is unavailable' using errcode = '22023';
  end if;

  if p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown') then
    raise exception 'Invalid availability value' using errcode = '22023';
  end if;

  if p_quantity is not null and (p_quantity < 1 or p_quantity > 999) then
    raise exception 'Quantity must be between 1 and 999' using errcode = '22023';
  end if;

  if p_seen_at > now() + interval '5 minutes' then
    raise exception 'Sighting time cannot be in the future' using errcode = '22023';
  end if;

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long' using errcode = '22023';
  end if;

  perform private.assert_ready_draft(p_draft_id, v_user_id, 'sighting', p_product_id, p_store_id);

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, moderation_status
  ) values (
    v_user_id, p_product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case when p_availability = 'low_stock' then 'low' when p_availability = 'sold_out' or p_availability = 'unknown' then 'none' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, false, null, 'pending'
  ) returning id into v_sighting_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_id;
end;
$$;

-- Recreate create_bounty with rate limit check (carrying forward Issue 14 params)
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
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  if v_scope = 'region' then
    if p_store_id is not null or p_retailer_ids is not null or p_store_ids is not null
      or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
    then
      raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
    end if;
  elsif v_scope = 'stores' then
    if p_store_id is not null then
      if v_zip is not null or p_radius_miles is not null
        or not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active)
      then
        raise exception 'Choose a valid store' using errcode = '22023';
      end if;
    elsif p_store_ids is not null and array_length(p_store_ids, 1) > 0 then
      if v_zip is not null or p_radius_miles is not null
        or not exists (
          select 1 from public.stores s
          where s.id = any(p_store_ids) and s.is_active
          having count(*) = array_length(p_store_ids, 1)
        )
      then
        raise exception 'Choose valid stores' using errcode = '22023';
      end if;
    else
      raise exception 'Choose at least one store' using errcode = '22023';
    end if;
  elsif v_scope = 'retailers' then
    if p_retailer_ids is null or array_length(p_retailer_ids, 1) is null
      or array_length(p_retailer_ids, 1) = 0
      or p_store_id is not null or v_zip is not null or p_radius_miles is not null
      or not exists (
        select 1 from public.retailers r
        where r.id = any(p_retailer_ids) and r.is_active
        having count(*) = array_length(p_retailer_ids, 1)
      )
    then
      raise exception 'Choose valid retailers' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid scope type' using errcode = '22023';
  end if;

  if p_reward_cents not between 100 and 1000000
    or p_deadline is null
    or p_deadline < now() + interval '1 hour'
    or p_deadline > now() + interval '30 days'
    or (v_requirements is not null and char_length(v_requirements) > 2000)
    or (v_variant_req is not null and char_length(v_variant_req) > 1000)
    or (p_quantity_needed is not null and p_quantity_needed not between 1 and 999)
  then
    raise exception 'Invalid bounty details' using errcode = '22023';
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
    case when v_scope = 'region' then v_zip else null end,
    case when v_scope = 'region' then p_radius_miles else null end,
    v_requirements, v_requirements, p_deadline, 'open', 'pending', v_scope,
    p_quantity_needed, v_variant_req, p_accept_equivalent
  ) returning id into v_bounty_id;

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

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_bounty_id;
end;
$$;

-- Re-grant execute
revoke all on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
to authenticated;

revoke all on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, integer, text, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, integer, text, boolean, uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
