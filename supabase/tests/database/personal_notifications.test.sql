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
select ok(
  (
    select 'id' = any(proargnames) and 'event_type' = any(proargnames)
      and 'title' = any(proargnames) and 'subtitle' = any(proargnames)
      and 'link' = any(proargnames) and 'occurred_at' = any(proargnames)
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'get_personal_notifications'
  ),
  'get_personal_notifications returns id, event_type, title, subtitle, link, occurred_at columns'
);

-- Granted to authenticated
select ok(
  has_function_privilege('authenticated', 'public.get_personal_notifications(integer)', 'execute'),
  'authenticated role can execute get_personal_notifications'
);

-- Not granted to anon
select ok(
  not has_function_privilege('anon', 'public.get_personal_notifications(integer)', 'execute'),
  'anon role cannot execute get_personal_notifications'
);

select finish();

rollback;
