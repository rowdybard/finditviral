import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import FontPicker from '../components/FontPicker'
import TurnstileWidget, { resetTurnstile } from '../components/TurnstileWidget'
import {
  EarlyAccessConfigurationError,
  EarlyAccessRateLimitError,
  EarlyAccessVerificationError,
  getTurnstileSiteKey,
  submitEarlyAccess,
} from '../lib/earlyAccess'

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

function getSubmitErrorMessage(error: unknown): string {
  if (error instanceof EarlyAccessConfigurationError) {
    return 'Early access is temporarily unavailable. Please check back shortly.'
  }
  if (error instanceof EarlyAccessVerificationError) {
    return 'The quick human check did not go through. Please complete it and try again.'
  }
  if (error instanceof EarlyAccessRateLimitError) {
    return 'That is a few tries in a row. Please wait a few minutes and try again.'
  }
  return 'We could not save your request. Please try again in a moment.'
}

export default function EarlyAccess() {
  const formPanelRef = useRef<HTMLDivElement>(null)
  const formHeadingRef = useRef<HTMLHeadingElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<SubmissionState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileUnavailable, setTurnstileUnavailable] = useState(false)
  const turnstileSiteKey = getTurnstileSiteKey()

  useEffect(() => {
    if (status === 'success') successHeadingRef.current?.focus()
  }, [status])

  function scrollToForm() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    formPanelRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    })
    window.requestAnimationFrame(() => formHeadingRef.current?.focus())
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (website) {
      setStatus('success')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedReason = reason.trim()

    if (!normalizedEmail || normalizedReason.length < 10) {
      setErrorMessage('Please add your email and a little more about what you hope to find.')
      setStatus('error')
      return
    }

    if (!turnstileToken) {
      setErrorMessage('Please complete the quick human check above the button.')
      setStatus('error')
      return
    }

    setStatus('submitting')
    setErrorMessage('')

    try {
      await submitEarlyAccess(normalizedEmail, normalizedReason, turnstileToken)
      setEmail('')
      setReason('')
      setStatus('success')
    } catch (error) {
      setErrorMessage(getSubmitErrorMessage(error))
      setStatus('error')
    } finally {
      setTurnstileToken(null)
      resetTurnstile()
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
          Early access
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:px-12 lg:py-20">
        <section className="max-w-2xl" aria-labelledby="early-access-title">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-brand-700">
            The hunt gets easier
          </p>
          <h1 id="early-access-title" className="max-w-xl text-5xl font-extrabold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl">
            Find what everyone else <span className="text-brand-600">missed</span>.
          </h1>
          <div className="mt-8 max-w-xl space-y-5 text-base leading-7 text-stone-600 sm:text-lg sm:leading-8">
            <p>
              FindItViral is a better way to track down the products that disappear overnight. Tell us what you are looking for, where you are searching, and let the right local sighting reach you before another sold-out trip.
            </p>
            <p>
              We are keeping the product private while we make it genuinely useful. Join the early-access list if you want to help shape the first release and be among the first invited in.
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToForm}
            className={`mt-9 inline-flex items-center gap-2 rounded-lg border-2 border-stone-900 bg-brand-500 px-5 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_#1c1917] focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50 motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0`}
          >
            Sign up for early access
            <span aria-hidden="true">&rarr;</span>
          </button>
        </section>

        <section
          ref={formPanelRef}
          aria-labelledby="early-access-form-title"
          className="rounded-2xl border-2 border-stone-900 bg-white p-6 shadow-[8px_8px_0_0_#1c1917] sm:p-8"
        >
          {status === 'success' ? (
            <div role="status" aria-live="polite" className="py-8 text-center">
              <div aria-hidden="true" className={`mx-auto grid h-14 w-14 rotate-3 place-items-center rounded-xl border-2 border-stone-900 bg-brand-400 text-2xl font-bold text-stone-950 ${TOY_SHADOW_SM}`}>
                &#10003;
              </div>
              <h2
                id="early-access-form-title"
                ref={successHeadingRef}
                tabIndex={-1}
                className="mt-5 rounded text-2xl font-extrabold text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                You are on the list.
              </h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-600">
                Thanks for telling us what matters to you. We will reach out when early access opens.
              </p>
            </div>
          ) : (
            <>
              <h2
                id="early-access-form-title"
                ref={formHeadingRef}
                tabIndex={-1}
                className="rounded text-2xl font-extrabold text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                Get on the early list
              </h2>
              <p id="early-access-form-description" className="mt-2 text-sm leading-6 text-stone-600">
                Tell us what you are trying to find and where you usually look.
              </p>
              <form
                onSubmit={handleSubmit}
                aria-busy={status === 'submitting'}
                aria-describedby="early-access-form-description"
                className="mt-6 space-y-5"
              >
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="company-website">Website</label>
                  <input
                    id="company-website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="early-access-email">
                    Email address
                  </label>
                  <input
                    id="early-access-email"
                    className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    maxLength={320}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="early-access-reason">
                    What are you trying to find&mdash;and where?
                  </label>
                  <textarea
                    id="early-access-reason"
                    className="min-h-32 w-full resize-y rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="The products you want, the stores you check, and what would make the hunt easier."
                    required
                    minLength={10}
                    maxLength={1200}
                  />
                </div>
                {turnstileSiteKey && !turnstileUnavailable ? (
                  <div className="min-h-[65px]">
                    <TurnstileWidget
                      siteKey={turnstileSiteKey}
                      onToken={setTurnstileToken}
                      onUnavailable={() => setTurnstileUnavailable(true)}
                    />
                  </div>
                ) : (
                  <p className="rounded-lg border-2 border-stone-200 bg-stone-100 px-3 py-2 text-sm text-stone-600">
                    The signup check could not load. Please refresh the page to try again.
                  </p>
                )}
                {status === 'error' && (
                  <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                    {errorMessage}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_#1c1917] focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0`}
                >
                  {status === 'submitting' ? 'Saving your spot...' : 'Sign up for early access'}
                </button>
              </form>
              <p className="mt-4 text-xs leading-5 text-stone-500">
                We only use this to evaluate and follow up about FindItViral early access. Read our{' '}
                <Link to="/privacy" className="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900">
                  privacy notice
                </Link>.
              </p>
            </>
          )}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl border-t-2 border-stone-200 px-5 py-5 text-xs text-stone-500 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>FindItViral &middot; Building a better way to find the hard-to-find.</span>
          <span className="flex flex-wrap items-center gap-4">
            <FontPicker />
            <a href="mailto:contact@finditviral.com" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">
              contact@finditviral.com
            </a>
            <Link to="/privacy" className="font-medium text-stone-700 underline-offset-4 hover:text-stone-900 hover:underline">
              Privacy
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
