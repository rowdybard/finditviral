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
  getUser: () => Promise<{
    data: { user: User | null }
    error: AuthError | null
  }>
  signOut: (options: { scope: 'local' }) => Promise<{ error: AuthError | null }>
}

export function isDefinitivelyInvalidSession(error: AuthError): boolean {
  return isAuthSessionMissingError(error)
    || (isAuthApiError(error) && error.code === 'user_not_found')
}

export async function getValidatedInitialSession(
  auth: AuthSessionClient,
): Promise<Session | null> {
  const { data: sessionData, error: sessionError } = await auth.getSession()
  const cachedSession = sessionData.session

  if (sessionError) {
    if (isDefinitivelyInvalidSession(sessionError)) return null
    throw sessionError
  }
  if (!cachedSession) return null

  const { data: userData, error: userError } = await auth.getUser()
  if (userError) {
    if (isDefinitivelyInvalidSession(userError)) {
      await auth.signOut({ scope: 'local' })
      return null
    }
    throw userError
  }

  if (!userData.user || userData.user.id !== cachedSession.user.id) {
    await auth.signOut({ scope: 'local' })
    return null
  }

  return { ...cachedSession, user: userData.user }
}
