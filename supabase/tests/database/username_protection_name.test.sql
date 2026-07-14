-- Issue 8: Verify legacy username protection via protection_name column

begin;

select plan(5);

-- protection_name column exists
select has_column('private', 'username_claims', 'protection_name', 'protection_name column exists');

-- protection_name has correct length check
select col_type_is('private', 'username_claims', 'protection_name', 'text', 'protection_name is text type');

-- Index exists
select has_index('private', 'username_claims', 'username_claims_protection_name_idx', 'protection_name index exists');

-- Legacy placeholder usernames should NOT have protection_name
select results_eq(
  $$ select count(*) from private.username_claims
     where is_legacy = true
       and private.username_is_placeholder(claimed_username)
       and protection_name is not null $$,
  $$ select 0::bigint $$,
  'UUID placeholder legacy claims do not get protection_name'
);

-- Legacy non-placeholder usernames SHOULD have protection_name (if any exist)
-- This is a soft check since there may be no legacy claims in a fresh DB
select ok(
  not exists (
    select 1 from private.username_claims
    where is_legacy = true
      and not private.username_is_placeholder(claimed_username)
      and protection_name is null
      and claimed_username ~ '[a-z]'
  ),
  'all legacy non-placeholder claims with alpha chars have protection_name'
);

select finish();

rollback;
