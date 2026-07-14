-- Run after applying 20260714015817_greater_lansing_open_beta_launch.sql.
-- Raises on any contract or privilege drift.

do $$
declare
  v_missing text[];
begin
  select array_agg(required_object)
  into v_missing
  from unnest(array[
    'public.retailers',
    'public.stores',
    'private.username_claims',
    'private.product_suggestions',
    'private.store_suggestions',
    'private.contribution_drafts',
    'private.interest_events',
    'private.digest_runs',
    'private.digest_run_items',
    'private.digest_delivery_attempts'
  ]) required_object
  where to_regclass(required_object) is null;

  if cardinality(v_missing) > 0 then
    raise exception 'Missing launch objects: %', v_missing;
  end if;

  if (select count(*) from private.username_claims)
    <> (select count(*) from public.profiles)
  then
    raise exception 'Username registry/profile count mismatch';
  end if;

  if exists (
    select 1 from private.username_claims
    where claimed_username ~ '^user_[0-9a-f]{15}$'
      and normalized_username is not null
  ) then
    raise exception 'Generated username placeholder received a protection key';
  end if;

  if not exists (
    select 1 from public.zip_codes
    where zip_code = '48910' and state = 'MI'
  ) then
    raise exception 'Missing Greater Lansing default ZIP 48910';
  end if;

  if (select count(*) from public.stores where is_active) < 15 then
    raise exception 'Expected at least 15 active verified launch stores';
  end if;

  if has_table_privilege('authenticated', 'public.sightings', 'insert')
    or has_table_privilege('authenticated', 'public.bounties', 'insert')
  then
    raise exception 'Direct contribution inserts are still granted';
  end if;

  if has_column_privilege(
      'authenticated', 'public.bounties', 'moderation_reason', 'select'
    )
    or has_column_privilege(
      'authenticated', 'public.sightings', 'moderated_by', 'select'
    )
  then
    raise exception 'Private contribution moderation fields are exposed';
  end if;

  if has_function_privilege('anon', 'public.request_early_access(text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.request_early_access(text,text)', 'execute')
  then
    raise exception 'Early-access RPC bypasses the Worker';
  end if;

  if not has_function_privilege('service_role', 'public.request_early_access(text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_interest_digest_attempt(timestamp with time zone)', 'execute')
    or not has_function_privilege('service_role', 'public.complete_interest_digest_attempt(uuid,uuid,text,text,text,text)', 'execute')
  then
    raise exception 'Worker RPC grants are incomplete';
  end if;

  if to_regprocedure('public.complete_onboarding(text,text,text,text,text[])') is null
    or to_regprocedure('public.create_sighting(uuid,uuid,timestamp with time zone,text,integer,text,uuid)') is null
    or to_regprocedure('public.create_bounty(uuid,uuid,text,integer,integer,timestamp with time zone,text,uuid)') is null
    or to_regprocedure('public.admin_resolve_product_suggestion(uuid,text,uuid,text,text,date)') is null
  then
    raise exception 'Required member RPC signature is missing';
  end if;

  if exists (
    select 1
    from private.interest_events e
    group by e.dedupe_key
    having count(*) > 1
  ) then
    raise exception 'Interest outbox dedupe keys are not unique';
  end if;
end
$$;

select
  (select count(*) from public.products where is_active) as active_products,
  (select count(*) from public.stores where is_active) as active_stores,
  (select count(*) from private.username_claims) as username_claims,
  (select count(*) from private.interest_events) as interest_events,
  (select count(*) from private.digest_runs) as digest_runs;
