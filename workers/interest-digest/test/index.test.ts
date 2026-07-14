import { afterEach, describe, expect, it, vi } from 'vitest'
import { processScheduledDigest } from '../src/index'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeClaim(overrides: Record<string, unknown> = {}) {
  return [{
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
    ...overrides,
  }]
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test_key_long_enough',
    DIGEST_TO_EMAIL: 'owner@finditviral.com',
    DIGEST_FROM_EMAIL: 'digest@finditviral.com',
    DIGEST_FROM_NAME: 'FindItViral',
    EMAIL: { send: vi.fn() },
    ...overrides,
  } as unknown as Env
}

function claimFetchMock(claim: unknown[] | null) {
  return vi.fn()
    .mockResolvedValueOnce(new Response(
      claim ? JSON.stringify(claim) : '[]',
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
}

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

describe('destination allowlist', () => {
  it('rejects a valid email that is not in the allowlist', async () => {
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
      DIGEST_TO_EMAIL: 'attacker@evil.com',
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

  it('sends to the allowed destination and records an accepted outcome', async () => {
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

    const send = vi.fn().mockResolvedValue({ messageId: 'msg-success-123' })
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key_long_enough',
      DIGEST_TO_EMAIL: 'owner@finditviral.com',
      DIGEST_FROM_EMAIL: 'digest@finditviral.com',
      DIGEST_FROM_NAME: 'FindItViral',
      EMAIL: { send },
    } as unknown as Env

    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    const sendArgs = send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(sendArgs.to).toBe('owner@finditviral.com')
    expect(sendArgs.from).toEqual({ email: 'digest@finditviral.com', name: 'FindItViral' })

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('accepted')
    expect(completionBody.p_message_id).toBe('msg-success-123')
    expect(completionBody.p_error_code).toBeNull()
  })
})

describe('transient email failure', () => {
  it('records transient_failure when email API returns a transient error code', async () => {
    const transientError = Object.assign(new Error('Rate limited'), { code: 'E_RATE_LIMIT_EXCEEDED' })
    const send = vi.fn().mockRejectedValue(transientError)
    const fetchMock = claimFetchMock(makeClaim())
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).rejects.toThrow('transient_failure')

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('transient_failure')
    expect(completionBody.p_error_code).toBe('E_RATE_LIMIT_EXCEEDED')
  })
})

describe('permanent email failure', () => {
  it('records permanent_failure when email API returns a permanent error code', async () => {
    const permanentError = Object.assign(new Error('Sender not verified'), { code: 'E_SENDER_NOT_VERIFIED' })
    const send = vi.fn().mockRejectedValue(permanentError)
    const fetchMock = claimFetchMock(makeClaim())
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).rejects.toThrow('permanent_failure')

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('permanent_failure')
    expect(completionBody.p_error_code).toBe('E_SENDER_NOT_VERIFIED')
  })
})

describe('uncertain outcome (MissingMessageIdError)', () => {
  it('records uncertain when email send succeeds but returns no message ID', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '' })
    const fetchMock = claimFetchMock(makeClaim())
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).rejects.toThrow('uncertain')

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('uncertain')
    expect(completionBody.p_error_code).toBe('EMAIL_RESULT_MISSING_MESSAGE_ID')
  })
})

describe('retry attempt (attempt_number=2)', () => {
  it('processes a retry claim with attempt_number=2', async () => {
    const claim = makeClaim({ attempt_number: 2 })
    const send = vi.fn().mockResolvedValue({ messageId: 'msg-retry-2' })
    const fetchMock = claimFetchMock(claim)
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).resolves.toBeUndefined()

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('accepted')
    expect(completionBody.p_message_id).toBe('msg-retry-2')
  })
})

describe('retry exhaustion at attempt 3', () => {
  it('processes a successful send on attempt 3', async () => {
    const claim = makeClaim({ attempt_number: 3 })
    const send = vi.fn().mockResolvedValue({ messageId: 'msg-attempt-3' })
    const fetchMock = claimFetchMock(claim)
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).resolves.toBeUndefined()

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('accepted')
  })

  it('records transient_failure on attempt 3 with transient error (no escalation in worker)', async () => {
    const claim = makeClaim({ attempt_number: 3 })
    const transientError = Object.assign(new Error('Rate limited'), { code: 'E_RATE_LIMIT_EXCEEDED' })
    const send = vi.fn().mockRejectedValue(transientError)
    const fetchMock = claimFetchMock(claim)
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).rejects.toThrow('transient_failure')

    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(completionBody.p_outcome).toBe('transient_failure')
    expect(completionBody.p_error_code).toBe('E_RATE_LIMIT_EXCEEDED')
    expect(completionBody.p_attempt_number).toBeUndefined()
  })
})

describe('empty claim behavior', () => {
  it('no-ops when claim returns null (empty array)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const send = vi.fn()
    const env = makeEnv({ EMAIL: { send } })
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('before 8 AM Detroit no-op', () => {
  it('skips digest when scheduled before 8 AM Detroit time', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv()
    await expect(
      processScheduledDigest(Date.parse('2026-07-14T11:00:00.000Z'), env),
    ).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('no sensitive email content in logs', () => {
  it('does not include email addresses in log output on failure', async () => {
    const transientError = Object.assign(new Error('Delivery failed for shopper@example.com'), { code: 'E_DELIVERY_FAILED' })
    const send = vi.fn().mockRejectedValue(transientError)
    const fetchMock = claimFetchMock(makeClaim())
    vi.stubGlobal('fetch', fetchMock)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = makeEnv({ EMAIL: { send } })

    try {
      await processScheduledDigest(Date.parse('2026-07-14T13:00:00.000Z'), env)
    } catch {
      // expected
    }

    const logCalls = consoleSpy.mock.calls.map(c => String(c[0]))
    for (const log of logCalls) {
      expect(log).not.toContain('shopper@example.com')
      expect(log).not.toContain('owner@finditviral.com')
    }
    consoleSpy.mockRestore()
  })
})
