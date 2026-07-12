import { describe, expect, it, vi } from 'vitest'
import {
  EarlyAccessConfigurationError,
  EarlyAccessSubmissionError,
  submitEarlyAccess,
  type EarlyAccessConfig,
} from './earlyAccess'

const config: EarlyAccessConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'publishable-test-key',
}

describe('submitEarlyAccess', () => {
  it('posts a normalized request to the uniform RPC endpoint', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 204 })
    ))

    await submitEarlyAccess('person@example.com', 'Looking near Boston', config, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/request_early_access')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBe(JSON.stringify({
      p_email: 'person@example.com',
      p_reason: 'Looking near Boston',
    }))
    expect(options?.headers).toMatchObject({
      apikey: 'publishable-test-key',
      Authorization: 'Bearer publishable-test-key',
    })
  })

  it('fails closed when production configuration is missing', async () => {
    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', {
        supabaseUrl: '',
        publishableKey: '',
      }),
    ).rejects.toBeInstanceOf(EarlyAccessConfigurationError)
  })

  it('returns one generic error for backend failures', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 500 })
    ))

    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', config, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessSubmissionError)
  })

  it('returns one generic error for thrown network failures', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError('network down')
    })

    await expect(
      submitEarlyAccess('person@example.com', 'Looking near Boston', config, fetchImpl),
    ).rejects.toBeInstanceOf(EarlyAccessSubmissionError)
  })
})
