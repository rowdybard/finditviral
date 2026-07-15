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
import PublicCatalogLayout from './components/PublicCatalogLayout'

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
      <Route path="/products/:slug" element={<PublicCatalogLayout><ProductPage /></PublicCatalogLayout>} />
      <Route path="/stores" element={<PublicCatalogLayout><Stores /></PublicCatalogLayout>} />
      <Route path="/stores/:slug" element={<PublicCatalogLayout><StorePage /></PublicCatalogLayout>} />
      <Route path="/leads/new" element={
        <Suspense fallback={<div className="min-h-screen bg-stone-50" aria-label="Loading" />}>
          <PrivateApp />
        </Suspense>
      } />
      <Route path="/leads/:slug" element={<PublicCatalogLayout><LeadDetail /></PublicCatalogLayout>} />
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
