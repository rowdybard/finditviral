import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  isOwner: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        void hydrateOwner(data.session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        if (newSession) {
          setLoading(true)
          setTimeout(() => void hydrateOwner(newSession.user.id), 0)
        } else {
          setProfile(null)
          setIsOwner(false)
          setLoading(false)
        }
      },
    )

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  async function hydrateOwner(userId: string) {
    const { data, error } = await supabase.rpc('is_app_owner')
    const owner = !error && data === true
    setIsOwner(owner)

    if (!owner) {
      setProfile(null)
      setLoading(false)
      return
    }

    await fetchProfile(userId)
  }

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, karma, is_pro, created_at, onboarding_completed, looking_for, preferred_cities')
      .eq('id', userId)
      .single()
    setProfile(data as Profile | null)
    setLoading(false)
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    const { data: owner, error: ownerError } = await supabase.rpc('is_app_owner')
    if (ownerError || owner !== true) {
      await supabase.auth.signOut()
      return { error: 'This account is not authorized for the closed beta.' }
    }
    setSession(data.session)
    setIsOwner(true)
    await fetchProfile(data.user.id)
    return { error: null }
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setIsOwner(false)
  }

  async function refreshProfile() {
    if (session) await fetchProfile(session.user.id)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        isOwner,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
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
