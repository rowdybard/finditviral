-- Restock Leads: verify tables, constraints, RLS, and RPC functions.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);

-- Table exists
select has_table('public', 'leads', 'leads table exists');
select has_table('public', 'lead_votes', 'lead_votes table exists');

-- Columns on leads
select has_column('public', 'leads', 'id', 'leads has id column');
select has_column('public', 'leads', 'headline', 'leads has headline column');
select has_column('public', 'leads', 'scope_type', 'leads has scope_type column');
select has_column('public', 'leads', 'status', 'leads has status column');
select has_column('public', 'leads', 'expires_at', 'leads has expires_at column');
select has_column('public', 'leads', 'confirmed_sighting_id', 'leads has confirmed_sighting_id column');

-- sightings.lead_id column
select has_column('public', 'sightings', 'lead_id', 'sightings has lead_id column');

-- RLS enabled
select is(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'leads'),
  true,
  'RLS is enabled on leads'
);
select is(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'lead_votes'),
  true,
  'RLS is enabled on lead_votes'
);

-- RPC functions exist
select has_function('public', 'create_lead',
  array['uuid', 'text', 'text', 'date', 'text', 'uuid', 'text', 'integer', 'text', 'text'],
  'create_lead RPC exists');

select has_function('public', 'list_public_leads',
  array['uuid', 'text', 'integer', 'integer'],
  'list_public_leads RPC exists');

select has_function('public', 'get_lead_detail',
  array['text'],
  'get_lead_detail RPC exists');

select has_function('public', 'vote_on_lead',
  array['uuid', 'text'],
  'vote_on_lead RPC exists');

select has_function('public', 'remove_lead_vote',
  array['uuid'],
  'remove_lead_vote RPC exists');

select has_function('public', 'confirm_lead_with_sighting',
  array['uuid', 'uuid', 'timestamptz', 'text', 'integer', 'text', 'text[]'],
  'confirm_lead_with_sighting RPC exists');

select has_function('public', 'admin_set_lead_moderation',
  array['uuid', 'text', 'text'],
  'admin_set_lead_moderation RPC exists');

-- Pending leads should not appear in list_public_leads
select ok(
  not exists (
    select 1 from public.list_public_leads(null, '48910', 50, 100)
    where id in (select id from public.leads where status = 'pending')
  ),
  'pending leads are excluded from public listing'
);

-- Rate limit function supports 'lead' type
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'check_contribution_rate_limit'
      and pg_get_functiondef(p.oid) ~ '''lead'''
  ),
  'check_contribution_rate_limit supports lead type'
);

-- contribution_moderation_events accepts 'lead' type
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'private'
      and cl.relname = 'contribution_moderation_events'
      and c.conname = 'contribution_moderation_events_contribution_type_check'
      and pg_get_constraintdef(c.oid) ~ '''lead'''
  ),
  'contribution_moderation_events accepts lead type'
);

select * from finish();
rollback;
