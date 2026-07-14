-- Fix infinite RLS recursion: bounties SELECT policy references bounty_claims,
-- and bounty_claims SELECT policy references bounties → infinite recursion.
-- Bounties are shared content; allow authenticated SELECT without cross-table checks.
-- The bounty_claims policy can still reference bounties safely (one-directional).

begin;

drop policy if exists authenticated_bounties_read on public.bounties;
create policy authenticated_bounties_read
  on public.bounties for select to authenticated
  using (true);

-- sightings_private_participant_read references bounty_claims which references bounties.
-- With bounties now using (true), the chain is: sightings → bounty_claims → bounties (terminates).
-- No recursion possible.

notify pgrst, 'reload schema';

commit;
