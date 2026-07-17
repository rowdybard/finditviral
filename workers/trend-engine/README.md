# FindItViral Trend Engine

The Trend Engine is a separate, independently deployable service that finds rising products, keeps time-bounded evidence, scores momentum, and prepares idempotent catalog patches for FindItViral. Here, “inventory” means the website catalog—not local store stock.

It does not write to FindItViral or hold a Supabase service key. A future FindItViral-owned publisher will pull a patch, validate it against the V1 contract, apply it through a narrow service-only database API, run smoke checks, and acknowledge the result.

The engine core is implemented, but it is not yet a live trend oracle: Cloudflare resources, real permitted source connectors, and the FindItViral publisher are deliberately not provisioned by this change. Until those are added, it can run locally or in shadow mode against normalized test/push/feed data without touching the website.

## Operating modes

- `shadow`: continuously discover and score candidates, then produce draft patches that cannot be consumed by the publisher.
- `review`: produce a ready patch only after a candidate is explicitly approved.
- `autopilot`: also allows an unreviewed candidate through when it is currently trending, has a score of at least 80, confidence of at least 0.75, at least three independent sources, a source URL, and complete catalog fields. A rejected candidate is never auto-published.

Production starts in `shadow`. `AUTOPILOT_MODE` is a global ceiling: an HTTP request cannot override it, and `/v1/patches/next` will not deliver an already-ready patch while the mode is `shadow`. The eventual FindItViral publisher must enforce its own final shadow kill switch too.

Do not arm production `autopilot` yet. The current ingest role is for trusted first-party normalizers, not independently authenticated external sources; Phase 2 must add source-scoped signatures or service bindings, and Phase 3 must add the FiV-owned publisher, before unattended publication is safe. `review` remains the highest intended publication mode until then.

## Pipeline

```text
permitted source APIs/feeds
        |
        v
normalized ViralSignalV1 records
        |
        v
identity resolution -> immutable evidence -> decayed multi-source score
        |
        v
candidate / emerging / trending / cooling / archived
        |
        v
shadow, review, or autopilot policy
        |
        v
CatalogPatchV1 outbox -> future FindItViral-owned publisher
```

Connectors normalize their source-specific metrics to a documented `0..100` signal and `-1..1` velocity. A batch contains at most four records from one source run; connectors chunk larger runs. Signals expire no later than fourteen days after observation. The core engine never scrapes arbitrary pages: scheduled JSON feeds must be HTTPS and explicitly listed in `SOURCE_HOST_ALLOWLIST`.

Each registered source has an `independence_key`. Mirrors or connectors derived from the same upstream must share that key. Scoring first aggregates and caps each independence group, and zero-trust evidence does not count toward the three-source autopilot gate. `catalog_host_allowlist` separately records which product domains that connector may vouch for. A human approval can verify/replace a catalog URL; an unreviewed autopilot candidate cannot.

## OpenAI research limits

OpenAI research uses `gpt-5.6-luna` with web search and strict structured output. Each run is capped at 8,000 output tokens and 12 candidates; every accepted candidate still requires two distinct current web-search citations before entering the normal review queue.

Identity is intentionally conservative:

1. exact GTIN;
2. exact normalized brand plus product name;
3. otherwise the source and its external product ID.

That avoids fuzzy matches silently merging different variants. A future review tool can add explicit merge/split decisions.

## Patch behavior

A patch contains `ensure_trend` followed by dependent `add_product` operations. Every operation has a stable idempotency key, evidence URLs, the score/policy version, and a rollback posture. The engine claims a candidate when it enters an active patch, so cron retries cannot generate duplicate additions.

Only one current shadow draft is retained; a newer run supersedes the old draft and releases its claims. Moving to review/autopilot therefore promotes eligible candidates instead of leaving them trapped in shadow. Stale `building` patches are failed and recovered automatically.

Publisher delivery is leased for five minutes. `GET /v1/patches/next` atomically changes a ready patch to exported and returns a one-use `delivery_token`. Before an `applied` acknowledgment, the publisher must record complete FiV product/trend ID and slug mappings for every `add_product`. Failed deliveries release candidate claims; applied deliveries remain terminal. A lost response can be leased again, so the FiV apply transaction must still enforce operation idempotency keys.

Delivery requires an exact match with the current global mode. Undelivered patches from a previous mode are superseded, and ready patches older than the two-hour score-freshness window fail closed and release their candidate claims. An already-active five-minute publisher lease is not revoked mid-transaction; this is why the final publisher also needs its own kill switch.

The initial publisher should apply catalog changes as data, not generate a new SQL migration for every viral product. FindItViral remains authoritative for its UUIDs, slugs, moderation, users, sightings, leads, and bounties.

## HTTP API

All bodies use `application/json`; all non-health routes require a bearer token.

`ENGINE_INGEST_TOKEN` is only for trusted first-party normalizers and cannot register sources, review candidates, or publish patches. Do not hand the shared token to a third party; external connectors should use a source-scoped signature or Cloudflare service binding before production onboarding.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `GET /health` | public | Liveness and active mode |
| `GET, POST /v1/sources` | admin | Inspect or register push/JSON-feed connectors |
| `POST /v1/signals` | ingest | Ingest a `ViralSignalV1` batch |
| `GET /v1/candidates` | read | Ranked candidate queue |
| `POST /v1/candidates/:id/review` | admin | Approve/reject and supply catalog overrides |
| `POST /v1/recompute` | admin | Recompute decay/state immediately |
| `POST /v1/patches` | admin | Generate a patch in the configured mode |
| `GET /v1/patches/next` | publisher | Lease the oldest ready patch (disabled in shadow) |
| `GET /v1/patches/:id` | read | Inspect an immutable patch manifest |
| `POST /v1/patches/:id/ack` | publisher | Acknowledge applied/failed with its delivery token |
| `POST /v1/catalog-links` | publisher | Record the resulting FindItViral IDs/slugs |
| `GET /v1/changes?after=` | read | Cursor-based evidence/score/patch outbox |

Contracts live in [`contracts/`](./contracts/).

Source registration requires an `independence_key`; it may also include `catalog_host_allowlist`, for example:

```json
{
  "id": "market-rank-feed",
  "name": "Market rank feed",
  "kind": "json_feed",
  "endpoint_url": "https://feeds.example.com/viral-products.json",
  "independence_key": "market-rank-provider",
  "catalog_host_allowlist": ["brand.example", "*.official-store.example"],
  "trust_weight": 0.85,
  "poll_interval_minutes": 30,
  "enabled": true
}
```

The `checksum` is SHA-256 over canonical JSON after replacing the manifest's checksum value with an empty string. The publisher validates the JSON Schema, runtime action shape, checksum, dependency order, idempotency keys, and collisions before writing anything.

## Scheduling and retention

- every five minutes: claim due normalized feeds and enqueue one poll per source;
- every ten minutes: recompute the ten stalest candidate scores, while new signals recompute immediately;
- minute 8 hourly: generate the current-mode patch;
- minute 17 every four hours: queue one OpenAI research run;
- 03:37 UTC daily: remove expired evidence/score/run/job records after 90 days, cursor change-log entries after 30 days, and unlinked/unpatched dormant candidates after 180 days.

The small batches and Queue consumer size of one keep every path below D1's 50-query free-plan invocation limit. Stale scores older than two hours are categorically ineligible for a patch, so a large backlog fails closed instead of publishing old trends.

## Local verification

From the repository root:

```text
npm run types:trend-engine
npm run migrate:trend-engine:local
npm run check:trend-engine
npm run test:trend-engine
npx wrangler deploy --dry-run --config workers/trend-engine/wrangler.jsonc
```

Type generation always reads `.dev.vars.example`, so a clean clone produces the same configuration bindings. Wrangler does not generate secret bindings from dev-var files; their names are declared separately in `src/env.d.ts` without values. Before local HTTP testing, copy the example to `.dev.vars` and replace all values with independent random tokens. `.dev.vars` is ignored by Git.

## Provisioning (not performed by this change)

Provisioning creates external Cloudflare resources and should be done deliberately:

```text
npx wrangler d1 create finditviral-trend-engine
npx wrangler queues create finditviral-trend-source-polls
npx wrangler queues create finditviral-trend-source-polls-dlq
```

Replace the placeholder D1 ID in `wrangler.jsonc`, then set secrets interactively:

```text
npx wrangler secret put ENGINE_ADMIN_TOKEN --config workers/trend-engine/wrangler.jsonc
npx wrangler secret put ENGINE_READ_TOKEN --config workers/trend-engine/wrangler.jsonc
npx wrangler secret put ENGINE_INGEST_TOKEN --config workers/trend-engine/wrangler.jsonc
npx wrangler secret put ENGINE_PUBLISHER_TOKEN --config workers/trend-engine/wrangler.jsonc
```

Finally apply remote migrations and deploy:

```text
npx wrangler d1 migrations apply finditviral-trend-engine --remote --config workers/trend-engine/wrangler.jsonc
npx wrangler deploy --config workers/trend-engine/wrangler.jsonc
```

Do not pass secret values on the command line or store them in config.

## Path to autonomous site operation

1. Run this engine in `shadow` with real, permitted source connectors and compare its calls against human decisions.
2. Add a private FindItViral staging/import RPC with strict V1 validation and engine-to-FiV ID mappings.
3. Add a FindItViral-owned scheduled publisher that pulls `/v1/patches/next`; the engine never receives a Supabase credential.
4. Have that publisher stage the diff, enforce its own kill switch, apply transactionally, record catalog links, run production smoke checks, then acknowledge the leased patch.
5. Enable `review`, verify idempotency, rollback, provenance, image-rights handling, and production smoke checks.
6. Enable `autopilot` only for the high-confidence policy. Keep both engine and publisher kill switches in `shadow`.

Direct browser writes, shared databases, fake Auth users, and automatic hard deletes are deliberately out of scope.
