import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { activeMarket } from '../lib/market'

export default function PublicCatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 w-full max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link to="/" className="flex items-center gap-2 font-bold text-brand-600">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="text-lg">FindItViral</span>
            <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/stores" className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`}>
              Stores
            </NavLink>
            <Link to="/auth" className="btn-primary px-3 py-1.5 text-sm">Join or sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-stone-200 py-5 text-center text-xs text-stone-500">
        FindItViral - {activeMarket.betaLabel} · Community reports can change quickly.
      </footer>
    </div>
  )
}
