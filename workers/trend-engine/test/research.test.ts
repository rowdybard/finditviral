import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimResearchRun, getResearchRun } from '../src/repository'
import { enqueueResearchRun, executeResearchRun } from '../src/research'
import worker from '../src/index'

afterEach(() => vi.unstubAllGlobals())

function response(citations: string[], candidateUrls = citations): Response {
  return new Response(JSON.stringify({
    output: [{ content: [{
      type: 'output_text',
      text: JSON.stringify({ candidates: [{
        name: 'Galaxy Glow Mini Printer', brand: 'Nova Toys', category: 'Tech toys',
        product_url: 'https://products.example.com/galaxy-glow-mini-printer',
        availability_status: 'available', topic: { name: 'Pocket Creativity' },
        signal: { type: 'social_velocity', value: 82, velocity: 0.5 }, confidence: 0.7,
        evidence_urls: candidateUrls,
      }] }),
      annotations: citations.map((url) => ({ type: 'url_citation', url })),
    }] }],
  }), { headers: { 'Content-Type': 'application/json' } })
}

describe('OpenAI research', () => {
  it('queues one active run and ingests only cited candidate evidence', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: 'manual-test-run' })
    const duplicate = await enqueueResearchRun(env, { trigger: 'manual', requestKey: 'manual-test-run-two' })
    expect(queued.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.run.id).toBe(queued.run.id)

    const now = new Date('2026-07-17T12:00:00.000Z')
    expect(await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())).toBe('claimed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://evidence.example.com/article-one',
      'https://evidence.example.com/article-two',
    ])))
    await executeResearchRun(env, queued.run.id, now)

    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run).toMatchObject({ status: 'succeeded', accepted_count: 1, rejected_count: 0 })
    const signal = await env.DB.prepare("SELECT source_id FROM viral_signals WHERE source_id = 'openai-research'").first<{ source_id: string }>()
    expect(signal?.source_id).toBe('openai-research')
  })

  it('rejects candidate URLs that were not returned as OpenAI web citations', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-invalid-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T13:00:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://evidence.example.com/article-one',
      'https://evidence.example.com/article-two',
    ], [
      'https://invented.example.com/not-cited',
      'https://evidence.example.com/article-two',
    ])))
    await executeResearchRun(env, queued.run.id, now)
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run).toMatchObject({ status: 'succeeded', accepted_count: 0, rejected_count: 1 })
  })

  it('exposes research-run controls only to admins', async () => {
    const request = (token?: string) => new Request('https://trend-engine.test/v1/research/runs', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    expect((await worker.fetch(request(), env)).status).toBe(401)
    const started = await worker.fetch(request(env.ENGINE_ADMIN_TOKEN), env)
    expect(started.status).toBe(202)
    const listed = await worker.fetch(new Request('https://trend-engine.test/v1/research/runs', {
      headers: { Authorization: `Bearer ${env.ENGINE_ADMIN_TOKEN}` },
    }), env)
    expect((await listed.json() as { runs: unknown[] }).runs.length).toBeGreaterThan(0)
  })
})
