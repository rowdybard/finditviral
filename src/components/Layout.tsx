import { type ReactNode } from 'react'
import Navbar from './Navbar'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        FindItViral — Greater Lansing Beta
      </footer>
    </div>
  )
}
