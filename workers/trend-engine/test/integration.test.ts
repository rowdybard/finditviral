import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import type { CatalogPatchV1, ViralSignalBatchV1 } from '../src/domain'
import { makeSignal } from './fixtures'

const ADMIN_TOKEN = 'test-admin-token-at-least-24-characters'
const READ_TOKEN = 'test-read-token-at-least-24-characters'
const INGEST_TOKEN = 'test-ingest-token-at-least-24-characters'
const PUBLISHER_TOKEN = 'test-publisher-token-at-least-24-characters'

interface CandidateListResponse {
  candidates: Array<{
    id: string
    review_status: string
    score: {
      value: number
      confidence: number
      source_count: number
      state: string
    }
  }>
}

interface IngestResponse {
  result: {
    received: number
    accepted: number
    duplicates: number
  }
}

interface PatchResponse {
  patch: CatalogPatchV1 | null
  status: string | null
}

function request(path: string, init: RequestInit = {}, token?: string): Request {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new Request(`https://engine.example.com${path}`, { ...init, headers })
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return worker.fetch(request(path, init, token), env)
}

describe('trend engine end-to-end', () => {
  it('deduplicates signals, ranks a candidate, reviews it, and emits one ready patch', async () => {
    const now = new Date()
    const modeOverride = await call('/v1/patches', {
      method: 'POST',
      body: JSON.stringify({ mode: 'autopilot' }),
    }, ADMIN_TOKEN)
    expect(modeOverride.status).toBe(409)
    for (const id of ['social-source', 'search-source', 'market-source']) {
      const response = await call('/v1/sources', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name: id,
          kind: 'push',
          independence_key: id,
          catalog_host_allowlist: ['products.example.com'],
          trust_weight: 0.9,
          enabled: true,
        }),
      }, ADMIN_TOKEN)
      expect(response.status).toBe(201)
    }

    const batches: ViralSignalBatchV1[] = [
      makeSignal({ source: 'social-source', type: 'social_velocity', now }),
      makeSignal({ source: 'search-source', type: 'search_interest', now }),
      makeSignal({ source: 'market-source', type: 'marketplace_rank', now }),
    ].map((record) => ({ schema_version: 1, records: [record] }))
    for (const batch of batches) {
      const ingest = await call('/v1/signals', { method: 'POST', body: JSON.stringify(batch) }, INGEST_TOKEN)
      expect(ingest.status).toBe(202)
      expect(await ingest.json() as IngestResponse).toMatchObject({
        result: { received: 1, accepted: 1, duplicates: 0 },
      })
    }

    const list = await call('/v1/candidates?state=trending', {}, READ_TOKEN)
    expect(list.status).toBe(200)
    const listBody = await list.json() as CandidateListResponse
    expect(listBody.candidates).toHaveLength(1)
    expect(listBody.candidates[0]?.score).toMatchObject({ state: 'trending', source_count: 3 })
    const candidateId = listBody.candidates[0]?.id
    expect(candidateId).toMatch(/^candidate_/)
    if (!candidateId) throw new Error('Expected a candidate ID')

    const tamperedReplay = structuredClone(batches[0])
    if (!tamperedReplay) throw new Error('Expected a replay fixture')
    tamperedReplay.records[0]!.candidate.name = 'Tampered Product Name'
    tamperedReplay.records[0]!.candidate.product_url = 'https://products.example.com/tampered'
    const tamperedResult = await call('/v1/signals', {
      method: 'POST',
      body: JSON.stringify(tamperedReplay),
    }, INGEST_TOKEN)
    expect(await tamperedResult.json() as IngestResponse).toMatchObject({
      result: { accepted: 0, duplicates: 1 },
    })
    const detail = await call(`/v1/candidates/${candidateId}`, {}, READ_TOKEN)
    expect(await detail.json()).toMatchObject({
      candidate: {
        name: 'Galaxy Glow Mini Printer',
        product_url: 'https://products.example.com/galaxy-glow-mini-printer',
      },
    })

    for (const batch of batches) {
      const duplicate = await call('/v1/signals', { method: 'POST', body: JSON.stringify(batch) }, INGEST_TOKEN)
      expect(duplicate.status).toBe(200)
      expect(await duplicate.json() as IngestResponse).toMatchObject({
        result: { received: 1, accepted: 0, duplicates: 1 },
      })
    }
    const preservedRun = await env.DB.prepare(`
      SELECT accepted_count, duplicate_count
      FROM source_runs
      WHERE source_id = 'social-source' AND external_run_id = 'social-source-run-1'
    `).first<{ accepted_count: number; duplicate_count: number }>()
    expect(preservedRun).toMatchObject({ accepted_count: 1, duplicate_count: 1 })

    const unauthorized = await call('/v1/candidates')
    expect(unauthorized.status).toBe(401)

    const review = await call(`/v1/candidates/${candidateId}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', note: 'Verified against all three evidence links.' }),
    }, ADMIN_TOKEN)
    expect(review.status).toBe(200)

    const createPatch = await call('/v1/patches', {
      method: 'POST',
      body: JSON.stringify({ mode: 'review' }),
    }, ADMIN_TOKEN)
    expect(createPatch.status).toBe(201)
    const patchBody = await createPatch.json() as PatchResponse
    expect(patchBody.status).toBe('ready')
    expect(patchBody.patch?.operations.map((operation) => operation.action)).toEqual(['ensure_trend', 'add_product'])
    expect(patchBody.patch?.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
    const patchId = patchBody.patch?.patch_id
    if (!patchId) throw new Error('Expected a patch ID')

    const shadowEnv: Env = {
      DB: env.DB,
      SOURCE_QUEUE: env.SOURCE_QUEUE,
      RESEARCH_QUEUE: env.RESEARCH_QUEUE,
      ENVIRONMENT: env.ENVIRONMENT,
      AUTOPILOT_MODE: 'shadow',
      SOURCE_HOST_ALLOWLIST: env.SOURCE_HOST_ALLOWLIST,
      OPENAI_RESEARCH_MODEL: env.OPENAI_RESEARCH_MODEL,
      ENGINE_ADMIN_TOKEN: env.ENGINE_ADMIN_TOKEN,
      ENGINE_READ_TOKEN: env.ENGINE_READ_TOKEN,
      ENGINE_INGEST_TOKEN: env.ENGINE_INGEST_TOKEN,
      ENGINE_PUBLISHER_TOKEN: env.ENGINE_PUBLISHER_TOKEN,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
    }
    const shadowBlocked = await worker.fetch(
      request('/v1/patches/next', {}, PUBLISHER_TOKEN),
      shadowEnv,
    )
    expect(shadowBlocked.status).toBe(204)
    expect(shadowBlocked.headers.get('X-Engine-Mode')).toBe('shadow')

    const next = await call('/v1/patches/next', {}, PUBLISHER_TOKEN)
    expect(next.status).toBe(200)
    const delivery = await next.json() as { patch: CatalogPatchV1; delivery_token: string }
    expect(delivery.patch.patch_id).toBe(patchId)
    expect((await call('/v1/patches/next', {}, PUBLISHER_TOKEN)).status).toBe(204)

    const wrongLease = await call(`/v1/patches/${patchId}/ack`, {
      method: 'POST',
      body: JSON.stringify({ status: 'applied', delivery_token: crypto.randomUUID() }),
    }, PUBLISHER_TOKEN)
    expect(wrongLease.status).toBe(409)

    const missingLinks = await call(`/v1/patches/${patchId}/ack`, {
      method: 'POST',
      body: JSON.stringify({ status: 'applied', delivery_token: delivery.delivery_token }),
    }, PUBLISHER_TOKEN)
    expect(missingLinks.status).toBe(409)

    const link = await call('/v1/catalog-links', {
      method: 'POST',
      body: JSON.stringify({
        candidate_id: candidateId,
        fiv_product_id: '11111111-1111-4111-8111-111111111111',
        fiv_product_slug: 'galaxy-glow-mini-printer',
        fiv_trend_id: '22222222-2222-4222-8222-222222222222',
        fiv_trend_slug: 'pocket-creativity',
        status: 'active',
      }),
    }, PUBLISHER_TOKEN)
    expect(link.status).toBe(201)

    const changes = await call('/v1/changes?after=0&limit=100', {}, READ_TOKEN)
    const changeBody = await changes.json() as { changes: Array<{ event_type: string }> }
    expect(changeBody.changes.filter((change) => change.event_type === 'viral_signal')).toHaveLength(3)
    expect(changeBody.changes.filter((change) => change.event_type === 'score_snapshot')).toHaveLength(3)
    expect(changeBody.changes.filter((change) => change.event_type === 'catalog_patch')).toHaveLength(1)

    const ack = await call(`/v1/patches/${patchId}/ack`, {
      method: 'POST',
      body: JSON.stringify({ status: 'applied', delivery_token: delivery.delivery_token }),
    }, PUBLISHER_TOKEN)
    expect(ack.status).toBe(200)
    expect((await call('/v1/patches/next', {}, PUBLISHER_TOKEN)).status).toBe(204)

    const repeatedAck = await call(`/v1/patches/${patchId}/ack`, {
      method: 'POST',
      body: JSON.stringify({ status: 'failed', delivery_token: delivery.delivery_token }),
    }, PUBLISHER_TOKEN)
    expect(repeatedAck.status).toBe(409)

    const duplicatePatch = await call('/v1/patches', {
      method: 'POST',
      body: JSON.stringify({ mode: 'review' }),
    }, ADMIN_TOKEN)
    expect(duplicatePatch.status).toBe(200)
    expect((await duplicatePatch.json() as PatchResponse).patch).toBeNull()
  })
})
