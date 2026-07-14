-- Issue 13: Bounty scopes (region/retailers/stores)
--
-- Add scope_type to bounties, create bounty_retailers and bounty_stores
-- association tables, and recreate create_bounty to accept multi-scope.

begin;

-- Add scope_type column
alter table public.bounties
  add column if not exists scope_type text not null default 'region'
    check (scope_type in ('region', 'retailers', 'stores'));

-- Backfill existing rows
update public.bounties set scope_type = 'stores' where store_id is not null;
update public.bounties set scope_type = 'region' where store_id is null;

-- Create association tables
create table if not exists public.bounty_retailers (
  bounty_id uuid not null references public.bounties(id) on delete cascade,
  retailer_id uuid not null references public.retailers(id) on delete restrict,
  primary key (bounty_id, retailer_id)
);

create table if not exists public.bounty_stores (
  bounty_id uuid not null references public.bounties(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  primary key (bounty_id, store_id)
);

-- Enable RLS on association tables
alter table public.bounty_retailers enable row level security;
alter table public.bounty_stores enable row level security;

-- Drop old scope check, add new one
alter table public.bounties drop constraint if exists bounties_scope_check;
alter table public.bounties add constraint bounties_scope_check check (
  (scope_type = 'region' and store_id is null and zip_code ~ '^[0-9]{5}$' and radius_miles in (10, 25, 50, 100, 250))
  or (scope_type = 'stores' and store_id is not null and zip_code is null and radius_miles is null)
  or (scope_type = 'retailers' and store_id is null and zip_code is null and radius_miles is null)
  or (scope_type = 'stores' and store_id is null and zip_code is null and radius_miles is null)
);

-- RLS policies for association tables (authenticated can read, no direct write)
create policy bounty_retailers_authenticated_read
  on public.bounty_retailers for select to authenticated
  using (true);

create policy bounty_stores_authenticated_read
  on public.bounty_stores for select to authenticated
  using (true);

-- Recreate create_bounty with multi-scope support
create or replace function public.create_bounty(
  p_product_id uuid,
  p_scope_type text default 'region',
  p_store_id uuid default null,
  p_zip_code text default null,
  p_radius_miles integer default null,
  p_retailer_ids uuid[] default null,
  p_store_ids uuid[] default null,
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
  v_scope text := coalesce(p_scope_type, 'region');
begin
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is unavailable' using errcode = '22023';
  end if;

  -- Validate scope
  if v_scope = 'region' then
    if p_store_id is not null or p_retailer_ids is not null or p_store_ids is not null
      or v_zip is null or v_zip !~ '^[0-9]{5}$'
      or p_radius_miles not in (10, 25, 50, 100, 250)
      or not exists (select 1 from public.zip_codes z where z.zip_code = v_zip and z.state = 'MI')
    then
      raise exception 'Choose a valid Greater Lansing ZIP radius' using errcode = '22023';
    end if;
  elsif v_scope = 'stores' then
    if p_store_id is not null then
      -- Single store (backward compat)
      if v_zip is not null or p_radius_miles is not null
        or not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active)
      then
        raise exception 'Choose a valid store' using errcode = '22023';
      end if;
    elsif p_store_ids is not null and array_length(p_store_ids, 1) > 0 then
      if v_zip is not null or p_radius_miles is not null
        or not exists (
          select 1 from public.stores s
          where s.id = any(p_store_ids) and s.is_active
          having count(*) = array_length(p_store_ids, 1)
        )
      then
        raise exception 'Choose valid stores' using errcode = '22023';
      end if;
    else
      raise exception 'Choose at least one store' using errcode = '22023';
    end if;
  elsif v_scope = 'retailers' then
    if p_retailer_ids is null or array_length(p_retailer_ids, 1) is null
      or array_length(p_retailer_ids, 1) = 0
      or p_store_id is not null or v_zip is not null or p_radius_miles is not null
      or not exists (
        select 1 from public.retailers r
        where r.id = any(p_retailer_ids) and r.is_active
        having count(*) = array_length(p_retailer_ids, 1)
      )
    then
      raise exception 'Choose valid retailers' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid scope type' using errcode = '22023';
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
    p_draft_id, v_user_id, 'bounty', p_product_id,
    case when v_scope = 'stores' and p_store_id is not null then p_store_id
         when v_scope = 'stores' and p_store_ids is not null then p_store_ids[1]
         else null end
  );

  insert into public.bounties (
    user_id, product_id, store_id, reward_amount, reward_cents,
    zip_code, radius_miles, notes, requirements, deadline,
    status, moderation_status, scope_type
  ) values (
    v_user_id, p_product_id,
    case when v_scope = 'stores' and p_store_id is not null then p_store_id else null end,
    p_reward_cents::numeric / 100, p_reward_cents,
    case when v_scope = 'region' then v_zip else null end,
    case when v_scope = 'region' then p_radius_miles else null end,
    v_requirements, v_requirements, p_deadline, 'open', 'pending', v_scope
  ) returning id into v_bounty_id;

  -- Insert retailer associations
  if v_scope = 'retailers' and p_retailer_ids is not null then
    insert into public.bounty_retailers (bounty_id, retailer_id)
    select v_bounty_id, unnest(p_retailer_ids)
    on conflict do nothing;
  end if;

  -- Insert store associations (multi-store)
  if v_scope = 'stores' and p_store_ids is not null then
    insert into public.bounty_stores (bounty_id, store_id)
    select v_bounty_id, unnest(p_store_ids)
    on conflict do nothing;
  end if;

  if p_draft_id is not null then
    delete from private.contribution_drafts d
    where d.id = p_draft_id and d.user_id = v_user_id;
  end if;

  return v_bounty_id;
end;
$$;

-- Re-grant execute
revoke all on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bounty(uuid, text, uuid, text, integer, uuid[], uuid[], integer, timestamptz, text, uuid)
to authenticated;

-- Revoke direct write on association tables
revoke insert, update, delete on public.bounty_retailers from authenticated, anon;
revoke insert, update, delete on public.bounty_stores from authenticated, anon;

-- Add search_retailers RPC for multi-select scope
create or replace function public.search_retailers(
  p_query text,
  p_limit integer default 12
)
returns table (
  id uuid,
  name text,
  slug text,
  website_url text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.id, r.name, r.slug, r.website_url
  from public.retailers r
  where r.is_active
    and (
      nullif(btrim(p_query), '') is null
      or r.name ilike '%' || btrim(p_query) || '%'
      or r.slug ilike '%' || btrim(p_query) || '%'
    )
  order by similarity(r.name, btrim(p_query)) desc, r.name
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

revoke all on function public.search_retailers(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_retailers(text, integer)
to authenticated;

notify pgrst, 'reload schema';

commit;
