import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Layout from './Layout'
import PublicCatalogLayout from './PublicCatalogLayout'

export default function CatalogLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50" aria-label="Loading" />
    )
  }

  if (user) {
    return <Layout>{children}</Layout>
  }

  return <PublicCatalogLayout>{children}</PublicCatalogLayout>
}
