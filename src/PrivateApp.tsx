import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import Bounties from './pages/Bounties'
import BountyDetail from './pages/BountyDetail'
import Home from './pages/Home'
import NewBounty from './pages/NewBounty'
import NewSighting from './pages/NewSighting'
import Onboarding from './pages/Onboarding'
import ProductPage from './pages/ProductPage'
import Profile from './pages/Profile'
import Sightings from './pages/Sightings'
import TrendPage from './pages/TrendPage'

function OnboardingRedirect({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading || !user) return <>{children}</>
  const needsOnboarding = !profile || !profile.onboarding_completed
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

export default function PrivateApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="*" element={
          <Layout>
            <OnboardingRedirect>
              <Routes>
                <Route path="/home" element={<Home />} />
                <Route path="/trends/:slug" element={<TrendPage />} />
                <Route path="/products/:slug" element={<ProductPage />} />
                <Route path="/bounties" element={<Bounties />} />
                <Route path="/bounties/new" element={<ProtectedRoute><NewBounty /></ProtectedRoute>} />
                <Route path="/bounties/:id" element={<BountyDetail />} />
                <Route path="/sightings" element={<Sightings />} />
                <Route path="/sightings/new" element={<ProtectedRoute><NewSighting /></ProtectedRoute>} />
                <Route path="/profile/:username" element={<Profile />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </OnboardingRedirect>
          </Layout>
        } />
      </Routes>
    </AuthProvider>
  )
}
