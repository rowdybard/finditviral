export const AUTH_TURNSTILE_CONFIG = {
  execution: 'execute',
  appearance: 'always',
  action: 'turnstile-spin-v1',
  theme: 'light',
} as const

export type PendingTurnstileAction = (token: string, isCurrent: () => boolean) => Promise<void>

type PendingTokenRequest = {
  resolve: (token: string) => void
  reject: (error: Error) => void
}

export class TurnstileRequestCancelledError extends Error {
  constructor() {
    super('Turnstile request cancelled')
    this.name = 'TurnstileRequestCancelledError'
  }
}

export class TurnstileActionLifecycle {
  private generation = 0

  activate(): number {
    this.generation += 1
    return this.generation
  }

  snapshot(): number {
    return this.generation
  }

  isCurrent(generation: number): boolean {
    return this.generation === generation
  }

  invalidate(generation: number): boolean {
    if (!this.isCurrent(generation)) return false
    this.generation += 1
    return true
  }
}

export class TurnstileTokenRequestController {
  private pending: PendingTokenRequest | null = null

  get hasPendingRequest() {
    return this.pending !== null
  }

  request(execute: () => void): Promise<string> {
    if (this.pending) {
      return Promise.reject(new Error('CAPTCHA verification is already in progress.'))
    }

    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject }

      try {
        execute()
      } catch (error) {
        const pending = this.takePending()
        pending?.reject(error instanceof Error ? error : new Error('CAPTCHA verification could not start.'))
      }
    })
  }

  resolve(token: string): boolean {
    const pending = this.takePending()
    if (!pending) return false

    if (!token) {
      pending.reject(new Error('CAPTCHA verification returned an empty token. Please try again.'))
      return true
    }

    pending.resolve(token)
    return true
  }

  reject(error: Error): boolean {
    const pending = this.takePending()
    if (!pending) return false
    pending.reject(error)
    return true
  }

  cancel(): boolean {
    return this.reject(new TurnstileRequestCancelledError())
  }

  private takePending(): PendingTokenRequest | null {
    const pending = this.pending
    this.pending = null
    return pending
  }
}
