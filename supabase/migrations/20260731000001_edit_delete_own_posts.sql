-- Allow members to edit and delete their own bounties and sightings.
-- Follows the same SECURITY DEFINER pattern as close_bounty.

begin;

-- ---------------------------------------------------------------------------
-- update_bounty: owner can edit requirements, reward, deadline, and details
-- Only allowed when bounty is open and no claim has been accepted.
-- ---------------------------------------------------------------------------
create or replace function public.update_bounty(
  p_bounty_id uuid,
  p_requirements text default null,
  p_reward_cents integer default null,
  p_deadline timestamptz default null,
  p_quantity_needed integer default null,
  p_variant_requirements text default null,
  p_accept_equivalent boolean default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_bounty public.bounties%rowtype;
  v_requirements text := nullif(btrim(p_requirements), '');
  v_variant_req text := nullif(btrim(p_variant_requirements), '');
begin
  select * into v_bounty
  from public.bounties b
  where b.id = p_bounty_id
  for update;

  if not found then
    raise exception 'Bounty not found' using errcode = 'P0002';
  end if;
  if v_bounty.user_id <> v_user_id then
    raise exception 'Only the bounty owner can edit this bounty' using errcode = '42501';
  end if;
  if v_bounty.status not in ('open') then
    raise exception 'Only open bounties can be edited' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.bounty_claims bc
    where bc.bounty_id = v_bounty.id and bc.status = 'accepted'
  ) then
    raise exception 'Cannot edit a bounty with an accepted claim' using errcode = '55000';
  end if;

  -- Validate provided fields
  if p_reward_cents is not null and (p_reward_cents < 100 or p_reward_cents > 1000000) then
    raise exception 'Reward must be between $1 and $10,000' using errcode = '22023';
  end if;
  if p_deadline is not null and (p_deadline < now() + interval '1 hour' or p_deadline > now() + interval '30 days') then
    raise exception 'Deadline must be between 1 hour and 30 days from now' using errcode = '22023';
  end if;
  if v_requirements is not null and char_length(v_requirements) > 2000 then
    raise exception 'Requirements must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if v_variant_req is not null and char_length(v_variant_req) > 1000 then
    raise exception 'Variant requirements must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if p_quantity_needed is not null and (p_quantity_needed < 1 or p_quantity_needed > 999) then
    raise exception 'Quantity needed must be between 1 and 999' using errcode = '22023';
  end if;

  update public.bounties set
    requirements = coalesce(v_requirements, requirements),
    reward_cents = coalesce(p_reward_cents, reward_cents),
    reward_amount = coalesce(p_reward_cents::numeric / 100, reward_amount),
    deadline = coalesce(p_deadline, deadline),
    quantity_needed = coalesce(p_quantity_needed, quantity_needed),
    variant_requirements = coalesce(v_variant_req, variant_requirements),
    accept_equivalent = coalesce(p_accept_equivalent, accept_equivalent)
  where id = v_bounty.id;
end;
$$;

revoke all on function public.update_bounty(uuid, text, integer, timestamptz, integer, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_bounty(uuid, text, integer, timestamptz, integer, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- delete_bounty: owner can delete their own bounty
-- Only allowed when no claim has been accepted. Cascade deletes claims.
-- ---------------------------------------------------------------------------
create or replace function public.delete_bounty(p_bounty_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_bounty public.bounties%rowtype;
begin
  select * into v_bounty
  from public.bounties b
  where b.id = p_bounty_id
  for update;

  if not found then
    raise exception 'Bounty not found' using errcode = 'P0002';
  end if;
  if v_bounty.user_id <> v_user_id then
    raise exception 'Only the bounty owner can delete this bounty' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.bounty_claims bc
    where bc.bounty_id = v_bounty.id and bc.status = 'accepted'
  ) then
    raise exception 'Cannot delete a bounty with an accepted claim' using errcode = '55000';
  end if;

  delete from public.bounties where id = v_bounty.id;
end;
$$;

revoke all on function public.delete_bounty(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_bounty(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- delete_sighting: owner can delete their own sighting
-- Not allowed if the sighting is linked to a bounty claim or lead confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.delete_sighting(p_sighting_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_sighting public.sightings%rowtype;
begin
  select * into v_sighting
  from public.sightings s
  where s.id = p_sighting_id
  for update;

  if not found then
    raise exception 'Sighting not found' using errcode = 'P0002';
  end if;
  if v_sighting.user_id <> v_user_id then
    raise exception 'Only the sighting owner can delete this sighting' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.bounty_claims bc
    where bc.sighting_id = v_sighting.id
  ) then
    raise exception 'Cannot delete a sighting linked to a bounty claim' using errcode = '55000';
  end if;
  if v_sighting.lead_id is not null and exists (
    select 1 from public.leads l
    where l.confirmed_sighting_id = v_sighting.id
  ) then
    raise exception 'Cannot delete a sighting that confirmed a lead' using errcode = '55000';
  end if;

  delete from public.sightings where id = v_sighting.id;
end;
$$;

revoke all on function public.delete_sighting(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_sighting(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
