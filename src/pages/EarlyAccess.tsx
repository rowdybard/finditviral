import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import TurnstileWidget from '../components/TurnstileWidget'
import { trackEvent } from '../lib/analytics'
import { activeMarket } from '../lib/market'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'Check your email and tell us a little more about what interests you.',
  verification_required: 'Complete the verification before submitting.',
  verification_failed: 'Verification expired or failed. Please try again.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unavailable: 'Early access is temporarily unavailable. Please try again later.',
}

export default function EarlyAccess() {
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleToken = useCallback((token: string | null) => {
    setTurnstileToken(token)
    if (token) setError(null)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!turnstileToken) {
      setError(ERROR_MESSAGES.verification_required)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          reason: reason.trim(),
          turnstileToken,
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'unavailable' }))
        const code = typeof body?.error === 'string' ? body.error : 'unavailable'
        setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unavailable)
        setTurnstileToken(null)
        setTurnstileResetKey((value) => value + 1)
        return
      }

      trackEvent('generate_lead', { method: 'early_access' })
      setSubmitted(true)
    } catch {
      setError(ERROR_MESSAGES.unavailable)
      setTurnstileToken(null)
      setTurnstileResetKey((value) => value + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <div aria-hidden="true" className="h-1.5 w-full bg-brand-500" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
        <Link to="/" className="flex items-center gap-2.5 rounded text-lg font-extrabold tracking-tight text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50">
          <span className={`grid h-9 w-9 place-items-center rounded-lg border-2 border-stone-900 bg-white ${TOY_SHADOW_SM}`}>
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          </span>
          FindItViral
        </Link>
        <span className={`rotate-2 rounded-md border-2 border-stone-900 bg-brand-100 px-2.5 py-1 text-xs font-bold text-stone-900 ${TOY_SHADOW_SM}`}>
          {activeMarket.betaLabel}
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-12">
        <section aria-labelledby="early-access-title">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Open local beta</p>
          <h1 id="early-access-title" className="mt-3 text-4xl font-extrabold tracking-tight text-stone-900 sm:text-6xl">
            Find viral products around <span className="text-brand-600">{activeMarket.name}</span>.
          </h1>
          <div className="mt-7 max-w-2xl space-y-4 text-base leading-7 text-stone-600 sm:text-lg sm:leading-8">
            <p>
              FindItViral helps local shoppers share recent sightings for viral, limited, and hard-to-find retail products before someone drives across town.
            </p>
            <p>
              We are starting with shoppers around Lansing, East Lansing, Okemos, Holt, and nearby communities. Create an account to browse the local catalog, post what you are hunting, and report what is actually on shelves.
            </p>
            <p>
              The beta is open now to Greater Lansing shoppers. Your reports help make the next person’s trip across town worth it.
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/auth?mode=signup"
              className={`rounded-lg border-2 border-stone-900 bg-brand-500 px-6 py-3.5 text-center text-base font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2`}
            >
              Create a free beta account
            </Link>
            <Link to="/auth" className="px-4 py-3 text-center text-sm font-bold text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">
              Already a member? Sign in
            </Link>
          </div>
        </section>

        <section className={`rounded-2xl border-2 border-stone-900 bg-white p-6 sm:p-8 ${TOY_SHADOW}`} aria-labelledby="join-title">
          {submitted ? (
            <div role="status" aria-live="polite" className="py-8 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-green-700 bg-green-50 text-2xl font-bold text-green-700">✓</div>
              <h2 id="join-title" className="mt-5 text-2xl font-extrabold text-stone-900">You’re on the list.</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Thanks for helping us build the {activeMarket.name} beta. We’ll keep you posted as it grows.</p>
            </div>
          ) : (
            <>
              <h2 id="join-title" className="text-2xl font-extrabold text-stone-900">Get beta updates</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Not ready to make an account? Tell us what you are hunting and we will keep you in the loop.</p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <label htmlFor="early-access-email" className="mb-2 block text-sm font-semibold text-stone-800">Email address</label>
                  <input
                    id="early-access-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>

                <div>
                  <label htmlFor="early-access-reason" className="mb-2 block text-sm font-semibold text-stone-800">Why are you interested?</label>
                  <textarea
                    id="early-access-reason"
                    required
                    minLength={10}
                    maxLength={1200}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="What products are you trying to find, or how would you use FindItViral?"
                    className="min-h-32 w-full resize-y rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <p className="mt-1 text-right text-xs text-stone-400">{reason.length}/1200</p>
                </div>

                {TURNSTILE_SITE_KEY ? (
                  <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} resetKey={turnstileResetKey} onToken={handleToken} />
                ) : (
                  <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">Verification is unavailable.</p>
                )}

                {error && (
                  <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting || !TURNSTILE_SITE_KEY}
                  className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3.5 text-base font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {submitting ? 'Submitting…' : 'Send me beta updates'}
                </button>
              </form>
            </>
          )}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl border-t-2 border-stone-200 px-5 py-5 text-xs text-stone-500 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>FindItViral &middot; {activeMarket.footerTagline}</span>
          <span className="flex flex-wrap items-center gap-4">
            <a href="mailto:contact@finditviral.com" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">contact@finditviral.com</a>
            <Link to="/stores" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Browse verified stores</Link>
            <Link to="/privacy" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">Privacy</Link>
            <Link to="/auth" className="font-medium text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
