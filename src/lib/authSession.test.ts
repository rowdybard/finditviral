import {
  AuthApiError,
  AuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  canClearInspectedStaleSession,
  doesAuthEventSupersedeInspection,
  getValidatedInitialSession,
  isDefinitivelyInvalidSession,
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

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      status: 'stale',
      session: cachedSession,
    })
  })

  it('does not destroy a cached session for a transient validation outage', async () => {
    const auth = createAuthClient({
      user: null,
      userError: authError('unexpected_failure', 503),
    })

    await expect(getValidatedInitialSession(auth)).rejects.toMatchObject({
      code: 'unexpected_failure',
      status: 503,
    })
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
    expect(isDefinitivelyInvalidSession(authError('session_not_found', 400))).toBe(false)
    expect(isDefinitivelyInvalidSession(authError('unexpected_failure', 503))).toBe(false)
  })

  it('allows cleanup after the startup SIGNED_IN event for the inspected token', () => {
    const startupEvent = {
      event: 'SIGNED_IN',
      accessToken: cachedSession.access_token,
    }

    expect(doesAuthEventSupersedeInspection(startupEvent, cachedSession)).toBe(false)
    expect(canClearInspectedStaleSession(cachedSession, cachedSession, startupEvent)).toBe(true)
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
