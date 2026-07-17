import type { TrendEngineQueueMessage } from './domain'
import { handleHttpRequest } from './http'
import { errorCode, errorMessage } from './errors'
import { logError, logEvent } from './logging'
import { processSourceQueue } from './queue'
import { processScheduledRun } from './scheduler'

export { computeScore } from './scoring'
export { evaluatePatchPolicy } from './policy'
export { parseViralSignalBatch } from './validation'
export type { PollSourceMessage, OpenAiResearchMessage, TrendEngineQueueMessage, ViralSignalV1, CatalogPatchV1 } from './domain'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleHttpRequest(request, env)
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    try {
      const result = await processScheduledRun(controller, env)
      logEvent('info', 'scheduled_run_completed', {
        cron: controller.cron,
        scheduled_at: new Date(controller.scheduledTime).toISOString(),
        duplicate: result.duplicate,
        queued_sources: result.queuedSources,
        recomputed_candidates: result.recomputedCandidates,
        patch_id: result.patchId,
        research_run_id: result.researchRunId,
      })
    } catch (error) {
      logError('scheduled_run_failed', error, {
        cron: controller.cron,
        scheduled_at: new Date(controller.scheduledTime).toISOString(),
        error_code: errorCode(error),
        error: errorMessage(error).slice(0, 300),
      })
      throw error
    }
  },

  async queue(batch: MessageBatch<TrendEngineQueueMessage>, env: Env): Promise<void> {
    await processSourceQueue(batch, env)
  },
} satisfies ExportedHandler<Env, TrendEngineQueueMessage>
