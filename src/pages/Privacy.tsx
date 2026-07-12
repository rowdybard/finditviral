import { Link } from 'react-router-dom'
import { activeMarket } from '../lib/market'

const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

export default function Privacy() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <div aria-hidden="true" className="h-1.5 w-full bg-brand-500" />

      <header className="border-b-2 border-stone-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
          <Link to="/" className={`flex items-center gap-2.5 rounded font-extrabold text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 focus:ring-offset-stone-50`}>
            <span className={`grid h-9 w-9 place-items-center rounded-lg border-2 border-stone-900 bg-white ${TOY_SHADOW_SM}`}>
              <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            </span>
            FindItViral
          </Link>
          <Link to="/" className="text-sm font-bold text-brand-700 underline-offset-4 hover:underline">
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Privacy</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-stone-900">A short, plain-English privacy notice</h1>
        <p className="mt-4 text-sm text-stone-500">Last updated July 11, 2026</p>

        <div className="mt-10 space-y-9 text-base leading-7 text-stone-600">
          <section>
            <h2 className="text-xl font-bold text-stone-900">What we collect</h2>
            <p className="mt-2">
              When you create an account, we store your email address, username, ZIP code, and any preferences you share during onboarding. When you post a bounty, report a sighting, or submit a claim, we store the details you provide. If you add contact info for bounty coordination, it is stored separately and only revealed to the other party when a claim is accepted. Our hosting and database providers may also process standard technical information, such as an IP address, to deliver and protect the site.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">How we use it</h2>
            <p className="mt-2">
              We use your information to provide the service — showing nearby sightings and bounties, connecting finders with bounty posters, and improving FindItViral. We do not sell your information or use it for unrelated advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">Who processes it</h2>
            <p className="mt-2">
              Cloudflare hosts the site and Supabase stores account and content data. They process information on our behalf under their own security and privacy terms. We do not otherwise share your data unless required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">Retention and your choices</h2>
            <p className="mt-2">
              You can delete your account or request data deletion at any time by emailing us. Bounties, sightings, and claims you have posted may be retained as needed for the service. If you refer friends, referral data is kept only as long as needed to track your referral rewards.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">Contact</h2>
            <p className="mt-2">
              Questions about this notice or your account? Email{' '}
              <a href="mailto:contact@finditviral.com" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800">
                contact@finditviral.com
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t-2 border-stone-200 py-6 text-center text-xs text-stone-500">
        FindItViral &middot; {activeMarket.betaLabel}
      </footer>
    </div>
  )
}
