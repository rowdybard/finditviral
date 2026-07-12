import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../lib/analytics'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

export default function Auth() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setLoading(false)
      return
    }

    const { error: signInError } = await signIn(email.trim().toLowerCase(), password)
    if (signInError) {
      setError(signInError)
      setLoading(false)
      return
    }

    trackEvent('login', { method: 'email' })
    navigate('/home', { replace: true })
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
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Closed beta</p>
          <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Owner sign in</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">This workspace is restricted to the FindItViral owner during the closed beta.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-email">Email address</label>
              <input
                id="auth-email"
                className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                maxLength={320}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
                minLength={8}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-stone-500">
          <Link to="/" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Back to early access</Link>
        </p>
      </main>
    </div>
  )
}
