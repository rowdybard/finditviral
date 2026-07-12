import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import OwnerGate from './components/OwnerGate'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import Bounties from './pages/Bounties'
import BountyDetail from './pages/BountyDetail'
import Home from './pages/Home'
import NewBounty from './pages/NewBounty'
import NewSighting from './pages/NewSighting'
import ProductPage from './pages/ProductPage'
import Profile from './pages/Profile'
import Sightings from './pages/Sightings'
import TrendPage from './pages/TrendPage'

export default function PrivateApp() {
  return (
    <AuthProvider>
      <OwnerGate>
        <Layout>
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
        </Layout>
      </OwnerGate>
    </AuthProvider>
  )
}
