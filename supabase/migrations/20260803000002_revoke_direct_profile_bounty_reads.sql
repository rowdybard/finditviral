-- Revoke direct table SELECT on profiles and bounties from authenticated.
-- Deploy AFTER the frontend is live with RPC calls (list_my_bounties,
-- list_my_claims, get_bounty_detail, get_my_profile).
--
-- This removes the broad table-level SELECT grants that allowed any
-- authenticated user to read all columns of profiles (including referred_by,
-- referral_count, looking_for, preferred_cities, onboarding_completed) and
-- bounties (including moderation_status, moderated_by, moderated_at).
--
-- RLS controls rows but cannot hide columns. Column-level grants are role-wide
-- and cannot express "all columns for my own row, four columns for everyone
-- else." RPCs are the primary access boundary.

begin;

revoke select on public.profiles from authenticated;
revoke select on public.bounties from authenticated;

-- The authenticated_profiles_read policy (using (true)) is no longer needed
-- since direct table SELECT is revoked. The policy is harmless but removing
-- it keeps the policy set clean.
drop policy if exists authenticated_profiles_read on public.profiles;

notify pgrst, 'reload schema';

commit;
