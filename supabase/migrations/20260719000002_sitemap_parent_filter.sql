-- Filter sitemap URLs by active parent trends (products) and active retailers (stores).
-- Products whose trend is inactive should not appear in the sitemap.
-- Stores whose retailer is inactive should not appear in the sitemap.

begin;

create or replace function public.get_sitemap_urls()
returns table (
  url_path text,
  lastmod date,
  changefreq text,
  priority real
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with static_urls as (
    select '/' as url_path, current_date as lastmod, 'weekly' as changefreq, 1.0 as priority
    union all
    select '/stores', current_date, 'weekly', 0.7
    union all
    select '/privacy', current_date, 'monthly', 0.3
  ),
  product_urls as (
    select
      '/products/' || p.slug as url_path,
      coalesce(p.verified_at::date, p.created_at::date) as lastmod,
      'weekly' as changefreq,
      0.8 as priority
    from public.products p
    join public.trends t on t.id = p.trend_id and t.is_active
    where p.is_active
    order by p.created_at desc
    limit 500
  ),
  store_urls as (
    select
      '/stores/' || s.slug as url_path,
      coalesce(s.updated_at::date, s.verified_at::date, s.created_at::date) as lastmod,
      'weekly' as changefreq,
      0.6 as priority
    from public.stores s
    join public.retailers r on r.id = s.retailer_id and r.is_active
    where s.is_active
    order by s.updated_at desc
    limit 500
  )
  select url_path, lastmod, changefreq, priority from (
    select * from static_urls
    union all
    select * from product_urls
    union all
    select * from store_urls
  ) combined
  order by
    case
      when url_path = '/' then 0
      when url_path like '/products/%' then 1
      when url_path like '/stores/%' then 2
      else 3
    end,
    url_path
  limit 1000;
$$;

revoke all on function public.get_sitemap_urls()
  from public, anon, authenticated, service_role;
grant execute on function public.get_sitemap_urls()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
