# Autonomous Trend Engine Plan

## Product definition

The engine is an autonomous catalog researcher and patch preparer. It answers: “What product is becoming viral now, what evidence supports that conclusion, and what minimal catalog change should FindItViral make?” It is not the local store-inventory system.

## Responsibility split

The engine owns source scheduling, normalized signals, append-only evidence within its retention window, product identity aliases, score history, candidate state, review decisions, publication policy, patch manifests, and an outbox.

FindItViral continues to own live catalog UUIDs/slugs, authentication, moderation, community reports, bounties, restock leads, public rendering, and the final database write boundary.

## Delivery phases

### Phase 1 — implemented here

- Independent Cloudflare Worker and D1 schema.
- Push and allowlisted JSON-feed source registry.
- At-least-once Queue consumer with per-message retry/ack behavior.
- Retry-safe cron claims and idempotent source-poll job leases.
- Versioned signal validation and conservative identity resolution.
- Decayed, upstream-group-capped, versioned scoring with explainable snapshots.
- Candidate lifecycle and review overrides.
- Shadow/review/autopilot patch policy.
- Versioned, checksummed, idempotent catalog patch outbox with leased delivery and legal status transitions.
- Fail-closed URL provenance, score freshness, source independence, and D1 free-plan query budgeting.
- Automated retention for evidence, score history, source runs, poll jobs, and the cursor outbox.
- Worker-runtime D1, HTTP, cron, Queue, score, contract, and policy tests.

### Phase 2 — real discovery connectors

Choose sources based on legal/API access and data quality. Each connector must document how raw rank/volume/velocity becomes the normalized V1 values, retain evidence URLs/hashes, respect source rate limits and terms, and never infer a purchasable product from a generic meme/topic without product evidence.

Begin with two or three complementary classes (for example search velocity, social velocity, and an official product/marketplace source), then backtest against known trend launches. Do not activate autopilot while all signals ultimately derive from one upstream dataset.

### Phase 3 — FindItViral publisher

Add private staging tables and a service-only batch RPC. A FindItViral-owned Worker leases the oldest ready patch, verifies its checksum/schema/idempotency keys, resolves engine IDs to existing FiV IDs, dry-runs a diff, applies in one controlled transaction, records every required link, runs web/database smoke checks, and acknowledges the delivery token.

The publisher must soft-disable rather than hard-delete, preserve existing UUIDs/slugs, reject incomplete image-rights metadata, and stop on collisions instead of guessing.

### Phase 4 — guarded autonomy

Run shadow comparisons, then review mode, then autopilot for only the hard policy. Monitor source health, candidate precision, duplicate rate, patch failure rate, time-to-detection, score backlog, lease retries, and rollback rate. Any publisher failure, schema mismatch, score-version change, or source-quality incident automatically falls both the engine and publisher back to shadow mode.

## Required pre-autopilot gates

- At least three genuinely independent sources for unreviewed publication.
- Backtested precision target agreed by the owner.
- Complete provenance and official catalog source URL.
- No unresolved identity or slug collision.
- Idempotent replay demonstrated in staging.
- Automated database and production smoke tests.
- Patch rollback tested without deleting community history.
- Alerting and a one-step `shadow` kill switch.
