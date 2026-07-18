-- Fix regressions from the profile/bounty RPC patch:
-- 1. get_bounty_detail: add app-owner visibility so admins can view any bounty
-- 2. list_my_bounties: add notes column that was missing from the original

begin;

-- ---------------------------------------------------------------------------
-- 1. Fix get_bounty_detail: add app-owner visibility
-- ---------------------------------------------------------------------------
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
      or v_is_app_owner
    );
end;
$$;

revoke all on function public.get_bounty_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_bounty_detail(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Recreate list_my_bounties with notes column
-- ---------------------------------------------------------------------------
drop function if exists public.list_my_bounties(integer);

create function public.list_my_bounties(p_limit integer default 20)
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
  notes text,
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
    b.notes,
    b.requirements,
    b.quantity_needed,
    b.variant_requirements,
    b.accept_equivalent,
    case
      when b.scope_type = 'retailers' then (
        select array_agg(r.name order by r.name)
        from public.bounty_retailers br
        join public.retailers r on r.id = br.retailer_id
        where br.bounty_id = b.id
      )
      else null
    end,
    case
      when b.scope_type = 'stores' and b.store_id is null then (
        select array_agg(s.name order by s.name)
        from public.bounty_stores bs
        join public.stores s on s.id = bs.store_id
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
-- 3. Revoke column-level SELECT grants from 20260714015817
-- ---------------------------------------------------------------------------
-- Migration B (20260803000002) revoked table-level SELECT on profiles and
-- bounties from authenticated. However, column-level grants from
-- 20260714015817_greater_lansing_open_beta_launch.sql remain. PostgreSQL's
-- has_table_privilege() returns true if the role has SELECT on any single
-- column, so the column-level grants must also be revoked.

revoke select (
  id, user_id, product_id, reward_amount, reward_cents, store_id, zip_code,
  radius_miles, notes, requirements, deadline, status, moderation_status,
  created_at
) on public.bounties from authenticated;

revoke select (
  id, username, karma, is_pro, created_at
) on public.profiles from authenticated;

notify pgrst, 'reload schema';

commit;
