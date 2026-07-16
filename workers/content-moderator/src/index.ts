import {
  MAX_TEXT_CONTENT_LENGTH,
  MODERATION_MODEL,
  ModerationContractError,
  parseOpenAiModeration,
  type ModerationQueueItem,
} from './domain'
import { renderFlaggedModerationEmail } from './email'
import {
  getPendingModerationQueue,
  markModerationNotificationSent,
  setContentModerationResult,
  type SupabaseRpcConfig,
} from './supabase'

const SERVICE_NAME = 'finditviral-content-moderator'
const OPENAI_URL = 'https://api.openai.com/v1/moderations'
const OPENAI_TIMEOUT_MS = 15_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_DESTINATIONS = ['owner@finditviral.com']

type RuntimeConfig = {
  supabase: SupabaseRpcConfig
  openAiKey: string
  toEmail: string
  fromEmail: string
  fromName: string
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120)
  }
  if (error instanceof Error) return error.name.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120)
  return 'UNKNOWN_ERROR'
}

function log(level: 'info' | 'warn' | 'error', event: string, details: Record<string, string | number | boolean> = {}): void {
  const entry = JSON.stringify({ service: SERVICE_NAME, event, ...details })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

export function requireRuntimeConfig(env: Env): RuntimeConfig {
  let url: URL
  try {
    url = new URL(env.SUPABASE_URL)
  } catch {
    throw new ModerationContractError('SUPABASE_URL must be an absolute URL')
  }
  if (url.protocol !== 'https:' || !env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY.length < 20) {
    throw new ModerationContractError('Supabase Worker configuration is invalid')
  }
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.length < 20) {
    throw new ModerationContractError('OPENAI_API_KEY is missing or invalid')
  }
  if (!EMAIL_PATTERN.test(env.MODERATION_TO_EMAIL) || !ALLOWED_DESTINATIONS.includes(env.MODERATION_TO_EMAIL)) {
    throw new ModerationContractError('MODERATION_TO_EMAIL is not an allowed destination')
  }
  if (!EMAIL_PATTERN.test(env.MODERATION_FROM_EMAIL) || !env.MODERATION_FROM_NAME || env.MODERATION_FROM_NAME.length > 80) {
    throw new ModerationContractError('Moderation email configuration is invalid')
  }
  return {
    supabase: { url: url.toString(), secretKey: env.SUPABASE_SECRET_KEY },
    openAiKey: env.OPENAI_API_KEY,
    toEmail: env.MODERATION_TO_EMAIL,
    fromEmail: env.MODERATION_FROM_EMAIL,
    fromName: env.MODERATION_FROM_NAME,
  }
}

async function moderateText(openAiKey: string, text: string) {
  if (!text.trim()) return { flagged: false, categories: [], model: 'skipped-empty' }
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODERATION_MODEL, input: text.slice(0, MAX_TEXT_CONTENT_LENGTH) }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`)
  const body = await response.text()
  if (new TextEncoder().encode(body).byteLength > 256 * 1024) throw new ModerationContractError('OpenAI response is too large')
  try {
    return parseOpenAiModeration(JSON.parse(body) as unknown)
  } catch (error) {
    if (error instanceof ModerationContractError) throw error
    throw new ModerationContractError('OpenAI response is not valid JSON')
  }
}

async function processItem(config: RuntimeConfig, env: Env, item: ModerationQueueItem): Promise<void> {
  try {
    if (item.resultFlagged === true) {
      if (item.needsNotification) {
        const message = renderFlaggedModerationEmail(item)
        const result = await env.EMAIL.send({
          to: config.toEmail,
          from: { email: config.fromEmail, name: config.fromName },
          subject: message.subject,
          text: message.text,
          html: message.html,
        })
        if (!result.messageId) throw new Error('EMAIL_RESULT_MISSING_MESSAGE_ID')
        await markModerationNotificationSent(config.supabase, item)
        log('info', 'flag_notification_accepted', { contribution_type: item.contributionType })
      }
      return
    }

    const decision = await moderateText(config.openAiKey, item.textContent)
    const persisted = await setContentModerationResult(
      config.supabase,
      item,
      decision.flagged,
      decision.categories,
      decision.model,
    )
    log('info', 'moderation_result_recorded', {
      contribution_type: item.contributionType,
      flagged: decision.flagged,
      recorded: persisted.recorded,
      auto_approved: persisted.autoApproved,
    })

    if (persisted.notificationPending && persisted.resultFlagged) {
      const notificationItem = { ...item, resultCategories: decision.categories }
      const message = renderFlaggedModerationEmail(notificationItem)
      const result = await env.EMAIL.send({
        to: config.toEmail,
        from: { email: config.fromEmail, name: config.fromName },
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      if (!result.messageId) throw new Error('EMAIL_RESULT_MISSING_MESSAGE_ID')
      await markModerationNotificationSent(config.supabase, notificationItem)
      log('info', 'flag_notification_accepted', { contribution_type: item.contributionType })
    }
  } catch (error) {
    log('error', 'moderation_item_failed', {
      contribution_type: item.contributionType,
      error_code: errorCode(error),
    })
  }
}

export async function processScheduledModeration(env: Env): Promise<void> {
  const config = requireRuntimeConfig(env)
  const items = await getPendingModerationQueue(config.supabase)
  for (const item of items) {
    await processItem(config, env, item)
  }
  log('info', 'scheduled_run_completed', { item_count: items.length })
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await processScheduledModeration(env)
    } catch (error) {
      log('error', 'scheduled_run_failed', { error_code: errorCode(error) })
      throw error
    }
  },
} satisfies ExportedHandler<Env>
