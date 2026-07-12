import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import EarlyAccess from './pages/EarlyAccess'
import Privacy from './pages/Privacy'

const PrivateApp = lazy(() => import('./PrivateApp'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EarlyAccess />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route
        path="*"
        element={
          <Suspense fallback={<div className="min-h-screen bg-stone-950" aria-label="Loading private access" />}>
            <PrivateApp />
          </Suspense>
        }
      />
    </Routes>
  )
}
