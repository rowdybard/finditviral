-- Contracts for re-moderation and post-claim bounty protections.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

select has_trigger('public', 'bounties', 'requeue_changed_bounty', 'bounty text edits re-enter moderation');
select has_trigger('public', 'leads', 'requeue_changed_lead', 'Lead text edits re-enter moderation');
select has_trigger('public', 'sightings', 'requeue_changed_sighting', 'sighting note edits re-enter moderation');
select has_trigger('public', 'sightings', 'queue_new_sighting_notes', 'ordinary sighting notes are queued for moderation');

select ok(
  pg_get_functiondef('private.requeue_changed_contribution()'::regprocedure) ~ 'delete from private.content_moderation_results'
  and pg_get_functiondef('private.requeue_changed_contribution()'::regprocedure) ~ 'new.status := ''pending'''
  and pg_get_functiondef('private.requeue_changed_contribution()'::regprocedure) ~ 'new.is_public := false',
  'changed contributions discard stale moderation and are non-public while pending'
);

select ok(
  pg_get_functiondef('private.queue_new_sighting_notes()'::regprocedure) ~ 'new.moderation_status := ''pending'''
  and pg_get_functiondef('private.queue_new_sighting_notes()'::regprocedure) ~ 'new.is_public := false',
  'ordinary sightings with notes cannot publish before moderation'
);

select ok(
  pg_get_functiondef('public.update_bounty(uuid, text, integer, timestamp with time zone, integer, text, boolean)'::regprocedure) ~ 'bounty_claims'
  and pg_get_functiondef('public.update_bounty(uuid, text, integer, timestamp with time zone, integer, text, boolean)'::regprocedure) ~ 'only permits a deadline extension',
  'any claim freezes bounty terms except a deadline extension'
);

select ok(
  pg_get_functiondef('public.delete_bounty(uuid)'::regprocedure) ~ 'A bounty with claims cannot be deleted',
  'bounties with any claim cannot be deleted'
);

select ok(
  pg_get_functiondef('public.update_lead(uuid, text, text, timestamp with time zone, text, text)'::regprocedure) ~ 'v_date < current_date',
  'Lead edits reject a past expected date'
);

select ok(
  pg_get_functiondef('public.update_lead(uuid, text, text, timestamp with time zone, text, text)'::regprocedure) ~ '\^https://',
  'Lead edits require HTTPS source URLs'
);

select ok(
  pg_get_functiondef('public.update_lead(uuid, text, text, timestamp with time zone, text, text)'::regprocedure) ~ 'expires_at = coalesce',
  'Lead edits recalculate expiry from the expected date'
);

select ok(
  has_function_privilege('authenticated', 'public.update_lead(uuid, text, text, timestamp with time zone, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.update_bounty(uuid, text, integer, timestamp with time zone, integer, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.update_lead(uuid, text, text, timestamp with time zone, text, text)', 'execute'),
  'edit RPCs remain member-only'
);

select * from finish();
rollback;
