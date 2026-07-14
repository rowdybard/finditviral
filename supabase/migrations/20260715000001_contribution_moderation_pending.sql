-- Issue 3: Contribution moderation (pending → approve)
--
-- New sightings and bounties are now created with moderation_status = 'pending'
-- and is_public = false (sightings). The admin_set_contribution_moderation RPC
-- gains an 'approve' action that sets moderation_status = 'approved' and
-- is_public = true (sightings). The 'restore' action also sets is_public = true.

begin;

-- Recreate create_sighting with pending moderation
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
    or p_availability not in ('low', 'medium', 'high')
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
    case when p_availability = 'low' then 'low' else 'in_stock' end,
    p_availability, p_quantity, v_notes, p_seen_at, false, null, 'pending'
  ) returning id into v_sighting_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_sighting_id;
end;
$$;

-- Recreate create_bounty with pending moderation
create or replace function public.create_bounty(
  p_product_id uuid,
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_reward_cents integer default null,
  p_deadline timestamptz default null,
  p_requirements text default null,
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
begin
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  if p_store_id is not null then
    if v_zip is not null or p_radius_miles is not null
      or not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active)
    then
      raise exception 'Choose either one store or a ZIP radius' using errcode = '22023';
    end if;
  elsif v_zip is null or v_zip !~ '^[0-9]{5}$'
    or p_radius_miles not in (10, 25, 50, 100, 250)
    or not exists (
      select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI'
    )
  then
    raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
  end if;

  if p_reward_cents not between 100 and 1000000
    or p_deadline is null
    or p_deadline < now() + interval '1 hour'
    or p_deadline > now() + interval '90 days'
    or (v_requirements is not null and char_length(v_requirements) > 2000)
  then
    raise exception 'Invalid bounty details' using errcode = '22023';
  end if;

  perform private.assert_ready_draft(
    p_draft_id, v_user_id, 'bounty', p_product_id, p_store_id
  );

  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status
  ) values (
    v_user_id, p_product_id, p_store_id,
    p_reward_cents::numeric / 100, p_reward_cents,
    case when p_store_id is null then v_zip else null end,
    case when p_store_id is null then p_radius_miles else null end,
    v_requirements, v_requirements, p_deadline, 'open', 'pending'
  ) returning id into v_bounty_id;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_bounty_id;
end;
$$;

-- Recreate admin_set_contribution_moderation with 'approve' action
create or replace function public.admin_set_contribution_moderation(
  p_contribution_type text,
  p_contribution_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_previous_status text;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_status text;
begin
  if p_contribution_type not in ('sighting', 'bounty')
    or p_action not in ('approve', 'hide', 'restore', 'reject')
    or (v_reason is not null and char_length(v_reason) > 500)
  then
    raise exception 'Invalid moderation action' using errcode = '22023';
  end if;

  v_new_status := case p_action
    when 'hide' then 'hidden'
    when 'reject' then 'rejected'
    else 'approved'
  end;

  if p_contribution_type = 'sighting' then
    select s.moderation_status into v_previous_status
    from public.sightings s where s.id = p_contribution_id for update;
    if not found then raise exception 'Sighting not found' using errcode = 'P0002'; end if;
    update public.sightings
    set moderation_status = v_new_status,
        is_public = (p_action in ('approve', 'restore')),
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  else
    select b.moderation_status into v_previous_status
    from public.bounties b where b.id = p_contribution_id for update;
    if not found then raise exception 'Bounty not found' using errcode = 'P0002'; end if;
    update public.bounties
    set moderation_status = v_new_status,
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  end if;

  insert into private.contribution_moderation_events (
    contribution_type, contribution_id, actor_id, previous_status, new_status, reason
  ) values (
    p_contribution_type, p_contribution_id, v_owner_id, v_previous_status, v_new_status, v_reason
  );
end;
$$;

-- Re-grant execute on recreated functions (signatures unchanged)
revoke all on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_bounty(uuid, uuid, text, integer, integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_contribution_moderation(text, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_sighting(uuid, uuid, timestamptz, text, integer, text, uuid),
  public.create_bounty(uuid, uuid, text, integer, integer, timestamptz, text, uuid)
to authenticated;

grant execute on function public.admin_set_contribution_moderation(text, uuid, text, text)
to authenticated;

notify pgrst, 'reload schema';

commit;
