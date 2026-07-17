export class EngineError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  /** Provider-recommended pause before the next attempt, when available. */
  readonly retryAfterSeconds?: number

  constructor(code: string, message: string, status = 500, retryable = false, retryAfterSeconds?: number) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.retryAfterSeconds = retryAfterSeconds
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
