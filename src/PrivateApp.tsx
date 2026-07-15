import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import Admin from './pages/Admin'
import Bounties from './pages/Bounties'
import BountyDetail from './pages/BountyDetail'
import Home from './pages/Home'
import Drafts from './pages/Drafts'
import NewBounty from './pages/NewBounty'
import NewLead from './pages/NewLead'
import NewSighting from './pages/NewSighting'
import Onboarding from './pages/Onboarding'
import Profile from './pages/Profile'
import Sightings from './pages/Sightings'
import TrendPage from './pages/TrendPage'
import { buildOnboardingPath, locationReturnPath } from './lib/authReturn'

function OnboardingRedirect({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading || !user) return <>{children}</>
  const needsOnboarding = !profile || !profile.onboarding_completed
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to={buildOnboardingPath(locationReturnPath(location))} replace />
  }
  return <>{children}</>
}

export default function PrivateApp() {
  return (
    <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="*" element={
          <ProtectedRoute>
            <Layout>
              <OnboardingRedirect>
                <Routes>
                  <Route path="/home" element={<Home />} />
                  <Route path="/trends/:slug" element={<TrendPage />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/drafts" element={<Drafts />} />
                  <Route path="/bounties" element={<Bounties />} />
                  <Route path="/bounties/new" element={<NewBounty />} />
                  <Route path="/bounties/:id" element={<BountyDetail />} />
                  <Route path="/sightings" element={<Sightings />} />
                  <Route path="/sightings/new" element={<NewSighting />} />
                  <Route path="/leads/new" element={<NewLead />} />
                  <Route path="/profile/:username" element={<Profile />} />
                  <Route path="*" element={<Navigate to="/home" replace />} />
                </Routes>
              </OnboardingRedirect>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
  )
}
