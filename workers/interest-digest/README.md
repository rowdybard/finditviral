# FindItViral interest digest Worker

This isolated Cloudflare Worker runs at the top of every UTC hour. It uses the Cron event's `scheduledTime` to determine the current `America/Detroit` date and hour. Before 8:00 AM local time it exits without contacting Supabase. At or after 8:00 AM it asks the database to atomically claim at most one delivery attempt, sends that digest through the Cloudflare Email Service binding, and records the outcome.

The database owns catch-up, concurrency, item assignment, leases, and the three-attempt limit. A Cloudflare `messageId` means the message was accepted by Email Service; it is not treated as proof that the destination inbox received it. Unknown send outcomes are recorded as `uncertain` and may be retried, so the owner should understand that a rare duplicate digest is possible.

## Required Cloudflare setup

1. Onboard `finditviral.com` for Email Sending and verify the one owner destination address.
2. Keep the binding restricted to `digest@finditviral.com`, as declared in `wrangler.jsonc`.
3. Create a dedicated Supabase `sb_secret_...` key for this Worker. Do not reuse the Pages Worker key.
4. Set both secrets through Wrangler's interactive prompt:

   ```powershell
   npx wrangler secret put SUPABASE_SECRET_KEY --config workers/interest-digest/wrangler.jsonc
   npx wrangler secret put DIGEST_TO_EMAIL --config workers/interest-digest/wrangler.jsonc
   ```

Never pass a secret value on the command line. For local tests, copy `.dev.vars.example` to `.dev.vars` and replace the placeholders; `.dev.vars` is ignored in this directory.

### Destination allowlist

The Worker validates `DIGEST_TO_EMAIL` against a hardcoded allowlist (`ALLOWED_DIGEST_DESTINATIONS` in `src/index.ts`). If the configured destination is not in the allowlist, the run is recorded as a permanent failure. Update this constant if the owner email changes.

The binding and scheduling configuration follow Cloudflare's current [Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [send-binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/), and [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) documentation. Cron expressions execute in UTC; the Worker performs the Detroit-time gate itself.

## Required database RPC contract

Only `service_role` may execute these functions. Revoke execution from `PUBLIC`, `anon`, and `authenticated` explicitly.

### `claim_interest_digest_attempt(p_scheduled_at timestamptz)`

Returns zero or one row with:

| Column | Type |
| --- | --- |
| `run_id` | `uuid` |
| `run_local_date` | `date` |
| `cutoff_at` | `timestamptz` |
| `attempt_id` | `uuid` |
| `attempt_number` | `integer` from 1 through 3 |
| `lease_token` | `uuid` |
| `items` | `jsonb` array |

Each item has exactly this shape:

```json
{
  "event_id": "uuid",
  "source": "early_access | onboarding_looking_for",
  "occurred_at": "ISO timestamptz",
  "email": "string or null",
  "username": "string or null",
  "interest": "string"
}
```

The function must treat `p_scheduled_at` as the authoritative clock input. It returns zero rows before 8:00 AM America/Detroit. Otherwise it atomically creates or resumes the correct run, marks a stale in-flight attempt `uncertain`, reserves at most one new attempt with a fixed lease, and returns the oldest retryable work. If there are no eligible events, it records the local date as a completed no-op and returns zero rows. It never returns an empty `items` array.

### `complete_interest_digest_attempt(...)`

Parameters:

```text
p_attempt_id uuid
p_lease_token uuid
p_outcome text
p_message_id text default null
p_error_code text default null
p_error_message text default null
```

Allowed outcomes are `accepted`, `transient_failure`, `permanent_failure`, and `uncertain`. `accepted` requires a nonempty message ID and completes the run. A permanent failure exhausts the run immediately. Transient and uncertain failures remain retryable unless this was attempt three, at which point the run is exhausted. The function validates the active lease/token, timestamps completion with the database clock, caps stored error fields, and should make an identical repeated completion idempotent.

The Worker calls both functions over `/rest/v1/rpc/...` with a server-only API key. Modern `sb_secret_...` keys are sent only in the `apikey` header; legacy JWT service-role keys additionally use `Authorization: Bearer`. Supabase documents the distinction in [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Verification

From the repository root:

```powershell
npx tsc --noEmit -p workers/interest-digest/tsconfig.json
npx vitest run workers/interest-digest/test
npx wrangler types --check --config workers/interest-digest/wrangler.jsonc --env-file workers/interest-digest/.dev.vars.example --strict-vars=false workers/interest-digest/worker-configuration.d.ts
npx wrangler deploy --dry-run --config workers/interest-digest/wrangler.jsonc
```

To exercise a scheduled event locally, use `npx wrangler dev --test-scheduled --config workers/interest-digest/wrangler.jsonc`, then request `/cdn-cgi/handler/scheduled?cron=0+*+*+*+*&time=<epoch-ms>`. Do not enable a remote Email binding unless you intend to send a real message to the configured verified inbox.
