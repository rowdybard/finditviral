-- Fix: admin_set_lead_moderation 'restore' should respect confirmed state.
-- Previously, restore always set status = 'active' and never touched
-- confirmed_sighting_id, so a confirmed → hidden → restored lead showed
-- "Unconfirmed Lead" while still carrying a stale confirmed_sighting_id.

begin;

create or replace function public.admin_set_lead_moderation(
  p_lead_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_previous_status text;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_status text;
  v_confirmed_sighting_id uuid;
  v_sighting_approved boolean := false;
begin
  if p_action not in ('approve', 'hide', 'restore')
    or (v_reason is not null and char_length(v_reason) > 500)
  then
    raise exception 'Invalid moderation action' using errcode = '22023';
  end if;

  v_new_status := case p_action
    when 'hide' then 'hidden'
    when 'restore' then 'active'
    else 'active'
  end;

  select l.status, l.confirmed_sighting_id
    into v_previous_status, v_confirmed_sighting_id
  from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  -- On restore: if the lead had a confirmed sighting that is still approved,
  -- restore to 'confirmed' instead of 'active'. Otherwise clear the stale pointer.
  if p_action = 'restore' and v_confirmed_sighting_id is not null then
    select (s.moderation_status = 'approved') into v_sighting_approved
    from public.sightings s where s.id = v_confirmed_sighting_id;

    if v_sighting_approved then
      v_new_status := 'confirmed';
    else
      v_confirmed_sighting_id := null;
    end if;
  end if;

  update public.leads
  set status = v_new_status,
    confirmed_sighting_id = case
      when p_action = 'restore' then v_confirmed_sighting_id
      else confirmed_sighting_id
    end,
    moderated_by = v_owner_id,
    moderated_at = now(),
    updated_at = now()
  where id = p_lead_id;

  insert into private.contribution_moderation_events (
    contribution_type, contribution_id, actor_id, previous_status, new_status, reason
  ) values (
    'lead', p_lead_id, v_owner_id, v_previous_status, v_new_status, v_reason
  );
end;
$$;

-- Re-apply grants (function signature unchanged, but grants need to survive the recreate)
revoke all on function public.admin_set_lead_moderation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_lead_moderation(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
