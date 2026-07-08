import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from './Navbar'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signIn, signOut } = useAuth()
  const navigate = useNavigate()

  async function demoLogin(email: string) {
    await signIn(email, 'demo')
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      {!isSupabaseConfigured && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-amber-800">
              Demo mode — using mock data. Set up Supabase for production.
            </span>
            <div className="flex gap-2">
              {user ? (
                <button onClick={() => signOut()} className="text-xs font-medium text-amber-900 underline">
                  Logout demo
                </button>
              ) : (
                <>
                  <button
                    onClick={() => demoLogin('demo@finditviral.com')}
                    className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    Login as Finder
                  </button>
                  <button
                    onClick={() => demoLogin('poster@finditviral.com')}
                    className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    Login as Poster
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        FindItViral — Bounty & Sighting Tracker
      </footer>
    </div>
  )
}
