begin;

revoke select (
  id, user_id, product_id, reward_amount, reward_cents, store_id, zip_code,
  radius_miles, notes, requirements, deadline, status, moderation_status,
  created_at
) on public.bounties from authenticated;

revoke select (
  id, username, karma, is_pro, created_at
) on public.profiles from authenticated;

notify pgrst, 'reload schema';

commit;
