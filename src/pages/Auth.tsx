import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getStoredReferrer } from '../lib/referral'
import { trackEvent } from '../lib/analytics'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

export default function Auth() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const referrer = getStoredReferrer()

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setLoading(true)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setLoading(false)
      return
    }

    if (mode === 'signup') {
      const { error: signUpError } = await signUp(email.trim().toLowerCase(), password)
      if (signUpError) {
        setError(signUpError)
        setLoading(false)
        return
      trackEvent('sign_up', { method: 'email' })
      }
      setSuccessMessage('Account created! Check your email to confirm, then sign in.')
      setMode('signin')
      setPassword('')
      setLoading(false)
    } else {
      const { error: signInError } = await signIn(email.trim().toLowerCase(), password)
      if (signInError) {
        setError(signInError)
        setLoading(false)
      trackEvent('login', { method: 'email' })
        return
      }
      navigate('/home', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <div aria-hidden="true" className="h-1.5 w-full bg-brand-500" />

      <header className="mx-auto flex w-full max-w-md items-center justify-center px-5 py-6">
        <Link to="/" className="flex items-center gap-2.5 rounded text-lg font-extrabold tracking-tight text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50">
          <span className={`grid h-9 w-9 place-items-center rounded-lg border-2 border-stone-900 bg-white ${TOY_SHADOW_SM}`}>
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          </span>
          FindItViral
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-16">
        <div className={`rounded-2xl border-2 border-stone-900 bg-white p-6 sm:p-8 ${TOY_SHADOW}`}>
          <div className="mb-6 flex gap-2 rounded-lg bg-stone-100 p-1">
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); setSuccessMessage(null) }}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition ${
                mode === 'signup' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); setSuccessMessage(null) }}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition ${
                mode === 'signin' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              Sign In
            </button>
          </div>

          {successMessage && (
            <div role="status" aria-live="polite" className="mb-4 rounded-lg border-2 border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-email">
                Email address
              </label>
              <input
                id="auth-email"
                className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                maxLength={320}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </div>

            {mode === 'signup' && referrer && (
              <div className="rounded-lg border-2 border-stone-200 bg-stone-50 px-4 py-3">
                <p className="text-sm text-stone-600">
                  Referred by <span className="font-bold text-stone-900">@{referrer}</span>
                </p>
              </div>
            )}

            {mode === 'signup' && (
              <p className="rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">
                Sign up during launch and get <span className="font-bold">3 months free Pro</span>!
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none`}
            >
              {loading
                ? 'Please wait...'
                : mode === 'signup'
                  ? 'Create my account'
                  : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-stone-500">
            {mode === 'signup' ? (
              <>Already have an account? <button type="button" onClick={() => { setMode('signin'); setError(null) }} className="font-bold text-brand-700 hover:text-brand-800">Sign in</button></>
            ) : (
              <>New here? <button type="button" onClick={() => { setMode('signup'); setError(null) }} className="font-bold text-brand-700 hover:text-brand-800">Create an account</button></>
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-stone-500">
          <Link to="/" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  )
}
