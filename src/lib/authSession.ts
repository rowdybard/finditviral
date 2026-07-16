import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from '@supabase/supabase-js'

type AuthSessionClient = {
  getSession: () => Promise<{
    data: { session: Session | null }
    error: AuthError | null
  }>
  getUser: (jwt?: string) => Promise<{
    data: { user: User | null }
    error: AuthError | null
  }>
}

export type AuthFailureKind = 'terminal' | 'retryable'

export type SafeAuthErrorMetadata = {
  code: string
  status: number | null
}

export type InitialSessionInspection =
  | { status: 'none' }
  | { status: 'stale'; session: Session; error?: unknown }
  | { status: 'invalid'; session: null; error: unknown }
  | { status: 'recoverable'; session: Session | null; error: unknown }
  | { status: 'valid'; session: Session }

export type AuthEventSnapshot = {
  event: string
  accessToken: string | null
}

export const AUTH_RECOVERY_INITIAL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const
export const AUTH_RECOVERY_STEADY_DELAY_MS = 30_000

export function getAuthRecoveryRetryDelay(attempt: number): number {
  return AUTH_RECOVERY_INITIAL_DELAYS_MS[attempt] ?? AUTH_RECOVERY_STEADY_DELAY_MS
}

export function shouldScheduleAuthRecoveryRetry(
  online: boolean,
  visibility: DocumentVisibilityState,
): boolean {
  return online && visibility === 'visible'
}

const TERMINAL_SESSION_ERROR_CODES = new Set([
  'bad_jwt',
  'no_authorization',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_expired',
  'session_not_found',
  'unexpected_audience',
  'user_banned',
  'user_not_found',
])

const RETRYABLE_AUTH_ERROR_CODES = new Set([
  'hook_timeout',
  'hook_timeout_after_retry',
  'request_timeout',
  'unexpected_failure',
])

export function classifyAuthFailure(error: unknown): AuthFailureKind {
  if (isAuthSessionMissingError(error)) return 'terminal'
  if (isAuthRetryableFetchError(error)) return 'retryable'

  if (isAuthApiError(error)) {
    if (error.code && TERMINAL_SESSION_ERROR_CODES.has(error.code)) return 'terminal'
    if (
      error.status >= 500
      || (error.code && RETRYABLE_AUTH_ERROR_CODES.has(error.code))
    ) {
      return 'retryable'
    }
  }

  // Unknown failures are kept recoverable. Destroying a locally cached session
  // is only safe when Supabase has given us a definitive terminal response.
  return 'retryable'
}

export function getSafeAuthErrorMetadata(error: unknown): SafeAuthErrorMetadata {
  if (!error || typeof error !== 'object') {
    return { code: 'unknown', status: null }
  }

  const candidate = error as { code?: unknown; name?: unknown; status?: unknown }
  return {
    code: typeof candidate.code === 'string'
      ? candidate.code
      : typeof candidate.name === 'string'
        ? candidate.name
        : 'unknown',
    status: typeof candidate.status === 'number' ? candidate.status : null,
  }
}

export function isDefinitivelyInvalidSession(error: unknown): boolean {
  return classifyAuthFailure(error) === 'terminal'
}

export async function getValidatedInitialSession(
  auth: AuthSessionClient,
): Promise<InitialSessionInspection> {
  let sessionResult: Awaited<ReturnType<AuthSessionClient['getSession']>>

  try {
    sessionResult = await auth.getSession()
  } catch (error) {
    return { status: 'recoverable', session: null, error }
  }

  const cachedSession = sessionResult.data.session
  if (sessionResult.error) {
    if (isDefinitivelyInvalidSession(sessionResult.error)) {
      return cachedSession
        ? { status: 'stale', session: cachedSession, error: sessionResult.error }
        : { status: 'invalid', session: null, error: sessionResult.error }
    }
    return { status: 'recoverable', session: cachedSession, error: sessionResult.error }
  }
  if (!cachedSession) return { status: 'none' }

  let userResult: Awaited<ReturnType<AuthSessionClient['getUser']>>
  try {
    userResult = await auth.getUser(cachedSession.access_token)
  } catch (error) {
    return { status: 'recoverable', session: cachedSession, error }
  }

  if (userResult.error) {
    if (isDefinitivelyInvalidSession(userResult.error)) {
      return { status: 'stale', session: cachedSession, error: userResult.error }
    }
    return { status: 'recoverable', session: cachedSession, error: userResult.error }
  }

  if (!userResult.data.user || userResult.data.user.id !== cachedSession.user.id) {
    return { status: 'stale', session: cachedSession }
  }

  return {
    status: 'valid',
    session: { ...cachedSession, user: userResult.data.user },
  }
}

export function canClearInspectedStaleSession(
  inspectedSession: Session,
  currentSession: Session | null,
  latestAuthEvent: AuthEventSnapshot | null,
): boolean {
  return !doesAuthEventSupersedeInspection(latestAuthEvent, inspectedSession)
    && currentSession?.access_token === inspectedSession.access_token
}

export function doesAuthEventSupersedeInspection(
  latestAuthEvent: AuthEventSnapshot | null,
  inspectedSession: Session | null,
): boolean {
  if (!latestAuthEvent) return false

  if (latestAuthEvent.event === 'INITIAL_SESSION') {
    // Supabase emits INITIAL_SESSION with null when its initial storage/refresh
    // read fails, including retryable failures. It is an input to bootstrap,
    // not evidence that a concurrently inspected cached session was revoked.
    return false
  }

  return latestAuthEvent.event !== 'SIGNED_IN'
    || !inspectedSession
    || latestAuthEvent.accessToken !== inspectedSession.access_token
}

export function shouldFetchProfile(
  nextUserId: string,
  currentProfileUserId: string | null,
  _profileStatus: 'idle' | 'loading' | 'ready' | 'recoverable-error',
): boolean {
  return currentProfileUserId !== nextUserId
}

export function canApplyProfileResponse(
  requestUserId: string,
  currentSessionUserId: string | null,
  requestGeneration: number,
  activeGeneration: number,
): boolean {
  return requestUserId === currentSessionUserId && requestGeneration === activeGeneration
}
