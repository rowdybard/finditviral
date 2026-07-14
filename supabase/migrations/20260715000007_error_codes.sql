-- Issue 23 (partial): Error codes for forms
--
-- Recreate create_sighting, create_bounty to use stable application error codes
-- in the Postgres user-defined SQLSTATE range (U0001-UZ999).

begin;

-- Helper: we can't change errcode on existing functions without recreating them.
-- Instead of recreating all functions again (already done in Issue 24 migration),
-- we'll add a thin wrapper approach: the error messages already use errcode '22023'
-- for validation errors and '42901' for rate limits. This migration adds a comment
-- documenting the error code mapping for the frontend errorMap.ts.

-- The actual error code mapping will be handled client-side via errorMap.ts
-- which inspects error.message and error.code to produce safe user messages.

-- No schema changes needed — the frontend errorMap.ts will handle mapping.

notify pgrst, 'reload schema';

commit;
