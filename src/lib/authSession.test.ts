import {
  AuthApiError,
  AuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  canApplyProfileResponse,
  canClearInspectedStaleSession,
  classifyAuthFailure,
  doesAuthEventSupersedeInspection,
  getAuthRecoveryRetryDelay,
  getValidatedInitialSession,
  isDefinitivelyInvalidSession,
  shouldScheduleAuthRecoveryRetry,
  shouldFetchProfile,
} from './authSession'

const cachedUser = { id: 'cached-user', email: 'cached@example.com' } as User
const serverUser = { ...cachedUser, email: 'current@example.com' } as User
const cachedSession = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: cachedUser,
} as Session

function authError(code: string, status: number): AuthError {
  return new AuthApiError(code, status, code)
}

function createAuthClient({
  session = cachedSession,
  sessionError = null,
  user = serverUser,
  userError = null,
}: {
  session?: Session | null
  sessionError?: AuthError | null
  user?: User | null
  userError?: AuthError | null
} = {}) {
  return {
    getSession: vi.fn(async () => ({
      data: { session },
      error: sessionError,
    })),
    getUser: vi.fn(async () => ({
      data: { user },
      error: userError,
    })),
  }
}

describe('validated initial auth sessions', () => {
  it('uses the server-validated user instead of trusting cached user data', async () => {
    const auth = createAuthClient()

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'valid',
      session: {
        ...cachedSession,
        user: serverUser,
      },
    })
    expect(auth.getUser).toHaveBeenCalledWith(cachedSession.access_token)
  })

  it('does not call the user endpoint when no cached session exists', async () => {
    const auth = createAuthClient({ session: null })

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({ status: 'none' })
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('marks a candidate stale when its auth user was deleted', async () => {
    const auth = createAuthClient({
      user: null,
      userError: authError('user_not_found', 403),
    })

    await expect(getValidatedInitialSession(auth)).resolves.toMatchObject({
      status: 'stale',
      session: cachedSession,
    })
  })

  it('does not destroy a cached session for a transient validation outage', async () => {
    const auth = createAuthClient({
      user: null,
      userError: authError('unexpected_failure', 503),
    })

    await expect(getValidatedInitialSession(auth)).resolves.toMatchObject({
      status: 'recoverable',
      session: cachedSession,
      error: {
        code: 'unexpected_failure',
        status: 503,
      },
    })
  })

  it('keeps an unexpected thrown network failure recoverable', async () => {
    const networkError = new TypeError('Failed to fetch')
    const auth = createAuthClient()
    auth.getSession.mockRejectedValueOnce(networkError)

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'recoverable',
      session: null,
      error: networkError,
    })
  })

  it('distinguishes a terminal session error when no cache remains', async () => {
    const terminalError = authError('refresh_token_not_found', 400)
    const auth = createAuthClient({ session: null, sessionError: terminalError })

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'invalid',
      session: null,
      error: terminalError,
    })
  })

  it('preserves a cached session when getSession reports a retryable outage', async () => {
    const retryableError = authError('unexpected_failure', 503)
    const auth = createAuthClient({ sessionError: retryableError })

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'recoverable',
      session: cachedSession,
      error: retryableError,
    })
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('marks a candidate stale when validation returns a different user', async () => {
    const auth = createAuthClient({
      user: { id: 'different-user' } as User,
    })

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'stale',
      session: cachedSession,
    })
  })

  it('recognizes terminal session validation errors', () => {
    expect(isDefinitivelyInvalidSession(authError('user_not_found', 403))).toBe(true)
    expect(isDefinitivelyInvalidSession(new AuthSessionMissingError())).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('session_not_found', 400))).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('session_expired', 401))).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('refresh_token_not_found', 400))).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('refresh_token_already_used', 400))).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('unexpected_failure', 503))).toBe(false)
  })

  it('defaults unknown errors to retryable instead of destroying local state', () => {
    expect(classifyAuthFailure(new TypeError('offline'))).toBe('retryable')
    expect(classifyAuthFailure(authError('request_timeout', 504))).toBe('retryable')
    expect(classifyAuthFailure(authError('bad_jwt', 401))).toBe('terminal')
  })

  it('allows cleanup after the startup SIGNED_IN event for the inspected token', () => {
    const startupEvent = {
      event: 'SIGNED_IN',
      accessToken: cachedSession.access_token,
    }

    expect(doesAuthEventSupersedeInspection(startupEvent, cachedSession)).toBe(false)
    expect(canClearInspectedStaleSession(cachedSession, cachedSession, startupEvent)).toBe(true)
  })

  it('allows validation to finish after the matching INITIAL_SESSION event', () => {
    const initialEvent = {
      event: 'INITIAL_SESSION',
      accessToken: cachedSession.access_token,
    }

    expect(doesAuthEventSupersedeInspection(initialEvent, cachedSession)).toBe(false)
    expect(doesAuthEventSupersedeInspection({ event: 'INITIAL_SESSION', accessToken: null }, null)).toBe(false)
    expect(doesAuthEventSupersedeInspection({ event: 'INITIAL_SESSION', accessToken: null }, cachedSession)).toBe(false)
  })

  it('never clears a stale candidate after a genuinely newer auth event', () => {
    const newerSession = {
      ...cachedSession,
      access_token: 'newer-access-token',
      user: { id: 'newer-user' } as User,
    }

    const newerSignIn = {
      event: 'SIGNED_IN',
      accessToken: newerSession.access_token,
    }
    const signedOut = { event: 'SIGNED_OUT', accessToken: null }

    expect(doesAuthEventSupersedeInspection(newerSignIn, cachedSession)).toBe(true)
    expect(canClearInspectedStaleSession(cachedSession, newerSession, newerSignIn)).toBe(false)
    expect(canClearInspectedStaleSession(cachedSession, cachedSession, signedOut)).toBe(false)
  })
})

describe('profile request coordination', () => {
  it('does not refetch a ready same-user profile on routine auth events', () => {
    expect(shouldFetchProfile(cachedUser.id, cachedUser.id, 'ready')).toBe(false)
    expect(shouldFetchProfile(cachedUser.id, cachedUser.id, 'recoverable-error')).toBe(false)
    expect(shouldFetchProfile(cachedUser.id, 'different-user', 'ready')).toBe(true)
    expect(shouldFetchProfile(cachedUser.id, null, 'recoverable-error')).toBe(true)
  })

  it('ignores a stale profile response after a newer request or account switch', () => {
    expect(canApplyProfileResponse(cachedUser.id, cachedUser.id, 2, 2)).toBe(true)
    expect(canApplyProfileResponse(cachedUser.id, cachedUser.id, 1, 2)).toBe(false)
    expect(canApplyProfileResponse(cachedUser.id, 'different-user', 2, 2)).toBe(false)
    expect(canApplyProfileResponse(cachedUser.id, null, 2, 2)).toBe(false)
  })
})

describe('auth recovery retry policy', () => {
  it('backs off at 1, 2, 4, and 8 seconds, then checks every 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5].map(getAuthRecoveryRetryDelay)).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      30_000,
      30_000,
    ])
  })

  it('only schedules background recovery while visible and online', () => {
    expect(shouldScheduleAuthRecoveryRetry(true, 'visible')).toBe(true)
    expect(shouldScheduleAuthRecoveryRetry(false, 'visible')).toBe(false)
    expect(shouldScheduleAuthRecoveryRetry(true, 'hidden')).toBe(false)
  })
})
