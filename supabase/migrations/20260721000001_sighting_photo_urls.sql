-- Add photo_urls support to create_sighting and confirm_lead_with_sighting
-- Also create the sighting-photos storage bucket with RLS policies.

begin;

-- ---------------------------------------------------------------------------
-- 1. Recreate create_sighting with p_photo_urls parameter
-- ---------------------------------------------------------------------------

create or replace function public.create_sighting(
  p_product_id uuid,
  p_store_id uuid,
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_draft_id uuid default null,
  p_photo_urls text[] default null
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
    bounty_id, moderation_status, photo_urls
  ) values (
    v_user_id, p_product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case when p_availability = 'low_stock' then 'low' when p_availability = 'sold_out' or p_availability = 'unknown' then 'none' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, false, null, 'pending',
    p_photo_urls
  ) returning id into v_sighting_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Recreate confirm_lead_with_sighting with p_photo_urls parameter
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

  if p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown') then
    raise exception 'Invalid availability value' using errcode = '22023';
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

  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, lead_id, moderation_status, photo_urls
  ) values (
    v_user_id, v_lead.product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case p_availability
      when 'in_stock' then 'in_stock'
      when 'low_stock' then 'low'
      when 'sold_out' then 'none'
      when 'unknown' then 'none'
    end,
    p_availability, p_quantity, v_notes, p_seen_at, true, null, v_lead.id, 'approved',
    p_photo_urls
  ) returning id into v_sighting_id;

  update public.leads
  set status = 'confirmed',
    confirmed_sighting_id = v_sighting_id,
    updated_at = now()
  where id = p_lead_id;

  return v_sighting_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-grant execute on recreated functions
-- ---------------------------------------------------------------------------

revoke all on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid, text[])
  to authenticated;

revoke all on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text, text[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Create sighting-photos storage bucket with RLS policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('sighting-photos', 'sighting-photos', true)
on conflict (id) do nothing;

-- RLS: users can upload to their own folder
create policy "Users upload own sighting photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- RLS: public can read all sighting photos
create policy "Public read sighting photos"
  on storage.objects for select
  to public
  using (bucket_id = 'sighting-photos');

-- RLS: users can delete their own photos
create policy "Users delete own sighting photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';

commit;
