import { DigestContractError, type DigestAttemptOutcome } from './domain'

const PERMANENT_EMAIL_ERROR_CODES = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
])

const TRANSIENT_EMAIL_ERROR_CODES = new Set([
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
  'E_DELIVERY_FAILED',
  'E_INTERNAL_SERVER_ERROR',
])

export class DigestConfigurationError extends Error {
  readonly code = 'DIGEST_CONFIGURATION_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'DigestConfigurationError'
  }
}

export class MissingMessageIdError extends Error {
  readonly code = 'EMAIL_RESULT_MISSING_MESSAGE_ID'

  constructor() {
    super('Email Service returned no message ID')
    this.name = 'MissingMessageIdError'
  }
}

function readErrorProperty(error: unknown, property: string): string | null {
  if (typeof error !== 'object' || error === null || !(property in error)) return null
  const value = (error as Record<string, unknown>)[property]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function getErrorCode(error: unknown): string {
  const code = readErrorProperty(error, 'code')
  if (code) return code.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128)
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128)
  }
  return 'UNKNOWN_ERROR'
}

export function getErrorMessage(error: unknown): string {
  const message = readErrorProperty(error, 'message')
  if (message) return message
  return 'Unknown error'
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+\b/g, '[redacted-api-key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 500)
}

export function classifyDeliveryFailure(error: unknown): DigestAttemptOutcome {
  if (error instanceof DigestConfigurationError || error instanceof DigestContractError) {
    return 'permanent_failure'
  }
  if (error instanceof MissingMessageIdError) return 'uncertain'

  const code = getErrorCode(error)
  if (PERMANENT_EMAIL_ERROR_CODES.has(code)) return 'permanent_failure'
  if (TRANSIENT_EMAIL_ERROR_CODES.has(code)) return 'transient_failure'
  return 'uncertain'
}
