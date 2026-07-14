import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../lib/analytics'
import { mapAuthError } from '../lib/errorMap'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

type TurnstileWidget = {
  render: (container: HTMLElement, options: {
    sitekey: string
    callback: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
    theme?: 'light' | 'dark' | 'auto'
    size?: 'normal' | 'compact'
  }) => string
  remove: (widgetId: string) => void
}

export default function Auth() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSignUp = searchParams.get('mode') === 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaExpired, setCaptchaExpired] = useState(false)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!isSignUp) return

    let cancelled = false

    function loadTurnstile() {
      const ts = (window as unknown as { turnstile?: TurnstileWidget }).turnstile
      if (ts) {
        renderTurnstile()
        return
      }
      const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)
      if (existing) {
        existing.addEventListener('load', renderTurnstile)
        return
      }
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.onload = () => {
        if (!cancelled) renderTurnstile()
      }
      document.head.appendChild(script)
    }

    function renderTurnstile() {
      const ts = (window as unknown as { turnstile?: TurnstileWidget }).turnstile
      if (!turnstileContainerRef.current || !ts) return
      if (turnstileWidgetId.current) {
        ts.remove(turnstileWidgetId.current)
      }
      turnstileWidgetId.current = ts.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => {
          setCaptchaToken(token)
          setCaptchaExpired(false)
        },
        'expired-callback': () => {
          setCaptchaToken(null)
          setCaptchaExpired(true)
        },
        'error-callback': () => {
          setCaptchaToken(null)
        },
        theme: 'light',
      })
    }

    loadTurnstile()

    return () => {
      cancelled = true
      const ts = (window as unknown as { turnstile?: TurnstileWidget }).turnstile
      if (turnstileWidgetId.current && ts) {
        ts.remove(turnstileWidgetId.current)
        turnstileWidgetId.current = null
      }
      setCaptchaToken(null)
      setCaptchaExpired(false)
    }
  }, [isSignUp])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()

    if (isSignUp) {
      if (!captchaToken) {
        setError('Please complete the CAPTCHA verification.')
        setLoading(false)
        return
      }
      const result = await signUp(normalizedEmail, password, captchaToken)
      if (result.error) {
        console.error('sign_up error:', result.error)
        setError(mapAuthError(result.error, true))
        setLoading(false)
        return
      }

      trackEvent('sign_up', { method: 'email' })
      if (result.needsEmailConfirmation) {
        setConfirmationPending(true)
        setLoading(false)
        return
      }

      navigate('/onboarding', { replace: true })
      return
    }

    const { error: signInError } = await signIn(normalizedEmail, password)
    if (signInError) {
      console.error('sign_in error:', signInError)
      setError(mapAuthError(signInError, false))
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
          {confirmationPending ? (
            <div role="status" aria-live="polite" className="py-4 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-green-700 bg-green-50 text-2xl font-bold text-green-700">✓</div>
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Almost there</p>
              <h1 className="mt-2 text-2xl font-extrabold">Check your email</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Open the confirmation link we sent to <strong className="text-stone-800">{email.trim()}</strong>, then finish setting up your Greater Lansing profile.
              </p>
              <Link to="/auth" className={`mt-6 inline-block rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM}`}>
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Greater Lansing beta</p>
              <h1 className="mt-2 text-2xl font-extrabold text-stone-900">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {isSignUp
                  ? 'Join local shoppers reporting and finding viral, limited, and hard-to-find products.'
                  : 'Sign in to check nearby sightings, post a bounty, or report what you found.'}
              </p>

              <div className="mt-6 grid grid-cols-2 rounded-xl border-2 border-stone-900 bg-stone-100 p-1" aria-label="Account action">
                <Link
                  to="/auth"
                  className={`rounded-lg px-3 py-2 text-center text-sm font-bold ${!isSignUp ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
                >
                  Sign in
                </Link>
                <Link
                  to="/auth?mode=signup"
                  className={`rounded-lg px-3 py-2 text-center text-sm font-bold ${isSignUp ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
                >
                  Create account
                </Link>
              </div>

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
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
                    required
                    minLength={8}
                  />
                </div>

                {isSignUp && (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-confirm-password">Confirm password</label>
                    <input
                      id="auth-confirm-password"
                      className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat your password"
                      required
                      minLength={8}
                    />
                  </div>
                )}

                {isSignUp && (
                  <div>
                    <div ref={turnstileContainerRef} className="cf-turnstile" />
                    {captchaExpired && (
                      <p className="mt-1 text-xs text-stone-500">CAPTCHA expired. Please verify again.</p>
                    )}
                  </div>
                )}

                {error && (
                  <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || (isSignUp && !captchaToken)}
                  className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-stone-500">
          <Link to="/" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Back to the Greater Lansing beta</Link>
        </p>
      </main>
    </div>
  )
}
