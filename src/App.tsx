import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { applyPageMetadata, getPageMetadata } from './lib/pageMetadata'
import { trackPageView } from './lib/analytics'
import EarlyAccess from './pages/EarlyAccess'
import LeadDetail from './pages/LeadDetail'
import Privacy from './pages/Privacy'
import ProductPage from './pages/ProductPage'
import StorePage from './pages/StorePage'
import Stores from './pages/Stores'
import CatalogLayout from './components/CatalogLayout'

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
      <Route path="/products/:slug" element={<CatalogLayout><ProductPage /></CatalogLayout>} />
      <Route path="/stores" element={<CatalogLayout><Stores /></CatalogLayout>} />
      <Route path="/stores/:slug" element={<CatalogLayout><StorePage /></CatalogLayout>} />
      <Route path="/leads/new/*" element={
        <Suspense fallback={<div className="min-h-screen bg-stone-50" aria-label="Loading" />}>
          <PrivateApp />
        </Suspense>
      } />
      <Route path="/leads/:slug" element={<CatalogLayout><LeadDetail /></CatalogLayout>} />
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
