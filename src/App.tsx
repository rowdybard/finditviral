import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { applyPageMetadata, getPageMetadata } from './lib/pageMetadata'
import { trackPageView } from './lib/analytics'
import EarlyAccess from './pages/EarlyAccess'
import Privacy from './pages/Privacy'

const PrivateApp = lazy(() => import('./PrivateApp'))

export default function App() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyPageMetadata(document, getPageMetadata(pathname))
    trackPageView(pathname)
  }, [pathname])

  return (
    <Routes>
      <Route path="/" element={<EarlyAccess />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route
        path="*"
        element={
          <Suspense fallback={<div className="min-h-screen bg-stone-50" aria-label="Loading" />}>
            <PrivateApp />
          </Suspense>
        }
      />
    </Routes>
  )
}
