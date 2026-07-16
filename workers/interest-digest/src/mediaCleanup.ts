import { createSupabaseServerHeaders, type SupabaseRpcConfig } from './supabase'

const ORPHAN_RPC = 'list_orphan_sighting_photo_paths'
const PHOTO_BUCKET = 'sighting-photos'
const MAX_DELETE_BATCH = 100
const RETENTION_MS = 91 * 24 * 60 * 60 * 1000
const UPSTREAM_TIMEOUT_MS = 15_000

export class MediaCleanupError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MediaCleanupError'
    this.code = code
  }
}

function endpoint(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

function isSafeObjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false
  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

export function parseOrphanPhotoPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new MediaCleanupError('INVALID_LIST', 'Orphan-photo RPC returned a non-array response')
  if (value.length > MAX_DELETE_BATCH) throw new MediaCleanupError('LIST_TOO_LARGE', 'Orphan-photo RPC exceeded its batch limit')

  const unique = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object') throw new MediaCleanupError('INVALID_ROW', 'Orphan-photo RPC returned an invalid row')
    const record = row as Record<string, unknown>
    const path = record.object_name ?? record.path
    if (!isSafeObjectPath(path)) throw new MediaCleanupError('INVALID_PATH', 'Orphan-photo RPC returned an unsafe path')
    unique.add(path)
  }
  return [...unique]
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 256 * 1024) throw new MediaCleanupError('RESPONSE_TOO_LARGE', 'Media-cleanup response exceeded its size limit')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new MediaCleanupError('INVALID_JSON', 'Media-cleanup endpoint returned invalid JSON')
  }
}

export async function listOrphanPhotoPaths(
  config: SupabaseRpcConfig,
  scheduledTime: number,
): Promise<string[]> {
  const headers = createSupabaseServerHeaders(config.secretKey)
  const response = await fetch(endpoint(config.url, `/rest/v1/rpc/${ORPHAN_RPC}`), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_older_than: new Date(scheduledTime - RETENTION_MS).toISOString(),
      p_limit: MAX_DELETE_BATCH,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!response.ok) throw new MediaCleanupError(`LIST_${response.status}`, `Orphan-photo RPC failed with HTTP ${response.status}`)
  return parseOrphanPhotoPaths(await responseJson(response))
}

export async function deletePhotoPaths(config: SupabaseRpcConfig, paths: string[]): Promise<number> {
  if (paths.length === 0) return 0
  if (paths.length > MAX_DELETE_BATCH || paths.some((path) => !isSafeObjectPath(path))) {
    throw new MediaCleanupError('INVALID_DELETE_BATCH', 'Refusing an invalid media-cleanup delete batch')
  }

  const response = await fetch(endpoint(config.url, `/storage/v1/object/${PHOTO_BUCKET}`), {
    method: 'DELETE',
    headers: createSupabaseServerHeaders(config.secretKey),
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!response.ok) throw new MediaCleanupError(`DELETE_${response.status}`, `Storage deletion failed with HTTP ${response.status}`)
  await responseJson(response)
  return paths.length
}

export async function processOrphanPhotoCleanup(
  config: SupabaseRpcConfig,
  scheduledTime: number,
): Promise<number> {
  const paths = await listOrphanPhotoPaths(config, scheduledTime)
  return deletePhotoPaths(config, paths)
}
