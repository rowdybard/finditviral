import { useRef, useState, type FormEvent } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type SubmissionState = 'idle' | 'submitting' | 'success' | 'duplicate' | 'error'

export default function EarlyAccess() {
  const formRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<SubmissionState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => document.getElementById('early-access-email')?.focus(), 350)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (website) return

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedReason = reason.trim()

    if (!normalizedEmail || normalizedReason.length < 10) {
      setErrorMessage('Please add your email and a little more about what you hope to find.')
      setStatus('error')
      return
    }

    setStatus('submitting')
    setErrorMessage('')

    const { error } = await supabase
      .from('early_access_requests')
      .insert({ email: normalizedEmail, reason: normalizedReason })

    if (error) {
      if (error.code === '23505') {
        setStatus('duplicate')
        return
      }

      setErrorMessage(
        isSupabaseConfigured
          ? 'Something went wrong while saving your request. Please try again.'
          : 'Early access is not connected in this local preview yet.',
      )
      setStatus('error')
      return
    }

    setEmail('')
    setReason('')
    setStatus('success')
  }

  const hasSubmitted = status === 'success' || status === 'duplicate'

  return (
    <main className="min-h-screen overflow-hidden bg-stone-950 text-stone-100">
      <div className="relative isolate">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_72%_15%,rgba(249,115,22,0.36),transparent_28rem),radial-gradient(circle_at_15%_6%,rgba(254,215,170,0.16),transparent_24rem)]"
        />
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-xl shadow-lg shadow-brand-500/30">
                F
              </span>
              FindItViral
            </div>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-stone-300">
              Private preview
            </span>
          </header>

          <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
            <div className="max-w-2xl">
              <p className="mb-5 text-sm font-semibold uppercase tracking-[0.22em] text-brand-300">
                The hunt gets easier
              </p>
              <h1 className="max-w-xl text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
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
                className="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 focus:ring-offset-stone-950"
              >
                Sign up for early access
                <span aria-hidden="true">&rarr;</span>
              </button>
            </div>

            <div ref={formRef} className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
              {hasSubmitted ? (
                <div className="py-8 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-500/20 text-xl text-brand-300">
                    &#10003;
                  </div>
                  <h2 className="mt-5 text-2xl font-bold text-white">
                    {status === 'duplicate' ? 'You are already on the list.' : 'You are on the list.'}
                  </h2>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-300">
                    {status === 'duplicate'
                      ? 'We already have this email saved for early access. We will be in touch when there is something worth sharing.'
                      : 'Thanks for telling us what matters to you. We will reach out when early access opens.'}
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-white">Get on the early list</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-300">
                    Tell us how FindItViral could make your search easier.
                  </p>
                  <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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
                        className="w-full rounded-xl border border-white/15 bg-stone-950/50 px-3.5 py-3 text-sm text-white placeholder:text-stone-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
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
                      <label className="mb-2 block text-sm font-medium text-stone-100" htmlFor="early-access-reason">
                        What would you use it for?
                      </label>
                      <textarea
                        id="early-access-reason"
                        className="min-h-32 w-full resize-y rounded-xl border border-white/15 bg-stone-950/50 px-3.5 py-3 text-sm text-white placeholder:text-stone-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="The products you are trying to find, the stores you check, or what would make this useful for you."
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
                      className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {status === 'submitting' ? 'Saving your spot...' : 'Sign up for early access'}
                    </button>
                  </form>
                  <p className="mt-4 text-xs leading-5 text-stone-500">
                    We will only use this to follow up about FindItViral early access.
                  </p>
                </>
              )}
            </div>
          </section>

          <footer className="border-t border-white/10 py-5 text-xs text-stone-500">
            FindItViral &middot; Building a better way to find the hard-to-find.
          </footer>
        </div>
      </div>
    </main>
  )
}
