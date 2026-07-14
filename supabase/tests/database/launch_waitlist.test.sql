begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select has_table(
  'public',
  'early_access_requests',
  'the private waitlist table exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.early_access_requests'::regclass),
  'row level security is enabled'
);

select ok(
  not has_table_privilege('anon', 'public.early_access_requests', 'select'),
  'anon cannot read the table directly'
);

select ok(
  not has_table_privilege('anon', 'public.early_access_requests', 'insert'),
  'anon cannot insert into the table directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.early_access_requests', 'select'),
  'authenticated users cannot read the table directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.early_access_requests', 'insert'),
  'authenticated users cannot insert into the table directly'
);

select ok(
  not has_function_privilege('anon', 'public.request_early_access(text,text)', 'execute'),
  'anon cannot execute the waitlist RPC directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.request_early_access(text,text)', 'execute'),
  'authenticated users cannot execute the waitlist RPC directly'
);

select ok(
  has_function_privilege('service_role', 'public.request_early_access(text,text)', 'execute'),
  'service_role can execute the waitlist RPC'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.request_early_access(text,text)'::regprocedure),
  'the request RPC is security definer'
);

select is(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = 'public.request_early_access(text,text)'::regprocedure
  ),
  'search_path=pg_catalog, private, pg_temp',
  'the request RPC has a hardened search path'
);

select ok(
  exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.early_access_requests'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) like '%lower(email)%'
  ),
  'email uniqueness is case-insensitive'
);

select has_index(
  'public',
  'early_access_requests',
  'early_access_requests_expires_at_idx',
  'the retention sweep has an expires_at index'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'early_access_requests'),
  0::bigint,
  'the table exposes no public row policies'
);

truncate table public.early_access_requests;

select lives_ok(
  $$select public.request_early_access(' TEST@Example.com ', ' A sufficiently detailed reason ')$$,
  'a valid request is accepted'
);

select is(
  (select email from public.early_access_requests limit 1),
  'test@example.com',
  'email is trimmed and lowercased'
);

select is(
  (select reason from public.early_access_requests limit 1),
  'A sufficiently detailed reason',
  'reason is trimmed'
);

select lives_ok(
  $$select public.request_early_access('test@example.com', 'A different valid reason')$$,
  'a duplicate request returns the same successful response'
);

select is(
  (select count(*) from public.early_access_requests where email = 'test@example.com'),
  1::bigint,
  'a duplicate request creates no second row'
);

select throws_ok(
  $$select public.request_early_access(null, 'A sufficiently detailed reason')$$,
  '22023',
  'Invalid early-access request',
  'a null email is rejected uniformly'
);

select throws_ok(
  $$select public.request_early_access('valid@example.com', null)$$,
  '22023',
  'Invalid early-access request',
  'a null reason is rejected uniformly'
);

select throws_ok(
  $$select public.request_early_access('not-an-email', 'A sufficiently detailed reason')$$,
  '22023',
  'Invalid early-access request',
  'an invalid email is rejected'
);

select throws_ok(
  $$select public.request_early_access('valid@example.com', 'too short')$$,
  '22023',
  'Invalid early-access request',
  'a short reason is rejected'
);

insert into public.early_access_requests (email, reason, created_at, expires_at)
values ('expired@example.com', 'Expired test request', now() - interval '25 months', now() - interval '1 month');

select lives_ok(
  $$select public.request_early_access('fresh@example.com', 'A fresh sufficiently detailed reason')$$,
  'a new request runs the retention sweep'
);

select is(
  (select count(*) from public.early_access_requests where email = 'expired@example.com'),
  0::bigint,
  'expired requests are removed during the retention sweep'
);

select * from finish();
rollback;

