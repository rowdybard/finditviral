-- Expand product search: add category and search_terms columns to products,
-- recreate search_products to match against category, search_terms, and
-- trends.description, and update admin product RPCs to accept the new fields.

begin;

-- ---------------------------------------------------------------------------
-- 1. Add category and search_terms columns to products
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists category text,
  add column if not exists search_terms text;

alter table public.products drop constraint if exists products_category_length;
alter table public.products add constraint products_category_length
  check (category is null or char_length(btrim(category)) <= 120);

alter table public.products drop constraint if exists products_search_terms_length;
alter table public.products add constraint products_search_terms_length
  check (search_terms is null or char_length(btrim(search_terms)) <= 500);

create index if not exists products_category_idx
  on public.products (category)
  where category is not null and is_active;

create index if not exists products_search_terms_idx
  on public.products (search_terms)
  where search_terms is not null and is_active;

-- ---------------------------------------------------------------------------
-- 2. Recreate search_products to include category, search_terms, trend description
-- ---------------------------------------------------------------------------
create or replace function public.search_products(
  p_query text,
  p_limit integer default 12
)
returns table (
  id uuid,
  name text,
  slug text,
  trend_name text,
  availability_status text,
  release_date date,
  image_url text
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    p.id,
    p.name,
    p.slug,
    t.name,
    p.availability_status,
    p.release_date,
    p.image_url
  from public.products p
  join public.trends t on t.id = p.trend_id
  where p.is_active
    and t.is_active
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and (
      p.name ilike '%' || btrim(p_query) || '%'
      or t.name ilike '%' || btrim(p_query) || '%'
      or p.brand ilike '%' || btrim(p_query) || '%'
      or coalesce(p.brand || ' ', '') || p.name ilike '%' || btrim(p_query) || '%'
      or p.category ilike '%' || btrim(p_query) || '%'
      or p.search_terms ilike '%' || btrim(p_query) || '%'
      or t.description ilike '%' || btrim(p_query) || '%'
    )
  order by
    case
      when p.name ilike btrim(p_query) || '%' then 0
      when p.brand ilike btrim(p_query) || '%' then 1
      when p.category ilike btrim(p_query) || '%' then 2
      when t.name ilike btrim(p_query) || '%' then 3
      when p.search_terms ilike '%' || btrim(p_query) || '%' then 4
      when t.description ilike '%' || btrim(p_query) || '%' then 5
      else 6
    end,
    p.name,
    p.id
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

revoke all on function public.search_products(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_products(text, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Recreate admin_create_product to accept category and search_terms
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_product(uuid, text, text, date, text, text);

create or replace function public.admin_create_product(
  p_trend_id uuid,
  p_name text,
  p_availability_status text default 'available',
  p_release_date date default null,
  p_source_url text default null,
  p_brand text default null,
  p_category text default null,
  p_search_terms text default null
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
  v_brand text := nullif(btrim(p_brand), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_category text := nullif(btrim(p_category), '');
  v_search_terms text := nullif(btrim(p_search_terms), '');
begin
  if btrim(p_name) is null or char_length(btrim(p_name)) > 160 then
    raise exception 'Invalid product name' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if p_availability_status not in ('available', 'backorder', 'preorder', 'announced', 'limited', 'retired') then
    raise exception 'Invalid availability status' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if v_source_url is not null and v_source_url !~ '^https://' then
    raise exception 'Invalid source URL' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if v_category is not null and char_length(v_category) > 120 then
    raise exception 'Category is too long' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if v_search_terms is not null and char_length(v_search_terms) > 500 then
    raise exception 'Search terms are too long' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  v_slug := lower(regexp_replace(btrim(p_name), '[^a-z0-9]+', '-', 'gi'));
  v_slug := trim(both '-' from v_slug);

  insert into public.products (
    trend_id, name, slug, availability_status, release_date, source_url, brand,
    category, search_terms,
    verified_at, verification_method, is_active
  ) values (
    p_trend_id, btrim(p_name), v_slug,
    p_availability_status, p_release_date, v_source_url, v_brand,
    v_category, v_search_terms,
    now(),
    case when v_source_url is null then 'owner_verified' else 'official_source' end,
    true
  )
  on conflict (slug) do update set
    name = excluded.name,
    availability_status = excluded.availability_status,
    release_date = excluded.release_date,
    source_url = excluded.source_url,
    brand = excluded.brand,
    category = excluded.category,
    search_terms = excluded.search_terms,
    verified_at = now(),
    verification_method = excluded.verification_method,
    is_active = true
  returning id into v_product_id;

  return v_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recreate admin_update_product to accept category and search_terms
-- ---------------------------------------------------------------------------
drop function if exists public.admin_update_product(uuid, text, text, date, boolean);

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_name text default null,
  p_availability_status text default null,
  p_release_date date default null,
  p_is_active boolean default null,
  p_category text default null,
  p_search_terms text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_owner_id uuid := private.assert_app_owner();
  v_category text := nullif(btrim(p_category), '');
  v_search_terms text := nullif(btrim(p_search_terms), '');
begin
  if v_category is not null and char_length(v_category) > 120 then
    raise exception 'Category is too long' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  if v_search_terms is not null and char_length(v_search_terms) > 500 then
    raise exception 'Search terms are too long' using errcode = '22023', hint = 'INVALID_PRODUCT';
  end if;

  update public.products set
    name = coalesce(nullif(btrim(p_name), ''), name),
    availability_status = coalesce(p_availability_status, availability_status),
    release_date = coalesce(p_release_date, release_date),
    category = case when p_category is not null then v_category else category end,
    search_terms = case when p_search_terms is not null then v_search_terms else search_terms end,
    is_active = coalesce(p_is_active, is_active)
  where id = p_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Re-grant admin product functions
-- ---------------------------------------------------------------------------
revoke all on function public.admin_create_product(uuid, text, text, date, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_product(uuid, text, text, date, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_disable_product(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_product(uuid, text, text, date, text, text, text, text),
  public.admin_update_product(uuid, text, text, date, boolean, text, text),
  public.admin_disable_product(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin list products and stores for catalog management UI
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_products(
  p_include_inactive boolean default false,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  slug text,
  trend_name text,
  brand text,
  category text,
  availability_status text,
  release_date date,
  is_active boolean,
  search_terms text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    p.id,
    p.name,
    p.slug,
    t.name,
    p.brand,
    p.category,
    p.availability_status,
    p.release_date,
    p.is_active,
    p.search_terms
  from public.products p
  join public.trends t on t.id = p.trend_id
  where (p_include_inactive or p.is_active)
  order by p.is_active desc, p.name
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.admin_list_products(boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_products(boolean, integer)
  to authenticated;

create or replace function public.admin_list_stores(
  p_include_inactive boolean default false,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  slug text,
  retailer_name text,
  address_line1 text,
  city text,
  state text,
  zip_code text,
  is_active boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    s.id,
    s.name,
    s.slug,
    r.name,
    s.address_line1,
    s.city,
    s.state,
    s.zip_code,
    s.is_active
  from public.stores s
  join public.retailers r on r.id = s.retailer_id
  where (p_include_inactive or s.is_active)
  order by s.is_active desc, s.name
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.admin_list_stores(boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_stores(boolean, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
