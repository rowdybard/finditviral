-- Issue 16: Admin catalog management
--
-- Add admin RPCs for store/product CRUD and member search.

begin;

-- Admin: create store
create or replace function public.admin_create_store(
  p_retailer_name text,
  p_store_name text,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_zip_code text,
  p_phone text default null,
  p_website_url text default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_retailer_id uuid;
  v_store_id uuid;
  v_retailer_slug text;
  v_store_slug text;
begin
  -- Find or create retailer
  select id into v_retailer_id
  from public.retailers r
  where lower(r.name) = lower(btrim(p_retailer_name))
  for update;

  if not found then
    v_retailer_slug := lower(regexp_replace(btrim(p_retailer_name), '[^a-z0-9]+', '-', 'gi'));
    v_retailer_slug := trim(both '-' from v_retailer_slug);
    insert into public.retailers (name, slug)
    values (btrim(p_retailer_name), v_retailer_slug)
    returning id into v_retailer_id;
  end if;

  v_store_slug := lower(regexp_replace(btrim(p_store_name) || '-' || btrim(p_city) || '-' || btrim(p_state), '[^a-z0-9]+', '-', 'gi'));
  v_store_slug := trim(both '-' from v_store_slug);

  insert into public.stores (
    retailer_id, name, slug, address_line1, city, state, zip_code,
    phone, website_url, latitude, longitude
  ) values (
    v_retailer_id, btrim(p_store_name), v_store_slug,
    btrim(p_address_line1), btrim(p_city), upper(btrim(p_state)),
    btrim(p_zip_code), p_phone, p_website_url, p_latitude, p_longitude
  )
  returning id into v_store_id;

  return v_store_id;
end;
$$;

-- Admin: update store
create or replace function public.admin_update_store(
  p_store_id uuid,
  p_store_name text default null,
  p_address_line1 text default null,
  p_phone text default null,
  p_website_url text default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
begin
  update public.stores set
    name = coalesce(nullif(btrim(p_store_name), ''), name),
    address_line1 = coalesce(nullif(btrim(p_address_line1), ''), address_line1),
    phone = coalesce(p_phone, phone),
    website_url = coalesce(p_website_url, website_url),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_store_id;
end;
$$;

-- Admin: disable store
create or replace function public.admin_disable_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
begin
  update public.stores set is_active = false, updated_at = now()
  where id = p_store_id;
end;
$$;

-- Admin: create product
create or replace function public.admin_create_product(
  p_trend_id uuid,
  p_name text,
  p_availability_status text default 'available',
  p_release_date date default null,
  p_source_url text default null,
  p_retailer text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_product_id uuid;
  v_slug text;
begin
  v_slug := lower(regexp_replace(btrim(p_name), '[^a-z0-9]+', '-', 'gi'));
  v_slug := trim(both '-' from v_slug);

  insert into public.products (
    trend_id, name, slug, availability_status, release_date, source_url, retailer
  ) values (
    p_trend_id, btrim(p_name), v_slug,
    p_availability_status, p_release_date, p_source_url, p_retailer
  )
  returning id into v_product_id;

  return v_product_id;
end;
$$;

-- Admin: update product
create or replace function public.admin_update_product(
  p_product_id uuid,
  p_name text default null,
  p_availability_status text default null,
  p_release_date date default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
begin
  update public.products set
    name = coalesce(nullif(btrim(p_name), ''), name),
    availability_status = coalesce(p_availability_status, availability_status),
    release_date = coalesce(p_release_date, release_date),
    is_active = coalesce(p_is_active, is_active)
  where id = p_product_id;
end;
$$;

-- Admin: disable product
create or replace function public.admin_disable_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
begin
  update public.products set is_active = false
  where id = p_product_id;
end;
$$;

-- Admin: search members by username
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
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.username, p.karma, p.created_at
  from public.profiles p
  where nullif(btrim(p_query), '') is null
    or p.username ilike '%' || btrim(p_query) || '%'
  order by case when p.username ilike btrim(p_query) || '%' then 0 else 1 end, p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Grant execute to authenticated (owner check is inside each function)
revoke all on function public.admin_create_store(text, text, text, text, text, text, text, text, numeric, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_store(uuid, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_disable_store(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_product(uuid, text, text, date, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_product(uuid, text, text, date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_disable_product(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_search_members(text, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_store(text, text, text, text, text, text, text, text, numeric, numeric),
  public.admin_update_store(uuid, text, text, text, text, boolean),
  public.admin_disable_store(uuid),
  public.admin_create_product(uuid, text, text, date, text, text),
  public.admin_update_product(uuid, text, text, date, boolean),
  public.admin_disable_product(uuid),
  public.admin_search_members(text, integer)
to authenticated;

notify pgrst, 'reload schema';

commit;
