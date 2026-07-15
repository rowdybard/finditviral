begin;

-- The photo-array signatures supersede these defaulted overloads. Keeping both
-- makes ordinary Postgres and PostgREST calls ambiguous.
drop function if exists public.create_sighting(
  uuid, uuid, timestamptz, text, integer, text, uuid
);
drop function if exists public.confirm_lead_with_sighting(
  uuid, uuid, timestamptz, text, integer, text
);

-- Serialize contribution-limit checks for a member and contribution type. The
-- advisory lock is held until the caller's transaction commits, so a successful
-- check and its subsequent insert are atomic with respect to competing RPCs.
create or replace function private.check_contribution_rate_limit(
  p_user_id uuid,
  p_type text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_limit integer;
  v_count integer;
  v_is_owner boolean;
begin
  if p_user_id is null then
    raise exception 'A user is required' using errcode = '22023';
  end if;

  if p_type not in ('sighting', 'bounty', 'suggestion', 'lead') then
    raise exception 'Unknown contribution type' using errcode = '22023';
  end if;

  select exists (
    select 1 from private.app_owners ao where ao.user_id = p_user_id
  ) into v_is_owner;

  if v_is_owner then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('contribution:' || p_user_id::text || ':' || p_type, 0)
  );

  v_limit := case p_type
    when 'sighting' then 10
    when 'bounty' then 5
    when 'suggestion' then 5
    when 'lead' then 10
  end;

  if p_type = 'sighting' then
    select count(*) into v_count
    from public.sightings s
    where s.user_id = p_user_id
      and s.created_at > now() - interval '1 hour';

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for sightings'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' sightings per hour. Please try again later.';
    end if;
  elsif p_type = 'bounty' then
    select count(*) into v_count
    from public.bounties b
    where b.user_id = p_user_id
      and b.created_at > now() - interval '1 hour';

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for bounties'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' bounties per hour. Please try again later.';
    end if;
  elsif p_type = 'suggestion' then
    select
       (select count(*)
       from private.product_suggestions ps
       where ps.user_id = p_user_id
         and ps.created_at > now() - interval '1 hour')
      +
       (select count(*)
       from private.store_suggestions ss
       where ss.user_id = p_user_id
         and ss.created_at > now() - interval '1 hour')
    into v_count;

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for suggestions'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' suggestions per hour. Please try again later.';
    end if;
  else
    select count(*) into v_count
    from public.leads l
    where l.user_id = p_user_id
      and l.created_at > now() - interval '1 hour';

    if v_count >= v_limit then
      raise exception 'Rate limit exceeded for leads'
        using errcode = '42901',
              hint = 'You can submit at most ' || v_limit || ' leads per hour. Please try again later.';
    end if;
  end if;
end;
$$;

revoke all on function private.check_contribution_rate_limit(uuid, text) from public;

-- Authoritative, transaction-safe limits for unauthenticated worker endpoints.
-- Only the service role can call the public wrapper; raw client IPs are never
-- stored because the worker sends a keyed SHA-256 digest.
create table if not exists private.public_request_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash),
  constraint public_request_rate_limits_scope_check
    check (scope in ('early_access_primary', 'early_access_daily', 'product_click')),
  constraint public_request_rate_limits_key_hash_check
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint public_request_rate_limits_count_check
    check (request_count >= 0)
);

alter table private.public_request_rate_limits enable row level security;

revoke all on table private.public_request_rate_limits
  from public, anon, authenticated, service_role;

create index if not exists public_request_rate_limits_updated_at_idx
  on private.public_request_rate_limits (updated_at);

create or replace function public.consume_public_request_limit(
  p_scope text,
  p_key_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_primary_count integer := 0;
  v_daily_count integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_scope not in ('early_access', 'product_click') then
    raise exception 'Unknown rate-limit scope' using errcode = '22023';
  end if;

  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key' using errcode = '22023';
  end if;

  -- Opportunistic bounded cleanup keeps the private table from growing forever.
  delete from private.public_request_rate_limits r
  where r.updated_at < v_now - interval '2 days';

  if p_scope = 'early_access' then
    -- Always lock the daily window before the shorter window to avoid deadlocks.
    perform pg_advisory_xact_lock(
      hashtextextended('public-rate:early_access_daily:' || p_key_hash, 0)
    );
    perform pg_advisory_xact_lock(
      hashtextextended('public-rate:early_access_primary:' || p_key_hash, 0)
    );

    select case
      when r.window_started_at > v_now - interval '1 day' then r.request_count
      else 0
    end
    into v_daily_count
    from private.public_request_rate_limits r
    where r.scope = 'early_access_daily' and r.key_hash = p_key_hash;

    select case
      when r.window_started_at > v_now - interval '10 minutes' then r.request_count
      else 0
    end
    into v_primary_count
    from private.public_request_rate_limits r
    where r.scope = 'early_access_primary' and r.key_hash = p_key_hash;

    v_daily_count := coalesce(v_daily_count, 0);
    v_primary_count := coalesce(v_primary_count, 0);

    if v_daily_count >= 20 or v_primary_count >= 5 then
      return false;
    end if;

    insert into private.public_request_rate_limits as existing
      (scope, key_hash, window_started_at, request_count, updated_at)
    values ('early_access_daily', p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set request_count = case
            when existing.window_started_at <= v_now - interval '1 day' then 1
            else existing.request_count + 1
          end,
          window_started_at = case
            when existing.window_started_at <= v_now - interval '1 day' then v_now
            else existing.window_started_at
          end,
          updated_at = v_now;

    insert into private.public_request_rate_limits as existing
      (scope, key_hash, window_started_at, request_count, updated_at)
    values ('early_access_primary', p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set request_count = case
            when existing.window_started_at <= v_now - interval '10 minutes' then 1
            else existing.request_count + 1
          end,
          window_started_at = case
            when existing.window_started_at <= v_now - interval '10 minutes' then v_now
            else existing.window_started_at
          end,
          updated_at = v_now;

    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public-rate:product_click:' || p_key_hash, 0)
  );

  select case
    when r.window_started_at > v_now - interval '10 minutes' then r.request_count
    else 0
  end
  into v_primary_count
  from private.public_request_rate_limits r
  where r.scope = 'product_click' and r.key_hash = p_key_hash;

  v_primary_count := coalesce(v_primary_count, 0);

  if v_primary_count >= 60 then
    return false;
  end if;

  insert into private.public_request_rate_limits as existing
    (scope, key_hash, window_started_at, request_count, updated_at)
  values ('product_click', p_key_hash, v_now, 1, v_now)
  on conflict (scope, key_hash) do update
    set request_count = case
          when existing.window_started_at <= v_now - interval '10 minutes' then 1
          else existing.request_count + 1
        end,
        window_started_at = case
          when existing.window_started_at <= v_now - interval '10 minutes' then v_now
          else existing.window_started_at
        end,
        updated_at = v_now;

  return true;
end;
$$;

revoke all on function public.consume_public_request_limit(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_public_request_limit(text, text)
  to service_role;

-- Existing rows contain public Storage URLs. Convert only URLs belonging to the
-- managed bucket; external legacy/mock URLs remain untouched.
update public.sightings s
set photo_urls = (
  select array_agg(
    case
      when u.photo_url like '%/storage/v1/object/public/sighting-photos/%'
        then split_part(
          split_part(u.photo_url, '/storage/v1/object/public/sighting-photos/', 2),
          '?',
          1
        )
      else u.photo_url
    end
    order by u.ordinality
  )
  from unnest(s.photo_urls) with ordinality as u(photo_url, ordinality)
)
where s.photo_urls is not null
  and exists (
    select 1
    from unnest(s.photo_urls) as p(photo_url)
    where p.photo_url like '%/storage/v1/object/public/sighting-photos/%'
  );

insert into storage.buckets (id, name, public)
values ('sighting-photos', 'sighting-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "Public read sighting photos" on storage.objects;
drop policy if exists "Owners and moderators read sighting photos" on storage.objects;
drop policy if exists "Approved sightings read photos" on storage.objects;

create policy "Owners and moderators read sighting photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sighting-photos'
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_app_owner())
    )
  );

create policy "Approved sightings read photos"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'sighting-photos'
    and exists (
      select 1
      from public.sightings s
      where s.is_public
        and s.moderation_status = 'approved'
        and storage.objects.name = any(s.photo_urls)
    )
  );

create or replace function private.assert_owned_sighting_photo_paths(
  p_user_id uuid,
  p_photo_paths text[]
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, storage, private, pg_temp
as $$
declare
  v_path_count integer := coalesce(cardinality(p_photo_paths), 0);
  v_owned_count integer;
begin
  if v_path_count = 0 then
    return;
  end if;

  if p_user_id is null or v_path_count > 4 then
    raise exception 'Sightings can include at most four owned photos'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_photo_paths) as p(path)
    where p.path is null
      or char_length(p.path) > 255
      or p.path !~ ('^' || p_user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
  ) then
    raise exception 'Every sighting photo must be an owned Storage object path'
      using errcode = '22023';
  end if;

  if (select count(distinct p.path) from unnest(p_photo_paths) as p(path)) <> v_path_count then
    raise exception 'Duplicate sighting photo paths are not allowed'
      using errcode = '22023';
  end if;

  select count(*) into v_owned_count
  from storage.objects o
  where o.bucket_id = 'sighting-photos'
    and o.owner_id = p_user_id::text
    and o.name = any(p_photo_paths);

  if v_owned_count <> v_path_count then
    raise exception 'Every sighting photo must be owned by the contributor'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_owned_sighting_photo_paths(uuid, text[])
  from public;

create or replace function private.enforce_sighting_photo_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $$
begin
  perform private.assert_owned_sighting_photo_paths(new.user_id, new.photo_urls);
  return new;
end;
$$;

revoke all on function private.enforce_sighting_photo_ownership() from public;

drop trigger if exists enforce_sighting_photo_ownership on public.sightings;
create trigger enforce_sighting_photo_ownership
before insert or update of user_id, photo_urls on public.sightings
for each row
execute function private.enforce_sighting_photo_ownership();

notify pgrst, 'reload schema';

commit;
