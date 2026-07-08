import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import Auth from './pages/Auth'
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
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/trends/:slug" element={<TrendPage />} />
        <Route path="/products/:slug" element={<ProductPage />} />
        <Route path="/bounties" element={<Bounties />} />
        <Route path="/bounties/new" element={<ProtectedRoute><NewBounty /></ProtectedRoute>} />
        <Route path="/bounties/:id" element={<BountyDetail />} />
        <Route path="/sightings" element={<Sightings />} />
        <Route path="/sightings/new" element={<ProtectedRoute><NewSighting /></ProtectedRoute>} />
        <Route path="/profile/:username" element={<Profile />} />
      </Routes>
    </Layout>
  )
}
