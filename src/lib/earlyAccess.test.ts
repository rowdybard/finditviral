import { describe, expect, it, vi } from 'vitest'
import {
  EARLY_ACCESS_ENDPOINT,
  EarlyAccessConfigurationError,
  EarlyAccessRateLimitError,
  EarlyAccessSubmissionError,
  EarlyAccessVerificationError,
  submitEarlyAccess,
} from './earlyAccess'

const VALID_TOKEN = 'turnstile-test-token'

function mockResponse(status: number, body: unknown = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('submitEarlyAccess', () => {
  it('posts email, reason, and turnstile token to the protected endpoint', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(204))

    await submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(url).toBe(EARLY_ACCESS_ENDPOINT)
    expect(options?.method).toBe('POST')
    expect(options?.body).toBe(JSON.stringify({
      email: 'person@example.com',
      reason: 'Looking near Boston',
      turnstileToken: VALID_TOKEN,
    }))
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
  })

  it('resolves silently on a 204 response', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(204))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).resolves.toBeUndefined()
  })

  it('throws EarlyAccessConfigurationError on 503', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(503, { error: 'unavailable' }))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessConfigurationError)
  })

  it('throws EarlyAccessRateLimitError on 429', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(429, { error: 'rate_limited' }))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessRateLimitError)
  })

  it('throws EarlyAccessVerificationError when verification fails', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(400, { error: 'verification_failed' }))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessVerificationError)
  })

  it('throws EarlyAccessVerificationError when verification is required', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(400, { error: 'verification_required' }))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessVerificationError)
  })

  it('returns one generic error for backend failures', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(500))
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessSubmissionError)
  })

  it('returns one generic error for thrown network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    })
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', VALID_TOKEN, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessSubmissionError)
  })
})
