import type { SourceRow, ViralSignalBatchV1 } from './domain'
import { EngineError, ValidationError } from './errors'
import { ingestSignalBatch, type IngestionResult } from './ingest'
import { getSource, recordSourceSuccess } from './repository'
import { parseViralSignalBatch } from './validation'

const MAX_FEED_BYTES = 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

function allowedHosts(env: Env): string[] {
  return env.SOURCE_HOST_ALLOWLIST
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function hostnameMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1)
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === pattern
}

export function assertAllowedSourceUrl(value: string, env: Env): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new EngineError('SOURCE_URL_INVALID', 'The source endpoint is not an absolute URL.', 400)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new EngineError('SOURCE_URL_INVALID', 'Source endpoints must use HTTPS without embedded credentials.', 400)
  }
  const allowlist = allowedHosts(env)
  if (allowlist.length === 0 || !allowlist.some((pattern) => hostnameMatches(url.hostname.toLowerCase(), pattern))) {
    throw new EngineError('SOURCE_HOST_NOT_ALLOWED', `The source host ${url.hostname} is not allowlisted.`, 400)
  }
  return url
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_FEED_BYTES) {
    throw new EngineError('SOURCE_RESPONSE_TOO_LARGE', 'The source feed exceeded the one-megabyte limit.', 422)
  }
  if (!response.body) throw new EngineError('SOURCE_RESPONSE_EMPTY', 'The source returned an empty body.', 422)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > MAX_FEED_BYTES) {
      await reader.cancel('source feed exceeds size limit')
      throw new EngineError('SOURCE_RESPONSE_TOO_LARGE', 'The source feed exceeded the one-megabyte limit.', 422)
    }
    chunks.push(result.value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new EngineError('SOURCE_RESPONSE_INVALID_JSON', 'The source feed did not return valid JSON.', 422)
  }
}

function ensureFeedOwnership(batch: ViralSignalBatchV1, source: SourceRow): void {
  const mismatches = batch.records.filter((record) => record.source !== source.id)
  if (mismatches.length > 0) {
    throw new ValidationError([`all feed records must use source=${source.id}`])
  }
}

export async function pollSource(
  env: Env,
  sourceId: string,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<IngestionResult> {
  const source = await getSource(env.DB, sourceId)
  if (!source) throw new EngineError('SOURCE_NOT_REGISTERED', `Source ${sourceId} is not registered.`, 404)
  if (source.enabled !== 1) throw new EngineError('SOURCE_DISABLED', `Source ${sourceId} is disabled.`, 409)
  if (source.kind !== 'json_feed' || !source.endpoint_url) {
    throw new EngineError('SOURCE_NOT_POLLABLE', `Source ${sourceId} is not a JSON feed.`, 409)
  }

  const url = assertAllowedSourceUrl(source.endpoint_url, env)
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new EngineError(
      'SOURCE_FETCH_FAILED',
      error instanceof Error ? error.message : 'The source fetch failed.',
      502,
      true,
    )
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
    throw new EngineError('SOURCE_HTTP_ERROR', `Source returned HTTP ${response.status}.`, 502, retryable)
  }

  const body = await readBoundedJson(response)
  const batch = parseViralSignalBatch(body, now)
  ensureFeedOwnership(batch, source)
  const result = await ingestSignalBatch(env.DB, batch, 'scheduled', now)
  await recordSourceSuccess(env.DB, source.id, now.toISOString())
  return result
}
