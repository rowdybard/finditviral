-- Owner gate: private app_owners table and is_app_owner RPC.

create schema if not exists private;

create table if not exists private.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.app_owners enable row level security;
revoke all on private.app_owners from public, anon, authenticated;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.app_owners
      where user_id = auth.uid()
    );
$$;

revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

comment on table private.app_owners is
  'Whitelist of Supabase Auth users who can access the private app.';
comment on function public.is_app_owner() is
  'Returns true if the current authenticated user is in the app_owners table.';
