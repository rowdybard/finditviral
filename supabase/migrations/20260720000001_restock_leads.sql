-- Restock Leads: unconfirmed availability intel with credibility voting
-- and lead-to-sighting confirmation.

begin;

-- ---------------------------------------------------------------------------
-- 1. Leads table
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  slug text not null unique,
  headline text not null check (char_length(btrim(headline)) between 3 and 140),
  details text check (details is null or char_length(details) <= 2000),
  expected_date date,
  scope_type text not null check (scope_type in ('region', 'retailers', 'stores')),
  store_id uuid references public.stores(id) on delete restrict,
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$'),
  radius_miles integer check (radius_miles is null or radius_miles in (10, 25, 50, 100, 250)),
  source_type text not null check (source_type in ('employee_tip', 'social_media', 'press_release', 'restock_schedule', 'other')),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'active', 'confirmed', 'expired', 'hidden')),
  confirmed_sighting_id uuid references public.sightings(id) on delete set null,
  expires_at timestamptz not null,
  moderated_by uuid references auth.users(id) on delete restrict,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Scope consistency: stores scope requires store_id, region/retailers require zip+radius
alter table public.leads drop constraint if exists leads_scope_check;
alter table public.leads add constraint leads_scope_check check (
  (scope_type = 'stores' and store_id is not null and zip_code is null and radius_miles is null)
  or (scope_type in ('region', 'retailers') and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
);

-- Moderation metadata: hidden requires moderated_by/at; pending must not have them
alter table public.leads drop constraint if exists leads_moderation_metadata_check;
alter table public.leads add constraint leads_moderation_metadata_check check (
  (status = 'pending' and moderated_by is null and moderated_at is null)
  or (status = 'hidden' and moderated_by is not null and moderated_at is not null)
  or (status in ('active', 'confirmed', 'expired') and (moderated_by is null) = (moderated_at is null))
);

-- Link leads user_id to profiles
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_user_id_profiles_fkey'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end
$$;

create index if not exists idx_leads_product_id on public.leads(product_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_expires_at on public.leads(expires_at);
create index if not exists idx_leads_user_id on public.leads(user_id);
create index if not exists idx_leads_slug on public.leads(slug);

-- ---------------------------------------------------------------------------
-- 2. Add lead_id to sightings
-- ---------------------------------------------------------------------------

alter table public.sightings
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

-- Update sightings_self_insert policy to also block direct lead_id inserts
drop policy if exists sightings_self_insert on public.sightings;
create policy sightings_self_insert on public.sightings
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and is_public = true
    and bounty_id is null
    and lead_id is null
  );

-- ---------------------------------------------------------------------------
-- 3. Lead votes table
-- ---------------------------------------------------------------------------

create table if not exists public.lead_votes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote text not null check (vote in ('credible', 'doubtful')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, user_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_votes_user_id_profiles_fkey'
      and conrelid = 'public.lead_votes'::regclass
  ) then
    alter table public.lead_votes
      add constraint lead_votes_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end
$$;

create index if not exists idx_lead_votes_lead_id on public.lead_votes(lead_id);
create index if not exists idx_lead_votes_user_id on public.lead_votes(user_id);

-- ---------------------------------------------------------------------------
-- 4. Enable RLS on leads and lead_votes
-- ---------------------------------------------------------------------------

alter table public.leads enable row level security;
alter table public.lead_votes enable row level security;

-- Leads: visible if active/confirmed, or own pending/hidden
drop policy if exists leads_visible on public.leads;
create policy leads_visible on public.leads
  for select
  to authenticated
  using (
    status in ('active', 'confirmed')
    or (user_id = (select auth.uid()) and status in ('pending', 'hidden'))
  );

-- Leads: authors can insert
drop policy if exists leads_self_insert on public.leads;
create policy leads_self_insert on public.leads
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Leads: authors can update own pending leads
drop policy if exists leads_self_update on public.leads;
create policy leads_self_update on public.leads
  for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'pending');

-- Lead votes: all authenticated can read (public vote tallies)
drop policy if exists lead_votes_read on public.lead_votes;
create policy lead_votes_read on public.lead_votes
  for select
  to authenticated
  using (true);

-- Lead votes: self insert
drop policy if exists lead_votes_self_insert on public.lead_votes;
create policy lead_votes_self_insert on public.lead_votes
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Lead votes: self update (change vote)
drop policy if exists lead_votes_self_update on public.lead_votes;
create policy lead_votes_self_update on public.lead_votes
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Lead votes: self delete (remove vote)
drop policy if exists lead_votes_self_delete on public.lead_votes;
create policy lead_votes_self_delete on public.lead_votes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Update contribution_moderation_events to accept 'lead' type and 'active' status
-- ---------------------------------------------------------------------------

alter table private.contribution_moderation_events drop constraint if exists contribution_moderation_events_contribution_type_check;
alter table private.contribution_moderation_events add constraint contribution_moderation_events_contribution_type_check
  check (contribution_type in ('sighting', 'bounty', 'lead'));

alter table private.contribution_moderation_events drop constraint if exists contribution_moderation_events_new_status_check;
alter table private.contribution_moderation_events add constraint contribution_moderation_events_new_status_check
  check (new_status in ('approved', 'rejected', 'hidden', 'active'));

-- ---------------------------------------------------------------------------
-- 6. Update rate limit to support 'lead' type
-- ---------------------------------------------------------------------------

create or replace function private.check_contribution_rate_limit(
  p_user_id uuid,
  p_type text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_limit integer;
  v_count integer;
  v_is_owner boolean;
begin
  select exists (
    select 1 from private.app_owners ao where ao.user_id = p_user_id
  ) into v_is_owner;

  if v_is_owner then return; end if;

  v_limit := case p_type
    when 'sighting' then 10
    when 'bounty' then 5
    when 'suggestion' then 5
    when 'lead' then 10
    else 10
  end;

  select count(*) into v_count
  from public.sightings s
  where s.user_id = p_user_id
    and s.created_at > now() - interval '1 hour';

  if p_type = 'sighting' and v_count >= v_limit then
    raise exception 'Rate limit exceeded for sightings'
      using errcode = '42901',
            hint = 'You can submit at most ' || v_limit || ' sightings per hour. Please try again later.';
  end if;

  select count(*) into v_count
  from public.bounties b
  where b.user_id = p_user_id
    and b.created_at > now() - interval '1 hour';

  if p_type = 'bounty' and v_count >= v_limit then
    raise exception 'Rate limit exceeded for bounties'
      using errcode = '42901',
            hint = 'You can submit at most ' || v_limit || ' bounties per hour. Please try again later.';
  end if;

  if p_type = 'lead' then
    select count(*) into v_count
    from public.leads l
    where l.user_id = p_user_id
      and l.created_at > now() - interval '1 hour';

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for leads'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' leads per hour. Please try again later.';
    end if;
  end if;

  if p_type = 'suggestion' then
    select count(*) into v_count
    from (
      select id from public.product_suggestions ps
      where ps.user_id = p_user_id and ps.created_at > now() - interval '1 hour'
      union all
      select id from public.store_suggestions ss
      where ss.user_id = p_user_id and ss.created_at > now() - interval '1 hour'
    ) t;

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for suggestions'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' suggestions per hour. Please try again later.';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. create_lead RPC
-- ---------------------------------------------------------------------------

create or replace function public.create_lead(
  p_product_id uuid,
  p_headline text,
  p_details text default null,
  p_expected_date date default null,
  p_scope_type text default 'region',
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_source_type text default 'other',
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead_id uuid;
  v_headline text := nullif(btrim(p_headline), '');
  v_details text := nullif(btrim(p_details), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_zip text := nullif(btrim(p_zip_code), '');
  v_scope text := coalesce(p_scope_type, 'region');
  v_slug text;
  v_product public.products%rowtype;
  v_expires_at timestamptz;
  v_store public.stores%rowtype;
begin
  perform private.check_contribution_rate_limit(v_user_id, 'lead');

  if v_headline is null or char_length(v_headline) < 3 then
    raise exception 'Headline is required (3-140 characters)' using errcode = '22023';
  end if;
  if char_length(v_headline) > 140 then
    raise exception 'Headline must be 140 characters or fewer' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 2000 then
    raise exception 'Details must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if v_source_url is not null and char_length(v_source_url) > 2000 then
    raise exception 'Source URL is too long' using errcode = '22023';
  end if;
  if p_source_type not in ('employee_tip', 'social_media', 'press_release', 'restock_schedule', 'other') then
    raise exception 'Invalid source type' using errcode = '22023';
  end if;

  select * into v_product from public.products p where p.id = p_product_id and p.is_active;
  if not found then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  -- Scope validation
  if v_scope = 'stores' then
    if p_store_id is null or v_zip is not null or p_radius_miles is not null then
      raise exception 'Store scope requires a store and no ZIP/radius' using errcode = '22023';
    end if;
    select * into v_store from public.stores s where s.id = p_store_id and s.is_active;
    if not found then
      raise exception 'Store is unavailable' using errcode = '22023';
    end if;
  elsif v_scope in ('region', 'retailers') then
    if p_store_id is not null or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
    then
      raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid scope type' using errcode = '22023';
  end if;

  -- Compute expiration
  v_expires_at := coalesce(
    (p_expected_date + interval '7 days')::timestamptz,
    now() + interval '14 days'
  );

  -- Generate unique slug
  v_slug := private.slugify(v_product.name || '-' || v_headline);
  -- Ensure uniqueness by appending a short suffix if needed
  if exists (select 1 from public.leads l where l.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.leads (
    user_id, product_id, slug, headline, details, expected_date,
    scope_type, store_id, zip_code, radius_miles,
    source_type, source_url, status, expires_at
  ) values (
    v_user_id, p_product_id, v_slug, v_headline, v_details, p_expected_date,
    v_scope,
    case when v_scope = 'stores' then v_store.id else null end,
    case when v_scope in ('region', 'retailers') then v_zip else null end,
    case when v_scope in ('region', 'retailers') then p_radius_miles else null end,
    p_source_type, v_source_url, 'pending', v_expires_at
  ) returning id into v_lead_id;

  return v_lead_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. list_public_leads RPC
-- ---------------------------------------------------------------------------

create or replace function public.list_public_leads(
  p_product_id uuid default null,
  p_zip_code text default '48910',
  p_radius_miles integer default 50,
  p_limit integer default 50
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  slug text,
  headline text,
  details text,
  expected_date date,
  scope_type text,
  store_id uuid,
  store_name text,
  store_slug text,
  zip_code text,
  radius_miles integer,
  source_type text,
  source_url text,
  status text,
  confirmed_sighting_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  username text,
  credible_count bigint,
  doubtful_count bigint,
  net_score bigint,
  distance_miles numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
  with origin as (
    select z.latitude, z.longitude
    from public.zip_codes z
    where z.zip_code = p_zip_code
  ),
  vote_counts as (
    select
      lv.lead_id,
      count(*) filter (where lv.vote = 'credible') as credible_count,
      count(*) filter (where lv.vote = 'doubtful') as doubtful_count
    from public.lead_votes lv
    group by lv.lead_id
  )
  select
    l.id,
    p.id,
    p.name,
    p.slug,
    l.slug,
    l.headline,
    l.details,
    l.expected_date,
    l.scope_type,
    l.store_id,
    st.name,
    st.slug,
    l.zip_code,
    l.radius_miles,
    l.source_type,
    l.source_url,
    l.status,
    l.confirmed_sighting_id,
    l.expires_at,
    l.created_at,
    pr.username,
    coalesce(vc.credible_count, 0),
    coalesce(vc.doubtful_count, 0),
    coalesce(vc.credible_count, 0) - coalesce(vc.doubtful_count, 0),
    case
      when l.scope_type in ('region', 'retailers') and l.zip_code is not null then
        (select private.distance_miles(o.latitude, o.longitude, lz.latitude, lz.longitude)
         from public.zip_codes lz
         cross join origin o
         where lz.zip_code = l.zip_code)
      when l.scope_type = 'stores' and l.store_id is not null then
        (select private.distance_miles(o.latitude, o.longitude, sz.latitude, sz.longitude)
         from public.stores s2
         join public.zip_codes sz on sz.zip_code = s2.zip_code
         cross join origin o
         where s2.id = l.store_id)
      else null
    end
  from public.leads l
  join public.products p on p.id = l.product_id and p.is_active
  left join public.stores st on st.id = l.store_id and st.is_active
  left join public.profiles pr on pr.id = l.user_id
  left join vote_counts vc on vc.lead_id = l.id
  left join origin o on true
  where l.status in ('active', 'confirmed')
    and l.expires_at > now()
    and (p_product_id is null or l.product_id = p_product_id)
    and (
      p_zip_code is null
      or l.scope_type = 'stores'
      or (p_radius_miles between 1 and 250 and (
        select private.distance_miles(o.latitude, o.longitude, lz.latitude, lz.longitude)
        from public.zip_codes lz
        cross join origin o
        where lz.zip_code = l.zip_code
      ) <= p_radius_miles)
    )
  order by l.created_at desc, l.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- 9. get_lead_detail RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_lead_detail(
  p_lead_slug text
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  slug text,
  headline text,
  details text,
  expected_date date,
  scope_type text,
  store_id uuid,
  store_name text,
  store_slug text,
  store_city text,
  store_state text,
  zip_code text,
  radius_miles integer,
  source_type text,
  source_url text,
  status text,
  confirmed_sighting_id uuid,
  confirmed_store_name text,
  confirmed_seen_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  username text,
  is_owner boolean,
  caller_vote text,
  credible_count bigint,
  doubtful_count bigint,
  net_score bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  return query
  select
    l.id,
    p.id,
    p.name,
    p.slug,
    l.slug,
    l.headline,
    l.details,
    l.expected_date,
    l.scope_type,
    l.store_id,
    st.name,
    st.slug,
    st.city,
    st.state,
    l.zip_code,
    l.radius_miles,
    l.source_type,
    l.source_url,
    l.status,
    l.confirmed_sighting_id,
    cs.store_name,
    cs.seen_at,
    l.expires_at,
    l.created_at,
    pr.username,
    (l.user_id = v_user_id),
    lv.vote,
    coalesce(vc.credible_count, 0),
    coalesce(vc.doubtful_count, 0),
    coalesce(vc.credible_count, 0) - coalesce(vc.doubtful_count, 0)
  from public.leads l
  join public.products p on p.id = l.product_id
  left join public.stores st on st.id = l.store_id
  left join public.sightings cs on cs.id = l.confirmed_sighting_id
  left join public.profiles pr on pr.id = l.user_id
  left join public.lead_votes lv on lv.lead_id = l.id and lv.user_id = v_user_id
  left join (
    select
      lead_id,
      count(*) filter (where vote = 'credible') as credible_count,
      count(*) filter (where vote = 'doubtful') as doubtful_count
    from public.lead_votes
    group by lead_id
  ) vc on vc.lead_id = l.id
  where l.slug = p_lead_slug
    and (
      l.status in ('active', 'confirmed')
      or (l.user_id = v_user_id and l.status in ('pending', 'hidden'))
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. vote_on_lead RPC
-- ---------------------------------------------------------------------------

create or replace function public.vote_on_lead(
  p_lead_id uuid,
  p_vote text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
  v_lead public.leads%rowtype;
begin
  if p_vote not in ('credible', 'doubtful') then
    raise exception 'Invalid vote value' using errcode = '22023';
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_lead.status not in ('active', 'confirmed') then
    raise exception 'Voting is only available on active or confirmed leads' using errcode = '55000';
  end if;

  insert into public.lead_votes (lead_id, user_id, vote, created_at, updated_at)
  values (p_lead_id, v_user_id, p_vote, now(), now())
  on conflict (lead_id, user_id)
  do update set vote = excluded.vote, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. remove_lead_vote RPC
-- ---------------------------------------------------------------------------

create or replace function public.remove_lead_vote(
  p_lead_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_user_id uuid := private.assert_permanent_member();
begin
  delete from public.lead_votes
  where lead_id = p_lead_id and user_id = v_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. confirm_lead_with_sighting RPC
-- ---------------------------------------------------------------------------

create or replace function public.confirm_lead_with_sighting(
  p_lead_id uuid,
  p_store_id uuid,
  p_seen_at timestamptz,
  p_availability text,
  p_quantity integer default null,
  p_notes text default null
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

  -- Create the sighting as public and approved (it's a real confirmed sighting)
  insert into public.sightings (
    user_id, product_id, store_id, store_name, city, state, zip_code,
    stock_level, availability, quantity, notes, seen_at, is_public,
    bounty_id, lead_id, moderation_status
  ) values (
    v_user_id, v_lead.product_id, v_store.id, v_store.name, v_store.city,
    v_store.state, v_store.zip_code,
    case p_availability
      when 'in_stock' then 'in_stock'
      when 'low_stock' then 'low'
      when 'sold_out' then 'none'
      when 'unknown' then 'none'
    end,
    p_availability, p_quantity, v_notes, p_seen_at, true, null, v_lead.id, 'approved'
  ) returning id into v_sighting_id;

  -- Mark the lead as confirmed
  update public.leads
  set status = 'confirmed',
    confirmed_sighting_id = v_sighting_id,
    updated_at = now()
  where id = p_lead_id;

  return v_sighting_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. admin_set_lead_moderation RPC
-- ---------------------------------------------------------------------------

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

  select l.status into v_previous_status
  from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.leads
  set status = v_new_status,
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

-- ---------------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------------

revoke all on public.leads from public, anon, authenticated, service_role;
revoke all on public.lead_votes from public, anon, authenticated, service_role;

grant select, insert, update on public.leads to authenticated;
grant select, insert, update, delete on public.lead_votes to authenticated;

revoke all on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_lead(uuid, text, text, date, text, uuid, text, integer, text, text)
  to authenticated;

revoke all on function public.list_public_leads(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_leads(uuid, text, integer, integer)
  to anon, authenticated, service_role;

revoke all on function public.get_lead_detail(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_lead_detail(text)
  to anon, authenticated, service_role;

revoke all on function public.vote_on_lead(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.vote_on_lead(uuid, text)
  to authenticated;

revoke all on function public.remove_lead_vote(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.remove_lead_vote(uuid)
  to authenticated;

revoke all on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_lead_with_sighting(uuid, uuid, timestamptz, text, integer, text)
  to authenticated;

revoke all on function public.admin_set_lead_moderation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_lead_moderation(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
