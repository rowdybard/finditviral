import { Navigate, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { buildAuthPath, locationReturnPath } from '../lib/authReturn'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (!user) return <Navigate to={buildAuthPath(locationReturnPath(location))} replace />
  return <>{children}</>
}
