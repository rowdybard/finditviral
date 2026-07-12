import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5 font-bold text-white focus:outline-none focus:ring-2 focus:ring-brand-300">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-stone-50">
              <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            </span>
            FindItViral
          </Link>
          <Link to="/" className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            Back to early access
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-300">Privacy</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">A short, plain-English privacy notice</h1>
        <p className="mt-4 text-sm text-stone-400">Last updated July 11, 2026</p>

        <div className="mt-10 space-y-9 text-base leading-7 text-stone-300">
          <section>
            <h2 className="text-xl font-semibold text-white">What we collect</h2>
            <p className="mt-2">
              When you join the early-access list, we store the email address you provide and your answer about what you are trying to find. Our hosting and database providers may also process standard technical information, such as an IP address, to deliver and protect the site.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">How we use it</h2>
            <p className="mt-2">
              We use your submission to understand early interest, improve FindItViral, and contact you about product access. We do not sell your information or use it for unrelated advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Who processes it</h2>
            <p className="mt-2">
              Cloudflare hosts the site and Supabase stores waitlist submissions. They process information on our behalf under their own security and privacy terms. We do not otherwise share waitlist data unless required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Retention and your choices</h2>
            <p className="mt-2">
              Waitlist submissions expire after 24 months unless they are still needed for an active early-access relationship. Every launch email will include a way to opt out or request deletion. If you never receive an email, the submission will expire automatically.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-stone-400">
        FindItViral &middot; Building a better way to find the hard-to-find.
      </footer>
    </div>
  )
}
