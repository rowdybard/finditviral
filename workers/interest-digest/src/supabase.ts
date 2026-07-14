import {
  DigestContractError,
  parseDigestClaimResponse,
  type DigestAttemptOutcome,
  type DigestClaim,
} from './domain'
import { sanitizeErrorMessage } from './errors'

const CLAIM_RPC = 'claim_interest_digest_attempt'
const COMPLETE_RPC = 'complete_interest_digest_attempt'
const CLAIM_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
const ERROR_RESPONSE_LIMIT_BYTES = 8 * 1024
const UPSTREAM_TIMEOUT_MS = 15_000

export interface SupabaseRpcConfig {
  url: string
  secretKey: string
}

export interface CompleteAttemptInput {
  attemptId: string
  leaseToken: string
  outcome: DigestAttemptOutcome
  messageId: string | null
  errorCode: string | null
  errorMessage: string | null
}

export class SupabaseRpcError extends Error {
  readonly code: string
  readonly status: number

  constructor(operation: string, status: number, upstreamCode: string | null) {
    const codeSuffix = upstreamCode ? `_${upstreamCode.replace(/[^A-Za-z0-9_]/g, '').slice(0, 48)}` : ''
    super(`Supabase ${operation} RPC failed with HTTP ${status}`)
    this.name = 'SupabaseRpcError'
    this.code = `SUPABASE_RPC_${status}${codeSuffix}`
    this.status = status
  }
}

export function createSupabaseServerHeaders(secretKey: string): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    apikey: secretKey,
    'Content-Type': 'application/json',
  })

  // Modern sb_secret keys are opaque API keys, not JWTs. Legacy service-role
  // JWTs still require the bearer header for PostgREST role propagation.
  if (secretKey.startsWith('eyJ')) {
    headers.set('Authorization', `Bearer ${secretKey}`)
  }
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
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new DigestContractError('Supabase response exceeds the allowed size')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let result = ''

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      throw new DigestContractError('Supabase response exceeds the allowed size')
    }
    result += decoder.decode(chunk.value, { stream: true })
  }
  result += decoder.decode()
  return result
}

function readPostgrestCode(body: string): string | null {
  if (!body) return null
  try {
    const value: unknown = JSON.parse(body)
    if (typeof value === 'object' && value !== null && 'code' in value) {
      const code = (value as Record<string, unknown>).code
      return typeof code === 'string' ? code : null
    }
  } catch {
    return null
  }
  return null
}

async function throwRpcError(operation: string, response: Response): Promise<never> {
  const body = await readBoundedText(response, ERROR_RESPONSE_LIMIT_BYTES)
  throw new SupabaseRpcError(operation, response.status, readPostgrestCode(body))
}

export async function claimDigestAttempt(
  config: SupabaseRpcConfig,
  scheduledAt: string,
): Promise<DigestClaim | null> {
  const response = await fetch(rpcUrl(config.url, CLAIM_RPC), {
    method: 'POST',
    headers: createSupabaseServerHeaders(config.secretKey),
    body: JSON.stringify({ p_scheduled_at: scheduledAt }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })

  if (!response.ok) await throwRpcError('claim', response)
  if (response.status === 204) return null

  const body = await readBoundedText(response, CLAIM_RESPONSE_LIMIT_BYTES)
  if (!body) return null

  try {
    const value: unknown = JSON.parse(body)
    return parseDigestClaimResponse(value)
  } catch (error) {
    if (error instanceof DigestContractError) throw error
    throw new DigestContractError(`claim RPC returned invalid JSON: ${sanitizeErrorMessage(String(error))}`)
  }
}

export async function completeDigestAttempt(
  config: SupabaseRpcConfig,
  input: CompleteAttemptInput,
): Promise<void> {
  const headers = createSupabaseServerHeaders(config.secretKey)
  headers.set('Prefer', 'return=minimal')
  const response = await fetch(rpcUrl(config.url, COMPLETE_RPC), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_attempt_id: input.attemptId,
      p_lease_token: input.leaseToken,
      p_outcome: input.outcome,
      p_message_id: input.messageId,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })

  if (!response.ok) await throwRpcError('completion', response)
}

