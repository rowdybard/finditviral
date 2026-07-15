-- Security lint fixes:
-- 1. Fix touch_profile_contacts_updated_at search_path (function_search_path_mutable)
-- 2. Move pg_trgm extension to extensions schema (extension_in_public)

begin;

-- 1. Fix touch_profile_contacts_updated_at: add explicit search_path
create or replace function public.touch_profile_contacts_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Re-apply grants (function signature unchanged but grants need to survive the recreate)
revoke all on function public.touch_profile_contacts_updated_at()
  from public, anon, authenticated, service_role;

-- 2. Move pg_trgm to extensions schema
-- Drop existing GIN trigram indexes first (they depend on the extension)
drop index if exists public.products_name_trgm_idx;
drop index if exists public.products_brand_trgm_idx;
drop index if exists public.products_category_trgm_idx;
drop index if exists public.products_search_terms_trgm_idx;
drop index if exists public.trends_name_trgm_idx;
drop index if exists public.trends_description_trgm_idx;
drop index if exists public.stores_name_trgm_idx;
drop index if exists public.retailers_name_trgm_idx;

-- Drop and recreate the extension in the extensions schema
drop extension if exists pg_trgm cascade;
create extension pg_trgm schema extensions;

-- Grant usage on extensions schema so functions can use the operators
grant usage on schema extensions to authenticated, anon;

-- Recreate GIN trigram indexes using schema-qualified operator class
create index if not exists products_name_trgm_idx
  on public.products using gin (name extensions.gin_trgm_ops)
  where is_active;

create index if not exists products_brand_trgm_idx
  on public.products using gin (brand extensions.gin_trgm_ops)
  where is_active and brand is not null;

create index if not exists products_category_trgm_idx
  on public.products using gin (category extensions.gin_trgm_ops)
  where is_active and category is not null;

create index if not exists products_search_terms_trgm_idx
  on public.products using gin (search_terms extensions.gin_trgm_ops)
  where is_active and search_terms is not null;

create index if not exists trends_name_trgm_idx
  on public.trends using gin (name extensions.gin_trgm_ops)
  where is_active;

create index if not exists trends_description_trgm_idx
  on public.trends using gin (description extensions.gin_trgm_ops)
  where is_active and description is not null;

create index if not exists stores_name_trgm_idx
  on public.stores using gin (name extensions.gin_trgm_ops)
  where is_active;

create index if not exists retailers_name_trgm_idx
  on public.retailers using gin (name extensions.gin_trgm_ops)
  where is_active;

commit;
