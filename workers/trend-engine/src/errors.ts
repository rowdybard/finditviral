export class EngineError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  /** Provider-recommended pause before the next attempt, when available. */
  readonly retryAfterSeconds?: number
  /** Additional structured context (e.g. rate-limit headers, provider body). */
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, status = 500, retryable = false, retryAfterSeconds?: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.retryAfterSeconds = retryAfterSeconds
    this.details = details
  }
}

export class ValidationError extends EngineError {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('VALIDATION_FAILED', 'The request did not match the versioned engine contract.', 400)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export function errorCode(error: unknown): string {
  return error instanceof EngineError ? error.code : 'UNEXPECTED_ERROR'
}
