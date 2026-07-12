import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { captureReferrer } from '../lib/referral'
import { activeMarket } from '../lib/market'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

export default function EarlyAccess() {
  useEffect(() => {
    captureReferrer()
  }, [])

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

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <section className="max-w-2xl text-center" aria-labelledby="early-access-title">
          <h1 id="early-access-title" className="text-5xl font-extrabold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl">
            Find viral products around <span className="text-brand-600">Greater Lansing</span>.
          </h1>
          <div className="mx-auto mt-8 max-w-xl space-y-5 text-base leading-7 text-stone-600 sm:text-lg sm:leading-8">
            <p>
              See what's in stock at stores near you before you make the trip. Post a bounty if you can't find it.
            </p>
          </div>
          <div className="mx-auto mt-7 max-w-xl rounded-xl border-2 border-brand-300 bg-brand-50 px-5 py-4 text-left">
            <p className="text-sm font-bold text-brand-800">Launch special: 3 months free Pro!</p>
            <p className="mt-1 text-sm text-brand-700">
              Sign up during launch and get 3 months of Pro features free. Refer friends and earn up to 9 more months — a full year free.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/auth"
              className={`inline-flex items-center gap-2 rounded-lg border-2 border-stone-900 bg-brand-500 px-6 py-3.5 text-base font-bold text-stone-950 ${TOY_SHADOW} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_#1c1917] focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50 motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0`}
            >
              Create an account
              <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link
              to="/sightings"
              className={`inline-flex items-center gap-2 rounded-lg border-2 border-stone-900 bg-white px-5 py-3.5 text-base font-bold text-stone-900 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50`}
            >
              Browse sightings
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl border-t-2 border-stone-200 px-5 py-5 text-xs text-stone-500 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>FindItViral &middot; {activeMarket.footerTagline}</span>
          <span className="flex flex-wrap items-center gap-4">
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
