-- Issue 21: Verify get_personal_notifications RPC exists and is secured

begin;

select plan(4);

-- Function exists with correct signature
select has_function(
  'public', 'get_personal_notifications',
  ARRAY['integer'],
  'get_personal_notifications function exists'
);

-- Returns the expected columns
select function_returns(
  'public', 'get_personal_notifications',
  ARRAY['integer'],
  'public.get_personal_notifications(integer)',
  'get_personal_notifications returns table'
);

-- Granted to authenticated
select has_table_privilege(
  'authenticated',
  'public.get_personal_notifications(integer)',
  'execute',
  'authenticated role can execute get_personal_notifications'
);

-- Not granted to anon
select ok(
  not has_table_privilege(
    'anon',
    'public.get_personal_notifications(integer)',
    'execute'
  ),
  'anon role cannot execute get_personal_notifications'
);

select finish();

rollback;
