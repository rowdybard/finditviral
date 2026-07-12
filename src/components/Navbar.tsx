import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Navbar() {
  const { user, profile, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link to="/home" className="flex items-center gap-2 font-bold text-brand-600">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="text-lg">FindItViral</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink
            to="/bounties"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            Bounties
          </NavLink>
          <NavLink
            to="/sightings"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            Sightings
          </NavLink>
          {user ? (
            <div className="flex items-center gap-2">
              {profile?.username ? (
                <Link
                  to={`/profile/${profile.username}`}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  {profile.username}
                </Link>
              ) : (
                <span className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-400">
                  Profile
                </span>
              )}
              <button onClick={signOut} className="btn-ghost px-3 py-1.5 text-sm">
                Logout
              </button>
            </div>
          ) : (
            <Link to="/auth" className="btn-primary px-3 py-1.5 text-sm">
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
