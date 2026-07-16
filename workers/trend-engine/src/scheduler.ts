import type { EngineMode, PollSourceMessage } from './domain'
import { EngineError } from './errors'
import { stableId } from './identity'
import { recomputeAllCandidates } from './ingest'
import { generateCatalogPatch } from './patches'
import {
  claimCronRun,
  claimDueSources,
  cleanupCronRuns,
  cleanupRetention,
  releaseCronRun,
  releaseSourceClaims,
} from './repository'

export const SOURCE_POLL_CRON = '*/5 * * * *'
export const SCORE_CRON = '3,13,23,33,43,53 * * * *'
export const PATCH_CRON = '8 * * * *'
export const RETENTION_CRON = '37 3 * * *'

export interface ScheduledResult {
  duplicate: boolean
  queuedSources: number
  recomputedCandidates: number
  patchId: string | null
}

async function enqueueDueSources(env: Env, scheduledAt: string, executionKey: string): Promise<number> {
  const due = await claimDueSources(env.DB, new Date(scheduledAt))
  if (due.length === 0) return 0
  try {
    await env.SOURCE_QUEUE.sendBatch(due.map((source) => ({
      body: {
        kind: 'poll_source',
        source_id: source.id,
        scheduled_at: scheduledAt,
        execution_key: executionKey,
      } satisfies PollSourceMessage,
      contentType: 'json' as const,
    })))
  } catch (error) {
    await releaseSourceClaims(env.DB, due.map((source) => source.id), scheduledAt)
    throw error
  }
  return due.length
}

function configuredMode(env: Env): EngineMode {
  const value: string = env.AUTOPILOT_MODE
  if (value === 'shadow' || value === 'review' || value === 'autopilot') return value
  throw new EngineError('ENGINE_CONFIGURATION_INVALID', 'AUTOPILOT_MODE must be shadow, review, or autopilot.', 500)
}

export async function processScheduledRun(
  controller: ScheduledController,
  env: Env,
  now = new Date(),
): Promise<ScheduledResult> {
  const scheduledAt = new Date(controller.scheduledTime).toISOString()
  const executionKey = await stableId('cron', `${controller.cron}:${controller.scheduledTime}`)
  const claimed = await claimCronRun(env.DB, executionKey, controller.cron, scheduledAt, now.toISOString())
  if (!claimed) {
    controller.noRetry()
    return { duplicate: true, queuedSources: 0, recomputedCandidates: 0, patchId: null }
  }

  try {
    await cleanupCronRuns(env.DB, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
    if (controller.cron === SOURCE_POLL_CRON) {
      return {
        duplicate: false,
        queuedSources: await enqueueDueSources(env, scheduledAt, executionKey),
        recomputedCandidates: 0,
        patchId: null,
      }
    }

    if (controller.cron === SCORE_CRON) {
      return {
        duplicate: false,
        queuedSources: 0,
        recomputedCandidates: await recomputeAllCandidates(env.DB, now),
        patchId: null,
      }
    }

    if (controller.cron === PATCH_CRON) {
      const result = await generateCatalogPatch(env.DB, configuredMode(env), 'scheduled', now)
      return {
        duplicate: false,
        queuedSources: 0,
        recomputedCandidates: 0,
        patchId: result.patch?.patch_id ?? null,
      }
    }

    if (controller.cron === RETENTION_CRON) {
      await cleanupRetention(
        env.DB,
        new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(),
        now.toISOString(),
      )
      return { duplicate: false, queuedSources: 0, recomputedCandidates: 0, patchId: null }
    }

    controller.noRetry()
    return { duplicate: false, queuedSources: 0, recomputedCandidates: 0, patchId: null }
  } catch (error) {
    await releaseCronRun(env.DB, executionKey)
    throw error
  }
}
