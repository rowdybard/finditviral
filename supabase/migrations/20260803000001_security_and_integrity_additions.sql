-- Security & integrity additions (additive, safe to deploy before frontend changes).
-- Fixes: admin_search_members owner check, legacy create_bounty overloads,
-- new list_my_bounties / list_my_claims RPCs, get_bounty_detail moderation gating,
-- bounty RLS policy recreation, constraint validation, missing FK indexes.

begin;

-- ---------------------------------------------------------------------------
-- A1. Fix admin_search_members: add assert_app_owner (Issue 5)
-- ---------------------------------------------------------------------------
-- Same class of authorization bug already fixed for admin_list_products and
-- admin_list_stores in 20260717000000. The function is SECURITY DEFINER,
-- granted to authenticated, but had no owner assertion.

drop function if exists public.admin_search_members(text, integer);

create or replace function public.admin_search_members(
  p_query text,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  username text,
  karma integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();
  return query
    select p.id, p.username, p.karma, p.created_at
    from public.profiles p
    where nullif(btrim(p_query), '') is null
      or p.username ilike '%' || btrim(p_query) || '%'
    order by case when p.username ilike btrim(p_query) || '%' then 0 else 1 end, p.username
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.admin_search_members(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_members(text, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- A2. Drop legacy create_bounty overloads (Issue 6)
-- ---------------------------------------------------------------------------
-- The 8-param and 11-param overloads lack the contribution-rate-limit check,
-- newer fields (quantity_needed, variant_requirements, accept_equivalent),
-- and retain 90-day deadlines instead of the canonical 30-day limit.
-- The UI only calls the 14-param version.

drop function if exists public.create_bounty(
  uuid, uuid, text, integer, integer, timestamptz, text, uuid
);

drop function if exists public.create_bounty(
  uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, uuid
);

-- ---------------------------------------------------------------------------
-- A3. Add list_my_bounties RPC (replaces direct .from('bounties') in Profile)
-- ---------------------------------------------------------------------------
create or replace function public.list_my_bounties(p_limit integer default 20)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  reward_amount numeric,
  reward_cents integer,
  scope_type text,
  store_id uuid,
  store_name text,
  zip_code text,
  radius_miles integer,
  requirements text,
  quantity_needed integer,
  variant_requirements text,
  accept_equivalent boolean,
  retailer_names text[],
  store_names text[],
  deadline timestamptz,
  status text,
  moderation_status text,
  created_at timestamptz,
  is_owner boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  return query
  select
    b.id,
    b.product_id,
    p.name,
    p.slug,
    b.reward_amount,
    b.reward_cents,
    b.scope_type,
    b.store_id,
    st.name,
    b.zip_code,
    b.radius_miles,
    b.requirements,
    b.quantity_needed,
    b.variant_requirements,
    b.accept_equivalent,
    case
      when b.scope_type = 'retailers' then (
        select array_agg(br_r.name order by br_r.name)
        from public.bounty_retailers br
        join public.retailers br_r on br_r.id = br.retailer_id
        where br.bounty_id = b.id
      )
      else null
    end,
    case
      when b.scope_type = 'stores' and b.store_id is null then (
        select array_agg(bs_s.name order by bs_s.name)
        from public.bounty_stores bs
        join public.stores bs_s on bs_s.id = bs.store_id
        where bs.bounty_id = b.id
      )
      else null
    end,
    b.deadline,
    b.status,
    b.moderation_status,
    b.created_at,
    true
  from public.bounties b
  join public.products p on p.id = b.product_id
  left join public.stores st on st.id = b.store_id
  where b.user_id = v_user_id
  order by b.created_at desc, b.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.list_my_bounties(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_bounties(integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- A4. Add list_my_claims RPC (replaces direct .from('bounty_claims') + embedded
--      bounty:bounties(...) in Profile — would break when SELECT on bounties
--      is revoked in Migration B)
-- ---------------------------------------------------------------------------
create or replace function public.list_my_claims(p_limit integer default 20)
returns table (
  id uuid,
  bounty_id uuid,
  status text,
  created_at timestamptz,
  product_name text,
  product_slug text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  return query
  select
    bc.id,
    bc.bounty_id,
    bc.status,
    bc.created_at,
    p.name,
    p.slug
  from public.bounty_claims bc
  join public.bounties b on b.id = bc.bounty_id
  join public.products p on p.id = b.product_id
  where bc.finder_id = v_user_id
  order by bc.created_at desc, bc.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.list_my_claims(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_claims(integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- A5. Update get_bounty_detail: gate moderation_status for non-owners
-- ---------------------------------------------------------------------------
-- Non-owners see 'approved' for approved bounties (needed for the claim
-- button in BountyDetail.tsx) and null for all other moderation states.
-- Owners and app owners always see the real moderation_status.

drop function if exists public.get_bounty_detail(uuid);

create or replace function public.get_bounty_detail(p_bounty_id uuid)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  store_id uuid,
  store_name text,
  zip_code text,
  radius_miles integer,
  reward_cents integer,
  deadline timestamptz,
  requirements text,
  status text,
  moderation_status text,
  created_at timestamptz,
  owner_username text,
  is_owner boolean,
  caller_claim_id uuid,
  caller_claim_status text,
  owner_contact_info text,
  accepted_finder_contact_info text,
  scope_type text,
  quantity_needed integer,
  variant_requirements text,
  accept_equivalent boolean,
  retailer_names text[],
  store_names text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_is_owner boolean;
  v_is_app_owner boolean;
begin
  -- Determine ownership and app-owner status for moderation_status gating.
  select (b.user_id = v_user_id) into v_is_owner
  from public.bounties b where b.id = p_bounty_id;

  v_is_app_owner := private.is_app_owner(v_user_id);

  return query
  select
    b.id,
    b.product_id,
    p.name,
    p.slug,
    b.store_id,
    st.name,
    b.zip_code,
    b.radius_miles,
    b.reward_cents,
    b.deadline,
    b.requirements,
    b.status,
    case
      when v_is_owner or v_is_app_owner then b.moderation_status
      when b.moderation_status = 'approved' then 'approved'
      else null
    end,
    b.created_at,
    owner_profile.username,
    b.user_id = v_user_id,
    caller_claim.id,
    caller_claim.status,
    case when caller_claim.status = 'accepted' then owner_contact.contact_info end,
    case when b.user_id = v_user_id and accepted_claim.status = 'accepted'
      then finder_contact.contact_info end,
    b.scope_type,
    b.quantity_needed,
    b.variant_requirements,
    b.accept_equivalent,
    case
      when b.scope_type = 'retailers' then (
        select array_agg(br_r.name order by br_r.name)
        from public.bounty_retailers br
        join public.retailers br_r on br_r.id = br.retailer_id
        where br.bounty_id = b.id
      )
      else null
    end,
    case
      when b.scope_type = 'stores' and b.store_id is null then (
        select array_agg(bs_s.name order by bs_s.name)
        from public.bounty_stores bs
        join public.stores bs_s on bs_s.id = bs.store_id
        where bs.bounty_id = b.id
      )
      else null
    end
  from public.bounties b
  join public.products p on p.id = b.product_id
  join public.profiles owner_profile on owner_profile.id = b.user_id
  left join public.stores st on st.id = b.store_id
  left join public.bounty_claims caller_claim
    on caller_claim.bounty_id = b.id and caller_claim.finder_id = v_user_id
  left join public.bounty_claims accepted_claim
    on accepted_claim.bounty_id = b.id and accepted_claim.status = 'accepted'
  left join public.profile_contacts owner_contact on owner_contact.user_id = b.user_id
  left join public.profile_contacts finder_contact on finder_contact.user_id = accepted_claim.finder_id
  where b.id = p_bounty_id
    and (
      (b.moderation_status = 'approved' and b.deadline > now())
      or b.user_id = v_user_id
      or caller_claim.id is not null
    );
end;
$$;

revoke all on function public.get_bounty_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_bounty_detail(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- A6. Recreate bounty RLS policy (live DB still has using (true))
-- ---------------------------------------------------------------------------
-- Ensure the SECURITY DEFINER helper exists (from 20260719000001).
create or replace function private.is_bounty_participant(p_bounty_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
  select exists (
    select 1 from public.bounty_claims bc
    where bc.bounty_id = p_bounty_id and bc.finder_id = p_user_id
  );
$$;

revoke all on function private.is_bounty_participant(uuid, uuid)
  from public, anon, service_role;
grant execute on function private.is_bounty_participant(uuid, uuid)
  to authenticated;

-- Replace the over-broad policy from 20260718000005_fix_rls_recursion.sql.
-- The live database still has using (true); this migration applies the
-- correct approved/owner/participant visibility.
drop policy if exists authenticated_bounties_read on public.bounties;
create policy authenticated_bounties_read
  on public.bounties for select to authenticated
  using (
    moderation_status = 'approved'
    or user_id = (select auth.uid())
    or private.is_bounty_participant(id, (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- A7. Validate NOT VALID constraints (Issue 8)
-- ---------------------------------------------------------------------------
-- Only these 7 constraints exist as NOT VALID in the live database.
-- The legacy *_format names do not exist; their *_check equivalents are
-- already validated.

alter table public.bounties validate constraint bounties_notes_max_length;
alter table public.bounties validate constraint bounties_reward_max_amount;
alter table public.bounties validate constraint bounties_reward_two_decimals;
alter table public.profile_contacts validate constraint profile_contacts_info_max_length;
alter table public.profiles validate constraint profiles_looking_for_max_length;
alter table public.sightings validate constraint sightings_store_name_length;
alter table public.sightings validate constraint sightings_city_max_length;

-- ---------------------------------------------------------------------------
-- A8. Add missing foreign-key indexes (Issue 9)
-- ---------------------------------------------------------------------------

create index if not exists idx_leads_store_id
  on public.leads(store_id);

create index if not exists idx_leads_confirmed_sighting_id
  on public.leads(confirmed_sighting_id);

create index if not exists idx_sightings_lead_id
  on public.sightings(lead_id);

create index if not exists idx_bounties_store_id
  on public.bounties(store_id);

create index if not exists idx_bounty_retailers_retailer_id
  on public.bounty_retailers(retailer_id);

create index if not exists idx_bounty_stores_store_id
  on public.bounty_stores(store_id);

notify pgrst, 'reload schema';

commit;
