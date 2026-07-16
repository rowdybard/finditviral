const DEFAULT_RETURN_PATH = '/home'
const APP_ORIGIN = 'https://finditviral.local'

export type AppLocation = {
  pathname: string
  search?: string
  hash?: string
}

export function sanitizeReturnPath(
  value: string | null | undefined,
  fallback = DEFAULT_RETURN_PATH,
) {
  if (
    !value
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback
  }

  try {
    const url = new URL(value, APP_ORIGIN)
    if (url.origin !== APP_ORIGIN || url.pathname === '/auth' || url.pathname === '/onboarding') {
      return fallback
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function locationReturnPath(location: AppLocation) {
  return sanitizeReturnPath(`${location.pathname}${location.search ?? ''}${location.hash ?? ''}`)
}

export function buildAuthPath(returnTo: string, mode?: 'signup') {
  const params = new URLSearchParams()
  if (mode) params.set('mode', mode)

  const safeReturnTo = sanitizeReturnPath(returnTo)
  if (safeReturnTo !== DEFAULT_RETURN_PATH) params.set('returnTo', safeReturnTo)

  const query = params.toString()
  return query ? `/auth?${query}` : '/auth'
}

export function buildReauthenticationPath(returnTo: string) {
  const safeReturnTo = sanitizeReturnPath(returnTo)
  const params = new URLSearchParams({ reason: 'session_expired' })
  if (safeReturnTo !== DEFAULT_RETURN_PATH) params.set('returnTo', safeReturnTo)
  return `/auth?${params.toString()}`
}

export function buildOnboardingPath(returnTo: string) {
  const safeReturnTo = sanitizeReturnPath(returnTo)
  if (safeReturnTo === DEFAULT_RETURN_PATH) return '/onboarding'

  const params = new URLSearchParams({ returnTo: safeReturnTo })
  return `/onboarding?${params.toString()}`
}
