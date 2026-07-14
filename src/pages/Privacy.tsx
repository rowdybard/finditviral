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
        <p className="mt-4 text-sm text-stone-500">Last updated July 13, 2026</p>

        <div className="mt-10 space-y-9 text-base leading-7 text-stone-600">
          <section>
            <h2 className="text-xl font-bold text-stone-900">What we collect</h2>
            <p className="mt-2">
              When you create an account, we store your email address, username, ZIP code, location preferences, optional product interests and contact details, bounties, sightings, and related activity. If you request beta updates, we also store the email address and reason you provide. Our hosting, verification, and analytics providers may process standard technical information such as an IP address, browser details, and page activity to deliver, protect, and understand use of the site.
            </p>
            <p className="mt-3">
              When you open a product from a trend page, FiV Heat uses a random 30-day first-party browser identifier to avoid counting the same product repeatedly. We turn that identifier into a product-specific one-way key before it reaches Supabase; we do not store the raw identifier, your account ID, email address, IP address, or browser details with the product-open total.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">How we use it</h2>
            <p className="mt-2">
              We use your information to provide the service — showing nearby sightings and bounties, connecting finders with bounty posters, securing accounts, and improving FindItViral. Contact details are private except when needed to connect the two parties after a bounty claim is accepted. We do not sell your information or use it for unrelated advertising.
            </p>
            <p className="mt-3">
              FiV Heat turns aggregate product opens into a smoothed relative-interest score, so a few early clicks do not overwhelm the comparison. The same browser-and-product pair can count again only after six hours.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">Who processes it</h2>
            <p className="mt-2">
              Cloudflare hosts the site and provides Turnstile bot verification, Supabase stores early-access and account data, and Google Analytics measures page visits and successful early-access submissions. These providers process information on our behalf under their own security and privacy terms. Browser privacy tools or blockers may prevent analytics from loading. We do not sell your information or otherwise share it unless required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-stone-900">Retention and your choices</h2>
            <p className="mt-2">
              Beta-update requests expire after two years and may be removed sooner when they are no longer needed. You can request deletion of your update request or account data at any time by emailing us. Account and community content may be retained as needed to operate and secure the service.
            </p>
            <p className="mt-3">
              The FiV Heat browser identifier expires after 30 days. Product-specific deduplication keys expire after six hours and are removed when later FiV Heat activity runs the cleanup, while aggregate product-open totals are retained to calculate relative interest.
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
