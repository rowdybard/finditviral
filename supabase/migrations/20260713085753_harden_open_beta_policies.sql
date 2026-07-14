-- Cache JWT claims once per statement in the restrictive policy and combine
-- the two sighting read branches into one permissive policy.

begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'trends', 'products', 'profiles', 'profile_contacts',
    'profile_locations', 'bounties', 'sightings',
    'bounty_claims', 'zip_codes'
  ]
  loop
    execute format('drop policy permanent_users_only on public.%I', v_table);
    execute format(
      'create policy permanent_users_only on public.%I
         as restrictive for all to authenticated
         using (not coalesce((((select auth.jwt())) ->> ''is_anonymous'')::boolean, false))
         with check (not coalesce((((select auth.jwt())) ->> ''is_anonymous'')::boolean, false))',
      v_table
    );
  end loop;
end
$$;

drop policy authenticated_public_sightings_read on public.sightings;
drop policy sightings_private_participant_read on public.sightings;

create policy authenticated_sightings_read
  on public.sightings for select to authenticated
  using (
    is_public = true
    or (
      is_public = false
      and (
        (select auth.uid()) = user_id
        or exists (
          select 1
          from public.bounties b
          join public.bounty_claims bc on bc.bounty_id = b.id
          where bc.sighting_id = sightings.id
            and b.user_id = (select auth.uid())
        )
      )
    )
  );

alter function public.touch_profile_locations_updated_at()
  set search_path = pg_catalog, pg_temp;

notify pgrst, 'reload schema';

commit;
