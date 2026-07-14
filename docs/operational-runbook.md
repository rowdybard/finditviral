# Operational Runbook

## Cloudflare Worker Logs

1. Go to Cloudflare Dashboard → Pages → finditviral → Functions → Logs
2. Filter by request path or event type
3. Structured JSON log events:
   - `early_access_request` — early-access API submissions
   - `product_click_recorded` — product click tracking
   - `turnstile_verification_failed` — CAPTCHA failures
   - `rate_limited` — rate limit triggered

## Supabase Logs

1. Go to Supabase Dashboard → Logs
2. Key log streams:
   - **Auth logs:** signup, signin, email confirmation events
   - **API logs:** PostgREST requests, RPC calls
   - **Database logs:** slow queries, connection issues

## Error Code Reference

| Code | Description | Action |
|------|-------------|--------|
| `42501` | Unauthorized (permanent member required) | Check user auth state and email confirmation |
| `42901` | Rate limit exceeded | Wait 1 hour or contact support |
| `22023` | Invalid input | Check form validation |
| `23505` | Unique constraint violation | Duplicate submission (e.g., username, claim) |
| `55006` | Onboarding already completed | Redirect to home |
| `P0002` | Profile not found | Check auth state |
| `auth_signin_failed` | Frontend auth signin error | Check Supabase Auth status |
| `auth_signup_failed` | Frontend auth signup error | Check Supabase Auth status |
| `verification_required` | Turnstile token missing | Ensure CAPTCHA widget loads |
| `verification_failed` | Turnstile token invalid | Check Turnstile site/secret keys |
| `rate_limited` | API rate limit hit | Check KV counters, wait and retry |
| `DIGEST_CONFIGURATION_INVALID` | Digest worker misconfigured | Check digest destination allowlist and secrets |
| `DIGEST_NO_CLAIM` | No pending digest claim | Normal no-op behavior |

## Smoke Checks

Run locally:
```bash
npm run smoke:web
```

Run against production (manual dispatch):
- GitHub Actions → Smoke Test workflow → Run workflow

## Health Check

Scheduled every 6 hours via `.github/workflows/health-check.yml`.
Fails visibly on errors.
