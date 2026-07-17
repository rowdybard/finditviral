-- Allow members to edit and delete their own leads and sightings.
-- Follows the same SECURITY DEFINER pattern as update_bounty / delete_bounty.

begin;

-- ---------------------------------------------------------------------------
-- Add edited_at columns
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists edited_at timestamptz;
alter table public.sightings add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------------------
-- update_lead: owner can edit headline, details, expected_date, source_type, source_url
-- Cannot edit confirmed or hidden leads. Resets all votes on save.
-- ---------------------------------------------------------------------------
create or replace function public.update_lead(
  p_lead_id uuid,
  p_headline text default null,
  p_details text default null,
  p_expected_date timestamptz default null,
  p_source_type text default null,
  p_source_url text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead public.leads%rowtype;
  v_headline text := nullif(btrim(p_headline), '');
  v_details text := nullif(btrim(p_details), '');
  v_source_url text := nullif(btrim(p_source_url), '');
begin
  select * into v_lead
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if v_lead.user_id <> v_user_id then
    raise exception 'Only the lead owner can edit this lead' using errcode = '42501';
  end if;
  if v_lead.status in ('confirmed', 'hidden') then
    raise exception 'Cannot edit a confirmed or hidden lead' using errcode = '55000';
  end if;

  -- Validate provided fields
  if v_headline is null or char_length(v_headline) < 3 or char_length(v_headline) > 140 then
    raise exception 'Headline must be between 3 and 140 characters' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 2000 then
    raise exception 'Details must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if v_source_url is not null and char_length(v_source_url) > 2000 then
    raise exception 'Source URL must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in ('employee_tip', 'social_media', 'press_release', 'restock_schedule', 'other') then
    raise exception 'Invalid source type' using errcode = '22023';
  end if;

  -- Reset all votes on the lead
  delete from public.lead_votes where lead_id = v_lead.id;

  update public.leads set
    headline = v_headline,
    details = v_details,
    expected_date = p_expected_date::date,
    source_type = p_source_type,
    source_url = v_source_url,
    edited_at = now(),
    updated_at = now()
  where id = v_lead.id;
end;
$$;

revoke all on function public.update_lead(uuid, text, text, timestamptz, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_lead(uuid, text, text, timestamptz, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- delete_lead: owner can delete their own lead
-- Cannot delete confirmed leads. Cascade deletes lead_votes.
-- ---------------------------------------------------------------------------
create or replace function public.delete_lead(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead public.leads%rowtype;
begin
  select * into v_lead
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if v_lead.user_id <> v_user_id then
    raise exception 'Only the lead owner can delete this lead' using errcode = '42501';
  end if;
  if v_lead.status = 'confirmed' then
    raise exception 'Cannot delete a confirmed lead' using errcode = '55000';
  end if;

  delete from public.lead_votes where lead_id = v_lead.id;
  delete from public.leads where id = v_lead.id;
end;
$$;

revoke all on function public.delete_lead(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_lead(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_sighting: owner can edit notes, quantity, availability
-- Cannot edit sightings linked to bounty claims or lead confirmations.
-- Resets all verifications on save.
-- ---------------------------------------------------------------------------
create or replace function public.update_sighting(
  p_sighting_id uuid,
  p_notes text default null,
  p_quantity integer default null,
  p_availability text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_sighting public.sightings%rowtype;
  v_notes text := nullif(btrim(p_notes), '');
begin
  select * into v_sighting
  from public.sightings s
  where s.id = p_sighting_id
  for update;

  if not found then
    raise exception 'Sighting not found' using errcode = 'P0002';
  end if;
  if v_sighting.user_id <> v_user_id then
    raise exception 'Only the sighting owner can edit this sighting' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.bounty_claims bc
    where bc.sighting_id = v_sighting.id
  ) then
    raise exception 'Cannot edit a sighting linked to a bounty claim' using errcode = '55000';
  end if;
  if v_sighting.lead_id is not null and exists (
    select 1 from public.leads l
    where l.confirmed_sighting_id = v_sighting.id
  ) then
    raise exception 'Cannot edit a sighting that confirmed a lead' using errcode = '55000';
  end if;

  -- Validate provided fields
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if p_quantity is not null and (p_quantity < 1 or p_quantity > 99) then
    raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
  end if;
  if p_availability is not null and p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown') then
    raise exception 'Invalid availability value' using errcode = '22023';
  end if;

  -- Reset all verifications on the sighting
  delete from private.sighting_verifications where sighting_id = v_sighting.id;

  update public.sightings set
    notes = v_notes,
    quantity = p_quantity,
    availability = p_availability,
    stock_level = case
      when coalesce(p_availability, availability::text) = 'in_stock' then 'in_stock'
      when coalesce(p_availability, availability::text) = 'low_stock' then 'low'
      when coalesce(p_availability, availability::text) in ('sold_out', 'unknown') then 'none'
      else stock_level
    end,
    edited_at = now()
  where id = v_sighting.id;
end;
$$;

revoke all on function public.update_sighting(uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_sighting(uuid, text, integer, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
