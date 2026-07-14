-- The app no longer uses an owner gate. Keep the private enrollment data for
-- administrative history, but remove the public RPC surface.

revoke all on function public.is_app_owner()
  from public, anon, authenticated, service_role;

comment on function public.is_app_owner() is
  'Internal legacy owner check; not exposed through the Data API.';

notify pgrst, 'reload schema';
