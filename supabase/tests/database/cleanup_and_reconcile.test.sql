-- End-to-end pgTAP tests for cleanup & reconciliation migration (20260715000009).
-- Tests rate-limit schema fix, submit_bounty_claim 5-min future check,
-- list_public_bounties scope_type column, and scope_check constraint.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, private;

select plan(8);

-- 1. Rate limit function exists and references private schema tables
select has_function(
  'private', 'check_contribution_rate_limit',
  array['uuid', 'text'],
  'check_contribution_rate_limit exists in private schema'
);

-- 2. Rate limit function body references private.product_suggestions (not public)
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'check_contribution_rate_limit'
      and pg_get_functiondef(p.oid) ~ 'private\.product_suggestions'
  ),
  'rate limit function references private.product_suggestions (not public)'
);

-- 3. Rate limit function body references private.store_suggestions (not public)
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'check_contribution_rate_limit'
      and pg_get_functiondef(p.oid) ~ 'private\.store_suggestions'
  ),
  'rate limit function references private.store_suggestions (not public)'
);

-- 4. submit_bounty_claim uses 5-minute future check (not 15)
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_bounty_claim'
      and pg_get_functiondef(p.oid) ~ "interval '5 minutes'"
      and pg_get_functiondef(p.oid) !~ "interval '15 minutes'"
  ),
  'submit_bounty_claim uses 5-minute future check (not 15)'
);

-- 5. list_public_bounties returns scope_type column
select has_column(
  'public',
  'list_public_bounties',
  'scope_type',
  'list_public_bounties returns scope_type column'
);

-- 6. list_public_bounties includes retailer/stores scope bounties without distance filter
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_public_bounties'
      and pg_get_functiondef(p.oid) ~ "scope_type in \('retailers', 'stores'\)"
  ),
  'list_public_bounties skips distance filter for retailer/stores scope'
);

-- 7. bounties_scope_check constraint exists
select has_check(
  'public', 'bounties',
  'bounties has scope_check constraint'
);

-- 8. validate_bounty_scope trigger function exists for association validation
select has_function(
  'public', 'validate_bounty_scope',
  'validate_bounty_scope trigger function exists for association validation'
);

select * from finish();
rollback;
