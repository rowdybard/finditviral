import { afterEach, describe, expect, it, vi } from 'vitest'
import { processScheduledDigest } from '../src/index'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scheduled digest configuration handling', () => {
  it('claims first and records invalid email configuration as permanent', async () => {
    const claim = [{
      run_id: '11111111-1111-4111-8111-111111111111',
      run_local_date: '2026-07-14',
      cutoff_at: '2026-07-14T12:00:00.000Z',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      attempt_number: 1,
      lease_token: '33333333-3333-4333-8333-333333333333',
      items: [{
        event_id: '44444444-4444-4444-8444-444444444444',
        source: 'early_access',
        occurred_at: '2026-07-13T15:00:00.000Z',
        email: 'shopper@example.com',
        username: null,
        interest: 'Looking for local viral products.',
      }],
    }]

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(claim), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const send = vi.fn()
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key_long_enough',
      DIGEST_TO_EMAIL: 'invalid-address',
      DIGEST_FROM_EMAIL: 'digest@finditviral.com',
      DIGEST_FROM_NAME: 'FindItViral',
      EMAIL: { send },
    } as unknown as Env

    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).rejects.toThrow('permanent_failure')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('permanent_failure')
    expect(completionBody.p_error_code).toBe('DIGEST_CONFIGURATION_INVALID')
  })
})
