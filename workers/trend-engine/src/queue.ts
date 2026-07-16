import type { PollSourceMessage } from './domain'
import { EngineError, errorCode } from './errors'
import { pollSource } from './collector'
import { stableId } from './identity'
import { logError, logEvent } from './logging'
import {
  claimSourcePollJob,
  completeSourcePollJob,
  recordSourceFailure,
  releaseSourcePollJob,
} from './repository'

function isPollSourceMessage(value: unknown): value is PollSourceMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.kind === 'poll_source'
    && typeof record.source_id === 'string'
    && typeof record.scheduled_at === 'string'
    && typeof record.execution_key === 'string'
}

function retryDelay(attempts: number): number {
  return Math.min(30 * (2 ** Math.max(0, attempts - 1)), 3600)
}

export async function processSourceQueue(batch: MessageBatch<PollSourceMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    if (!isPollSourceMessage(message.body)) {
      logEvent('warn', 'queue_message_invalid', { message_id: message.id })
      message.ack()
      continue
    }

    const now = new Date()
    const jobKey = await stableId('poll_job', `${message.body.execution_key}:${message.body.source_id}`)
    const claim = await claimSourcePollJob(env.DB, {
      jobKey,
      sourceId: message.body.source_id,
      executionKey: message.body.execution_key,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    })
    if (claim === 'completed') {
      message.ack()
      continue
    }
    if (claim === 'busy') {
      message.retry({ delaySeconds: 60 })
      continue
    }

    try {
      const result = await pollSource(env, message.body.source_id)
      await completeSourcePollJob(env.DB, jobKey, new Date().toISOString())
      logEvent('info', 'source_poll_completed', {
        message_id: message.id,
        source_id: message.body.source_id,
        accepted: result.accepted,
        duplicates: result.duplicates,
      })
      message.ack()
    } catch (error) {
      const delay = retryDelay(message.attempts)
      const retryable = !(error instanceof EngineError) || error.retryable
      try {
        await recordSourceFailure(
          env.DB,
          message.body.source_id,
          errorCode(error),
          retryable ? new Date(Date.now() + delay * 1000).toISOString() : null,
          new Date().toISOString(),
        )
        if (retryable) await releaseSourcePollJob(env.DB, jobKey, new Date().toISOString())
        else await completeSourcePollJob(env.DB, jobKey, new Date().toISOString())
      } catch (recordError) {
        logError('source_failure_record_failed', recordError, {
          message_id: message.id,
          source_id: message.body.source_id,
        })
        message.retry({ delaySeconds: delay })
        continue
      }

      logError('source_poll_failed', error, {
        message_id: message.id,
        source_id: message.body.source_id,
        attempt: message.attempts,
        retryable,
      })
      if (retryable) message.retry({ delaySeconds: delay })
      else message.ack()
    }
  }
}
