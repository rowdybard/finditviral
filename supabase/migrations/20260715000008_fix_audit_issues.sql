-- Post-audit fixes: rate limits on suggestion functions, get_bounty_detail new columns

begin;

-- 1. Recreate suggest_product_for_draft with rate limit check
create or replace function public.suggest_product_for_draft(
  p_draft_id uuid default null,
  p_draft_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_name text default null,
  p_brand text default null,
  p_source_url text default null,
  p_store_id uuid default null
)
returns table (draft_id uuid, suggestion_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_draft_id uuid;
  v_suggestion_id uuid;
  v_name text := btrim(p_name);
  v_brand text := nullif(btrim(p_brand), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_store_id uuid := p_store_id;
begin
  perform private.check_contribution_rate_limit(v_user_id, 'suggestion');

  if v_name is null or char_length(v_name) not between 2 and 160
    or (v_brand is not null and char_length(v_brand) > 120)
    or (v_source_url is not null and v_source_url !~ '^https://')
  then
    raise exception 'Invalid product suggestion' using errcode = '22023';
  end if;

  if p_draft_id is not null and v_store_id is null then
    select d.store_id into v_store_id
    from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  end if;

  v_draft_id := public.save_contribution_draft(
    p_draft_id,
    p_draft_type,
    p_payload,
    null,
    v_store_id
  );

  insert into private.product_suggestions (user_id, name, brand, source_url)
  values (v_user_id, v_name, v_brand, v_source_url)
  returning id into v_suggestion_id;

  update private.contribution_drafts d
  set product_id = null,
      product_suggestion_id = v_suggestion_id,
      state = 'waiting_for_approval',
      updated_at = now(),
      expires_at = now() + interval '90 days'
  where d.id = v_draft_id and d.user_id = v_user_id;

  return query select v_draft_id, v_suggestion_id;
end;
$$;

-- 2. Recreate suggest_store_for_draft with rate limit check
create or replace function public.suggest_store_for_draft(
  p_draft_id uuid default null,
  p_draft_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_product_id uuid default null,
  p_retailer_name text default null,
  p_store_name text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_state text default null,
  p_zip_code text default null,
  p_source_url text default null,
  p_notes text default null
)
returns table (draft_id uuid, suggestion_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_draft_id uuid;
  v_suggestion_id uuid;
  v_retailer text := btrim(p_retailer_name);
  v_store text := nullif(btrim(p_store_name), '');
  v_address text := btrim(p_address_line1);
  v_city text := btrim(p_city);
  v_state text := upper(btrim(p_state));
  v_zip text := btrim(p_zip_code);
  v_phone text := nullif(btrim(p_notes), '');
  v_source text := nullif(btrim(p_source_url), '');
  v_product_id uuid := p_product_id;
begin
  perform private.check_contribution_rate_limit(v_user_id, 'suggestion');

  if v_retailer is null or char_length(v_retailer) not between 1 and 120
    or v_address is null or char_length(v_address) not between 1 and 160
    or v_city is null or char_length(v_city) not between 1 and 100
    or v_state !~ '^[A-Z]{2}$'
    or v_zip !~ '^[0-9]{5}$'
    or (v_source is not null and v_source !~ '^https://')
    or (v_phone is not null and char_length(v_phone) > 40)
  then
    raise exception 'Invalid store suggestion' using errcode = '22023';
  end if;

  if p_draft_id is not null and v_product_id is null then
    select d.product_id into v_product_id
    from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  end if;

  v_draft_id := public.save_contribution_draft(
    p_draft_id,
    p_draft_type,
    p_payload,
    v_product_id,
    null
  );

  insert into private.store_suggestions (
    user_id, retailer_name, store_name, address_line1, city, state,
    zip_code, phone, source_url
  ) values (
    v_user_id, v_retailer, v_store, v_address, v_city, v_state,
    v_zip, v_phone, v_source
  ) returning id into v_suggestion_id;

  update private.contribution_drafts d
  set store_id = null,
      store_suggestion_id = v_suggestion_id,
      state = 'waiting_for_approval',
      updated_at = now(),
      expires_at = now() + interval '90 days'
  where d.id = v_draft_id and d.user_id = v_user_id;

  return query select v_draft_id, v_suggestion_id;
end;
$$;

-- 3. Recreate get_bounty_detail with new columns
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
  accept_equivalent boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
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
    b.store_id,
    st.name,
    b.zip_code,
    b.radius_miles,
    b.reward_cents,
    b.deadline,
    b.requirements,
    b.status,
    b.moderation_status,
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
    b.accept_equivalent
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

-- Re-grant execute on recreated functions
revoke all on function public.suggest_product_for_draft(uuid, text, jsonb, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.suggest_store_for_draft(uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_bounty_detail(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.suggest_product_for_draft(uuid, text, jsonb, text, text, text, uuid),
  public.suggest_store_for_draft(uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text),
  public.get_bounty_detail(uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
