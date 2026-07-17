import { NavLink, Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAdminReview } from '../contexts/AdminReviewContext'
import { trackEvent } from '../lib/analytics'
import PostMenu from './PostMenu'

export default function Navbar() {
  const { user, profile, signOut } = useAuth()
  const { owner, counts } = useAdminReview()
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!accountOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAccountOpen(false)
      accountButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-2xl flex-wrap items-center justify-between gap-x-2 gap-y-2 px-3 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-4">
        <Link to="/home" className="flex shrink-0 items-center gap-2 font-bold text-brand-600">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="text-lg">FindItViral</span>
          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
        </Link>

        <nav className="relative flex w-full items-center justify-between gap-0.5 border-t border-stone-200 pt-2 sm:w-auto sm:justify-start sm:gap-1 sm:border-t-0 sm:pt-0">
          <NavLink
            to="/bounties"
            className={({ isActive }) =>
              `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'
              }`
            }
          >
            Bounties
          </NavLink>
          <NavLink
            to="/sightings"
            className={({ isActive }) =>
              `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'
              }`
            }
          >
            Sightings
          </NavLink>
          {user && <PostMenu />}
          {user ? (
            <div ref={accountRef} className="absolute right-0 -top-[3.25rem] sm:relative sm:right-auto sm:top-auto">
              <button
                ref={accountButtonRef}
                type="button"
                className="flex min-h-11 max-w-[92px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:max-w-36 sm:px-3"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <span className="truncate">{profile?.username || 'Account'}</span>
                <span aria-hidden="true">▾</span>
              </button>
              {accountOpen && (
                <div role="menu" aria-label="Account" className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border-2 border-stone-900 bg-white p-1.5 shadow-[4px_4px_0_0_#1c1917]">
                  {profile?.username && (
                    <Link role="menuitem" to={`/profile/${profile.username}`} onClick={() => setAccountOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Profile</Link>
                  )}
                  <Link role="menuitem" to="/drafts" onClick={() => { setAccountOpen(false); trackEvent('open_drafts', { source: 'account_menu' }) }} className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span>My Drafts</span>
                  </Link>
                  {owner === true && (
                    <Link role="menuitem" to="/admin?tab=review" onClick={() => { setAccountOpen(false); trackEvent('open_admin_review_queue', { source: 'account_menu' }) }} className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <span>Admin</span>
                      {counts.total > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white" aria-label={`${counts.total} pending reviews`}>{counts.total}</span>}
                    </Link>
                  )}
                  <button role="menuitem" type="button" onClick={() => { setAccountOpen(false); void signOut() }} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Sign Out</button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/auth" className="btn-primary px-2 py-1.5 text-sm sm:px-3">
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
