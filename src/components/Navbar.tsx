import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import PostMenu from './PostMenu'

export default function Navbar() {
  const { user, profile, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
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
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            Bounties
          </NavLink>
          <NavLink
            to="/sightings"
            className={({ isActive }) =>
              `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            Sightings
          </NavLink>
          {user && (
            <NavLink
              to="/drafts"
              className={({ isActive }) =>
                `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              Drafts
            </NavLink>
          )}
          {user && <PostMenu />}
          {user ? (
            <div className="flex items-center gap-1 sm:gap-2">
              {profile?.username ? (
                <Link
                  to={`/profile/${profile.username}`}
                  className="max-w-[80px] truncate rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 sm:max-w-none sm:px-3"
                >
                  {profile.username}
                </Link>
              ) : (
                <span className="rounded-lg px-2 py-1.5 text-sm font-medium text-gray-400 sm:px-3">
                  Profile
                </span>
              )}
              <button onClick={signOut} className="btn-ghost px-2 py-1.5 text-sm sm:px-3">
                Logout
              </button>
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
