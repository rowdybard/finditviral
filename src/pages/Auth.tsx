import { Eye, EyeSlash } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { trackEvent } from '../lib/analytics'
import { mapAuthError } from '../lib/errorMap'
import { buildAuthPath, buildOnboardingPath, sanitizeReturnPath } from '../lib/authReturn'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export default function Auth() {
  const { signIn, signUp, passwordRecovery, requestPasswordReset, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSignUp = searchParams.get('mode') === 'signup'
  const isForgot = searchParams.get('mode') === 'forgot'
  const returnTo = sanitizeReturnPath(searchParams.get('returnTo'))
  const signInPath = buildAuthPath(returnTo)
  const signUpPath = buildAuthPath(returnTo, 'signup')
  const forgotPath = `/auth?mode=forgot${returnTo !== '/home' ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`
  const onboardingPath = buildOnboardingPath(returnTo)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [captchaExpired, setCaptchaExpired] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendSent, setResendSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [passwordUpdated, setPasswordUpdated] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)
  const submittingRef = useRef(false)
  const pendingActionRef = useRef<((token: string) => Promise<void>) | null>(null)

  function resetTurnstile() {
    const ts = window.turnstile
    if (turnstileWidgetId.current && ts) {
      ts.reset(turnstileWidgetId.current)
    }
  }

  const showCaptcha = !isForgot && !passwordRecovery && !confirmationPending

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !showCaptcha) return
    let cancelled = false

    function renderWidget() {
      const ts = window.turnstile
      if (!turnstileContainerRef.current || !ts || cancelled) return
      if (turnstileWidgetId.current) {
        ts.remove(turnstileWidgetId.current)
      }
      turnstileWidgetId.current = ts.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        execution: 'execute',
        appearance: 'always',
        callback: (token: string) => {
          const action = pendingActionRef.current
          pendingActionRef.current = null
          if (action) void action(token)
        },
        'expired-callback': () => {
          pendingActionRef.current = null
          submittingRef.current = false
          setLoading(false)
          setCaptchaExpired(true)
        },
        'error-callback': () => {
          pendingActionRef.current = null
          submittingRef.current = false
          setLoading(false)
          setError('CAPTCHA verification failed. Please try again.')
        },
        theme: 'light',
      })
    }

    function loadScript() {
      const ts = window.turnstile
      if (ts) {
        renderWidget()
        return
      }
      const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)
      if (existing) {
        existing.addEventListener('load', renderWidget)
        return
      }
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.onload = () => {
        if (!cancelled) renderWidget()
      }
      document.head.appendChild(script)
    }

    loadScript()

    return () => {
      cancelled = true
      const ts = window.turnstile
      if (turnstileWidgetId.current && ts) {
        ts.remove(turnstileWidgetId.current)
        turnstileWidgetId.current = null
      }
      pendingActionRef.current = null
      submittingRef.current = false
    }
  }, [showCaptcha, isSignUp])

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const { error: resetError } = await requestPasswordReset(normalizedEmail)
    setLoading(false)
    if (resetError) {
      setError(mapAuthError(resetError, true))
      return
    }
    setResetSent(true)
  }

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error: updateError } = await updatePassword(password)
    setLoading(false)
    if (updateError) {
      setError(mapAuthError(updateError, false))
      return
    }
    setPasswordUpdated(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (submittingRef.current) return

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    submittingRef.current = true
    const normalizedEmail = email.trim().toLowerCase()

    if (isSignUp) {
      pendingActionRef.current = async (token: string) => {
        const result = await signUp(normalizedEmail, password, token, returnTo)
        if (result.error) {
          console.error('sign_up error:', result.error)
          setError(mapAuthError(result.error, true))
          resetTurnstile()
          setLoading(false)
          submittingRef.current = false
          return
        }
        trackEvent('sign_up', { method: 'email' })
        if (result.needsEmailConfirmation) {
          setConfirmationPending(true)
          setLoading(false)
          submittingRef.current = false
          return
        }
        navigate(onboardingPath, { replace: true })
      }
    } else {
      pendingActionRef.current = async (token: string) => {
        const { error: signInError } = await signIn(normalizedEmail, password, token)
        if (signInError) {
          console.error('sign_in error:', signInError)
          setError(mapAuthError(signInError, false))
          resetTurnstile()
          setLoading(false)
          submittingRef.current = false
          return
        }
        trackEvent('login', { method: 'email' })
        navigate(returnTo, { replace: true })
      }
    }

    const ts = window.turnstile
    if (TURNSTILE_SITE_KEY && ts && turnstileWidgetId.current) {
      ts.execute(turnstileWidgetId.current)
    } else if (TURNSTILE_SITE_KEY) {
      setError('CAPTCHA verification is not ready. Please refresh the page.')
      setLoading(false)
      submittingRef.current = false
      pendingActionRef.current = null
    } else {
      const action = pendingActionRef.current
      pendingActionRef.current = null
      if (action) await action('')
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
          {confirmationPending ? (
            <div role="status" aria-live="polite" className="py-4 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-green-700 bg-green-50 text-2xl font-bold text-green-700">✓</div>
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Almost there</p>
              <h1 className="mt-2 text-2xl font-extrabold">Check your email</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Open the confirmation link we sent to <strong className="text-stone-800">{email.trim()}</strong>, then finish setting up your Greater Lansing profile.
              </p>
              {resendSent ? (
                <p className="mt-4 text-sm font-medium text-green-700">Confirmation email resent. Check your inbox.</p>
              ) : (
                <button
                  type="button"
                  disabled={resending}
                  onClick={async () => {
                    setResending(true)
                    const { error: resendError } = await supabase.auth.resend({
                      type: 'signup',
                      email: email.trim().toLowerCase(),
                      options: { emailRedirectTo: `${window.location.origin}${onboardingPath}` },
                    })
                    setResending(false)
                    if (resendError) {
                      setError(mapAuthError(resendError.message, true))
                    } else {
                      setResendSent(true)
                    }
                  }}
                  className="mt-4 text-sm font-medium text-brand-700 underline-offset-4 hover:underline disabled:opacity-60"
                >
                  {resending ? 'Resending…' : 'Resend confirmation email'}
                </button>
              )}
              <Link to={signInPath} className={`mt-6 inline-block rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM}`}>
                Back to sign in
              </Link>
            </div>
          ) : isForgot ? (
            <>
              {resetSent ? (
                <div role="status" aria-live="polite" className="py-4 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-green-700 bg-green-50 text-2xl font-bold text-green-700">✓</div>
                  <h1 className="mt-4 text-2xl font-extrabold">Check your email</h1>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    We sent a password reset link to <strong className="text-stone-800">{email.trim()}</strong>. Click the link in the email to set a new password.
                  </p>
                  <Link to={signInPath} className={`mt-6 inline-block rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM}`}>
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Greater Lansing beta</p>
                  <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Reset your password</h1>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Enter your email and we'll send you a link to set a new password.
                  </p>

                  <form onSubmit={handleForgotPassword} className="mt-6 space-y-5">
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

                    {error && (
                      <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {loading ? 'Sending…' : 'Send reset link'}
                    </button>
                  </form>

                  <p className="mt-4 text-center text-sm text-stone-600">
                    <Link to={signInPath} className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Back to sign in</Link>
                  </p>
                </>
              )}
            </>
          ) : passwordRecovery ? (
            <>
              {passwordUpdated ? (
                <div role="status" aria-live="polite" className="py-4 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-green-700 bg-green-50 text-2xl font-bold text-green-700">✓</div>
                  <h1 className="mt-4 text-2xl font-extrabold">Password updated</h1>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Your password has been changed. You can now sign in with your new password.
                  </p>
                  <Link to={signInPath} className={`mt-6 inline-block rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM}`}>
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Greater Lansing beta</p>
                  <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Set a new password</h1>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Choose a new password for your account.
                  </p>

                  <form onSubmit={handleUpdatePassword} className="mt-6 space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-password">New password</label>
                      <div className="relative">
                        <input
                          id="auth-password"
                          className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 pr-11 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="At least 8 characters"
                          required
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-500 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-confirm-password">Confirm password</label>
                      <div className="relative">
                        <input
                          id="auth-confirm-password"
                          className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 pr-11 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Repeat your password"
                          required
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-500 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {loading ? 'Updating…' : 'Update password'}
                    </button>
                  </form>
                </>
              )}
            </>
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
                  to={signInPath}
                  className={`rounded-lg px-3 py-2 text-center text-sm font-bold ${!isSignUp ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
                >
                  Sign in
                </Link>
                <Link
                  to={signUpPath}
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
                  <div className="relative">
                    <input
                      id="auth-password"
                      className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 pr-11 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-500 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                {isSignUp && (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="auth-confirm-password">Confirm password</label>
                    <div className="relative">
                      <input
                        id="auth-confirm-password"
                        className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 pr-11 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Repeat your password"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-500 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  {TURNSTILE_SITE_KEY ? (
                    <div ref={turnstileContainerRef} />
                  ) : (
                    <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">Verification is unavailable.</p>
                  )}
                  {captchaExpired && (
                    <p className="mt-1 text-xs text-stone-500">CAPTCHA expired. Please verify again.</p>
                  )}
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}
                </button>

                {!isSignUp && (
                  <p className="text-center text-sm text-stone-600">
                    <Link to={forgotPath} className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Forgot your password?</Link>
                  </p>
                )}
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
