export const MAX_DIGEST_ITEMS = 1_000
export const MAX_INTEREST_LENGTH = 2_000
export const MAX_RENDERED_BODY_BYTES = 4 * 1024 * 1024

export type DigestSource = 'early_access' | 'onboarding_looking_for'
export type DigestAttemptOutcome =
  | 'accepted'
  | 'transient_failure'
  | 'permanent_failure'
  | 'uncertain'

export interface DigestItem {
  eventId: string
  source: DigestSource
  occurredAt: string
  email: string | null
  username: string | null
  interest: string
}

export interface DigestClaim {
  runId: string
  runLocalDate: string
  cutoffAt: string
  attemptId: string
  attemptNumber: number
  leaseToken: string
  items: DigestItem[]
}

export interface DigestEmailContent {
  subject: string
  text: string
  html: string
}

export class DigestContractError extends Error {
  readonly code = 'DIGEST_CONTRACT_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'DigestContractError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new DigestContractError(`${key} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new DigestContractError(`${key} must be null or a non-empty string of at most ${maxLength} characters`)
  }
  return value
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DigestContractError(`${key} must be a UUID`)
  }
  return value
}

function requireTimestamp(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, 64)
  if (Number.isNaN(Date.parse(value))) {
    throw new DigestContractError(`${key} must be an ISO timestamp`)
  }
  return value
}

function requireLocalDate(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DigestContractError(`${key} must be an ISO date`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new DigestContractError(`${key} must be a valid calendar date`)
  }
  return value
}

function parseDigestItem(value: unknown): DigestItem {
  if (!isRecord(value)) {
    throw new DigestContractError('each digest item must be an object')
  }

  const source = requireString(value, 'source', 32)
  if (source !== 'early_access' && source !== 'onboarding_looking_for') {
    throw new DigestContractError('source is not supported')
  }

  const rawEmail = requireNullableString(value, 'email', 320)
  if (rawEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    throw new DigestContractError('email is invalid')
  }

  // Defense in depth: onboarding events must never expose member auth emails
  const email = source === 'onboarding_looking_for' ? null : rawEmail

  const interest = requireString(value, 'interest', MAX_INTEREST_LENGTH)
  if (interest.trim().length === 0) {
    throw new DigestContractError('interest must contain visible text')
  }

  return {
    eventId: requireUuid(value, 'event_id'),
    source,
    occurredAt: requireTimestamp(value, 'occurred_at'),
    email,
    username: requireNullableString(value, 'username', 64),
    interest,
  }
}

function parseClaimRecord(value: unknown): DigestClaim {
  if (!isRecord(value)) {
    throw new DigestContractError('digest claim must be an object')
  }

  const attemptNumber = value.attempt_number
  if (!Number.isInteger(attemptNumber) || Number(attemptNumber) < 1 || Number(attemptNumber) > 3) {
    throw new DigestContractError('attempt_number must be an integer from 1 through 3')
  }

  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_DIGEST_ITEMS) {
    throw new DigestContractError(`items must contain 1 through ${MAX_DIGEST_ITEMS} entries`)
  }

  const items = value.items.map(parseDigestItem)
  if (new Set(items.map((item) => item.eventId)).size !== items.length) {
    throw new DigestContractError('items must not contain duplicate event IDs')
  }

  return {
    runId: requireUuid(value, 'run_id'),
    runLocalDate: requireLocalDate(value, 'run_local_date'),
    cutoffAt: requireTimestamp(value, 'cutoff_at'),
    attemptId: requireUuid(value, 'attempt_id'),
    attemptNumber: Number(attemptNumber),
    leaseToken: requireUuid(value, 'lease_token'),
    items,
  }
}

export function parseDigestClaimResponse(value: unknown): DigestClaim | null {
  if (!Array.isArray(value)) {
    throw new DigestContractError('claim RPC response must be an array')
  }
  if (value.length === 0) return null
  if (value.length !== 1) {
    throw new DigestContractError('claim RPC response must contain at most one row')
  }
  return parseClaimRecord(value[0])
}

