import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'
import { buildOnboardingPath } from '../lib/authReturn'
import { buildPasswordRecoveryRedirectUrl } from '../lib/authEntry'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  passwordRecovery: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, captchaToken?: string, returnTo?: string) => Promise<{
    error: string | null
    needsEmailConfirmation: boolean
  }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  requestPasswordReset: (email: string, captchaToken?: string) => Promise<{ error: string | null }>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        void fetchProfile(data.session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecovery(true)
        } else if (event === 'SIGNED_OUT') {
          setPasswordRecovery(false)
        }
        setSession(newSession)
        if (newSession) {
          setLoading(true)
          setTimeout(() => void fetchProfile(newSession.user.id), 0)
        } else {
          setProfile(null)
          setLoading(false)
        }
      },
    )

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  async function fetchProfile(_userId: string) {
    const { data, error } = await supabase.rpc('get_my_profile')
    const nextProfile = Array.isArray(data) ? data[0] : data
    setProfile(error ? null : nextProfile as Profile | null)
    setLoading(false)
  }

  async function signIn(email: string, password: string, captchaToken?: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    if (error) {
      console.error(JSON.stringify({ event: 'auth_signin_failed', code: error.code ?? 'unknown', message: error.message }))
      return { error: error.message }
    }
    setSession(data.session)
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
      console.error(JSON.stringify({ event: 'auth_signup_failed', code: error.code ?? 'unknown', message: error.message }))
      return { error: error.message, needsEmailConfirmation: false }
    }

    if (!data.session || !data.user) {
      return { error: null, needsEmailConfirmation: true }
    }

    setSession(data.session)
    await fetchProfile(data.user.id)
    return { error: null, needsEmailConfirmation: false }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  async function refreshProfile() {
    if (session) await fetchProfile(session.user.id)
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
    if (!updateError) {
      setPasswordRecovery(false)
    }
    return { error: updateError ? updateError.message : null }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        passwordRecovery,
        signIn,
        signUp,
        signOut,
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
