-- Onboarding, referral system, and launch promo.
-- Safe to run on a new project or after the private-app migrations.

-- Add onboarding and referral columns to profiles
alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles
  add column if not exists referred_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  add column if not exists referral_count integer not null default 0;

alter table public.profiles
  add column if not exists looking_for text;

-- Update handle_new_user to grant launch promo Pro for 90 days
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, karma, is_pro)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
    0,
    now() < '2026-10-12T00:00:00Z'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Complete onboarding: set username, mark done, process referral
create or replace function public.complete_onboarding(
  p_username text,
  p_zip_code text default null,
  p_looking_for text default null,
  p_referrer_username text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_username text;
  v_referrer_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_clean_username := lower(trim(p_username));
  if v_clean_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 characters, letters/numbers/underscore only'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.profiles
    where username = v_clean_username and id <> v_user_id
  ) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  -- Resolve referrer (can't be self, must have < 9 referrals)
  v_referrer_id := null;
  if p_referrer_username is not null then
    select id into v_referrer_id from public.profiles
    where username = lower(trim(p_referrer_username))
      and id <> v_user_id
      and referral_count < 9
    limit 1;
  end if;

  update public.profiles
  set username = v_clean_username,
    onboarding_completed = true,
    looking_for = nullif(trim(p_looking_for), ''),
    referred_by = v_referrer_id
  where id = v_user_id;

  if v_referrer_id is not null then
    update public.profiles
    set referral_count = referral_count + 1
    where id = v_referrer_id;
  end if;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text) from anon, authenticated;
grant execute on function public.complete_onboarding(text, text, text, text) to authenticated;

comment on function public.complete_onboarding(text, text, text, text) is
  'Sets username, marks onboarding complete, and processes referral bonus.';
