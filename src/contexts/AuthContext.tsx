import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'
import { buildOnboardingPath } from '../lib/authReturn'
import { buildPasswordRecoveryRedirectUrl } from '../lib/authEntry'
import {
  canApplyProfileResponse,
  canClearInspectedStaleSession,
  classifyAuthFailure,
  doesAuthEventSupersedeInspection,
  getAuthRecoveryRetryDelay,
  getSafeAuthErrorMetadata,
  getValidatedInitialSession,
  shouldScheduleAuthRecoveryRetry,
  shouldFetchProfile,
} from '../lib/authSession'

export type AuthStatus = 'initializing' | 'authenticated' | 'recovering' | 'anonymous' | 'expired'
export type ProfileStatus = 'idle' | 'loading' | 'ready' | 'recoverable-error'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  authStatus: AuthStatus
  profileStatus: ProfileStatus
  lastAuthErrorCode: string | null
  loading: boolean
  passwordRecovery: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, captchaToken?: string, returnTo?: string) => Promise<{
    error: string | null
    needsEmailConfirmation: boolean
  }>
  signOut: () => Promise<void>
  retryAuth: () => Promise<void>
  refreshProfile: () => Promise<void>
  requestPasswordReset: (email: string, captchaToken?: string) => Promise<{ error: string | null }>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
}

type ActiveProfileRequest = {
  userId: string
  generation: number
  promise: Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function runtimeAuthContext() {
  return {
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
  }
}

function logAuthDiagnostic(
  trigger: string,
  previousStatus: AuthStatus,
  nextStatus: AuthStatus,
  error?: unknown,
) {
  const metadata = error ? getSafeAuthErrorMetadata(error) : null
  console.info(JSON.stringify({
    event: 'auth_state',
    trigger,
    previousStatus,
    nextStatus,
    ...runtimeAuthContext(),
    ...(metadata ? { code: metadata.code, status: metadata.status } : {}),
  }))
}

function logSafeFailure(event: string, error: unknown) {
  const metadata = getSafeAuthErrorMetadata(error)
  console.error(JSON.stringify({
    event,
    code: metadata.code,
    status: metadata.status,
    ...runtimeAuthContext(),
  }))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null)
  const [profile, setProfileState] = useState<Profile | null>(null)
  const [authStatus, setAuthStatusState] = useState<AuthStatus>('initializing')
  const [profileStatus, setProfileStatusState] = useState<ProfileStatus>('idle')
  const [lastAuthErrorCode, setLastAuthErrorCode] = useState<string | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  const sessionRef = useRef<Session | null>(null)
  const profileRef = useRef<Profile | null>(null)
  const profileUserIdRef = useRef<string | null>(null)
  const authStatusRef = useRef<AuthStatus>('initializing')
  const profileStatusRef = useRef<ProfileStatus>('idle')
  const profileGenerationRef = useRef(0)
  const activeProfileRequestRef = useRef<ActiveProfileRequest | null>(null)
  const intentionalSignOutRef = useRef(false)
  const retryInspectionRef = useRef<() => Promise<void>>(async () => undefined)

  const publishAuthStatus = useCallback((
    nextStatus: AuthStatus,
    trigger: string,
    error?: unknown,
  ) => {
    const previousStatus = authStatusRef.current
    authStatusRef.current = nextStatus
    setAuthStatusState(nextStatus)
    setLastAuthErrorCode(error ? getSafeAuthErrorMetadata(error).code : null)
    logAuthDiagnostic(trigger, previousStatus, nextStatus, error)
  }, [])

  const publishSession = useCallback((nextSession: Session | null) => {
    const previousUserId = sessionRef.current?.user.id ?? null
    const nextUserId = nextSession?.user.id ?? null

    if (previousUserId !== nextUserId) {
      profileGenerationRef.current += 1
      activeProfileRequestRef.current = null
      profileRef.current = null
      profileUserIdRef.current = null
      profileStatusRef.current = 'idle'
      setProfileState(null)
      setProfileStatusState('idle')
    }

    sessionRef.current = nextSession
    setSessionState(nextSession)
  }, [])

  const fetchProfile = useCallback((userId: string, force = false): Promise<void> => {
    const activeRequest = activeProfileRequestRef.current
    if (!force && activeRequest?.userId === userId) return activeRequest.promise

    if (
      !force
      && !shouldFetchProfile(userId, profileUserIdRef.current, profileStatusRef.current)
    ) {
      return Promise.resolve()
    }

    const generation = profileGenerationRef.current + 1
    profileGenerationRef.current = generation
    profileStatusRef.current = 'loading'
    setProfileStatusState('loading')

    const promise = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_my_profile')
        if (!canApplyProfileResponse(
          userId,
          sessionRef.current?.user.id ?? null,
          generation,
          profileGenerationRef.current,
        )) {
          return
        }

        if (error) {
          profileUserIdRef.current = userId
          profileStatusRef.current = 'recoverable-error'
          setProfileStatusState('recoverable-error')
          logSafeFailure('auth_profile_fetch_failed', error)
          return
        }

        const result = Array.isArray(data) ? data[0] : data
        const nextProfile = (result ?? null) as Profile | null
        profileRef.current = nextProfile
        profileUserIdRef.current = userId
        profileStatusRef.current = 'ready'
        setProfileState(nextProfile)
        setProfileStatusState('ready')
      } catch (error) {
        if (!canApplyProfileResponse(
          userId,
          sessionRef.current?.user.id ?? null,
          generation,
          profileGenerationRef.current,
        )) {
          return
        }
        profileUserIdRef.current = userId
        profileStatusRef.current = 'recoverable-error'
        setProfileStatusState('recoverable-error')
        logSafeFailure('auth_profile_fetch_failed', error)
      } finally {
        if (activeProfileRequestRef.current?.generation === generation) {
          activeProfileRequestRef.current = null
        }
      }
    })()

    activeProfileRequestRef.current = { userId, generation, promise }
    return promise
  }, [])

  useEffect(() => {
    let stopped = false
    let latestAuthEvent: { event: AuthChangeEvent; accessToken: string | null } | null = null
    let retryAttempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let activeInspection: Promise<void> | null = null

    function clearRetryTimer() {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
    }

    function scheduleInspectionRetry() {
      if (
        stopped
        || retryTimer
        || !shouldScheduleAuthRecoveryRetry(
          typeof navigator === 'undefined' || navigator.onLine,
          typeof document === 'undefined' ? 'visible' : document.visibilityState,
        )
      ) {
        return
      }

      const delay = getAuthRecoveryRetryDelay(retryAttempt)
      retryAttempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!shouldScheduleAuthRecoveryRetry(navigator.onLine, document.visibilityState)) return
        void runInspection()
      }, delay)
    }

    async function applyTerminalInspection(inspectedSession: Session, error?: unknown) {
      let current: Awaited<ReturnType<typeof supabase.auth.getSession>>
      try {
        current = await supabase.auth.getSession()
      } catch (recheckError) {
        publishSession(inspectedSession)
        publishAuthStatus('recovering', 'terminal_session_recheck_failed', recheckError)
        scheduleInspectionRetry()
        return
      }

      if (current.error && classifyAuthFailure(current.error) === 'retryable') {
        publishSession(inspectedSession)
        publishAuthStatus('recovering', 'terminal_session_recheck_failed', current.error)
        scheduleInspectionRetry()
        return
      }

      if (current.error) {
        if (doesAuthEventSupersedeInspection(latestAuthEvent, inspectedSession)) return
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) logSafeFailure('auth_terminal_cleanup_failed', signOutError)
        if (stopped) return
        const currentToken = sessionRef.current?.access_token
        if (currentToken && currentToken !== inspectedSession.access_token) return
        publishSession(null)
        setPasswordRecovery(false)
        publishAuthStatus('expired', 'terminal_session', error ?? current.error)
        return
      }

      if (
        stopped
        || !canClearInspectedStaleSession(
          inspectedSession,
          current.data.session,
          latestAuthEvent,
        )
      ) {
        return
      }

      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) logSafeFailure('auth_terminal_cleanup_failed', signOutError)
      if (stopped) return

      const currentToken = sessionRef.current?.access_token
      if (currentToken && currentToken !== inspectedSession.access_token) return
      publishSession(null)
      setPasswordRecovery(false)
      publishAuthStatus('expired', 'terminal_session', error)
    }

    async function performInspection() {
      const inspection = await getValidatedInitialSession(supabase.auth)
      const inspectedSession = 'session' in inspection ? inspection.session : null
      if (
        stopped
        || doesAuthEventSupersedeInspection(latestAuthEvent, inspectedSession)
      ) {
        return
      }

      if (inspection.status === 'recoverable') {
        if (inspection.session) publishSession(inspection.session)
        publishAuthStatus('recovering', 'session_validation_retryable', inspection.error)
        scheduleInspectionRetry()
        return
      }

      if (inspection.status === 'invalid') {
        publishSession(null)
        setPasswordRecovery(false)
        publishAuthStatus('expired', 'session_validation_terminal', inspection.error)
        return
      }

      if (inspection.status === 'stale') {
        await applyTerminalInspection(inspection.session, inspection.error)
        return
      }

      retryAttempt = 0
      clearRetryTimer()

      if (inspection.status === 'none') {
        publishSession(null)
        publishAuthStatus('anonymous', 'initial_session_empty')
        return
      }

      publishSession(inspection.session)
      publishAuthStatus('authenticated', 'initial_session_valid')
      await fetchProfile(inspection.session.user.id)
    }

    function runInspection(): Promise<void> {
      if (activeInspection) return activeInspection

      const promise = performInspection()
        .catch((error: unknown) => {
          if (stopped) return
          publishAuthStatus('recovering', 'session_validation_failed', error)
          scheduleInspectionRetry()
        })
        .finally(() => {
          if (activeInspection === promise) activeInspection = null
        })
      activeInspection = promise
      return promise
    }

    retryInspectionRef.current = async () => {
      clearRetryTimer()
      retryAttempt = 0
      await runInspection()
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === 'INITIAL_SESSION') {
          const initialAccessToken = newSession?.access_token ?? null
          const currentAccessToken = sessionRef.current?.access_token ?? null
          if (
            authStatusRef.current !== 'initializing'
            && initialAccessToken !== currentAccessToken
          ) {
            logAuthDiagnostic(event, authStatusRef.current, authStatusRef.current)
            return
          }

          latestAuthEvent = { event, accessToken: initialAccessToken }
          publishSession(newSession)
          if (authStatusRef.current === 'initializing') {
            publishAuthStatus('initializing', event)
          } else {
            logAuthDiagnostic(event, authStatusRef.current, authStatusRef.current)
          }
          return
        }

        latestAuthEvent = {
          event,
          accessToken: newSession?.access_token ?? null,
        }

        if (event === 'SIGNED_OUT') {
          const intentional = intentionalSignOutRef.current
          publishSession(null)
          setPasswordRecovery(false)
          publishAuthStatus(
            intentional ? 'anonymous' : 'expired',
            event,
          )
          intentionalSignOutRef.current = false
          return
        }

        if (!newSession) {
          logAuthDiagnostic(event, authStatusRef.current, authStatusRef.current)
          return
        }

        retryAttempt = 0
        clearRetryTimer()
        publishSession(newSession)
        if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
        publishAuthStatus('authenticated', event)

        // Keep the auth callback synchronous. This also lets same-user refresh
        // events collapse onto an existing/ready profile request.
        setTimeout(() => {
          if (!stopped) void fetchProfile(newSession.user.id)
        }, 0)
      },
    )

    function resumeRecovery() {
      if (!shouldScheduleAuthRecoveryRetry(navigator.onLine, document.visibilityState)) return

      if (authStatusRef.current === 'recovering') {
        clearRetryTimer()
        retryAttempt = 0
        // Supabase owns token refresh on visibility changes. This only reruns
        // session validation and shares the client's existing auth lock.
        setTimeout(() => {
          if (!stopped && authStatusRef.current === 'recovering') void runInspection()
        }, 0)
        return
      }

      const currentSession = sessionRef.current
      if (currentSession && profileStatusRef.current === 'recoverable-error') {
        void fetchProfile(currentSession.user.id, true)
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        clearRetryTimer()
        return
      }
      resumeRecovery()
    }

    function handleOffline() {
      clearRetryTimer()
    }

    window.addEventListener('online', resumeRecovery)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('focus', resumeRecovery)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void runInspection()

    return () => {
      stopped = true
      clearRetryTimer()
      retryInspectionRef.current = async () => undefined
      window.removeEventListener('online', resumeRecovery)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('focus', resumeRecovery)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      authListener.subscription.unsubscribe()
    }
  }, [fetchProfile, publishAuthStatus, publishSession])

  async function signIn(email: string, password: string, captchaToken?: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    if (error) {
      logSafeFailure('auth_signin_failed', error)
      return { error: error.message }
    }

    setPasswordRecovery(false)
    publishSession(data.session)
    publishAuthStatus('authenticated', 'sign_in_action')
    await fetchProfile(data.user.id)
    return { error: null }
  }

  async function signUp(email: string, password: string, captchaToken?: string, returnTo = '/home') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${buildOnboardingPath(returnTo)}`,
        captchaToken,
      },
    })

    if (error) {
      logSafeFailure('auth_signup_failed', error)
      return { error: error.message, needsEmailConfirmation: false }
    }

    if (!data.session || !data.user) {
      return { error: null, needsEmailConfirmation: true }
    }

    setPasswordRecovery(false)
    publishSession(data.session)
    publishAuthStatus('authenticated', 'sign_up_action')
    await fetchProfile(data.user.id)
    return { error: null, needsEmailConfirmation: false }
  }

  async function signOut() {
    intentionalSignOutRef.current = true
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    publishSession(null)
    setPasswordRecovery(false)
    publishAuthStatus('anonymous', 'sign_out_action', error ?? undefined)
    intentionalSignOutRef.current = false
    if (error) logSafeFailure('auth_signout_failed', error)
  }

  const retryAuth = useCallback(async () => {
    const currentSession = sessionRef.current
    if (
      currentSession
      && authStatusRef.current === 'authenticated'
      && profileStatusRef.current === 'recoverable-error'
    ) {
      await fetchProfile(currentSession.user.id, true)
      return
    }

    await retryInspectionRef.current()
  }, [fetchProfile])

  async function refreshProfile() {
    const currentSession = sessionRef.current
    if (currentSession) await fetchProfile(currentSession.user.id, true)
  }

  async function requestPasswordReset(email: string, captchaToken?: string) {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: buildPasswordRecoveryRedirectUrl(window.location.origin),
        captchaToken,
      },
    )
    return { error: resetError ? resetError.message : null }
  }

  async function updatePassword(newPassword: string) {
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (!updateError) setPasswordRecovery(false)
    return { error: updateError ? updateError.message : null }
  }

  const loading = authStatus === 'initializing'
    || (authStatus === 'recovering' && !session)
    || (
      authStatus === 'authenticated'
      && Boolean(session)
      && !profile
      && (profileStatus === 'idle' || profileStatus === 'loading')
    )

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        authStatus,
        profileStatus,
        lastAuthErrorCode,
        loading,
        passwordRecovery,
        signIn,
        signUp,
        signOut,
        retryAuth,
        refreshProfile,
        requestPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
