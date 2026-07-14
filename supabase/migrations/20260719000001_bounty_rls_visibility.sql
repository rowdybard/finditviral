-- Replace over-broad bounty RLS (using (true)) with approved/owner/participant visibility.
-- Uses a SECURITY DEFINER helper to avoid RLS recursion: bounties → is_bounty_participant → terminates.

begin;

-- is_bounty_participant: SECURITY DEFINER — bypasses RLS to avoid recursion.
-- Returns true if the user has any claim (any status) on the bounty.
create or replace function private.is_bounty_participant(p_bounty_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
  select exists (
    select 1 from public.bounty_claims bc
    where bc.bounty_id = p_bounty_id and bc.finder_id = p_user_id
  );
$$;

revoke all on function private.is_bounty_participant(uuid, uuid)
  from public, anon, service_role;
grant execute on function private.is_bounty_participant(uuid, uuid)
  to authenticated;

-- Replace the over-broad policy from 20260718000005_fix_rls_recursion.sql
drop policy if exists authenticated_bounties_read on public.bounties;
create policy authenticated_bounties_read
  on public.bounties for select to authenticated
  using (
    moderation_status = 'approved'
    or user_id = (select auth.uid())
    or private.is_bounty_participant(id, (select auth.uid()))
  );

-- Recursion safety:
-- bounties RLS → is_bounty_participant (SECURITY DEFINER, no RLS) → terminates.
-- bounty_claims RLS → bounties RLS → is_bounty_participant → terminates.
-- sightings RLS → bounty_claims → bounties → is_bounty_participant → terminates.
-- profile_contacts RLS → bounty_claims → bounties → is_bounty_participant → terminates.

notify pgrst, 'reload schema';

commit;
