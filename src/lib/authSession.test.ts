import {
  AuthApiError,
  AuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
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
    signOut: vi.fn(async () => ({ error: null })),
  }
}

describe('validated initial auth sessions', () => {
  it('uses the server-validated user instead of trusting cached user data', async () => {
    const auth = createAuthClient()

    await expect(getValidatedInitialSession(auth)).resolves.toEqual({
      ...cachedSession,
      user: serverUser,
    })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('does not call the user endpoint when no cached session exists', async () => {
    const auth = createAuthClient({ session: null })

    await expect(getValidatedInitialSession(auth)).resolves.toBeNull()
    expect(auth.getUser).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('clears a local session whose auth user was deleted', async () => {
    const auth = createAuthClient({
      user: null,
      userError: authError('user_not_found', 403),
    })

    await expect(getValidatedInitialSession(auth)).resolves.toBeNull()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
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
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('clears a mismatched user returned for the cached session', async () => {
    const auth = createAuthClient({
      user: { id: 'different-user' } as User,
    })

    await expect(getValidatedInitialSession(auth)).resolves.toBeNull()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('recognizes terminal session validation errors', () => {
    expect(isDefinitivelyInvalidSession(authError('user_not_found', 403))).toBe(true)
    expect(isDefinitivelyInvalidSession(new AuthSessionMissingError())).toBe(true)
    expect(isDefinitivelyInvalidSession(authError('session_not_found', 400))).toBe(false)
    expect(isDefinitivelyInvalidSession(authError('unexpected_failure', 503))).toBe(false)
  })
})
