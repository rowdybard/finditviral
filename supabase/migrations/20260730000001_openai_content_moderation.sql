-- Automated safety moderation for text-bearing contributions. The Worker is
-- the only caller for the service-role functions below; browser clients never
-- receive access to the result table or mutation functions.

begin;

create table private.content_moderation_results (
  id uuid primary key default gen_random_uuid(),
  contribution_type text not null check (contribution_type in ('bounty', 'lead', 'sighting')),
  contribution_id uuid not null,
  flagged boolean not null,
  categories text[] not null default '{}'::text[],
  model text not null check (char_length(model) between 1 and 160),
  created_at timestamptz not null default now(),
  notification_sent_at timestamptz,
  unique (contribution_type, contribution_id)
);

create index content_moderation_results_notification_idx
  on private.content_moderation_results (created_at)
  where flagged and notification_sent_at is null;

alter table private.content_moderation_results enable row level security;
revoke all on table private.content_moderation_results from public, anon, authenticated, service_role;

create function public.get_pending_moderation_queue(
  p_limit integer default 25
)
returns table (
  contribution_type text,
  contribution_id uuid,
  text_content text,
  product_name text,
  username text,
  result_flagged boolean,
  result_categories text[],
  result_model text,
  needs_notification boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_limit integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'Moderation queue limit must be between 1 and 25'
      using errcode = '22023', hint = 'INVALID_LIMIT';
  end if;
  v_limit := p_limit;

  return query
  with candidates as (
    select
      'bounty'::text as contribution_type,
      b.id as contribution_id,
      concat_ws(E'\n\n',
        case when nullif(btrim(b.requirements), '') is not null then 'Requirements:\n' || b.requirements end,
        case when nullif(btrim(b.variant_requirements), '') is not null then 'Variant requirements:\n' || b.variant_requirements end
      ) as text_content,
      p.name as product_name,
      pr.username,
      r.flagged as result_flagged,
      r.categories as result_categories,
      r.model as result_model,
      r.notification_sent_at,
      b.created_at
    from public.bounties b
    join public.products p on p.id = b.product_id
    join public.profiles pr on pr.id = b.user_id
    left join private.content_moderation_results r
      on r.contribution_type = 'bounty' and r.contribution_id = b.id
    where b.moderation_status = 'pending'
      and b.created_at >= now() - interval '24 hours'
      and (r.id is null or (r.flagged and r.notification_sent_at is null))

    union all

    select
      'lead'::text,
      l.id,
      concat_ws(E'\n\n',
        'Headline:\n' || l.headline,
        case when nullif(btrim(l.details), '') is not null then 'Details:\n' || l.details end
      ),
      p.name,
      pr.username,
      r.flagged,
      r.categories,
      r.model,
      r.notification_sent_at,
      l.created_at
    from public.leads l
    join public.products p on p.id = l.product_id
    join public.profiles pr on pr.id = l.user_id
    left join private.content_moderation_results r
      on r.contribution_type = 'lead' and r.contribution_id = l.id
    where l.status = 'pending'
      and l.created_at >= now() - interval '24 hours'
      and (r.id is null or (r.flagged and r.notification_sent_at is null))

    union all

    select
      'sighting'::text,
      s.id,
      coalesce(s.notes, ''),
      p.name,
      pr.username,
      r.flagged,
      r.categories,
      r.model,
      r.notification_sent_at,
      s.created_at
    from public.sightings s
    join public.leads l on l.id = s.lead_id
    join public.products p on p.id = s.product_id
    join public.profiles pr on pr.id = s.user_id
    left join private.content_moderation_results r
      on r.contribution_type = 'sighting' and r.contribution_id = s.id
    where s.moderation_status = 'pending'
      and not s.is_public
      and s.bounty_id is null
      and l.status = 'active'
      and l.confirmed_sighting_id = s.id
      and s.created_at >= now() - interval '24 hours'
      and (r.id is null or (r.flagged and r.notification_sent_at is null))
  )
  select
    c.contribution_type,
    c.contribution_id,
    c.text_content,
    c.product_name,
    c.username,
    c.result_flagged,
    coalesce(c.result_categories, '{}'::text[]),
    c.result_model,
    coalesce(c.result_flagged, false) and c.notification_sent_at is null
  from candidates c
  order by c.created_at, c.contribution_type, c.contribution_id
  limit v_limit;
end;
$$;

create function public.set_content_moderation_result(
  p_contribution_type text,
  p_contribution_id uuid,
  p_flagged boolean,
  p_categories text[] default '{}'::text[],
  p_model text default 'omni-moderation-latest'
)
returns table (
  recorded boolean,
  result_flagged boolean,
  auto_approved boolean,
  notification_pending boolean
)
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_result_id uuid;
  v_existing_flagged boolean;
  v_existing_notification_sent_at timestamptz;
  v_categories text[] := case when p_flagged then coalesce(p_categories, '{}'::text[]) else '{}'::text[] end;
  v_bounty_status text;
  v_lead_status text;
  v_sighting_status text;
  v_confirmed_sighting_id uuid;
begin
  if p_contribution_type not in ('bounty', 'lead', 'sighting')
    or p_contribution_id is null
    or p_flagged is null
    or nullif(btrim(p_model), '') is null
    or char_length(p_model) > 160
    or cardinality(v_categories) > 32
    or exists (select 1 from unnest(v_categories) category where char_length(category) > 120)
  then
    raise exception 'Invalid content moderation result' using errcode = '22023';
  end if;

  select r.flagged, r.notification_sent_at
    into v_existing_flagged, v_existing_notification_sent_at
  from private.content_moderation_results r
  where r.contribution_type = p_contribution_type
    and r.contribution_id = p_contribution_id;
  if found then
    return query select false, v_existing_flagged, false,
      v_existing_flagged and v_existing_notification_sent_at is null;
    return;
  end if;

  if p_contribution_type = 'bounty' then
    select b.moderation_status into v_bounty_status
    from public.bounties b
    where b.id = p_contribution_id
    for update;
    if not found or v_bounty_status <> 'pending' then
      return query select false, p_flagged, false, false;
      return;
    end if;
  elsif p_contribution_type = 'lead' then
    select l.status into v_lead_status
    from public.leads l
    where l.id = p_contribution_id
    for update;
    if not found or v_lead_status <> 'pending' then
      return query select false, p_flagged, false, false;
      return;
    end if;
  else
    select s.moderation_status, l.status, l.confirmed_sighting_id
      into v_sighting_status, v_lead_status, v_confirmed_sighting_id
    from public.sightings s
    join public.leads l on l.id = s.lead_id
    where s.id = p_contribution_id
      and s.bounty_id is null
    for update of s, l;
    if not found
      or v_sighting_status <> 'pending'
      or v_lead_status <> 'active'
      or v_confirmed_sighting_id <> p_contribution_id
    then
      return query select false, p_flagged, false, false;
      return;
    end if;
  end if;

  insert into private.content_moderation_results (
    contribution_type, contribution_id, flagged, categories, model
  ) values (
    p_contribution_type, p_contribution_id, p_flagged, v_categories, btrim(p_model)
  )
  on conflict (contribution_type, contribution_id) do nothing
  returning id into v_result_id;

  if v_result_id is null then
    select r.flagged, r.notification_sent_at
      into v_existing_flagged, v_existing_notification_sent_at
    from private.content_moderation_results r
    where r.contribution_type = p_contribution_type
      and r.contribution_id = p_contribution_id;
    return query select false, coalesce(v_existing_flagged, p_flagged), false,
      coalesce(v_existing_flagged, false) and v_existing_notification_sent_at is null;
    return;
  end if;

  if p_flagged then
    return query select true, true, false, true;
    return;
  end if;

  if p_contribution_type = 'bounty' then
    update public.bounties
    set moderation_status = 'approved',
        moderated_by = null,
        moderated_at = null,
        moderation_reason = null
    where id = p_contribution_id;
  elsif p_contribution_type = 'lead' then
    update public.leads
    set status = 'active',
        moderated_by = null,
        moderated_at = null
    where id = p_contribution_id;
  else
    update public.sightings
    set moderation_status = 'approved',
        is_public = true,
        moderated_by = null,
        moderated_at = null,
        moderation_reason = null
    where id = p_contribution_id;
  end if;

  return query select true, false, true, false;
end;
$$;

create function public.mark_content_moderation_notification_sent(
  p_contribution_type text,
  p_contribution_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
declare
  v_marked boolean := false;
begin
  if p_contribution_type not in ('bounty', 'lead', 'sighting') or p_contribution_id is null then
    raise exception 'Invalid content moderation notification' using errcode = '22023';
  end if;

  update private.content_moderation_results r
  set notification_sent_at = now()
  where r.contribution_type = p_contribution_type
    and r.contribution_id = p_contribution_id
    and r.flagged
    and r.notification_sent_at is null
  returning true into v_marked;

  return coalesce(v_marked, false);
end;
$$;

revoke all on function public.get_pending_moderation_queue(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.set_content_moderation_result(text, uuid, boolean, text[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_content_moderation_notification_sent(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pending_moderation_queue(integer) to service_role;
grant execute on function public.set_content_moderation_result(text, uuid, boolean, text[], text) to service_role;
grant execute on function public.mark_content_moderation_notification_sent(text, uuid) to service_role;

-- Clean automated results are not owner tasks. Flagged results and work that
-- aged out of the 24-hour automated window remain in the existing owner badge.
create or replace function public.get_admin_review_counts()
returns table (
  pending_sightings bigint,
  pending_bounties bigint,
  pending_leads bigint,
  pending_product_suggestions bigint,
  pending_store_suggestions bigint,
  total bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
  with counts as (
    select
      (select count(*) from public.sightings s
        where s.moderation_status = 'pending' and s.lead_id is null) as sightings_count,
      (select count(*) from public.bounties b
        left join private.content_moderation_results r
          on r.contribution_type = 'bounty' and r.contribution_id = b.id
        where b.moderation_status = 'pending'
          and (r.flagged or (r.id is null and b.created_at < now() - interval '24 hours'))
      ) as bounties_count,
      (
        (select count(*) from public.leads l
          left join private.content_moderation_results r
            on r.contribution_type = 'lead' and r.contribution_id = l.id
          where l.status = 'pending'
            and (r.flagged or (r.id is null and l.created_at < now() - interval '24 hours'))
        )
        +
        (select count(*) from public.leads l
          join public.sightings s on s.id = l.confirmed_sighting_id
          left join private.content_moderation_results r
            on r.contribution_type = 'sighting' and r.contribution_id = s.id
          where l.status = 'active'
            and s.moderation_status = 'pending'
            and (r.flagged or (r.id is null and s.created_at < now() - interval '24 hours'))
        )
      ) as leads_count,
      (select count(*) from private.product_suggestions ps where ps.status = 'pending') as product_suggestions_count,
      (select count(*) from private.store_suggestions ss where ss.status = 'pending') as store_suggestions_count
  )
  select
    sightings_count,
    bounties_count,
    leads_count,
    product_suggestions_count,
    store_suggestions_count,
    sightings_count + bounties_count + leads_count + product_suggestions_count + store_suggestions_count
  from counts;
end;
$$;

revoke all on function public.get_admin_review_counts()
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_review_counts() to authenticated;

drop function if exists public.admin_list_recent_contributions(integer);

create function public.admin_list_recent_contributions(
  p_limit integer default 100
)
returns table (
  contribution_type text,
  contribution_id uuid,
  username text,
  product_name text,
  moderation_status text,
  lifecycle_status text,
  occurred_at timestamptz,
  verified_count bigint,
  not_found_count bigint,
  last_verified_at timestamptz,
  last_not_found_at timestamptz,
  community_state text,
  moderation_flagged boolean,
  moderation_categories text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public, pg_temp
as $$
begin
  perform private.assert_app_owner();

  return query
  with recent as (
    select *
    from (
      select
        'sighting'::text as contribution_type,
        s.id as contribution_id,
        pr.username,
        p.name as product_name,
        s.moderation_status,
        case when s.seen_at >= now() - interval '7 days' then 'fresh' else 'expired' end as lifecycle_status,
        s.created_at as occurred_at
      from public.sightings s
      join public.profiles pr on pr.id = s.user_id
      join public.products p on p.id = s.product_id

      union all

      select 'bounty'::text, b.id, pr.username, p.name, b.moderation_status, b.status, b.created_at
      from public.bounties b
      join public.profiles pr on pr.id = b.user_id
      join public.products p on p.id = b.product_id

      union all

      select 'lead'::text, l.id, pr.username, p.name, l.status, null::text, l.created_at
      from public.leads l
      join public.profiles pr on pr.id = l.user_id
      join public.products p on p.id = l.product_id
    ) all_contributions
    order by occurred_at desc, contribution_id
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ), summaries as (
    select summary.*
    from private.sighting_verification_summaries(
      coalesce((select array_agg(r.contribution_id) from recent r where r.contribution_type = 'sighting'), '{}'::uuid[]),
      null
    ) summary
  )
  select
    r.contribution_type,
    r.contribution_id,
    r.username,
    r.product_name,
    r.moderation_status,
    r.lifecycle_status,
    r.occurred_at,
    case when r.contribution_type = 'sighting' then coalesce(summaries.verified_count, 0::bigint) else 0::bigint end,
    case when r.contribution_type = 'sighting' then coalesce(summaries.not_found_count, 0::bigint) else 0::bigint end,
    case when r.contribution_type = 'sighting' then summaries.last_verified_at else null::timestamptz end,
    case when r.contribution_type = 'sighting' then summaries.last_not_found_at else null::timestamptz end,
    case when r.contribution_type = 'sighting' then coalesce(summaries.community_state, 'unverified') else null::text end,
    coalesce(moderation.flagged, false),
    coalesce(moderation.categories, '{}'::text[])
  from recent r
  left join summaries on summaries.sighting_id = r.contribution_id
  left join private.content_moderation_results moderation
    on moderation.contribution_type = r.contribution_type
    and moderation.contribution_id = r.contribution_id
  order by r.occurred_at desc, r.contribution_id;
end;
$$;

revoke all on function public.admin_list_recent_contributions(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_recent_contributions(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
