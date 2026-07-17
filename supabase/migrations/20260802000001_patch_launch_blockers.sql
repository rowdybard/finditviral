-- Close moderation and edit-time integrity gaps.  These triggers protect all
-- mutation paths, not just the member RPCs.
begin;

create or replace function private.requeue_changed_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  if tg_table_name = 'bounties' and (
    (to_jsonb(new)->>'requirements') is distinct from (to_jsonb(old)->>'requirements') or
    (to_jsonb(new)->>'variant_requirements') is distinct from (to_jsonb(old)->>'variant_requirements')
  ) then
    delete from private.content_moderation_results where contribution_type = 'bounty' and contribution_id = new.id;
    new.moderation_status := 'pending';
    new.moderated_at := null;
    new.moderated_by := null;
  elsif tg_table_name = 'leads' and (
    (to_jsonb(new)->>'headline') is distinct from (to_jsonb(old)->>'headline') or
    (to_jsonb(new)->>'details') is distinct from (to_jsonb(old)->>'details') or
    (to_jsonb(new)->>'source_type') is distinct from (to_jsonb(old)->>'source_type') or
    (to_jsonb(new)->>'source_url') is distinct from (to_jsonb(old)->>'source_url')
  ) then
    delete from private.content_moderation_results where contribution_type = 'lead' and contribution_id = new.id;
    new.status := 'pending';
  elsif tg_table_name = 'sightings' and (to_jsonb(new)->>'notes') is distinct from (to_jsonb(old)->>'notes') then
    delete from private.content_moderation_results where contribution_type = 'sighting' and contribution_id = new.id;
    new.moderation_status := 'pending';
    new.is_public := false;
    new.moderated_at := null;
    new.moderated_by := null;
  end if;
  return new;
end;
$$;

create or replace function private.queue_new_sighting_notes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  if nullif(btrim(new.notes), '') is not null and new.lead_id is null and new.bounty_id is null then
    new.moderation_status := 'pending';
    new.is_public := false;
  end if;
  return new;
end;
$$;

drop trigger if exists requeue_changed_bounty on public.bounties;
create trigger requeue_changed_bounty before update on public.bounties for each row execute function private.requeue_changed_contribution();
drop trigger if exists requeue_changed_lead on public.leads;
create trigger requeue_changed_lead before update on public.leads for each row execute function private.requeue_changed_contribution();
drop trigger if exists requeue_changed_sighting on public.sightings;
create trigger requeue_changed_sighting before update on public.sightings for each row execute function private.requeue_changed_contribution();
drop trigger if exists queue_new_sighting_notes on public.sightings;
create trigger queue_new_sighting_notes before insert on public.sightings for each row execute function private.queue_new_sighting_notes();

-- A claim freezes the offer.  Only an extension can be made after that point.
create or replace function public.update_bounty(
  p_bounty_id uuid, p_requirements text default null, p_reward_cents integer default null,
  p_deadline timestamptz default null, p_quantity_needed integer default null,
  p_variant_requirements text default null, p_accept_equivalent boolean default null
) returns void language plpgsql security definer set search_path = pg_catalog, private, public, pg_temp as $$
declare v_user_id uuid := private.assert_permanent_member(); v_bounty public.bounties%rowtype;
begin
  select * into v_bounty from public.bounties where id = p_bounty_id for update;
  if not found then raise exception 'Bounty not found' using errcode = 'P0002'; end if;
  if v_bounty.user_id <> v_user_id or v_bounty.status <> 'open' then raise exception 'Only the open bounty owner can edit this bounty' using errcode = '42501'; end if;
  if exists (select 1 from public.bounty_claims where bounty_id = v_bounty.id) then
    if p_deadline is null or p_deadline <= v_bounty.deadline or p_requirements is not null or p_reward_cents is not null or p_quantity_needed is not null or p_variant_requirements is not null or p_accept_equivalent is not null then
      raise exception 'A bounty with claims only permits a deadline extension' using errcode = '55000';
    end if;
    update public.bounties set deadline = p_deadline where id = v_bounty.id;
    return;
  end if;
  if p_deadline is not null and (p_deadline < now() + interval '1 hour' or p_deadline > now() + interval '30 days') then raise exception 'Invalid deadline' using errcode = '22023'; end if;
  if p_reward_cents is not null and (p_reward_cents < 100 or p_reward_cents > 1000000) then raise exception 'Invalid reward' using errcode = '22023'; end if;
  if p_quantity_needed is not null and p_quantity_needed not between 1 and 999 then raise exception 'Invalid quantity' using errcode = '22023'; end if;
  if nullif(btrim(p_requirements), '') is not null and char_length(btrim(p_requirements)) > 2000 then raise exception 'Invalid requirements' using errcode = '22023'; end if;
  if nullif(btrim(p_variant_requirements), '') is not null and char_length(btrim(p_variant_requirements)) > 1000 then raise exception 'Invalid variant requirements' using errcode = '22023'; end if;
  update public.bounties set requirements = coalesce(nullif(btrim(p_requirements), ''), requirements), reward_cents = coalesce(p_reward_cents, reward_cents), reward_amount = coalesce(p_reward_cents::numeric / 100, reward_amount), deadline = coalesce(p_deadline, deadline), quantity_needed = coalesce(p_quantity_needed, quantity_needed), variant_requirements = coalesce(nullif(btrim(p_variant_requirements), ''), variant_requirements), accept_equivalent = coalesce(p_accept_equivalent, accept_equivalent) where id = v_bounty.id;
end; $$;

revoke all on function public.update_bounty(uuid, text, integer, timestamptz, integer, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_bounty(uuid, text, integer, timestamptz, integer, text, boolean) to authenticated;

create or replace function public.delete_bounty(p_bounty_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, private, public, pg_temp as $$
declare v_user_id uuid := private.assert_permanent_member(); v_bounty public.bounties%rowtype;
begin
  select * into v_bounty from public.bounties where id = p_bounty_id for update;
  if not found then raise exception 'Bounty not found' using errcode = 'P0002'; end if;
  if v_bounty.user_id <> v_user_id then raise exception 'Only the bounty owner can delete this bounty' using errcode = '42501'; end if;
  if exists (select 1 from public.bounty_claims where bounty_id = v_bounty.id) then raise exception 'A bounty with claims cannot be deleted' using errcode = '55000'; end if;
  delete from public.bounties where id = v_bounty.id;
end; $$;

revoke all on function public.delete_bounty(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_bounty(uuid) to authenticated;

-- Lead edits now retain creation-time temporal and URL invariants.
create or replace function public.update_lead(
  p_lead_id uuid, p_headline text default null, p_details text default null,
  p_expected_date timestamptz default null, p_source_type text default null, p_source_url text default null
) returns void language plpgsql security definer set search_path = pg_catalog, private, public, pg_temp as $$
declare v_user_id uuid := private.assert_permanent_member(); v_lead public.leads%rowtype; v_headline text := nullif(btrim(p_headline), ''); v_details text := nullif(btrim(p_details), ''); v_url text := nullif(btrim(p_source_url), ''); v_date date := p_expected_date::date;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.user_id <> v_user_id or v_lead.status in ('confirmed', 'hidden') then raise exception 'Only an editable lead owner can edit this lead' using errcode = '42501'; end if;
  if v_headline is null or char_length(v_headline) not between 3 and 140 or (v_details is not null and char_length(v_details) > 2000) then raise exception 'Invalid lead text' using errcode = '22023'; end if;
  if v_date is not null and v_date < current_date then raise exception 'Expected date cannot be in the past' using errcode = '22023'; end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~ '^https://') then raise exception 'Source URL must use HTTPS' using errcode = '22023'; end if;
  if p_source_type not in ('employee_tip', 'social_media', 'press_release', 'restock_schedule', 'other') then raise exception 'Invalid source type' using errcode = '22023'; end if;
  delete from public.lead_votes where lead_id = v_lead.id;
  update public.leads set headline = v_headline, details = v_details, expected_date = v_date, source_type = p_source_type, source_url = v_url, expires_at = coalesce((v_date + interval '7 days')::timestamptz, now() + interval '14 days'), edited_at = now(), updated_at = now() where id = v_lead.id;
end; $$;

revoke all on function public.update_lead(uuid, text, text, timestamptz, text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_lead(uuid, text, text, timestamptz, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
