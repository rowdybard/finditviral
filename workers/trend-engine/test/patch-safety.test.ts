import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { ViralSignalBatchV1 } from '../src/domain'
import { ingestSignalBatch } from '../src/ingest'
import { claimNextReadyPatch, generateCatalogPatch, getPatch } from '../src/patches'
import { MAX_SCORE_AGE_MS } from '../src/policy'
import { listCandidates, saveReviewDecision, upsertSource } from '../src/repository'
import { makeSignal } from './fixtures'

async function seedTrendingCandidate(now: Date) {
  for (const [id, type] of [['patch-social', 'social_velocity'], ['patch-search', 'search_interest'], ['patch-market', 'marketplace_rank']] as const) {
    await upsertSource(env.DB, {
      id,
      name: id,
      kind: 'push',
      endpoint_url: null,
      independence_key: id,
      catalog_host_allowlist: ['products.example.com'],
      trust_weight: 0.9,
      poll_interval_minutes: 60,
      enabled: true,
    }, now.toISOString())
    const batch: ViralSignalBatchV1 = {
      schema_version: 1,
      records: [makeSignal({ source: id, type, now })],
    }
    await ingestSignalBatch(env.DB, batch, 'push', now)
  }

  const [candidate] = await listCandidates(env.DB, { state: 'trending', limit: 1, offset: 0 })
  if (!candidate) throw new Error('Expected a trending candidate')
  return candidate
}

describe('catalog patch safety', () => {
  it('supersedes a shadow draft and releases its claims when review mode is enabled', async () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const candidate = await seedTrendingCandidate(now)
    const shadow = await generateCatalogPatch(env.DB, 'shadow', 'scheduled', now)
    expect(shadow.status).toBe('draft')
    expect(shadow.patch?.operations.some((operation) => operation.candidate_id === candidate.id)).toBe(true)

    await saveReviewDecision(env.DB, {
      id: crypto.randomUUID(),
      candidateId: candidate.id,
      decision: 'approved',
      note: 'Reviewed against all evidence.',
      overridesJson: null,
      decidedAt: new Date(now.getTime() + 1000).toISOString(),
    })
    const reviewed = await generateCatalogPatch(
      env.DB,
      'review',
      'manual',
      new Date(now.getTime() + 2000),
    )
    expect(reviewed.status).toBe('ready')
    expect(await getPatch(env.DB, reviewed.patch?.patch_id ?? '')).toEqual(reviewed.patch)

    const oldStatus = await env.DB.prepare('SELECT status FROM patches WHERE id = ?')
      .bind(shadow.patch?.patch_id)
      .first<{ status: string }>()
    expect(oldStatus?.status).toBe('superseded')
    const claim = await env.DB.prepare(`
      SELECT patch_id FROM patch_candidate_claims WHERE candidate_id = ? AND action = 'add_product'
    `).bind(candidate.id).first<{ patch_id: string }>()
    expect(claim?.patch_id).toBe(reviewed.patch?.patch_id)
  })

  it('supersedes a ready patch when the global publication mode changes', async () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const candidate = await seedTrendingCandidate(now)
    const autopilot = await generateCatalogPatch(env.DB, 'autopilot', 'scheduled', now)
    expect(autopilot.status).toBe('ready')

    expect(await claimNextReadyPatch(env.DB, 'review', new Date(now.getTime() + 60_000))).toBeNull()
    const row = await env.DB.prepare('SELECT status, error_code FROM patches WHERE id = ?')
      .bind(autopilot.patch?.patch_id)
      .first<{ status: string; error_code: string }>()
    expect(row).toEqual({ status: 'superseded', error_code: 'PATCH_MODE_CHANGED' })
    const claim = await env.DB.prepare('SELECT patch_id FROM patch_candidate_claims WHERE candidate_id = ?')
      .bind(candidate.id)
      .first()
    expect(claim).toBeNull()
  })

  it('fails a ready patch after its score-freshness window and releases its claim', async () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const candidate = await seedTrendingCandidate(now)
    await saveReviewDecision(env.DB, {
      id: crypto.randomUUID(),
      candidateId: candidate.id,
      decision: 'approved',
      note: 'Verified before patch generation.',
      overridesJson: null,
      decidedAt: now.toISOString(),
    })
    const reviewed = await generateCatalogPatch(env.DB, 'review', 'manual', now)
    expect(reviewed.status).toBe('ready')

    const staleAt = new Date(now.getTime() + MAX_SCORE_AGE_MS + 1)
    expect(await claimNextReadyPatch(env.DB, 'review', staleAt)).toBeNull()
    const row = await env.DB.prepare('SELECT status, error_code FROM patches WHERE id = ?')
      .bind(reviewed.patch?.patch_id)
      .first<{ status: string; error_code: string }>()
    expect(row).toEqual({ status: 'failed', error_code: 'PATCH_STALE' })
    const claim = await env.DB.prepare('SELECT patch_id FROM patch_candidate_claims WHERE candidate_id = ?')
      .bind(candidate.id)
      .first()
    expect(claim).toBeNull()
  })

  it('does not revoke a publisher lease that is already in flight', async () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const candidate = await seedTrendingCandidate(now)
    await saveReviewDecision(env.DB, {
      id: crypto.randomUUID(),
      candidateId: candidate.id,
      decision: 'approved',
      note: 'Verified before patch generation.',
      overridesJson: null,
      decidedAt: now.toISOString(),
    })
    const reviewed = await generateCatalogPatch(env.DB, 'review', 'manual', now)
    const delivery = await claimNextReadyPatch(env.DB, 'review', now)
    expect(delivery?.patch.patch_id).toBe(reviewed.patch?.patch_id)

    expect(await claimNextReadyPatch(env.DB, 'autopilot', new Date(now.getTime() + 60_000))).toBeNull()
    const row = await env.DB.prepare('SELECT status, delivery_token FROM patches WHERE id = ?')
      .bind(reviewed.patch?.patch_id)
      .first<{ status: string; delivery_token: string }>()
    expect(row).toEqual({ status: 'exported', delivery_token: delivery?.deliveryToken })
    const claim = await env.DB.prepare('SELECT patch_id FROM patch_candidate_claims WHERE candidate_id = ?')
      .bind(candidate.id)
      .first<{ patch_id: string }>()
    expect(claim?.patch_id).toBe(reviewed.patch?.patch_id)
  })
})
