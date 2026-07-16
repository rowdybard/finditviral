import { buildOnboardingPath, sanitizeReturnPath } from './authReturn'

export const PASSWORD_RECOVERY_PATH = '/auth?type=recovery'

type SignedInAuthDestinationInput = {
  authLoading: boolean
  hasUser: boolean
  onboardingCompleted: boolean
  passwordRecovery: boolean
  returnTo: string
  search: string
  hash: string
}

type CompletedOnboardingDestinationInput = {
  authLoading: boolean
  hasUser: boolean
  onboardingCompleted: boolean
  returnTo: string
}

type AuthCaptchaVisibilityInput = {
  authLoading: boolean
  actionLoading: boolean
  hasActiveAuthSession: boolean
  passwordRecovery: boolean
  confirmationPending: boolean
  resetSent: boolean
}

export function isPasswordRecoveryCallback(search: string, hash: string): boolean {
  const queryType = new URLSearchParams(search).get('type')
  const fragmentType = new URLSearchParams(hash.replace(/^#/, '')).get('type')
  return queryType === 'recovery' || fragmentType === 'recovery'
}

export function buildPasswordRecoveryRedirectUrl(origin: string): string {
  return new URL(PASSWORD_RECOVERY_PATH, origin).toString()
}

export function getPasswordRecoveryRoute(
  passwordRecovery: boolean,
  pathname: string,
  hash = '',
): string | null {
  if (!passwordRecovery || pathname === '/auth') return null
  // Keep the recovery fragment intact until Supabase has exchanged it for a session.
  return `${PASSWORD_RECOVERY_PATH}${hash}`
}

export function getSignedInAuthDestination({
  authLoading,
  hasUser,
  onboardingCompleted,
  passwordRecovery,
  returnTo,
  search,
  hash,
}: SignedInAuthDestinationInput): string | null {
  if (
    authLoading
    || !hasUser
    || passwordRecovery
    || isPasswordRecoveryCallback(search, hash)
  ) {
    return null
  }

  const safeReturnTo = sanitizeReturnPath(returnTo)
  return onboardingCompleted ? safeReturnTo : buildOnboardingPath(safeReturnTo)
}

export function getCompletedOnboardingDestination({
  authLoading,
  hasUser,
  onboardingCompleted,
  returnTo,
}: CompletedOnboardingDestinationInput): string | null {
  if (authLoading || !hasUser || !onboardingCompleted) return null
  return sanitizeReturnPath(returnTo)
}

export function shouldShowAuthCaptcha({
  authLoading,
  actionLoading,
  hasActiveAuthSession,
  passwordRecovery,
  confirmationPending,
  resetSent,
}: AuthCaptchaVisibilityInput): boolean {
  return (!authLoading || actionLoading)
    && (!hasActiveAuthSession || actionLoading)
    && !passwordRecovery
    && !confirmationPending
    && !resetSent
}
