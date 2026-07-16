import { env } from 'cloudflare:workers'
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
} from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import type { PollSourceMessage, ViralSignalBatchV1 } from '../src/domain'
import { processScheduledRun, SOURCE_POLL_CRON } from '../src/scheduler'
import { upsertSource } from '../src/repository'
import { makeSignal } from './fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function queueResponse(): QueueSendBatchResponse {
  return {
    metadata: {
      metrics: {
        backlogCount: 0,
        backlogBytes: 0,
      },
    },
  }
}

describe('scheduled discovery and Queue delivery', () => {
  it('claims a due feed exactly once and enqueues a poll message', async () => {
    const now = new Date()
    await upsertSource(env.DB, {
      id: 'scheduled-feed',
      name: 'Scheduled feed',
      kind: 'json_feed',
      endpoint_url: 'https://feeds.example.com/trending.json',
      independence_key: 'scheduled-feed',
      catalog_host_allowlist: ['products.example.com'],
      trust_weight: 0.8,
      poll_interval_minutes: 30,
      enabled: true,
    }, now.toISOString())

    const sendBatch = vi.spyOn(env.SOURCE_QUEUE, 'sendBatch').mockResolvedValue(queueResponse())
    const scheduledTime = now.getTime() + 1000
    const first = await processScheduledRun(createScheduledController({
      cron: SOURCE_POLL_CRON,
      scheduledTime: new Date(scheduledTime),
    }), env, now)
    const duplicate = await processScheduledRun(createScheduledController({
      cron: SOURCE_POLL_CRON,
      scheduledTime: new Date(scheduledTime),
    }), env, now)

    expect(first).toMatchObject({ duplicate: false, queuedSources: 1 })
    expect(duplicate).toMatchObject({ duplicate: true, queuedSources: 0 })
    expect(sendBatch).toHaveBeenCalledTimes(1)
    const messages = Array.from(sendBatch.mock.calls[0]?.[0] ?? [])
    expect(messages[0]?.body).toMatchObject({ kind: 'poll_source', source_id: 'scheduled-feed' })
  })

  it('acknowledges a valid feed and retries a transient upstream failure per message', async () => {
    const now = new Date()
    for (const id of ['queue-success-feed', 'queue-retry-feed']) {
      await upsertSource(env.DB, {
        id,
        name: id,
        kind: 'json_feed',
        endpoint_url: `https://feeds.example.com/${id}.json`,
        independence_key: id,
        catalog_host_allowlist: ['products.example.com'],
        trust_weight: 0.9,
        poll_interval_minutes: 30,
        enabled: true,
      }, now.toISOString())
    }

    const successBatch: ViralSignalBatchV1 = {
      schema_version: 1,
      records: [makeSignal({ source: 'queue-success-feed', now })],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(successBatch), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const successMessage = {
      id: 'queue-message-success',
      timestamp: now,
      attempts: 1,
      body: {
        kind: 'poll_source' as const,
        source_id: 'queue-success-feed',
        scheduled_at: now.toISOString(),
        execution_key: 'cron-success',
      },
    }
    const retryMessage = {
      id: 'queue-message-retry',
      timestamp: now,
      attempts: 1,
      body: {
        kind: 'poll_source' as const,
        source_id: 'queue-retry-feed',
        scheduled_at: now.toISOString(),
        execution_key: 'cron-retry',
      },
    }

    const batch = createMessageBatch<PollSourceMessage>(
      'finditviral-trend-source-polls',
      [successMessage, retryMessage],
    )
    const ctx = createExecutionContext()
    await worker.queue(batch, env)
    const result = await getQueueResult(batch, ctx)

    expect(result.explicitAcks).toContain(successMessage.id)
    expect(result.retryMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ msgId: retryMessage.id })]),
    )
    const stored = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM viral_signals WHERE source_id = 'queue-success-feed'
    `).first<{ count: number }>()
    expect(stored?.count).toBe(1)

    const replayBatch = createMessageBatch<PollSourceMessage>(
      'finditviral-trend-source-polls',
      [successMessage],
    )
    const replayContext = createExecutionContext()
    await worker.queue(replayBatch, env)
    const replayResult = await getQueueResult(replayBatch, replayContext)
    expect(replayResult.explicitAcks).toContain(successMessage.id)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('releases source and cron claims when Queue publication fails so the event can retry', async () => {
    const now = new Date()
    await env.DB.prepare(`
      UPDATE sources SET next_poll_at = ?, lease_until = NULL
    `).bind(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()).run()
    await upsertSource(env.DB, {
      id: 'queue-send-failure-feed',
      name: 'Queue send failure feed',
      kind: 'json_feed',
      endpoint_url: 'https://feeds.example.com/queue-send-failure.json',
      independence_key: 'queue-send-failure-feed',
      catalog_host_allowlist: ['products.example.com'],
      trust_weight: 0.9,
      poll_interval_minutes: 30,
      enabled: true,
    }, now.toISOString())

    const sendBatch = vi.spyOn(env.SOURCE_QUEUE, 'sendBatch')
      .mockRejectedValueOnce(new Error('Queue temporarily unavailable'))
      .mockResolvedValue(queueResponse())
    const controller = createScheduledController({
      cron: SOURCE_POLL_CRON,
      scheduledTime: now,
    })
    await expect(processScheduledRun(controller, env, now)).rejects.toThrow('Queue temporarily unavailable')

    const released = await env.DB.prepare(`
      SELECT lease_until, next_poll_at FROM sources WHERE id = 'queue-send-failure-feed'
    `).first<{ lease_until: string | null; next_poll_at: string }>()
    expect(released?.lease_until).toBeNull()
    expect(released?.next_poll_at).toBe(now.toISOString())

    const retry = await processScheduledRun(controller, env, now)
    expect(retry).toMatchObject({ duplicate: false, queuedSources: 1 })
    expect(sendBatch).toHaveBeenCalledTimes(2)
  })
})
