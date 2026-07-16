import {
  AVAILABILITY_STATUSES,
  ENGINE_MODES,
  SIGNAL_TYPES,
  type AvailabilityStatus,
  type CatalogOverrides,
  type EngineMode,
  type ViralSignalBatchV1,
  type ViralSignalV1,
} from './domain'
import { ValidationError } from './errors'

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_RECORDS = 4
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const HOST_PATTERN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type JsonRecord = Record<string, unknown>

export interface SourceCreateInput {
  id: string
  name: string
  kind: 'push' | 'json_feed'
  endpoint_url: string | null
  independence_key: string
  catalog_host_allowlist: string[]
  trust_weight: number
  poll_interval_minutes: number
  enabled: boolean
}

export interface CatalogLinkInput {
  candidateId: string
  fivProductId: string | null
  fivProductSlug: string | null
  fivTrendId: string | null
  fivTrendSlug: string | null
  status: 'active' | 'inactive'
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(
  record: JsonRecord,
  allowedKeys: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed by this contract version`)
  }
}

function requiredString(record: JsonRecord, key: string, path: string, issues: string[], max = 200): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
    issues.push(`${path}.${key} must be a non-empty string no longer than ${max} characters`)
    return ''
  }
  return value.trim()
}

function optionalString(record: JsonRecord, key: string, path: string, issues: string[], max = 200): string | undefined {
  const value = record[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim().length > max) {
    issues.push(`${path}.${key} must be a string no longer than ${max} characters`)
    return undefined
  }
  return value.trim()
}

function requiredNumber(record: JsonRecord, key: string, path: string, issues: string[], min: number, max: number): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push(`${path}.${key} must be a number between ${min} and ${max}`)
    return min
  }
  return value
}

function optionalInteger(record: JsonRecord, key: string, path: string, issues: string[], min: number): number | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    issues.push(`${path}.${key} must be an integer greater than or equal to ${min}`)
    return undefined
  }
  return value
}

function parseHttpsUrl(value: string | undefined, path: string, issues: string[]): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid')
    return url.toString()
  } catch {
    issues.push(`${path} must be an absolute HTTPS URL without embedded credentials`)
    return undefined
  }
}

function parseTimestamp(value: string, path: string, issues: string[]): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || !value.includes('T')) {
    issues.push(`${path} must be an ISO 8601 timestamp`)
    return Number.NaN
  }
  return timestamp
}

function parseDate(value: string | undefined, path: string, issues: string[]): string | undefined {
  if (!value) return undefined
  if (!DATE_PATTERN.test(value)) {
    issues.push(`${path} must use YYYY-MM-DD`)
    return undefined
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    issues.push(`${path} must be a real calendar date`)
    return undefined
  }
  return value
}

function parseSearchTerms(value: unknown, path: string, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 8) {
    issues.push(`${path} must be an array with at most 8 items`)
    return undefined
  }
  const terms = value.flatMap((term, index) => {
    if (typeof term !== 'string' || term.trim().length === 0 || term.trim().length > 60) {
      issues.push(`${path}[${index}] must be 1 to 60 characters`)
      return []
    }
    return [term.trim()]
  })
  if (new Set(terms).size !== terms.length) issues.push(`${path} must not contain duplicates`)
  if (terms.join(' ').length > 500) issues.push(`${path} must be at most 500 characters when joined`)
  return terms
}

function parseHostAllowlist(value: unknown, path: string, issues: string[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) {
    issues.push(`${path} must be an array with at most 20 host patterns`)
    return []
  }
  const hosts = value.flatMap((host, index) => {
    if (typeof host !== 'string') {
      issues.push(`${path}[${index}] must be a hostname`)
      return []
    }
    const normalized = host.trim().toLowerCase().replace(/\.$/, '')
    if (!HOST_PATTERN.test(normalized)) {
      issues.push(`${path}[${index}] must be an exact hostname or *.example.com wildcard`)
      return []
    }
    return [normalized]
  })
  if (new Set(hosts).size !== hosts.length) issues.push(`${path} must not contain duplicates`)
  return hosts
}

function parseSignal(input: unknown, index: number, nowMs: number, issues: string[]): ViralSignalV1 | null {
  const path = `records[${index}]`
  if (!isRecord(input)) {
    issues.push(`${path} must be an object`)
    return null
  }
  rejectUnknownKeys(input, [
    'schema_version', 'kind', 'source', 'external_observation_id', 'source_run_id',
    'observed_at', 'expires_at', 'candidate', 'signal', 'confidence',
    'evidence_url', 'evidence_hash',
  ], path, issues)

  if (input.schema_version !== 1) issues.push(`${path}.schema_version must equal 1`)
  if (input.kind !== 'viral_signal') issues.push(`${path}.kind must equal viral_signal`)

  const source = requiredString(input, 'source', path, issues, 64)
  if (source && !SOURCE_ID_PATTERN.test(source)) {
    issues.push(`${path}.source must use lowercase letters, numbers, underscores, or hyphens`)
  }
  const externalObservationId = requiredString(input, 'external_observation_id', path, issues, 160)
  const sourceRunId = requiredString(input, 'source_run_id', path, issues, 160)
  const observedAt = requiredString(input, 'observed_at', path, issues, 40)
  const expiresAt = requiredString(input, 'expires_at', path, issues, 40)
  const observedMs = parseTimestamp(observedAt, `${path}.observed_at`, issues)
  const expiresMs = parseTimestamp(expiresAt, `${path}.expires_at`, issues)
  if (Number.isFinite(observedMs)) {
    if (observedMs > nowMs + MAX_FUTURE_SKEW_MS) issues.push(`${path}.observed_at is too far in the future`)
    if (observedMs < nowMs - MAX_AGE_MS) issues.push(`${path}.observed_at is older than the 30-day ingestion window`)
  }
  if (Number.isFinite(observedMs) && Number.isFinite(expiresMs)) {
    if (expiresMs <= observedMs) issues.push(`${path}.expires_at must be later than observed_at`)
    if (expiresMs > observedMs + MAX_TTL_MS) issues.push(`${path}.expires_at may be at most 14 days after observed_at`)
    if (expiresMs <= nowMs) issues.push(`${path}.expires_at must still be active when ingested`)
  }

  if (!isRecord(input.candidate)) {
    issues.push(`${path}.candidate must be an object`)
    return null
  }
  const candidatePath = `${path}.candidate`
  rejectUnknownKeys(input.candidate, [
    'external_id', 'name', 'brand', 'gtin', 'category', 'topic', 'product_url',
    'image_url', 'search_terms', 'availability_status', 'release_date',
  ], candidatePath, issues)
  const externalId = requiredString(input.candidate, 'external_id', candidatePath, issues, 160)
  const name = requiredString(input.candidate, 'name', candidatePath, issues, 160)
  const brand = optionalString(input.candidate, 'brand', candidatePath, issues, 100)
  const gtin = optionalString(input.candidate, 'gtin', candidatePath, issues, 14)
  if (gtin && (!/^\d+$/.test(gtin) || ![8, 12, 13, 14].includes(gtin.length))) {
    issues.push(`${candidatePath}.gtin must contain 8, 12, 13, or 14 digits`)
  }
  const category = optionalString(input.candidate, 'category', candidatePath, issues, 100)
  if (!isRecord(input.candidate.topic)) {
    issues.push(`${candidatePath}.topic must be an object`)
    return null
  }
  const topicName = requiredString(input.candidate.topic, 'name', `${candidatePath}.topic`, issues, 100)
  rejectUnknownKeys(input.candidate.topic, ['name', 'slug', 'description'], `${candidatePath}.topic`, issues)
  const topicSlug = optionalString(input.candidate.topic, 'slug', `${candidatePath}.topic`, issues, 90)
  const topicDescription = optionalString(input.candidate.topic, 'description', `${candidatePath}.topic`, issues, 500)
  const productUrl = parseHttpsUrl(
    optionalString(input.candidate, 'product_url', candidatePath, issues, 2048),
    `${candidatePath}.product_url`,
    issues,
  )
  const imageUrl = parseHttpsUrl(
    optionalString(input.candidate, 'image_url', candidatePath, issues, 2048),
    `${candidatePath}.image_url`,
    issues,
  )

  const searchTerms = parseSearchTerms(input.candidate.search_terms, `${candidatePath}.search_terms`, issues)

  let availabilityStatus: AvailabilityStatus | undefined
  if (input.candidate.availability_status !== undefined) {
    if (typeof input.candidate.availability_status !== 'string' || !AVAILABILITY_STATUSES.includes(input.candidate.availability_status as AvailabilityStatus)) {
      issues.push(`${candidatePath}.availability_status is invalid`)
    } else {
      availabilityStatus = input.candidate.availability_status as AvailabilityStatus
    }
  }
  const releaseDate = parseDate(
    optionalString(input.candidate, 'release_date', candidatePath, issues, 10),
    `${candidatePath}.release_date`,
    issues,
  )

  if (!isRecord(input.signal)) {
    issues.push(`${path}.signal must be an object`)
    return null
  }
  const signalPath = `${path}.signal`
  rejectUnknownKeys(input.signal, [
    'type', 'value', 'velocity', 'rank', 'previous_rank', 'sample_size',
  ], signalPath, issues)
  const signalTypeValue = requiredString(input.signal, 'type', signalPath, issues, 40)
  if (!SIGNAL_TYPES.includes(signalTypeValue as typeof SIGNAL_TYPES[number])) {
    issues.push(`${signalPath}.type is invalid`)
  }
  const signalValue = requiredNumber(input.signal, 'value', signalPath, issues, 0, 100)
  let velocity: number | undefined
  if (input.signal.velocity !== undefined) {
    velocity = requiredNumber(input.signal, 'velocity', signalPath, issues, -1, 1)
  }
  const rank = optionalInteger(input.signal, 'rank', signalPath, issues, 1)
  const previousRank = optionalInteger(input.signal, 'previous_rank', signalPath, issues, 1)
  const sampleSize = optionalInteger(input.signal, 'sample_size', signalPath, issues, 0)
  const confidence = requiredNumber(input, 'confidence', path, issues, 0, 1)
  const evidenceUrl = parseHttpsUrl(
    requiredString(input, 'evidence_url', path, issues, 2048),
    `${path}.evidence_url`,
    issues,
  ) ?? ''
  const evidenceHash = optionalString(input, 'evidence_hash', path, issues, 160)
  if (evidenceHash && !SHA256_PATTERN.test(evidenceHash)) {
    issues.push(`${path}.evidence_hash must be a lowercase sha256 digest`)
  }

  return {
    schema_version: 1,
    kind: 'viral_signal',
    source,
    external_observation_id: externalObservationId,
    source_run_id: sourceRunId,
    observed_at: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : observedAt,
    expires_at: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : expiresAt,
    candidate: {
      external_id: externalId,
      name,
      ...(brand ? { brand } : {}),
      ...(gtin ? { gtin } : {}),
      ...(category ? { category } : {}),
      topic: {
        name: topicName,
        ...(topicSlug ? { slug: topicSlug } : {}),
        ...(topicDescription ? { description: topicDescription } : {}),
      },
      ...(productUrl ? { product_url: productUrl } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(searchTerms ? { search_terms: searchTerms } : {}),
      ...(availabilityStatus ? { availability_status: availabilityStatus } : {}),
      ...(releaseDate ? { release_date: releaseDate } : {}),
    },
    signal: {
      type: signalTypeValue as typeof SIGNAL_TYPES[number],
      value: signalValue,
      ...(velocity !== undefined ? { velocity } : {}),
      ...(rank !== undefined ? { rank } : {}),
      ...(previousRank !== undefined ? { previous_rank: previousRank } : {}),
      ...(sampleSize !== undefined ? { sample_size: sampleSize } : {}),
    },
    confidence,
    evidence_url: evidenceUrl,
    ...(evidenceHash ? { evidence_hash: evidenceHash } : {}),
  }
}

export function parseViralSignalBatch(input: unknown, now = new Date()): ViralSignalBatchV1 {
  const issues: string[] = []
  if (!isRecord(input)) throw new ValidationError(['body must be an object'])
  rejectUnknownKeys(input, ['schema_version', 'records'], 'body', issues)
  if (input.schema_version !== 1) issues.push('schema_version must equal 1')
  if (!Array.isArray(input.records)) issues.push('records must be an array')
  else if (input.records.length === 0 || input.records.length > MAX_RECORDS) {
    issues.push(`records must contain between 1 and ${MAX_RECORDS} signals`)
  }

  const records = Array.isArray(input.records)
    ? input.records.flatMap((record, index) => {
      const parsed = parseSignal(record, index, now.getTime(), issues)
      return parsed ? [parsed] : []
    })
    : []

  if (records.length > 1) {
    if (new Set(records.map((record) => record.source)).size !== 1) {
      issues.push('all records in a batch must belong to the same source')
    }
    if (new Set(records.map((record) => record.source_run_id)).size !== 1) {
      issues.push('all records in a batch must belong to the same source run')
    }
  }

  if (issues.length > 0) throw new ValidationError(issues)
  return { schema_version: 1, records }
}

export function parseSourceCreate(input: unknown): SourceCreateInput {
  const issues: string[] = []
  if (!isRecord(input)) throw new ValidationError(['body must be an object'])
  const id = requiredString(input, 'id', 'body', issues, 64)
  if (id && !SOURCE_ID_PATTERN.test(id)) issues.push('body.id has an invalid format')
  const name = requiredString(input, 'name', 'body', issues, 100)
  const independenceKey = requiredString(input, 'independence_key', 'body', issues, 64)
  if (independenceKey && !SOURCE_ID_PATTERN.test(independenceKey)) {
    issues.push('body.independence_key must use lowercase letters, numbers, underscores, or hyphens')
  }
  const kindValue = requiredString(input, 'kind', 'body', issues, 20)
  const kind = kindValue === 'json_feed' ? 'json_feed' : 'push'
  if (kindValue !== 'json_feed' && kindValue !== 'push') issues.push('body.kind must be push or json_feed')
  const endpointRaw = optionalString(input, 'endpoint_url', 'body', issues, 2048)
  const endpointUrl = parseHttpsUrl(endpointRaw, 'body.endpoint_url', issues) ?? null
  if (kind === 'json_feed' && !endpointUrl) issues.push('body.endpoint_url is required for json_feed sources')
  if (kind === 'push' && endpointRaw) issues.push('body.endpoint_url must be omitted for push sources')
  const catalogHostAllowlist = parseHostAllowlist(
    input.catalog_host_allowlist,
    'body.catalog_host_allowlist',
    issues,
  )
  const trustWeight = input.trust_weight === undefined
    ? 0.5
    : requiredNumber(input, 'trust_weight', 'body', issues, 0, 1)
  const pollInterval = input.poll_interval_minutes === undefined
    ? 60
    : optionalInteger(input, 'poll_interval_minutes', 'body', issues, 5) ?? 60
  if (pollInterval > 10080) issues.push('body.poll_interval_minutes may not exceed 10080')
  const enabled = input.enabled === undefined ? true : input.enabled
  if (typeof enabled !== 'boolean') issues.push('body.enabled must be a boolean')
  if (issues.length > 0) throw new ValidationError(issues)
  return {
    id,
    name,
    kind,
    endpoint_url: endpointUrl,
    independence_key: independenceKey,
    catalog_host_allowlist: catalogHostAllowlist,
    trust_weight: trustWeight,
    poll_interval_minutes: pollInterval,
    enabled: typeof enabled === 'boolean' ? enabled : true,
  }
}

export function parseReview(input: unknown): { decision: 'approved' | 'rejected'; note: string | null; overrides: CatalogOverrides | null } {
  const issues: string[] = []
  if (!isRecord(input)) throw new ValidationError(['body must be an object'])
  const decisionValue = requiredString(input, 'decision', 'body', issues, 20)
  if (decisionValue !== 'approved' && decisionValue !== 'rejected') issues.push('body.decision must be approved or rejected')
  const note = optionalString(input, 'note', 'body', issues, 500) ?? null
  let overrides: CatalogOverrides | null = null
  if (input.overrides !== undefined && input.overrides !== null) {
    if (!isRecord(input.overrides)) issues.push('body.overrides must be an object')
    else {
      const sourceUrl = parseHttpsUrl(optionalString(input.overrides, 'source_url', 'body.overrides', issues, 2048), 'body.overrides.source_url', issues)
      const availability = optionalString(input.overrides, 'availability_status', 'body.overrides', issues, 20)
      if (availability && !AVAILABILITY_STATUSES.includes(availability as AvailabilityStatus)) {
        issues.push('body.overrides.availability_status is invalid')
      }
      const searchTerms = parseSearchTerms(input.overrides.search_terms, 'body.overrides.search_terms', issues)
      const releaseDate = input.overrides.release_date === null
        ? null
        : parseDate(
          optionalString(input.overrides, 'release_date', 'body.overrides', issues, 10),
          'body.overrides.release_date',
          issues,
        )
      overrides = {
        ...(optionalString(input.overrides, 'trend_name', 'body.overrides', issues, 100) ? { trend_name: String(input.overrides.trend_name).trim() } : {}),
        ...(optionalString(input.overrides, 'trend_slug', 'body.overrides', issues, 90) ? { trend_slug: String(input.overrides.trend_slug).trim() } : {}),
        ...(input.overrides.trend_description === null ? { trend_description: null } : {}),
        ...(optionalString(input.overrides, 'trend_description', 'body.overrides', issues, 500) ? { trend_description: String(input.overrides.trend_description).trim() } : {}),
        ...(optionalString(input.overrides, 'product_name', 'body.overrides', issues, 160) ? { product_name: String(input.overrides.product_name).trim() } : {}),
        ...(optionalString(input.overrides, 'product_slug', 'body.overrides', issues, 90) ? { product_slug: String(input.overrides.product_slug).trim() } : {}),
        ...(input.overrides.brand === null ? { brand: null } : {}),
        ...(optionalString(input.overrides, 'brand', 'body.overrides', issues, 100) ? { brand: String(input.overrides.brand).trim() } : {}),
        ...(input.overrides.category === null ? { category: null } : {}),
        ...(optionalString(input.overrides, 'category', 'body.overrides', issues, 100) ? { category: String(input.overrides.category).trim() } : {}),
        ...(searchTerms ? { search_terms: searchTerms } : {}),
        ...(availability && AVAILABILITY_STATUSES.includes(availability as AvailabilityStatus) ? { availability_status: availability as AvailabilityStatus } : {}),
        ...(releaseDate !== undefined ? { release_date: releaseDate } : {}),
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
      }
    }
  }
  if (issues.length > 0) throw new ValidationError(issues)
  return {
    decision: decisionValue as 'approved' | 'rejected',
    note,
    overrides,
  }
}

export function parseCatalogLink(input: unknown): CatalogLinkInput {
  const issues: string[] = []
  if (!isRecord(input)) throw new ValidationError(['body must be an object'])
  const candidateId = requiredString(input, 'candidate_id', 'body', issues, 64)
  if (candidateId && !/^candidate_[0-9a-f]{24}$/.test(candidateId)) {
    issues.push('body.candidate_id is invalid')
  }
  const statusValue = requiredString(input, 'status', 'body', issues, 20)
  if (statusValue !== 'active' && statusValue !== 'inactive') {
    issues.push('body.status must be active or inactive')
  }
  const optionalNullable = (key: string, max: number): string | null => {
    const value = input[key]
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
      issues.push(`body.${key} must be a non-empty string no longer than ${max} characters`)
      return null
    }
    return value.trim()
  }
  const fivProductId = optionalNullable('fiv_product_id', 64)
  const fivProductSlug = optionalNullable('fiv_product_slug', 90)
  const fivTrendId = optionalNullable('fiv_trend_id', 64)
  const fivTrendSlug = optionalNullable('fiv_trend_slug', 90)
  for (const [path, value] of [
    ['body.fiv_product_id', fivProductId],
    ['body.fiv_trend_id', fivTrendId],
  ] as const) {
    if (value && !UUID_PATTERN.test(value)) issues.push(`${path} must be a UUID`)
  }
  for (const [path, value] of [
    ['body.fiv_product_slug', fivProductSlug],
    ['body.fiv_trend_slug', fivTrendSlug],
  ] as const) {
    if (value && !SLUG_PATTERN.test(value)) issues.push(`${path} must be a lowercase URL slug`)
  }
  if (statusValue === 'active' && (!fivProductId || !fivProductSlug || !fivTrendId || !fivTrendSlug)) {
    issues.push('active catalog links require both FindItViral IDs and slugs')
  }
  if (issues.length > 0) throw new ValidationError(issues)
  return {
    candidateId,
    fivProductId,
    fivProductSlug,
    fivTrendId,
    fivTrendSlug,
    status: statusValue === 'inactive' ? 'inactive' : 'active',
  }
}

export function parseEngineMode(value: unknown, fallback: EngineMode = 'shadow'): EngineMode {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !ENGINE_MODES.includes(value as EngineMode)) {
    throw new ValidationError(['mode must be shadow, review, or autopilot'])
  }
  return value as EngineMode
}
