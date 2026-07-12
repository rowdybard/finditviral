import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  EarlyAccessConfigurationError,
  submitEarlyAccess,
} from '../lib/earlyAccess'

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error'

export default function EarlyAccess() {
  const formPanelRef = useRef<HTMLDivElement>(null)
  const formHeadingRef = useRef<HTMLHeadingElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<SubmissionState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

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

    setStatus('submitting')
    setErrorMessage('')

    try {
      await submitEarlyAccess(normalizedEmail, normalizedReason)
      setEmail('')
      setReason('')
      setStatus('success')
    } catch (error) {
      setErrorMessage(
        error instanceof EarlyAccessConfigurationError
          ? 'Early access is temporarily unavailable. Please check back shortly.'
          : 'We could not save your request. Please try again in a moment.',
      )
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-stone-950 text-stone-100">
      <div className="relative isolate flex min-h-screen flex-col">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_72%_15%,rgba(249,115,22,0.36),transparent_28rem),radial-gradient(circle_at_15%_6%,rgba(254,215,170,0.16),transparent_24rem)]"
        />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white focus:outline-none focus:ring-2 focus:ring-brand-300">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-stone-50 shadow-lg shadow-brand-500/20">
              <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            </span>
            FindItViral
          </Link>
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-stone-300">
            Early access
          </span>
        </header>

        <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:px-12 lg:py-20">
          <section className="max-w-2xl" aria-labelledby="early-access-title">
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.22em] text-brand-300">
              The hunt gets easier
            </p>
            <h1 id="early-access-title" className="max-w-xl text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
              Find what everyone else missed.
            </h1>
            <div className="mt-8 max-w-xl space-y-5 text-base leading-7 text-stone-300 sm:text-lg sm:leading-8">
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
              className="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand-400 px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg shadow-brand-500/25 transition hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 focus:ring-offset-stone-950"
            >
              Sign up for early access
              <span aria-hidden="true">&rarr;</span>
            </button>
          </section>

          <section
            ref={formPanelRef}
            aria-labelledby="early-access-form-title"
            className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8"
          >
            {status === 'success' ? (
              <div role="status" aria-live="polite" className="py-8 text-center">
                <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-500/20 text-xl text-brand-300">
                  &#10003;
                </div>
                <h2 ref={successHeadingRef} tabIndex={-1} className="mt-5 text-2xl font-bold text-white focus:outline-none">
                  You are on the list.
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-300">
                  Thanks for telling us what matters to you. We will reach out when early access opens.
                </p>
              </div>
            ) : (
              <>
                <h2
                  id="early-access-form-title"
                  ref={formHeadingRef}
                  tabIndex={-1}
                  className="text-2xl font-bold text-white focus:outline-none"
                >
                  Get on the early list
                </h2>
                <p id="early-access-form-description" className="mt-2 text-sm leading-6 text-stone-300">
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
                    <label className="mb-2 block text-sm font-medium text-stone-100" htmlFor="early-access-email">
                      Email address
                    </label>
                    <input
                      id="early-access-email"
                      className="w-full rounded-xl border border-white/15 bg-stone-950/50 px-3.5 py-3 text-base text-white placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
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
                    <label className="mb-2 block text-sm font-medium text-stone-100" htmlFor="early-access-reason">
                      What are you trying to find&mdash;and where?
                    </label>
                    <textarea
                      id="early-access-reason"
                      className="min-h-32 w-full resize-y rounded-xl border border-white/15 bg-stone-950/50 px-3.5 py-3 text-base text-white placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="The products you want, the stores you check, and what would make the hunt easier."
                      required
                      minLength={10}
                      maxLength={1200}
                    />
                  </div>
                  {status === 'error' && (
                    <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">
                      {errorMessage}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full rounded-xl bg-brand-400 px-4 py-3 text-sm font-semibold text-stone-950 transition hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === 'submitting' ? 'Saving your spot...' : 'Sign up for early access'}
                  </button>
                </form>
                <p className="mt-4 text-xs leading-5 text-stone-400">
                  We only use this to evaluate and follow up about FindItViral early access. Read our{' '}
                  <Link to="/privacy" className="font-medium text-stone-300 underline underline-offset-2 hover:text-white">
                    privacy notice
                  </Link>.
                </p>
              </>
            )}
          </section>
        </main>

        <footer className="mx-auto w-full max-w-6xl border-t border-white/10 px-5 py-5 text-xs text-stone-400 sm:px-8 lg:px-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>FindItViral &middot; Building a better way to find the hard-to-find.</span>
            <Link to="/privacy" className="font-medium text-stone-300 underline-offset-4 hover:text-white hover:underline">
              Privacy
            </Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
