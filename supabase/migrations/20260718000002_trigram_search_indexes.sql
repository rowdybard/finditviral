-- Add pg_trgm GIN indexes to accelerate ILIKE wildcard searches in
-- search_products and search_stores.

begin;

create extension if not exists pg_trgm;

-- Products: name, brand, category, search_terms (only active rows)
create index if not exists products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops)
  where is_active;

create index if not exists products_brand_trgm_idx
  on public.products using gin (brand gin_trgm_ops)
  where is_active and brand is not null;

create index if not exists products_category_trgm_idx
  on public.products using gin (category gin_trgm_ops)
  where is_active and category is not null;

create index if not exists products_search_terms_trgm_idx
  on public.products using gin (search_terms gin_trgm_ops)
  where is_active and search_terms is not null;

-- Trends: name, description (only active rows)
create index if not exists trends_name_trgm_idx
  on public.trends using gin (name gin_trgm_ops)
  where is_active;

create index if not exists trends_description_trgm_idx
  on public.trends using gin (description gin_trgm_ops)
  where is_active and description is not null;

-- Stores: name (only active rows)
create index if not exists stores_name_trgm_idx
  on public.stores using gin (name gin_trgm_ops)
  where is_active;

-- Retailers: name (only active rows)
create index if not exists retailers_name_trgm_idx
  on public.retailers using gin (name gin_trgm_ops)
  where is_active;

commit;
