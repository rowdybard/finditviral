-- PostgREST can only embed public.profiles when the relationship exists in
-- Postgres. Keep the auth.users constraints and add public profile
-- relationships for the owner-only application queries.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bounties_user_id_profiles_fkey'
      and conrelid = 'public.bounties'::regclass
  ) then
    alter table public.bounties
      add constraint bounties_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sightings_user_id_profiles_fkey'
      and conrelid = 'public.sightings'::regclass
  ) then
    alter table public.sightings
      add constraint sightings_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bounty_claims_finder_id_profiles_fkey'
      and conrelid = 'public.bounty_claims'::regclass
  ) then
    alter table public.bounty_claims
      add constraint bounty_claims_finder_id_profiles_fkey
      foreign key (finder_id) references public.profiles(id) on delete cascade;
  end if;
end
$$;

notify pgrst, 'reload schema';
