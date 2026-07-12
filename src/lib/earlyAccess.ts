export const EARLY_ACCESS_ENDPOINT = '/api/early-access'

export class EarlyAccessConfigurationError extends Error {
  constructor() {
    super('Early access is not configured.')
    this.name = 'EarlyAccessConfigurationError'
  }
}

export class EarlyAccessVerificationError extends Error {
  constructor() {
    super('The verification challenge was not accepted.')
    this.name = 'EarlyAccessVerificationError'
  }
}

export class EarlyAccessRateLimitError extends Error {
  constructor() {
    super('Too many early-access requests from this connection.')
    this.name = 'EarlyAccessRateLimitError'
  }
}

export class EarlyAccessSubmissionError extends Error {
  constructor() {
    super('The early-access request could not be saved.')
    this.name = 'EarlyAccessSubmissionError'
  }
}

export function getTurnstileSiteKey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''
}

export async function submitEarlyAccess(
  email: string,
  reason: string,
  turnstileToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<void> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(EARLY_ACCESS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, reason, turnstileToken }),
      signal: controller.signal,
    })

    if (response.ok) return

    if (response.status === 503) throw new EarlyAccessConfigurationError()
    if (response.status === 429) throw new EarlyAccessRateLimitError()

    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (body?.error === 'verification_failed' || body?.error === 'verification_required') {
        throw new EarlyAccessVerificationError()
      }
    }

    throw new EarlyAccessSubmissionError()
  } catch (error) {
    if (
      error instanceof EarlyAccessConfigurationError
      || error instanceof EarlyAccessVerificationError
      || error instanceof EarlyAccessRateLimitError
      || error instanceof EarlyAccessSubmissionError
    ) {
      throw error
    }
    throw new EarlyAccessSubmissionError()
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
