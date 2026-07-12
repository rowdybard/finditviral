-- Public-launch waitlist baseline.
-- Safe to run on a new project or after the private-app migrations.

create extension if not exists pgcrypto;

create table if not exists public.early_access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 months')
);

alter table public.early_access_requests
  add column if not exists expires_at timestamptz;

update public.early_access_requests
set expires_at = created_at + interval '24 months'
where expires_at is null;

alter table public.early_access_requests
  alter column expires_at set default (now() + interval '24 months'),
  alter column expires_at set not null;

create unique index if not exists early_access_requests_email_key
  on public.early_access_requests (lower(email));

create index if not exists early_access_requests_expires_at_idx
  on public.early_access_requests (expires_at);

alter table public.early_access_requests enable row level security;

drop policy if exists "public_early_access_insert" on public.early_access_requests;
revoke all on public.early_access_requests from public, anon, authenticated;

-- A single RPC owns validation, normalization, duplicate handling, and the
-- retention sweep. Callers always receive the same successful response for a
-- new or existing address, so the endpoint does not disclose list membership.
create or replace function public.request_early_access(
  p_email text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_reason text := trim(p_reason);
begin
  if v_email is null
    or v_reason is null
    or char_length(v_email) not between 3 and 320
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_reason) not between 10 and 1200
  then
    raise exception 'Invalid early-access request' using errcode = '22023';
  end if;

  delete from public.early_access_requests
  where expires_at <= now();

  insert into public.early_access_requests (email, reason)
  values (v_email, v_reason)
  on conflict ((lower(email))) do nothing;
end;
$$;

revoke all on function public.request_early_access(text, text) from public, anon, authenticated;
grant execute on function public.request_early_access(text, text) to anon, authenticated;

comment on table public.early_access_requests is
  'Private early-access submissions. Rows expire after 24 months.';

comment on function public.request_early_access(text, text) is
  'Validates and stores an early-access request without revealing membership.';
