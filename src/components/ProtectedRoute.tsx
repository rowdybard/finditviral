import { Navigate, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { buildAuthPath, buildReauthenticationPath, locationReturnPath } from '../lib/authReturn'
import AuthRecoveryNotice from './AuthRecoveryNotice'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, authStatus, retryAuth } = useAuth()
  const location = useLocation()

  if (authStatus === 'recovering' && !user) {
    return <AuthRecoveryNotice onRetry={retryAuth} />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (!user) {
    const returnTo = locationReturnPath(location)
    const destination = authStatus === 'expired'
      ? buildReauthenticationPath(returnTo)
      : buildAuthPath(returnTo)
    return <Navigate to={destination} replace />
  }
  return <>{children}</>
}
