-- Pseudonymous, deduplicated product-card opens used to calculate FiV Heat.
-- Raw cookies, account IDs, IP addresses, and user agents never enter Postgres.

begin;

create schema if not exists private;

create table private.product_click_receipts (
  product_id uuid not null references public.products(id) on delete cascade,
  click_key text not null check (click_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  primary key (product_id, click_key)
);

create index product_click_receipts_expires_at_idx
  on private.product_click_receipts (expires_at);

create table private.product_click_totals (
  product_id uuid primary key references public.products(id) on delete cascade,
  click_count bigint not null default 0 check (click_count >= 0),
  last_clicked_at timestamptz not null default now()
);

alter table private.product_click_receipts enable row level security;
alter table private.product_click_totals enable row level security;

revoke all on schema private from public, anon, authenticated;
revoke all on table
  private.product_click_receipts,
  private.product_click_totals
from public, anon, authenticated, service_role;

create function public.record_product_click(
  p_product_id uuid,
  p_click_key text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rows_affected integer;
begin
  if p_product_id is null
    or p_click_key is null
    or p_click_key !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid product click' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.products p
    join public.trends t on t.id = p.trend_id
    where p.id = p_product_id
      and p.is_active
      and t.is_active
  ) then
    raise exception 'Product is not active' using errcode = '22023';
  end if;

  -- Expired product-specific keys are purged on subsequent FiV Heat activity.
  delete from private.product_click_receipts r
  where r.expires_at <= v_now;

  insert into private.product_click_receipts as existing (
    product_id,
    click_key,
    expires_at
  )
  values (
    p_product_id,
    p_click_key,
    v_now + interval '6 hours'
  )
  on conflict (product_id, click_key) do update
    set expires_at = excluded.expires_at
    where existing.expires_at <= v_now;

  get diagnostics v_rows_affected = row_count;

  if v_rows_affected = 0 then
    return false;
  end if;

  insert into private.product_click_totals as totals (
    product_id,
    click_count,
    last_clicked_at
  )
  values (p_product_id, 1, v_now)
  on conflict (product_id) do update
    set click_count = totals.click_count + 1,
        last_clicked_at = excluded.last_clicked_at;

  return true;
end;
$$;

revoke all on function public.record_product_click(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_product_click(uuid, text)
  to service_role;

create function public.get_trend_click_heat(p_trend_id uuid)
returns table (
  product_id uuid,
  heat_percent integer,
  total_clicks bigint,
  product_count integer,
  has_signal boolean
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with caller as (
    select
      auth.uid() is not null
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
      as allowed
  ),
  active_products as (
    select
      p.id as product_id,
      coalesce(totals.click_count, 0)::bigint as click_count
    from public.products p
    join public.trends t on t.id = p.trend_id
    left join private.product_click_totals totals on totals.product_id = p.id
    where p.trend_id = p_trend_id
      and p.is_active
      and t.is_active
  ),
  trend_totals as (
    select
      coalesce(sum(ap.click_count), 0)::bigint as total_clicks,
      count(*)::integer as product_count
    from active_products ap
  )
  select
    ap.product_id,
    case
      when tt.total_clicks = 0 or tt.product_count = 0 then 0
      else round(
        100.0 * (ap.click_count + 10.0)
        / (tt.total_clicks + (10.0 * tt.product_count))
      )::integer
    end as heat_percent,
    tt.total_clicks,
    tt.product_count,
    tt.total_clicks > 0 as has_signal
  from active_products ap
  cross join trend_totals tt
  cross join caller c
  where c.allowed;
$$;

revoke all on function public.get_trend_click_heat(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_trend_click_heat(uuid)
  to authenticated;

comment on table private.product_click_receipts is
  'Short-lived, product-specific anonymous deduplication receipts for FiV Heat.';
comment on table private.product_click_totals is
  'Aggregate anonymous product-card opens used by FiV Heat.';
comment on function public.record_product_click(uuid, text) is
  'Records one anonymous product-card open per product-specific key every six hours.';
comment on function public.get_trend_click_heat(uuid) is
  'Returns Bayesian-smoothed product-open shares for active products in one trend.';

notify pgrst, 'reload schema';

commit;
