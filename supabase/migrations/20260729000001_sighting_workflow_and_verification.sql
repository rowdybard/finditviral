-- Trusted sighting publication, idempotent submission, review counts,
-- community verification, and service-only orphan photo discovery.

begin;

-- ---------------------------------------------------------------------------
-- 1. Make the base sighting table fail closed and attach client idempotency.
-- ---------------------------------------------------------------------------

alter table public.sightings
  add column if not exists client_submission_id uuid;

alter table public.sightings
  alter column is_public set default false,
  alter column moderation_status set default 'pending';

-- Repair legacy rows before validating the stricter visibility invariant.
-- Bounty evidence is always private, and non-approved content is never public.
update public.sightings
set is_public = false
where is_public
  and (moderation_status <> 'approved' or bounty_id is not null);

-- Normal sightings created during the blanket-pending period can be trusted
-- when every referenced catalog entity is still active and verified. Lead
-- confirmations and bounty evidence intentionally remain in their workflows.
update public.sightings si
set moderation_status = 'approved',
    is_public = true,
    moderated_by = null,
    moderated_at = null,
    moderation_reason = null
from public.products p
join public.trends t on t.id = p.trend_id and t.is_active
join public.stores st on st.is_active
join public.retailers r on r.id = st.retailer_id and r.is_active
where si.product_id = p.id
  and si.store_id = st.id
  and si.bounty_id is null
  and si.lead_id is null
  and si.moderation_status = 'pending'
  and not si.is_public
  and p.is_active
  and p.verified_at is not null
  and p.availability_status <> 'retired';

alter table public.sightings
  drop constraint if exists sightings_visibility_workflow_check;
alter table public.sightings
  add constraint sightings_visibility_workflow_check
  check (
    not is_public
    or (moderation_status = 'approved' and bounty_id is null)
  ) not valid;
alter table public.sightings
  validate constraint sightings_visibility_workflow_check;

alter table public.sightings
  drop constraint if exists sightings_client_submission_workflow_check;
alter table public.sightings
  add constraint sightings_client_submission_workflow_check
  check (
    client_submission_id is null
    or (store_id is not null and bounty_id is null and lead_id is null)
  ) not valid;
alter table public.sightings
  validate constraint sightings_client_submission_workflow_check;

create unique index if not exists sightings_client_submission_store_key
  on public.sightings (user_id, client_submission_id, store_id)
  where client_submission_id is not null;

create index if not exists sightings_pending_review_idx
  on public.sightings (created_at, id)
  where moderation_status = 'pending';
create index if not exists bounties_pending_review_idx
  on public.bounties (created_at, id)
  where moderation_status = 'pending';
create index if not exists leads_pending_review_idx
  on public.leads (created_at, id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Store one current verification response per member and keep it private.
-- ---------------------------------------------------------------------------

create table if not exists private.sighting_verifications (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid not null
    references public.sightings(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  response text not null
    check (response in ('verified', 'not_found')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sighting_verifications_sighting_user_key
    unique (sighting_id, user_id),
  constraint sighting_verifications_timestamp_check
    check (updated_at >= created_at)
);

create index if not exists sighting_verifications_sighting_response_updated_idx
  on private.sighting_verifications (sighting_id, response, updated_at desc);
create index if not exists sighting_verifications_user_updated_idx
  on private.sighting_verifications (user_id, updated_at desc);

alter table private.sighting_verifications enable row level security;
revoke all on table private.sighting_verifications
  from public, anon, authenticated, service_role;

create or replace function private.sighting_community_state(
  p_verified_count bigint,
  p_not_found_count bigint,
  p_latest_responses text[]
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(p_not_found_count, 0) >= 2
      and p_latest_responses[1] = 'not_found'
      and p_latest_responses[2] = 'not_found'
      then 'possibly_gone'
    when coalesce(p_verified_count, 0) > 0
      and p_latest_responses[1] = 'verified'
      then 'community_verified'
    when coalesce(p_verified_count, 0) > 0
      and coalesce(p_not_found_count, 0) > 0
      then 'disputed'
    when coalesce(p_not_found_count, 0) > 0
      then 'not_found_reported'
    else 'unverified'
  end
$$;

revoke all on function private.sighting_community_state(bigint, bigint, text[])
  from public, anon, authenticated, service_role;

create or replace function private.sighting_verification_summaries(
  p_sighting_ids uuid[],
  p_caller_id uuid
)
returns table (
  sighting_id uuid,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  viewer_response text
)
language sql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
  with requested as (
    select distinct requested_id as sighting_id
    from unnest(coalesce(p_sighting_ids, '{}'::uuid[])) as ids(requested_id)
    where requested_id is not null
  ), aggregated as (
    select
      sv.sighting_id,
      count(*) filter (where sv.response = 'verified') as verified_count,
      count(*) filter (where sv.response = 'not_found') as not_found_count,
      max(sv.updated_at) filter (where sv.response = 'verified') as last_verified_at,
      max(sv.updated_at) filter (where sv.response = 'not_found') as last_not_found_at,
      array_agg(sv.response order by sv.updated_at desc, sv.user_id) as latest_responses
    from private.sighting_verifications sv
    join requested r on r.sighting_id = sv.sighting_id
    group by sv.sighting_id
  )
  select
    r.sighting_id,
    coalesce(a.verified_count, 0::bigint),
    coalesce(a.not_found_count, 0::bigint),
    a.last_verified_at,
    a.last_not_found_at,
    private.sighting_community_state(
      coalesce(a.verified_count, 0::bigint),
      coalesce(a.not_found_count, 0::bigint),
      a.latest_responses
    ),
    caller.response
  from requested r
  left join aggregated a on a.sighting_id = r.sighting_id
  left join private.sighting_verifications caller
    on caller.sighting_id = r.sighting_id
   and caller.user_id = p_caller_id
$$;

revoke all on function private.sighting_verification_summaries(uuid[], uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Submit normal sightings through a trusted, idempotent v2 RPC.
-- ---------------------------------------------------------------------------

create or replace function public.submit_sightings_v2(
  p_submission_id uuid,
  p_product_id uuid,
  p_store_ids uuid[],
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_draft_id uuid default null,
  p_photo_urls text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_notes text := nullif(btrim(p_notes), '');
  v_store public.stores%rowtype;
  v_store_id uuid;
  v_sighting_id uuid;
  v_sighting_ids uuid[] := '{}'::uuid[];
  v_existing_count bigint;
  v_existing_payload_matches boolean;
  v_existing_store_ids uuid[];
  v_requested_store_ids uuid[];
begin
  if p_submission_id is null then
    raise exception 'Client submission ID is required'
      using errcode = '22023', hint = 'CLIENT_SUBMISSION_ID_REQUIRED';
  end if;

  if p_store_ids is null
    or array_ndims(p_store_ids) <> 1
    or cardinality(p_store_ids) = 0
    or array_position(p_store_ids, null) is not null
    or cardinality(p_store_ids) <>
      (select count(distinct requested_store) from unnest(p_store_ids) as stores(requested_store))
  then
    raise exception 'Choose at least one unique store'
      using errcode = '22023', hint = 'INVALID_STORES';
  end if;

  v_requested_store_ids := array(
    select requested_store
    from unnest(p_store_ids) as stores(requested_store)
    order by requested_store
  );

  -- Serialize the same member/key pair. This closes the race between the
  -- lookup and the multi-row insert without blocking unrelated submissions.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_submission_id::text, 0)
  );

  select
    count(*),
    bool_and(
      s.product_id = p_product_id
      and s.seen_at = p_seen_at
      and s.availability = p_availability
      and (s.quantity is not distinct from p_quantity)
      and (s.notes is not distinct from v_notes)
      and (s.photo_urls is not distinct from p_photo_urls)
      and s.bounty_id is null
      and s.lead_id is null
    ),
    array_agg(s.store_id order by s.store_id)
  into v_existing_count, v_existing_payload_matches, v_existing_store_ids
  from public.sightings s
  where s.user_id = v_user_id
    and s.client_submission_id = p_submission_id;

  if v_existing_count > 0 then
    if v_existing_count <> cardinality(p_store_ids)
      or not coalesce(v_existing_payload_matches, false)
      or v_existing_store_ids is distinct from v_requested_store_ids
    then
      raise exception 'Client submission ID was already used with a different payload'
        using errcode = '22023', hint = 'IDEMPOTENCY_CONFLICT';
    end if;

    select array_agg(s.id order by requested.ordinality)
    into v_sighting_ids
    from unnest(p_store_ids) with ordinality as requested(store_id, ordinality)
    join public.sightings s
      on s.user_id = v_user_id
     and s.client_submission_id = p_submission_id
     and s.store_id = requested.store_id;

    return jsonb_build_object(
      'sighting_ids', to_jsonb(v_sighting_ids),
      'moderation_status', 'approved',
      'is_public', true,
      'replayed', true
    );
  end if;

  perform 1
  from public.products p
  join public.trends t on t.id = p.trend_id and t.is_active
  where p.id = p_product_id
    and p.is_active
    and p.verified_at is not null
    and p.availability_status <> 'retired'
  for key share of p, t;
  if not found then
    raise exception 'Product is unavailable; submit it for catalog approval first'
      using errcode = '22023', hint = 'PRODUCT_REQUIRES_APPROVAL';
  end if;

  if p_availability not in ('in_stock', 'low_stock', 'sold_out', 'unknown') then
    raise exception 'Invalid availability value'
      using errcode = '22023', hint = 'INVALID_AVAILABILITY';
  end if;
  if p_quantity is not null and (p_quantity < 1 or p_quantity > 99) then
    raise exception 'Quantity must be between 1 and 99'
      using errcode = '22023', hint = 'INVALID_QUANTITY';
  end if;
  if p_seen_at is null
    or p_seen_at < now() - interval '7 days'
    or p_seen_at > now() + interval '5 minutes'
  then
    raise exception 'Invalid sighting time'
      using errcode = '22023', hint = 'INVALID_SIGHTING_TIME';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long'
      using errcode = '22023', hint = 'NOTES_TOO_LONG';
  end if;

  perform private.assert_ready_draft(
    p_draft_id,
    v_user_id,
    'sighting',
    p_product_id,
    p_store_ids[1]
  );

  foreach v_store_id in array p_store_ids loop
    select * into v_store
    from public.stores s
    where s.id = v_store_id
      and s.is_active
      and exists (
        select 1 from public.retailers r
        where r.id = s.retailer_id and r.is_active
      )
    for key share;
    if not found then
      raise exception 'Store is unavailable'
        using errcode = '22023', hint = 'STORE_UNAVAILABLE';
    end if;

    perform private.check_contribution_rate_limit(v_user_id, 'sighting');

    insert into public.sightings (
      user_id, product_id, store_id, store_name, city, state, zip_code,
      stock_level, availability, quantity, notes, seen_at, is_public,
      bounty_id, lead_id, moderation_status, photo_urls,
      client_submission_id
    ) values (
      v_user_id, p_product_id, v_store.id, v_store.name, v_store.city,
      v_store.state, v_store.zip_code,
      case
        when p_availability = 'low_stock' then 'low'
        when p_availability in ('sold_out', 'unknown') then 'none'
        else 'in_stock'
      end,
      p_availability, p_quantity, v_notes, p_seen_at, true,
      null, null, 'approved', p_photo_urls,
      p_submission_id
    ) returning id into v_sighting_id;

    v_sighting_ids := array_append(v_sighting_ids, v_sighting_id);
  end loop;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'sighting_ids', to_jsonb(v_sighting_ids),
    'moderation_status', 'approved',
    'is_public', true,
    'replayed', false
  );
end;
$$;

revoke all on function public.submit_sightings_v2(
  uuid, uuid, uuid[], timestamptz, text, integer, text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.submit_sightings_v2(
  uuid, uuid, uuid[], timestamptz, text, integer, text, uuid, text[]
) to authenticated;

-- Legacy entry points remain available but inherit the trusted product checks,
-- atomicity, publication rules, and validation from v2. Only v2 promises
-- retry idempotency because legacy clients do not provide a stable key.
create or replace function public.create_sightings_batch(
  p_product_id uuid,
  p_store_ids uuid[],
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null,
  p_draft_id uuid default null,
  p_photo_urls text[] default null
)
returns uuid[]
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_result jsonb;
  v_sighting_ids uuid[];
begin
  perform private.assert_permanent_member();
  v_result := public.submit_sightings_v2(
    gen_random_uuid(),
    p_product_id,
    p_store_ids,
    p_seen_at,
    p_availability,
    p_quantity,
    p_notes,
    p_draft_id,
    p_photo_urls
  );

  select coalesce(
    array_agg(item.value::uuid order by item.ordinality),
    '{}'::uuid[]
  )
  into v_sighting_ids
  from jsonb_array_elements_text(v_result -> 'sighting_ids')
    with ordinality as item(value, ordinality);

  return v_sighting_ids;
end;
$$;

revoke all on function public.create_sightings_batch(
  uuid, uuid[], timestamptz, text, integer, text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.create_sightings_batch(
  uuid, uuid[], timestamptz, text, integer, text, uuid, text[]
) to authenticated;

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
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform private.assert_permanent_member();
  v_result := public.submit_sightings_v2(
    gen_random_uuid(),
    p_product_id,
    array[p_store_id],
    p_seen_at,
    p_availability,
    p_quantity,
    p_notes,
    p_draft_id,
    p_photo_urls
  );
  return (v_result -> 'sighting_ids' ->> 0)::uuid;
end;
$$;

revoke all on function public.create_sighting(
  uuid, uuid, timestamptz, text, integer, text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.create_sighting(
  uuid, uuid, timestamptz, text, integer, text, uuid, text[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Keep moderation visibility workflow-aware and expose owner queue counts.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_contribution_moderation(
  p_contribution_type text,
  p_contribution_id uuid,
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
    from public.sightings s
    where s.id = p_contribution_id
    for update;
    if not found then
      raise exception 'Sighting not found' using errcode = 'P0002';
    end if;

    update public.sightings
    set moderation_status = v_new_status,
        is_public = (v_new_status = 'approved' and bounty_id is null),
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  else
    select b.moderation_status into v_previous_status
    from public.bounties b
    where b.id = p_contribution_id
    for update;
    if not found then
      raise exception 'Bounty not found' using errcode = 'P0002';
    end if;

    update public.bounties
    set moderation_status = v_new_status,
        moderated_by = v_owner_id,
        moderated_at = now(),
        moderation_reason = v_reason
    where id = p_contribution_id;
  end if;

  insert into private.contribution_moderation_events (
    contribution_type, contribution_id, actor_id,
    previous_status, new_status, reason
  ) values (
    p_contribution_type, p_contribution_id, v_owner_id,
    v_previous_status, v_new_status, v_reason
  );
end;
$$;

revoke all on function public.admin_set_contribution_moderation(text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_contribution_moderation(text, uuid, text, text)
  to authenticated;

create or replace function public.get_admin_review_counts()
returns table (
  pending_sightings bigint,
  pending_bounties bigint,
  pending_leads bigint,
  pending_product_suggestions bigint,
  pending_store_suggestions bigint,
  total bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
  with counts as (
    select
      (select count(*) from public.sightings s
        where s.moderation_status = 'pending'
          and s.lead_id is null) as sightings_count,
      (select count(*) from public.bounties b
        where b.moderation_status = 'pending') as bounties_count,
      (select count(*) from public.leads l
        where l.status = 'pending') as leads_count,
      (select count(*) from private.product_suggestions ps
        where ps.status = 'pending') as product_suggestions_count,
      (select count(*) from private.store_suggestions ss
        where ss.status = 'pending') as store_suggestions_count
  )
  select
    counts.sightings_count,
    counts.bounties_count,
    counts.leads_count,
    counts.product_suggestions_count,
    counts.store_suggestions_count,
    counts.sightings_count
      + counts.bounties_count
      + counts.leads_count
      + counts.product_suggestions_count
      + counts.store_suggestions_count
  from counts;
end;
$$;

revoke all on function public.get_admin_review_counts()
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_review_counts()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Hardened community verification write and aggregate read APIs.
-- ---------------------------------------------------------------------------

create or replace function public.set_sighting_verification(
  p_sighting_id uuid,
  p_response text
)
returns table (
  sighting_id uuid,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  viewer_response text,
  is_owner boolean
)
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_sighting public.sightings%rowtype;
  v_response_time timestamptz;
begin
  if p_response is not null and p_response not in ('verified', 'not_found') then
    raise exception 'Invalid verification response'
      using errcode = '22023', hint = 'INVALID_VERIFICATION_RESPONSE';
  end if;

  select si.* into v_sighting
  from public.sightings si
  join public.products p on p.id = si.product_id and p.is_active
  join public.trends t on t.id = p.trend_id and t.is_active
  join public.stores st on st.id = si.store_id and st.is_active
  join public.retailers r on r.id = st.retailer_id and r.is_active
  where si.id = p_sighting_id
    and si.moderation_status = 'approved'
    and si.is_public
    and si.bounty_id is null
    and si.seen_at >= now() - interval '72 hours'
  for update of si;

  if not found then
    raise exception 'Sighting is not available for verification'
      using errcode = '55000', hint = 'SIGHTING_NOT_VERIFIABLE';
  end if;

  if v_sighting.user_id = v_user_id then
    raise exception 'You cannot verify your own sighting'
      using errcode = '42501', hint = 'OWN_SIGHTING';
  end if;

  if p_response is null then
    delete from private.sighting_verifications sv
    where sv.sighting_id = p_sighting_id
      and sv.user_id = v_user_id;
  else
    v_response_time := clock_timestamp();
    insert into private.sighting_verifications (
      sighting_id, user_id, response, created_at, updated_at
    ) values (
      p_sighting_id, v_user_id, p_response, v_response_time, v_response_time
    )
    on conflict on constraint sighting_verifications_sighting_user_key do update
    set response = excluded.response,
        updated_at = case
          when private.sighting_verifications.response is distinct from excluded.response
            then v_response_time
          else private.sighting_verifications.updated_at
        end;
  end if;

  return query
  select
    summary.sighting_id,
    summary.verified_count,
    summary.not_found_count,
    summary.last_verified_at,
    summary.last_not_found_at,
    summary.community_state,
    summary.viewer_response,
    false
  from private.sighting_verification_summaries(
    array[p_sighting_id],
    v_user_id
  ) summary;
end;
$$;

revoke all on function public.set_sighting_verification(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_sighting_verification(uuid, text)
  to authenticated;

create or replace function public.remove_sighting_verification(
  p_sighting_id uuid
)
returns table (
  sighting_id uuid,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  viewer_response text,
  is_owner boolean
)
language sql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
  select *
  from public.set_sighting_verification(p_sighting_id, null)
$$;

revoke all on function public.remove_sighting_verification(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.remove_sighting_verification(uuid)
  to authenticated;

create or replace function public.get_sighting_verification_summaries(
  p_sighting_ids uuid[]
)
returns table (
  sighting_id uuid,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  viewer_response text,
  is_owner boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  if p_sighting_ids is null or cardinality(p_sighting_ids) = 0 then
    return;
  end if;
  if cardinality(p_sighting_ids) > 100 then
    raise exception 'At most 100 sighting summaries can be requested'
      using errcode = '22023', hint = 'TOO_MANY_SIGHTINGS';
  end if;

  return query
  with eligible as (
    select distinct si.id, si.user_id
    from public.sightings si
    join unnest(p_sighting_ids) as requested(id) on requested.id = si.id
    where si.moderation_status = 'approved'
      and si.is_public
      and si.bounty_id is null
  ), summaries as (
    select summary.*
    from private.sighting_verification_summaries(
      coalesce((select array_agg(e.id) from eligible e), '{}'::uuid[]),
      auth.uid()
    ) summary
  )
  select
    summaries.sighting_id,
    summaries.verified_count,
    summaries.not_found_count,
    summaries.last_verified_at,
    summaries.last_not_found_at,
    summaries.community_state,
    summaries.viewer_response,
    coalesce(e.user_id = auth.uid(), false)
  from summaries
  join eligible e on e.id = summaries.sighting_id;
end;
$$;

revoke all on function public.get_sighting_verification_summaries(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_sighting_verification_summaries(uuid[])
  to anon, authenticated, service_role;

drop function if exists public.list_public_sightings(
  uuid, uuid, text, integer, integer
);

create function public.list_public_sightings(
  p_product_id uuid default null,
  p_store_id uuid default null,
  p_zip_code text default '48910',
  p_radius_miles integer default 50,
  p_limit integer default 50
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  store_id uuid,
  store_slug text,
  store_name text,
  retailer_name text,
  city text,
  state text,
  zip_code text,
  seen_at timestamptz,
  availability text,
  quantity integer,
  notes text,
  photo_urls text[],
  created_at timestamptz,
  distance_miles numeric,
  freshness_status text,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  viewer_response text,
  is_owner boolean
)
language sql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
  with origin as (
    select z.latitude, z.longitude
    from public.zip_codes z
    where z.zip_code = p_zip_code
  ), eligible as (
    select
      si.id,
      si.user_id,
      p.id as product_id,
      p.name as product_name,
      p.slug as product_slug,
      st.id as store_id,
      st.slug as store_slug,
      st.name as store_name,
      r.name as retailer_name,
      st.city,
      st.state,
      st.zip_code,
      si.seen_at,
      si.availability,
      si.quantity,
      si.notes,
      si.photo_urls,
      si.created_at,
      round(distance.value::numeric, 1) as distance_miles,
      private.sighting_freshness(si.seen_at) as freshness_status
    from public.sightings si
    join public.products p on p.id = si.product_id and p.is_active
    join public.trends t on t.id = p.trend_id and t.is_active
    join public.stores st on st.id = si.store_id and st.is_active
    join public.retailers r on r.id = st.retailer_id and r.is_active
    join public.zip_codes sz on sz.zip_code = st.zip_code
    left join origin o on true
    cross join lateral (
      select case
        when p_zip_code is null then null
        else private.distance_miles(
          o.latitude, o.longitude, sz.latitude, sz.longitude
        )
      end as value
    ) distance
    where si.is_public
      and si.moderation_status = 'approved'
      and si.seen_at >= now() - interval '72 hours'
      and (p_product_id is null or si.product_id = p_product_id)
      and (p_store_id is null or si.store_id = p_store_id)
      and (
        p_zip_code is null
        or (p_radius_miles between 1 and 250 and distance.value <= p_radius_miles)
      )
    order by si.seen_at desc, si.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ), summaries as (
    select summary.*
    from private.sighting_verification_summaries(
      coalesce((select array_agg(e.id) from eligible e), '{}'::uuid[]),
      auth.uid()
    ) summary
  )
  select
    e.id,
    e.product_id,
    e.product_name,
    e.product_slug,
    e.store_id,
    e.store_slug,
    e.store_name,
    e.retailer_name,
    e.city,
    e.state,
    e.zip_code,
    e.seen_at,
    e.availability,
    e.quantity,
    e.notes,
    e.photo_urls,
    e.created_at,
    e.distance_miles,
    e.freshness_status,
    summaries.verified_count,
    summaries.not_found_count,
    summaries.last_verified_at,
    summaries.last_not_found_at,
    summaries.community_state,
    summaries.viewer_response,
    coalesce(e.user_id = auth.uid(), false)
  from eligible e
  join summaries on summaries.sighting_id = e.id
  order by e.seen_at desc, e.id
$$;

revoke all on function public.list_public_sightings(
  uuid, uuid, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_public_sightings(
  uuid, uuid, text, integer, integer
) to anon, authenticated, service_role;

-- Include community signal in the existing owner contribution feed.
drop function if exists public.admin_list_recent_contributions(integer);

create function public.admin_list_recent_contributions(
  p_limit integer default 100
)
returns table (
  contribution_type text,
  contribution_id uuid,
  username text,
  product_name text,
  moderation_status text,
  lifecycle_status text,
  occurred_at timestamptz,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
  with recent as (
    select *
    from (
      select
        'sighting'::text as contribution_type,
        s.id as contribution_id,
        pr.username,
        p.name as product_name,
        s.moderation_status,
        case
          when s.seen_at >= now() - interval '7 days' then 'fresh'
          else 'expired'
        end as lifecycle_status,
        s.created_at as occurred_at
      from public.sightings s
      join public.profiles pr on pr.id = s.user_id
      join public.products p on p.id = s.product_id

      union all

      select
        'bounty'::text,
        b.id,
        pr.username,
        p.name,
        b.moderation_status,
        b.status,
        b.created_at
      from public.bounties b
      join public.profiles pr on pr.id = b.user_id
      join public.products p on p.id = b.product_id

      union all

      select
        'lead'::text,
        l.id,
        pr.username,
        p.name,
        l.status,
        null::text,
        l.created_at
      from public.leads l
      join public.profiles pr on pr.id = l.user_id
      join public.products p on p.id = l.product_id
    ) all_contributions
    order by occurred_at desc, contribution_id
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ), summaries as (
    select summary.*
    from private.sighting_verification_summaries(
      coalesce(
        (select array_agg(r.contribution_id)
         from recent r where r.contribution_type = 'sighting'),
        '{}'::uuid[]
      ),
      null
    ) summary
  )
  select
    r.contribution_type,
    r.contribution_id,
    r.username,
    r.product_name,
    r.moderation_status,
    r.lifecycle_status,
    r.occurred_at,
    case when r.contribution_type = 'sighting'
      then coalesce(summaries.verified_count, 0::bigint) else 0::bigint end,
    case when r.contribution_type = 'sighting'
      then coalesce(summaries.not_found_count, 0::bigint) else 0::bigint end,
    case when r.contribution_type = 'sighting'
      then summaries.last_verified_at else null::timestamptz end,
    case when r.contribution_type = 'sighting'
      then summaries.last_not_found_at else null::timestamptz end,
    case when r.contribution_type = 'sighting'
      then coalesce(summaries.community_state, 'unverified') else null::text end
  from recent r
  left join summaries on summaries.sighting_id = r.contribution_id
  order by r.occurred_at desc, r.contribution_id;
end;
$$;

revoke all on function public.admin_list_recent_contributions(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_recent_contributions(integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Service-role-only discovery for the Worker that deletes Storage objects.
-- ---------------------------------------------------------------------------

create or replace function public.list_orphan_sighting_photo_paths(
  p_older_than timestamptz,
  p_limit integer default 100
)
returns table (object_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, storage, pg_temp
as $$
declare
  v_cutoff timestamptz := least(
    coalesce(p_older_than, now() - interval '91 days'),
    now() - interval '91 days'
  );
  v_limit integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'Limit must be positive'
      using errcode = '22023', hint = 'INVALID_LIMIT';
  end if;
  v_limit := least(p_limit, 100);

  return query
  select o.name
  from storage.objects o
  where o.bucket_id = 'sighting-photos'
    and o.name is not null
    and o.created_at < v_cutoff
    and not exists (
      select 1
      from public.sightings s
      where o.name = any(coalesce(s.photo_urls, '{}'::text[]))
    )
    and not exists (
      select 1
      from private.contribution_drafts d
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(d.payload -> 'photoUrls') = 'array'
            then d.payload -> 'photoUrls'
          else '[]'::jsonb
        end
      ) as draft_photo(path)
      where d.expires_at > now()
        and draft_photo.path = o.name
    )
  order by o.created_at, o.name
  limit v_limit;
end;
$$;

revoke all on function public.list_orphan_sighting_photo_paths(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_orphan_sighting_photo_paths(timestamptz, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
