import { Navigate, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import OwnerGate from './components/OwnerGate'
import EarlyAccess from './pages/EarlyAccess'
import Home from './pages/Home'
import TrendPage from './pages/TrendPage'
import ProductPage from './pages/ProductPage'
import Bounties from './pages/Bounties'
import NewBounty from './pages/NewBounty'
import BountyDetail from './pages/BountyDetail'
import Sightings from './pages/Sightings'
import NewSighting from './pages/NewSighting'
import Profile from './pages/Profile'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EarlyAccess />} />
      <Route
        path="*"
        element={
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
        }
      />
    </Routes>
  )
}
