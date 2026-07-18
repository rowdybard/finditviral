import { env } from 'cloudflare:workers'
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimResearchRun, cancelResearchRun, getResearchRun, researchRunView, getLaneCheckpoints, createLaneCheckpoints, claimLaneCheckpoint, completeLaneCheckpoint, getLaneCheckpoint, reconcileStaleResearchRuns, releaseStaleLaneLeases, pauseResearchRun, resumeResearchRun, claimFinalize } from '../src/repository'
import { enqueueResearchRun, executeResearchRun, executeResearchLane, finalizeResearchRun, recordResearchFailure, computeRetryDelay, computeNextLaneDelay } from '../src/research'
import { researchRetryDelay } from '../src/queue'
import worker from '../src/index'
import type { OpenAiResearchMessage, ResearchLaneMessage, TrendEngineQueueMessage } from '../src/domain'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
    new Error('Unexpected outbound OpenAI request in test'),
  ))
})

afterEach(() => vi.unstubAllGlobals())

async function cancelIfActive(runId: string): Promise<void> {
  const run = await getResearchRun(env.DB, runId)
  if (run && ['queued', 'running', 'paused_rate_limit', 'finalizing'].includes(run.status)) {
    await cancelResearchRun(env.DB, runId, new Date().toISOString())
  }
}

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
      max_output_tokens: 1_200,
      include: ['web_search_call.action.sources'],
      reasoning: { effort: 'medium' },
      tools: [{ type: 'web_search', search_context_size: 'medium', return_token_budget: 'default' }],
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
    await cancelIfActive(queued.run.id)
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
    await cancelIfActive(queued.run.id)
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
    await cancelIfActive(queued.run.id)
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
    await cancelIfActive(queued.run.id)
  })

  it('uses the default web result budget only after a rate-limited attempt, while preserving high search context', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-rate-retry-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T14:15:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    const fetchMock = vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    await executeResearchRun(env, queued.run.id, now)
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(requestBody.tools).toEqual([{ type: 'web_search', search_context_size: 'medium', return_token_budget: 'default' }])
    expect(requestBody.max_output_tokens).toBe(1_200)
    expect(requestBody.reasoning).toEqual({ effort: 'medium' })
    await cancelIfActive(queued.run.id)
  })

  it('honors the provider token reset window after a 429 response', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `manual-rate-limit-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T14:30:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'x-ratelimit-reset-tokens': '6m0s' },
    })))

    const failure = await executeResearchRun(env, queued.run.id, now).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'OPENAI_RESEARCH_RATE_LIMITED', retryable: true, retryAfterSeconds: 360 })
    expect(researchRetryDelay(failure, 1)).toBe(360)
    // The queue records this before retrying. Clean up the focused direct-call
    // fixture so it does not occupy the single active-run slot for later tests.
    await recordResearchFailure(env, queued.run.id, failure, false)
    await cancelIfActive(queued.run.id)
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
    const runs = await env.DB.prepare('SELECT id FROM research_runs WHERE status IN (\'queued\', \'running\')').all<{ id: string }>()
    for (const r of runs.results) await cancelIfActive(r.id)
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
    await cancelIfActive(queued.run.id)
  })
})

describe('research queue delivery', () => {
  it('acknowledges a successful research run delivered via queue', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `queue-success-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T15:00:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ])))

    const batch = createMessageBatch<OpenAiResearchMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-success', timestamp: now, attempts: 1, body: { kind: 'openai_research', run_id: queued.run.id } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-success')
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('succeeded')
    await cancelIfActive(queued.run.id)
  })

  it('retries a message when the run is already claimed by another consumer', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `queue-busy-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T15:05:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 10 * 60 * 1000).toISOString())

    const batch = createMessageBatch<OpenAiResearchMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-busy', timestamp: now, attempts: 1, body: { kind: 'openai_research', run_id: queued.run.id } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.retryMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ msgId: 'msg-busy' })]),
    )
    await cancelIfActive(queued.run.id)
  })

  it('acks a completed run without re-executing OpenAI', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `queue-dup-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T15:10:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    const fetchMock = vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ]))
    vi.stubGlobal('fetch', fetchMock)
    await executeResearchRun(env, queued.run.id, now)

    const batch = createMessageBatch<OpenAiResearchMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-dup', timestamp: now, attempts: 1, body: { kind: 'openai_research', run_id: queued.run.id } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-dup')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await cancelIfActive(queued.run.id)
  })

  it('acks and fails the run on a non-retryable OpenAI error', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `queue-auth-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T15:15:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_test' },
    })))

    const batch = createMessageBatch<OpenAiResearchMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-auth', timestamp: now, attempts: 1, body: { kind: 'openai_research', run_id: queued.run.id } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-auth')
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('failed')
    expect(run?.error_code).toBe('OPENAI_RESEARCH_AUTH_FAILED')
  })

  it('retries with delay on a 429 rate-limit response', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `queue-429-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T15:20:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'x-ratelimit-reset-tokens': '6m0s' },
    })))

    const batch = createMessageBatch<OpenAiResearchMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-429', timestamp: now, attempts: 1, body: { kind: 'openai_research', run_id: queued.run.id } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.retryMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ msgId: 'msg-429' })]),
    )
    await cancelIfActive(queued.run.id)
  })
})

describe('computeRetryDelay', () => {
  it('returns exponential delay with jitter when no retryAfterSeconds', () => {
    const delay = computeRetryDelay(undefined, 1)
    expect(delay).toBeGreaterThanOrEqual(30)
    expect(delay).toBeLessThanOrEqual(45)
  })

  it('uses provider reset window when larger than exponential', () => {
    const delay = computeRetryDelay(360, 1)
    expect(delay).toBeGreaterThanOrEqual(360)
    expect(delay).toBeLessThanOrEqual(375)
  })

  it('caps at 3600 seconds', () => {
    const delay = computeRetryDelay(7200, 5)
    expect(delay).toBe(3600)
  })
})

describe('lane checkpoint idempotency', () => {
  it('does not re-execute a completed lane', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-idempotent-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T16:00:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())
    await createLaneCheckpoints(env.DB, queued.run.id, nowIso)

    const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    expect(await claimLaneCheckpoint(env.DB, queued.run.id, 'social', nowIso, leaseUntil)).toBe('claimed')

    await completeLaneCheckpoint(env.DB, queued.run.id, 'social', {
      candidatesJson: '[]',
      evidenceJson: '[]',
      diagnosticsJson: '{"source_urls":[],"discovery_lanes":[],"candidates":[],"summary":null}',
      requestId: 'req_test',
      usageJson: '{}',
      rateLimitDiagnosticsJson: '{}',
      now: nowIso,
    })

    expect(await claimLaneCheckpoint(env.DB, queued.run.id, 'social', nowIso, leaseUntil)).toBe('completed')
    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('succeeded')
    await cancelIfActive(queued.run.id)
  })

  it('creates four lane checkpoints for a new run', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-create-${crypto.randomUUID()}` })
    const checkpoints = await getLaneCheckpoints(env.DB, queued.run.id)
    expect(checkpoints).toHaveLength(4)
    expect(checkpoints.map((c) => c.lane).sort()).toEqual(['commerce', 'search_demand', 'social', 'trend_media'])
    expect(checkpoints.every((c) => c.status === 'pending')).toBe(true)
    await cancelIfActive(queued.run.id)
  })
})

describe('research finalize', () => {
  it('finalizes a run only once (idempotent)', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `finalize-idempotent-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T16:30:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())

    const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    for (const lane of ['social', 'search_demand', 'commerce', 'trend_media'] as const) {
      await claimLaneCheckpoint(env.DB, queued.run.id, lane, nowIso, leaseUntil)
      await completeLaneCheckpoint(env.DB, queued.run.id, lane, {
        candidatesJson: '[]',
        evidenceJson: '[]',
        diagnosticsJson: '{"source_urls":[],"discovery_lanes":[],"candidates":[],"summary":null}',
        requestId: null,
        usageJson: '{}',
        rateLimitDiagnosticsJson: '{}',
        now: nowIso,
      })
    }

    expect(await claimFinalize(env.DB, queued.run.id)).toBe(true)
    expect(await claimFinalize(env.DB, queued.run.id)).toBe(false)

    await finalizeResearchRun(env, queued.run.id, now)
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('succeeded')
    await cancelIfActive(queued.run.id)
  })
})

describe('research DLQ consumer', () => {
  it('marks a lane and run as failed on DLQ delivery', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `dlq-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T17:00:00.000Z')

    const batch = createMessageBatch<TrendEngineQueueMessage>(
      'finditviral-trend-research-dlq',
      [{ id: 'msg-dlq', timestamp: now, attempts: 4, body: { kind: 'research_lane', run_id: queued.run.id, lane: 'social' } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-dlq')
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('failed')
    expect(run?.error_code).toBe('DLQ_EXHAUSTED')
    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('failed')
  })
})

describe('stale-run reconciliation', () => {
  it('re-enqueues a stale run with an expired lease', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `stale-${crypto.randomUUID()}` })
    const past = new Date('2026-07-17T10:00:00.000Z')
    const pastIso = past.toISOString()

    await claimResearchRun(env.DB, queued.run.id, pastIso, pastIso)

    const now = new Date('2026-07-17T18:00:00.000Z')
    const reEnqueued = await reconcileStaleResearchRuns(env.DB, now.toISOString())
    expect(reEnqueued.some((r) => r.runId === queued.run.id)).toBe(true)
    expect(reEnqueued.find((r) => r.runId === queued.run.id)?.lane).toBe('social')
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('queued')
    await cancelIfActive(queued.run.id)
  })

  it('fails a run that exceeds the 6-hour deadline', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `deadline-${crypto.randomUUID()}` })
    const past = new Date('2026-07-17T10:00:00.000Z')
    const pastIso = past.toISOString()

    await claimResearchRun(env.DB, queued.run.id, pastIso, pastIso)

    await env.DB.prepare('UPDATE research_runs SET created_at = ? WHERE id = ?')
      .bind(new Date('2026-07-17T10:00:00.000Z').toISOString(), queued.run.id).run()

    const now = new Date('2026-07-17T18:00:00.000Z')
    await reconcileStaleResearchRuns(env.DB, now.toISOString())
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('failed')
    expect(run?.error_code).toBe('RESEARCH_DEADLINE_EXCEEDED')
  })
})

describe('stale lane lease release', () => {
  it('releases a stale lane lease back to pending', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-stale-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T16:00:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())
    const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    await claimLaneCheckpoint(env.DB, queued.run.id, 'social', nowIso, leaseUntil)

    await env.DB.prepare('UPDATE research_lane_checkpoints SET lease_until = ? WHERE run_id = ? AND lane = ?')
      .bind(new Date('2026-07-17T15:00:00.000Z').toISOString(), queued.run.id, 'social').run()

    await releaseStaleLaneLeases(env.DB, new Date('2026-07-17T16:05:00.000Z').toISOString())
    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('pending')
    expect(cp?.lease_until).toBeNull()
    await cancelIfActive(queued.run.id)
  })
})

describe('paused run resume', () => {
  it('resumes a paused run back to queued', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `resume-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T16:00:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())
    await pauseResearchRun(env.DB, queued.run.id)

    let run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('paused_rate_limit')

    const resumed = await resumeResearchRun(env.DB, queued.run.id)
    expect(resumed?.status).toBe('queued')

    run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('queued')
    await cancelIfActive(queued.run.id)
  })

  it('returns null when resuming a non-paused run', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `resume-non-paused-${crypto.randomUUID()}` })
    const result = await resumeResearchRun(env.DB, queued.run.id)
    expect(result).toBeNull()
    await cancelIfActive(queued.run.id)
  })
})

describe('lane progress in views', () => {
  it('includes lane progress in researchRunView', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-view-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T16:00:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())
    const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    await claimLaneCheckpoint(env.DB, queued.run.id, 'social', nowIso, leaseUntil)
    await completeLaneCheckpoint(env.DB, queued.run.id, 'social', {
      candidatesJson: '[]',
      evidenceJson: '[]',
      diagnosticsJson: '{"source_urls":[],"discovery_lanes":[],"candidates":[],"summary":null}',
      requestId: 'req_test_123',
      usageJson: '{}',
      rateLimitDiagnosticsJson: '{}',
      now: nowIso,
    })

    const run = await getResearchRun(env.DB, queued.run.id)
    const checkpoints = await getLaneCheckpoints(env.DB, queued.run.id)
    const view = researchRunView(run!, checkpoints)
    expect(view.lanes).toHaveLength(4)
    const socialLane = view.lanes.find((l) => l.lane === 'social')
    expect(socialLane?.status).toBe('succeeded')
    expect(socialLane?.request_id).toBe('req_test_123')
    const pendingLane = view.lanes.find((l) => l.lane === 'search_demand')
    expect(pendingLane?.status).toBe('pending')
    await cancelIfActive(queued.run.id)
  })
})

describe('429 recovery to finalization (end-to-end)', () => {
  it('recovers from a 429, resumes, completes remaining lanes, and finalizes', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `e2e-429-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T19:00:00.000Z')

    // First lane (social) gets a 429
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'x-ratelimit-reset-tokens': '1m0s' },
    })))
    const result1 = await executeResearchLane(env, queued.run.id, 'social', now)
    expect(result1.outcome).toBe('replacement_scheduled')

    const runAfterPause = await getResearchRun(env.DB, queued.run.id)
    expect(runAfterPause?.status).toBe('paused_rate_limit')

    const socialCp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(socialCp?.status).toBe('retry_wait')

    // Replacement message arrives — social lane succeeds
    const now2 = new Date('2026-07-17T19:05:00.000Z')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ])))
    const result2 = await executeResearchLane(env, queued.run.id, 'social', now2)
    expect(result2.outcome).toBe('completed')

    const runAfterResume = await getResearchRun(env.DB, queued.run.id)
    expect(runAfterResume?.status).not.toBe('paused_rate_limit')

    // Complete remaining lanes
    const now3 = new Date('2026-07-17T19:07:00.000Z')
    for (const lane of ['search_demand', 'commerce', 'trend_media'] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
        'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
        'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
      ])))
      const r = await executeResearchLane(env, queued.run.id, lane, now3)
      expect(r.outcome).toBe('completed')
    }

    // Finalize
    const now4 = new Date('2026-07-17T19:09:00.000Z')
    await finalizeResearchRun(env, queued.run.id, now4)
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('succeeded')
    await cancelIfActive(queued.run.id)
  })
})

describe('cross-lane distinct observations', () => {
  it('produces distinct observation IDs for the same candidate across lanes', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `cross-lane-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T19:30:00.000Z')
    const nowIso = now.toISOString()

    await claimResearchRun(env.DB, queued.run.id, nowIso, new Date(now.getTime() + 60000).toISOString())

    const urls = [
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response(urls))))

    await executeResearchLane(env, queued.run.id, 'social', now)
    await executeResearchLane(env, queued.run.id, 'search_demand', now)

    const checkpoints = await getLaneCheckpoints(env.DB, queued.run.id)
    const socialRecords = JSON.parse(checkpoints.find((c) => c.lane === 'social')!.candidates_json) as Array<{ external_observation_id: string }>
    const searchRecords = JSON.parse(checkpoints.find((c) => c.lane === 'search_demand')!.candidates_json) as Array<{ external_observation_id: string }>

    if (socialRecords.length > 0 && searchRecords.length > 0) {
      expect(socialRecords[0]!.external_observation_id).not.toBe(searchRecords[0]!.external_observation_id)
    }
    await cancelIfActive(queued.run.id)
  })
})

describe('non-429 retryable failure acks original message', () => {
  it('acks the queue message when a replacement is durably scheduled', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `no-double-retry-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T20:00:00.000Z')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain', 'x-request-id': 'req_500' },
    })))

    const batch = createMessageBatch<ResearchLaneMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-500', timestamp: now, attempts: 1, body: { kind: 'research_lane', run_id: queued.run.id, lane: 'social' } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-500')
    await cancelIfActive(queued.run.id)
  })
})

describe('busy lane retries the queue message', () => {
  it('retries when the lane is already claimed by another consumer', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `busy-retry-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T20:10:00.000Z')
    const nowIso = now.toISOString()

    const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    await claimResearchRun(env.DB, queued.run.id, nowIso, leaseUntil)
    await claimLaneCheckpoint(env.DB, queued.run.id, 'social', nowIso, leaseUntil)

    const batch = createMessageBatch<ResearchLaneMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-busy-lane', timestamp: now, attempts: 1, body: { kind: 'research_lane', run_id: queued.run.id, lane: 'social' } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.retryMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ msgId: 'msg-busy-lane' })]),
    )
    await cancelIfActive(queued.run.id)
  })
})

describe('retry backoff increases with attempts', () => {
  it('uses checkpoint attempts for computeRetryDelay', () => {
    const delay1 = computeRetryDelay(undefined, 1)
    const delay2 = computeRetryDelay(undefined, 2)
    const delay3 = computeRetryDelay(undefined, 3)
    expect(delay2).toBeGreaterThanOrEqual(delay1)
    expect(delay3).toBeGreaterThanOrEqual(delay2)
  })
})

describe('research_lane queue delivery', () => {
  it('acknowledges a successful research_lane message', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-queue-success-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T20:20:00.000Z')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ])))

    const batch = createMessageBatch<ResearchLaneMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-lane-ok', timestamp: now, attempts: 1, body: { kind: 'research_lane', run_id: queued.run.id, lane: 'social' } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-lane-ok')
    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('succeeded')
    await cancelIfActive(queued.run.id)
  })

  it('acks and fails on a non-retryable lane error', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `lane-queue-auth-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T20:25:00.000Z')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_test' },
    })))

    const batch = createMessageBatch<ResearchLaneMessage>(
      'finditviral-trend-research',
      [{ id: 'msg-lane-auth', timestamp: now, attempts: 1, body: { kind: 'research_lane', run_id: queued.run.id, lane: 'social' } }],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain('msg-lane-auth')
    const run = await getResearchRun(env.DB, queued.run.id)
    expect(run?.status).toBe('failed')
    expect(run?.error_code).toBe('OPENAI_RESEARCH_AUTH_FAILED')
  })
})

describe('computeNextLaneDelay', () => {
  it('uses a five-minute fallback when headers are missing', () => {
    const delay = computeNextLaneDelay()
    expect(delay).toBeGreaterThanOrEqual(300)
    expect(delay).toBeLessThanOrEqual(330)
  })

  it('uses a five-minute fallback when all headers are null', () => {
    const delay = computeNextLaneDelay({
      requestId: null,
      limitRequests: null,
      remainingRequests: null,
      resetRequestsSeconds: null,
      limitTokens: null,
      remainingTokens: null,
      resetTokensSeconds: null,
    })
    expect(delay).toBeGreaterThanOrEqual(300)
    expect(delay).toBeLessThanOrEqual(330)
  })

  it('delays until after token reset when remaining tokens are low', () => {
    const delay = computeNextLaneDelay({
      requestId: 'req_1',
      limitRequests: 100,
      remainingRequests: 50,
      resetRequestsSeconds: 10,
      limitTokens: 10_000,
      remainingTokens: 1_000,
      resetTokensSeconds: 600,
    })
    expect(delay).toBeGreaterThanOrEqual(600)
    expect(delay).toBeLessThanOrEqual(630)
  })

  it('delays until after request reset when request capacity is exhausted', () => {
    const delay = computeNextLaneDelay({
      requestId: 'req_2',
      limitRequests: 100,
      remainingRequests: 0,
      resetRequestsSeconds: 1200,
      limitTokens: 100_000,
      remainingTokens: 80_000,
      resetTokensSeconds: 5,
    })
    expect(delay).toBeGreaterThanOrEqual(1200)
    expect(delay).toBeLessThanOrEqual(1230)
  })

  it('uses five-minute fallback when capacity is healthy', () => {
    const delay = computeNextLaneDelay({
      requestId: 'req_3',
      limitRequests: 100,
      remainingRequests: 50,
      resetRequestsSeconds: 10,
      limitTokens: 100_000,
      remainingTokens: 80_000,
      resetTokensSeconds: 5,
    })
    expect(delay).toBeGreaterThanOrEqual(300)
    expect(delay).toBeLessThanOrEqual(330)
  })

  it('caps delay at 3600 seconds', () => {
    const delay = computeNextLaneDelay({
      requestId: 'req_4',
      limitRequests: 100,
      remainingRequests: 0,
      resetRequestsSeconds: 7200,
      limitTokens: 100_000,
      remainingTokens: 80_000,
      resetTokensSeconds: 0,
    })
    expect(delay).toBe(3600)
  })
})

describe('429 rate-limit diagnostics and retry', () => {
  it('stores provider body and rate-limit diagnostics on a 429', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `diag-429-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T21:00:00.000Z')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { type: 'rate_limit_exceeded', code: 'rate_limit', message: 'Too many requests' },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'req_diag_429',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '10m0s',
        'x-ratelimit-limit-tokens': '50000',
        'x-ratelimit-remaining-tokens': '5000',
        'x-ratelimit-reset-tokens': '6m0s',
      },
    })))

    const result = await executeResearchLane(env, queued.run.id, 'social', now)
    expect(result.outcome).toBe('replacement_scheduled')

    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('retry_wait')
    const diag = JSON.parse(cp!.rate_limit_diagnostics_json) as {
      provider_status: number
      provider_error: { error: { type: string; code: string; message: string } }
      rate_limits: {
        requestId: string
        limitRequests: number
        remainingRequests: number
        resetRequestsSeconds: number
        limitTokens: number
        remainingTokens: number
        resetTokensSeconds: number
      }
    }
    expect(diag.provider_status).toBe(429)
    expect(diag.provider_error.error.type).toBe('rate_limit_exceeded')
    expect(diag.provider_error.error.code).toBe('rate_limit')
    expect(diag.rate_limits.requestId).toBe('req_diag_429')
    expect(diag.rate_limits.limitRequests).toBe(100)
    expect(diag.rate_limits.remainingRequests).toBe(0)
    expect(diag.rate_limits.resetRequestsSeconds).toBe(600)
    expect(diag.rate_limits.limitTokens).toBe(50000)
    expect(diag.rate_limits.remainingTokens).toBe(5000)
    expect(diag.rate_limits.resetTokensSeconds).toBe(360)
    await cancelIfActive(queued.run.id)
  })

  it('uses the longest provider reset for 429 retry delay', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `longest-reset-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T21:10:00.000Z')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Rate limit exceeded' },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'x-ratelimit-reset-requests': '2m0s',
        'x-ratelimit-reset-tokens': '8m0s',
        'retry-after': '60',
      },
    })))

    const result = await executeResearchLane(env, queued.run.id, 'social', now)
    expect(result.outcome).toBe('replacement_scheduled')

    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    const nextRetryAt = new Date(cp!.next_retry_at!)
    const delaySeconds = Math.round((nextRetryAt.getTime() - now.getTime()) / 1000)
    // Longest reset is 480s (8m from tokens), plus at least 30s jitter
    expect(delaySeconds).toBeGreaterThanOrEqual(480)
    expect(delaySeconds).toBeLessThanOrEqual(3600)
    await cancelIfActive(queued.run.id)
  })

  it('keeps billing/quota 429 terminal', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `quota-429-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T21:20:00.000Z')
    await claimResearchRun(env.DB, queued.run.id, now.toISOString(), new Date(now.getTime() + 60000).toISOString())

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { type: 'insufficient_quota', message: 'You have insufficient quota' },
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_quota' },
    })))

    const failure = await executeResearchRun(env, queued.run.id, now).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'OPENAI_RESEARCH_QUOTA_EXHAUSTED',
      retryable: false,
    })
    await recordResearchFailure(env, queued.run.id, failure, false)
    await cancelIfActive(queued.run.id)
  })

  it('captures rate-limit headers on successful responses', async () => {
    const queued = await enqueueResearchRun(env, { trigger: 'manual', requestKey: `success-headers-${crypto.randomUUID()}` })
    const now = new Date('2026-07-17T21:30:00.000Z')

    const successResponse = response([
      'https://www.reddit.com/r/deals/comments/galaxy-glow-mini-printer',
      'https://www.target.com/p/galaxy-glow-mini-printer/-/A-1234',
    ])
    const responseWithHeaders = new Response(successResponse.body, {
      status: successResponse.status,
      headers: {
        ...successResponse.headers,
        'x-request-id': 'req_success_123',
        'x-ratelimit-limit-requests': '200',
        'x-ratelimit-remaining-requests': '150',
        'x-ratelimit-reset-requests': '5m0s',
        'x-ratelimit-limit-tokens': '100000',
        'x-ratelimit-remaining-tokens': '90000',
        'x-ratelimit-reset-tokens': '1m0s',
      },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithHeaders))
    await executeResearchLane(env, queued.run.id, 'social', now)

    const cp = await getLaneCheckpoint(env.DB, queued.run.id, 'social')
    expect(cp?.status).toBe('succeeded')
    const diag = JSON.parse(cp!.rate_limit_diagnostics_json) as {
      requestId: string
      limitRequests: number
      remainingRequests: number
      resetRequestsSeconds: number
      limitTokens: number
      remainingTokens: number
      resetTokensSeconds: number
    }
    expect(diag.requestId).toBe('req_success_123')
    expect(diag.limitRequests).toBe(200)
    expect(diag.remainingRequests).toBe(150)
    expect(diag.resetRequestsSeconds).toBe(300)
    expect(diag.limitTokens).toBe(100000)
    expect(diag.remainingTokens).toBe(90000)
    expect(diag.resetTokensSeconds).toBe(60)
    await cancelIfActive(queued.run.id)
  })
})
