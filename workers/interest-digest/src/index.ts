import { renderDigestEmail } from './email'
import type { DigestClaim } from './domain'
import {
  classifyDeliveryFailure,
  DigestConfigurationError,
  getErrorCode,
  getErrorMessage,
  MissingMessageIdError,
  sanitizeErrorMessage,
} from './errors'
import { getDetroitSchedule } from './schedule'
import { processOrphanPhotoCleanup } from './mediaCleanup'
import {
  claimDigestAttempt,
  completeDigestAttempt,
  type CompleteAttemptInput,
  type SupabaseRpcConfig,
} from './supabase'

const SERVICE_NAME = 'finditviral-interest-digest'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ALLOWED_DIGEST_DESTINATIONS = [
  'owner@finditviral.com',
]

interface RuntimeConfig {
  supabase: SupabaseRpcConfig
  toEmail: string
  fromEmail: string
  fromName: string
}

type EmailConfig = Omit<RuntimeConfig, 'supabase'>

type LogLevel = 'info' | 'warn' | 'error'

function logEvent(
  level: LogLevel,
  event: string,
  details: Record<string, string | number | boolean | null> = {},
): void {
  const entry = JSON.stringify({ service: SERVICE_NAME, event, ...details })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

export function requireSupabaseConfig(env: Env): SupabaseRpcConfig {
  let supabaseUrl: URL
  try {
    supabaseUrl = new URL(env.SUPABASE_URL)
  } catch {
    throw new DigestConfigurationError('SUPABASE_URL must be an absolute URL')
  }
  if (supabaseUrl.protocol !== 'https:') {
    throw new DigestConfigurationError('SUPABASE_URL must use HTTPS')
  }
  if (!env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY.length < 20) {
    throw new DigestConfigurationError('SUPABASE_SECRET_KEY is missing or invalid')
  }

  return {
    url: supabaseUrl.toString(),
    secretKey: env.SUPABASE_SECRET_KEY,
  }
}

function requireEmailConfig(env: Env): EmailConfig {
  if (!EMAIL_PATTERN.test(env.DIGEST_TO_EMAIL) || env.DIGEST_TO_EMAIL.length > 320) {
    throw new DigestConfigurationError('DIGEST_TO_EMAIL is missing or invalid')
  }
  if (!ALLOWED_DIGEST_DESTINATIONS.includes(env.DIGEST_TO_EMAIL)) {
    throw new DigestConfigurationError('DIGEST_TO_EMAIL is not in the allowed destinations allowlist')
  }
  if (!EMAIL_PATTERN.test(env.DIGEST_FROM_EMAIL) || env.DIGEST_FROM_EMAIL.length > 320) {
    throw new DigestConfigurationError('DIGEST_FROM_EMAIL is missing or invalid')
  }
  if (!env.DIGEST_FROM_NAME || env.DIGEST_FROM_NAME.length > 80) {
    throw new DigestConfigurationError('DIGEST_FROM_NAME is missing or invalid')
  }

  return {
    toEmail: env.DIGEST_TO_EMAIL,
    fromEmail: env.DIGEST_FROM_EMAIL,
    fromName: env.DIGEST_FROM_NAME,
  }
}

async function recordFailedDelivery(
  config: Pick<RuntimeConfig, 'supabase'>,
  claim: DigestClaim,
  error: unknown,
  invocationId: string,
): Promise<never> {
  const outcome = classifyDeliveryFailure(error)
  const errorCode = getErrorCode(error)
  const errorMessage = sanitizeErrorMessage(getErrorMessage(error))
  const completion: CompleteAttemptInput = {
    attemptId: claim.attemptId,
    leaseToken: claim.leaseToken,
    outcome,
    messageId: null,
    errorCode,
    errorMessage,
  }

  try {
    await completeDigestAttempt(config.supabase, completion)
  } catch (completionError) {
    logEvent('error', 'failure_state_record_failed', {
      invocation_id: invocationId,
      run_id: claim.runId,
      attempt_id: claim.attemptId,
      attempt_number: claim.attemptNumber,
      delivery_error_code: errorCode,
      record_error_code: getErrorCode(completionError),
    })
    throw new Error(`Digest attempt ${claim.attemptId} failed and its outcome could not be recorded`)
  }

  logEvent('error', 'delivery_failed', {
    invocation_id: invocationId,
    run_id: claim.runId,
    attempt_id: claim.attemptId,
    attempt_number: claim.attemptNumber,
    outcome,
    error_code: errorCode,
  })
  throw new Error(`Digest attempt ${claim.attemptId} ended as ${outcome}`)
}

export async function processScheduledDigest(scheduledTime: number, env: Env): Promise<void> {
  const invocationId = crypto.randomUUID()
  const schedule = getDetroitSchedule(scheduledTime)
  const scheduledAt = new Date(scheduledTime).toISOString()

  if (!schedule.shouldAttempt) {
    logEvent('info', 'before_digest_window', {
      invocation_id: invocationId,
      scheduled_at: scheduledAt,
      local_date: schedule.localDate,
      local_hour: schedule.localHour,
    })
    return
  }

  // Supabase must be valid before a claim can be recorded. Email settings are
  // deliberately validated after the claim so permanent configuration errors
  // are persisted and surfaced to the owner instead of retrying forever.
  const supabase = requireSupabaseConfig(env)
  const claim = await claimDigestAttempt(supabase, scheduledAt)
  if (!claim) {
    logEvent('info', 'no_digest_work', {
      invocation_id: invocationId,
      scheduled_at: scheduledAt,
      local_date: schedule.localDate,
    })
    return
  }

  let config: RuntimeConfig
  try {
    config = { supabase, ...requireEmailConfig(env) }
  } catch (error) {
    return recordFailedDelivery({ supabase }, claim, error, invocationId)
  }

  let messageId: string
  try {
    const content = renderDigestEmail(claim)
    const result = await env.EMAIL.send({
      to: config.toEmail,
      from: { email: config.fromEmail, name: config.fromName },
      subject: content.subject,
      text: content.text,
      html: content.html,
      headers: {
        'X-FindItViral-Digest-Run': claim.runId,
        'X-FindItViral-Digest-Date': claim.runLocalDate,
      },
    })
    messageId = result.messageId?.trim()
    if (!messageId) throw new MissingMessageIdError()
  } catch (error) {
    return recordFailedDelivery(config, claim, error, invocationId)
  }

  try {
    await completeDigestAttempt(config.supabase, {
      attemptId: claim.attemptId,
      leaseToken: claim.leaseToken,
      outcome: 'accepted',
      messageId,
      errorCode: null,
      errorMessage: null,
    })
  } catch (error) {
    logEvent('error', 'accepted_state_record_failed', {
      invocation_id: invocationId,
      run_id: claim.runId,
      attempt_id: claim.attemptId,
      attempt_number: claim.attemptNumber,
      message_id: messageId,
      error_code: getErrorCode(error),
    })
    throw new Error(`Email ${messageId} was accepted but digest state was not updated`)
  }

  logEvent('info', 'delivery_accepted', {
    invocation_id: invocationId,
    run_id: claim.runId,
    attempt_id: claim.attemptId,
    attempt_number: claim.attemptNumber,
    item_count: claim.items.length,
    message_id: messageId,
  })
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cleanupInvocationId = crypto.randomUUID()
    const cleanup = processOrphanPhotoCleanup(requireSupabaseConfig(env), controller.scheduledTime)
    const [digestResult, cleanupResult] = await Promise.allSettled([
      processScheduledDigest(controller.scheduledTime, env),
      cleanup,
    ])

    if (cleanupResult.status === 'fulfilled') {
      logEvent('info', 'orphan_photo_cleanup_completed', {
        invocation_id: cleanupInvocationId,
        deleted_count: cleanupResult.value,
      })
    } else {
      logEvent('error', 'orphan_photo_cleanup_failed', {
        invocation_id: cleanupInvocationId,
        error_code: getErrorCode(cleanupResult.reason),
        error: sanitizeErrorMessage(getErrorMessage(cleanupResult.reason)),
      })
    }

    if (digestResult.status === 'rejected') {
      const error = digestResult.reason
      logEvent('error', 'scheduled_run_failed', {
        scheduled_at: new Date(controller.scheduledTime).toISOString(),
        error_code: getErrorCode(error),
        error: sanitizeErrorMessage(getErrorMessage(error)),
      })
      throw error
    }
  },
} satisfies ExportedHandler<Env>
