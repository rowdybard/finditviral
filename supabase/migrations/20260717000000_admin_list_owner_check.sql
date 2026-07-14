-- Close owner-authorization hole in the catalog-list RPCs.
--
-- admin_list_products / admin_list_stores (20260716000000) were security
-- definer, granted to authenticated, with no owner check, allowing any
-- member to enumerate inactive products/stores and internal search_terms.
-- Recreate both as PL/pgSQL with an explicit owner assertion as the first
-- statement. Select shape/sort/limit are unchanged.

begin;

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
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
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
end;
$$;

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
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
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
end;
$$;

revoke all on function public.admin_list_products(boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_products(boolean, integer)
  to authenticated;

revoke all on function public.admin_list_stores(boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_stores(boolean, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
