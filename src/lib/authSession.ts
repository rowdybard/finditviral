import {
  isAuthApiError,
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

export type InitialSessionInspection =
  | { status: 'none' }
  | { status: 'stale'; session: Session }
  | { status: 'valid'; session: Session }

export type AuthEventSnapshot = {
  event: string
  accessToken: string | null
}

export function isDefinitivelyInvalidSession(error: AuthError): boolean {
  return isAuthSessionMissingError(error)
    || (isAuthApiError(error) && error.code === 'user_not_found')
}

export async function getValidatedInitialSession(
  auth: AuthSessionClient,
): Promise<InitialSessionInspection> {
  const { data: sessionData, error: sessionError } = await auth.getSession()
  const cachedSession = sessionData.session

  if (sessionError) {
    if (isDefinitivelyInvalidSession(sessionError)) return { status: 'none' }
    throw sessionError
  }
  if (!cachedSession) return { status: 'none' }

  const { data: userData, error: userError } = await auth.getUser(cachedSession.access_token)
  if (userError) {
    if (isDefinitivelyInvalidSession(userError)) {
      return { status: 'stale', session: cachedSession }
    }
    throw userError
  }

  if (!userData.user || userData.user.id !== cachedSession.user.id) {
    return { status: 'stale', session: cachedSession }
  }

  return {
    status: 'valid',
    session: { ...cachedSession, user: userData.user },
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

  return latestAuthEvent.event !== 'SIGNED_IN'
    || !inspectedSession
    || latestAuthEvent.accessToken !== inspectedSession.access_token
}
