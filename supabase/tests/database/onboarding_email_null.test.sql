-- Issue 1: Verify onboarding interest events do not store member auth emails
-- and early_access events still contain email.

begin;

select plan(3);

-- Verify existing onboarding_looking_for events have NULL email after migration
select results_eq(
  $$ select count(*) from private.interest_events where source = 'onboarding_looking_for' and email is not null $$,
  $$ select 0::bigint $$,
  'all onboarding_looking_for events have NULL email'
);

-- Verify early_access events still have email (if any exist)
-- This is a soft check — there may be zero early_access events in a fresh DB
select ok(
  not exists (
    select 1 from private.interest_events
    where source = 'early_access' and email is null
  ),
  'early_access events that exist still have email (or none exist)'
);

-- Verify the interest_events table still allows NULL email
select col_is_nullable('private', 'interest_events', 'email', 'email column is nullable');

select finish();

rollback;
