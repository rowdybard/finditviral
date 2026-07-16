import {
  parseModerationQueue,
  parsePersistedModerationResult,
  type ModerationQueueItem,
  type PersistedModerationResult,
} from './domain'

const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
const ERROR_RESPONSE_LIMIT_BYTES = 8 * 1024
const UPSTREAM_TIMEOUT_MS = 15_000

export type SupabaseRpcConfig = {
  url: string
  secretKey: string
}

export class SupabaseRpcError extends Error {
  readonly code: string

  constructor(operation: string, status: number) {
    super(`Supabase ${operation} RPC failed with HTTP ${status}`)
    this.name = 'SupabaseRpcError'
    this.code = `SUPABASE_RPC_${status}`
  }
}

export function createSupabaseServerHeaders(secretKey: string): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    apikey: secretKey,
    'Content-Type': 'application/json',
  })
  if (secretKey.startsWith('eyJ')) headers.set('Authorization', `Bearer ${secretKey}`)
  return headers
}

function rpcUrl(baseUrl: string, rpcName: string): string {
  const base = new URL(baseUrl)
  base.pathname = `/rest/v1/rpc/${rpcName}`
  base.search = ''
  base.hash = ''
  return base.toString()
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('Upstream response exceeds the allowed size')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let result = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new Error('Upstream response exceeds the allowed size')
    }
    result += decoder.decode(chunk.value, { stream: true })
  }
  return result + decoder.decode()
}

async function postRpc(config: SupabaseRpcConfig, name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(rpcUrl(config.url, name), {
    method: 'POST',
    headers: createSupabaseServerHeaders(config.secretKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!response.ok) {
    await readBoundedText(response, ERROR_RESPONSE_LIMIT_BYTES)
    throw new SupabaseRpcError(name, response.status)
  }
  const text = await readBoundedText(response, RESPONSE_LIMIT_BYTES)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Supabase ${name} returned invalid JSON`)
  }
}

export async function getPendingModerationQueue(config: SupabaseRpcConfig): Promise<ModerationQueueItem[]> {
  return parseModerationQueue(await postRpc(config, 'get_pending_moderation_queue', { p_limit: 25 }))
}

export async function setContentModerationResult(
  config: SupabaseRpcConfig,
  item: ModerationQueueItem,
  flagged: boolean,
  categories: string[],
  model: string,
): Promise<PersistedModerationResult> {
  return parsePersistedModerationResult(await postRpc(config, 'set_content_moderation_result', {
    p_contribution_type: item.contributionType,
    p_contribution_id: item.contributionId,
    p_flagged: flagged,
    p_categories: categories,
    p_model: model,
  }))
}

export async function markModerationNotificationSent(
  config: SupabaseRpcConfig,
  item: ModerationQueueItem,
): Promise<boolean> {
  const value = await postRpc(config, 'mark_content_moderation_notification_sent', {
    p_contribution_type: item.contributionType,
    p_contribution_id: item.contributionId,
  })
  if (typeof value !== 'boolean') throw new Error('notification completion RPC returned invalid data')
  return value
}
