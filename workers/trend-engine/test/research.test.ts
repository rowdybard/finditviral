import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimResearchRun, getResearchRun, researchRunView } from '../src/repository'
import { enqueueResearchRun, executeResearchRun, recordResearchFailure } from '../src/research'
import worker from '../src/index'

afterEach(() => vi.unstubAllGlobals())

function response(citations: string[], candidateUrls = citations, reviewMetrics: Record<string, unknown> = { rating_count: null, question_count: null, count_confidence: null, supporting_quote: null }): Response {
  return new Response(JSON.stringify({
    output: [
      { type: 'web_search_call', action: { sources: citations.map((url) => ({ type: 'url', url })) } },
      { content: [{
        type: 'output_text',
        text: JSON.stringify({ candidates: [{
          name: 'Galaxy Glow Mini Printer', brand: 'Nova Toys', category: 'Tech toys',
          product_url: 'https://products.example.com/galaxy-glow-mini-printer',
          availability_status: 'available', topic: { name: 'Pocket Creativity' },
          signal: { type: 'social_velocity', value: 82, velocity: 0.5 }, confidence: 0.7,
          evidence_urls: candidateUrls,
          evidence: candidateUrls.map((url, index) => ({ url, classification: index === 0 ? 'independent_social' : 'retailer_listing', supporting_quote: `Evidence ${index + 1} supports this candidate.` })),
          why_discovered: ['Independent consumer conversation and retail availability appeared in the current search.'],
          missing_validation: ['No verified seven-day search baseline was found.'],
          review_metrics: reviewMetrics,
        }] }),
        annotations: [],
      }] },
    ],
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
    const fetchMock = vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ]))
    vi.stubGlobal('fetch', fetchMock)
    await executeResearchRun(env, queued.run.id, now)

    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      model: string
      max_output_tokens: number
      text: { format: { schema: { properties: { candidates: { items: { properties: Record<string, unknown>; required: string[] } } } } } }
    }
    expect(requestBody).toMatchObject({
      model: 'gpt-5.6-luna',
      max_output_tokens: 8_000,
      include: ['web_search_call.action.sources'],
      reasoning: { effort: 'high' },
      tools: [{ type: 'web_search', search_context_size: 'high', return_token_budget: 'unlimited' }],
    })
    const candidateSchema = requestBody.text.format.schema.properties.candidates.items
    expect(candidateSchema.required).toEqual(Object.keys(candidateSchema.properties))
    const nestedProperties = candidateSchema.properties as Record<string, { properties?: Record<string, unknown>; required?: string[] }>
    expect(nestedProperties.topic!.required).toEqual(Object.keys(nestedProperties.topic!.properties!))
    expect(nestedProperties.signal!.required).toEqual(Object.keys(nestedProperties.signal!.properties!))

    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run).toMatchObject({ status: 'succeeded', accepted_count: 1, rejected_count: 0 })
    expect(researchRunView(run!).diagnostics.discovery_lanes).toEqual(['social', 'commerce'])
    const signal = await env.DB.prepare("SELECT source_id FROM viral_signals WHERE source_id = 'openai-research'").first<{ source_id: string }>()
    expect(signal?.source_id).toBe('openai-research')
  })

  it('rejects candidate URLs that were not returned as OpenAI web citations', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-invalid-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T13:00:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://evidence.example.com/article-one',
      'https://evidence.example.net/article-two',
    ], [
      'https://invented.example.com/not-cited',
      'https://evidence.example.net/article-two',
    ])))
    await executeResearchRun(env, queued.run.id, now)
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run).toMatchObject({ status: 'succeeded', accepted_count: 0, rejected_count: 1 })
    expect(researchRunView(run!).diagnostics).toMatchObject({
      source_urls: ['https://evidence.example.com/article-one', 'https://evidence.example.net/article-two'],
      summary: 'No candidates passed validation.',
      candidates: [{ name: 'Galaxy Glow Mini Printer', matched_evidence_count: 1, rejection_reasons: ['requires_two_returned_web_sources', 'missing_labeled_evidence_profiles'] }],
    })
  })

  it('rejects implausibly concatenated review counts instead of treating them as velocity', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-counts-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T13:30:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ], undefined, {
      rating_count: 40, question_count: 402, count_confidence: 0.95, supporting_quote: '40402',
    })))
    await executeResearchRun(env, queued.run.id, now)
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run).toMatchObject({ status: 'succeeded', accepted_count: 0, rejected_count: 1 })
    expect(researchRunView(run!).diagnostics.candidates[0]).toMatchObject({
      count_flag: 'possible_concatenated_count',
      rejection_reasons: expect.arrayContaining(['possible_concatenated_count']),
    })
  })

  it('records an actionable non-retryable error when OpenAI authentication fails', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-auth-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T14:00:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_test_auth_failure' },
    })))

    const failure = await executeResearchRun(env, queued.run.id, now).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'OPENAI_RESEARCH_AUTH_FAILED',
      retryable: false,
    })
    await recordResearchFailure(env, queued.run.id, failure, false)
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

  it('allows an admin to force-cancel an active research run', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-cancel-${crypto.randomUUID()}` })
    const response = await worker.fetch(new Request(`https://trend-engine.test/v1/research/runs/${queued.run.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ENGINE_ADMIN_TOKEN}` },
    }), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ run: { id: queued.run.id, status: 'failed', error_code: 'RESEARCH_RUN_CANCELLED' } })
    const repeat = await worker.fetch(new Request(`https://trend-engine.test/v1/research/runs/${queued.run.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ENGINE_ADMIN_TOKEN}` },
    }), env)
    expect(repeat.status).toBe(409)
  })
})
