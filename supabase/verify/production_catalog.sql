-- Read-only production verification. Run after applying the public launch migration.

do $verify$
declare
  v_function_oid regprocedure := to_regprocedure('public.request_early_access(text,text)');
  v_rls_enabled boolean;
  v_security_definer boolean;
  v_function_config text;
begin
  if to_regclass('public.early_access_requests') is null then
    raise exception 'Missing public.early_access_requests';
  end if;

  select relrowsecurity
  into v_rls_enabled
  from pg_class
  where oid = 'public.early_access_requests'::regclass;

  if not v_rls_enabled then
    raise exception 'RLS is not enabled on public.early_access_requests';
  end if;

  if has_table_privilege('anon', 'public.early_access_requests', 'select')
    or has_table_privilege('anon', 'public.early_access_requests', 'insert')
    or has_table_privilege('anon', 'public.early_access_requests', 'update')
    or has_table_privilege('anon', 'public.early_access_requests', 'delete')
    or has_table_privilege('authenticated', 'public.early_access_requests', 'select')
    or has_table_privilege('authenticated', 'public.early_access_requests', 'insert')
    or has_table_privilege('authenticated', 'public.early_access_requests', 'update')
    or has_table_privilege('authenticated', 'public.early_access_requests', 'delete')
  then
    raise exception 'Direct Data API table privileges are still present';
  end if;

  if v_function_oid is null then
    raise exception 'Missing public.request_early_access(text,text)';
  end if;

  if has_function_privilege('anon', v_function_oid, 'execute')
    or has_function_privilege('authenticated', v_function_oid, 'execute')
  then
    raise exception 'Public roles can still execute the waitlist RPC directly';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'execute') then
    raise exception 'service_role cannot execute the waitlist RPC';
  end if;

  select prosecdef, array_to_string(proconfig, ',')
  into v_security_definer, v_function_config
  from pg_proc
  where oid = v_function_oid;

  if not v_security_definer then
    raise exception 'The waitlist RPC is not SECURITY DEFINER';
  end if;

  if v_function_config is distinct from 'search_path=pg_catalog, pg_temp' then
    raise exception 'Unexpected RPC search_path: %', v_function_config;
  end if;

  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.early_access_requests'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) like '%lower(email)%'
  ) then
    raise exception 'Missing case-insensitive email uniqueness index';
  end if;

  if to_regclass('public.early_access_requests_expires_at_idx') is null then
    raise exception 'Missing expires_at retention index';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'early_access_requests'
  ) then
    raise exception 'Unexpected waitlist table policy exists';
  end if;

  raise notice 'FindItViral public waitlist catalog verification passed';
end
$verify$;

select
  count(*) as active_requests,
  min(created_at) as oldest_request,
  min(expires_at) as next_expiration
from public.early_access_requests
where expires_at > now();

