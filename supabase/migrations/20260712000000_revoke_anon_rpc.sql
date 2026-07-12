-- Lock the waitlist RPC to the service role only.
-- The Cloudflare Pages worker calls this RPC with the service role key;
-- anon and authenticated users must not be able to bypass Turnstile
-- by calling Supabase directly.

revoke execute on function public.request_early_access(text, text) from anon, authenticated;
grant execute on function public.request_early_access(text, text) to service_role;
