import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type AccessState = 'checking' | 'owner' | 'denied'

export default function OwnerGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signInError, setSignInError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [access, setAccess] = useState<AccessState>('checking')

  useEffect(() => {
    let active = true

    async function checkAccess() {
      if (authLoading) return
      if (!user || !isSupabaseConfigured) {
        if (active) setAccess('denied')
        return
      }

      if (active) setAccess('checking')
      const { data, error } = await supabase.rpc('is_app_owner')
      if (active) setAccess(!error && data === true ? 'owner' : 'denied')
    }

    void checkAccess()
    return () => { active = false }
  }, [authLoading, user])

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSigningIn(true)
    setSignInError(null)
    const { error } = await signIn(email, password)
    setIsSigningIn(false)

    if (error) {
      setSignInError(error)
      return
    }

    navigate('/home', { replace: true })
  }

  if (authLoading || (user && access === 'checking')) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 px-6 text-stone-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-brand-600" aria-label="Checking access" />
      </div>
    )
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-50 px-5 text-stone-900">
        <form onSubmit={handleSignIn} className="w-full max-w-sm rounded-xl border-2 border-stone-900 bg-white p-6 shadow-[4px_4px_0_0_#1c1917]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">FindItViral</p>
          <h1 className="mt-3 text-2xl font-extrabold text-stone-900">Private access</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">Sign in with the owner account to continue.</p>
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-bold" htmlFor="owner-email">Email</label>
              <input id="owner-email" className="w-full rounded-lg border-2 border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold" htmlFor="owner-password">Password</label>
              <input id="owner-password" className="w-full rounded-lg border-2 border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
          </div>
          {signInError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{signInError}</p>}
          <button type="submit" disabled={isSigningIn} className="mt-5 w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-2.5 text-sm font-bold text-stone-900 shadow-[3px_3px_0_0_#1c1917] hover:bg-brand-600 disabled:opacity-60">
            {isSigningIn ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </main>
    )
  }

  if (access !== 'owner') {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-50 px-5 text-stone-900">
        <div className="w-full max-w-sm rounded-xl border-2 border-stone-900 bg-white p-6 text-center shadow-[4px_4px_0_0_#1c1917]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">FindItViral</p>
          <h1 className="mt-3 text-2xl font-extrabold text-stone-900">Access unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-stone-500">This area is limited to the owner account.</p>
          <button onClick={() => void signOut()} className="mt-6 text-sm font-bold text-brand-700 hover:text-brand-800">Sign out</button>
        </div>
      </main>
    )
  }

  return <>{children}</>
}
