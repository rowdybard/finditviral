import { type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Mascot from './mascot/Mascot'
import MascotRestoreButton from './mascot/MascotRestoreButton'
import { activeMarket } from '../lib/market'

const WIDE_ROUTES = ['/bounties/new', '/sightings/new', '/leads/new']

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isWide = WIDE_ROUTES.includes(pathname)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className={`flex-1 mx-auto w-full px-4 py-6 ${isWide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</main>
      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        FindItViral — {activeMarket.betaLabel}
        <MascotRestoreButton />
      </footer>
      <Mascot />
    </div>
  )
}
