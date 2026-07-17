import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom'
import { applyPageMetadata, getPageMetadata } from './lib/pageMetadata'
import { trackPageView } from './lib/analytics'
import EarlyAccess from './pages/EarlyAccess'
import LeadDetail from './pages/LeadDetail'
import NewLead from './pages/NewLead'
import Privacy from './pages/Privacy'
import ProductPage from './pages/ProductPage'
import Products from './pages/Products'
import StorePage from './pages/StorePage'
import Stores from './pages/Stores'
import CatalogLayout from './components/CatalogLayout'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { OnboardingRedirect } from './PrivateApp'
import { useAuth } from './contexts/AuthContext'
import { getPasswordRecoveryRoute, isPasswordRecoveryCallback } from './lib/authEntry'

const PrivateApp = lazy(() => import('./PrivateApp'))

function LeadSlugRoute() {
  const { slug } = useParams()
  if (slug === 'new') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-stone-50" aria-label="Loading" />}>
        <ProtectedRoute>
          <Layout>
            <OnboardingRedirect>
              <NewLead />
            </OnboardingRedirect>
          </Layout>
        </ProtectedRoute>
      </Suspense>
    )
  }
  return <CatalogLayout><LeadDetail /></CatalogLayout>
}

export default function App() {
  const { pathname, search, hash } = useLocation()
  const { passwordRecovery } = useAuth()
  const recoveryCallback = isPasswordRecoveryCallback(search, hash)
  const recoveryRoute = getPasswordRecoveryRoute(
    passwordRecovery || recoveryCallback,
    pathname,
    hash,
  )

  useEffect(() => {
    applyPageMetadata(document, getPageMetadata(pathname))
    trackPageView(pathname)
  }, [pathname])

  if (recoveryRoute) return <Navigate to={recoveryRoute} replace />

  return (
    <Routes>
      <Route path="/" element={<EarlyAccess />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/products" element={<CatalogLayout><Products /></CatalogLayout>} />
      <Route path="/products/:slug" element={<CatalogLayout><ProductPage /></CatalogLayout>} />
      <Route path="/stores" element={<CatalogLayout><Stores /></CatalogLayout>} />
      <Route path="/stores/:slug" element={<CatalogLayout><StorePage /></CatalogLayout>} />
      <Route path="/leads/:slug" element={<LeadSlugRoute />} />
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
