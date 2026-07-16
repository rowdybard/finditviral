import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { getAdminReviewCounts, isAppOwner } from '../lib/launchApi'
import type { AdminReviewCounts } from '../types/database'

const EMPTY_COUNTS: AdminReviewCounts = {
  pending_product_suggestions: 0,
  pending_store_suggestions: 0,
  pending_sightings: 0,
  pending_bounties: 0,
  pending_leads: 0,
  total: 0,
}

type AdminReviewContextValue = {
  owner: boolean | null
  counts: AdminReviewCounts
  refresh: () => Promise<void>
}

const AdminReviewContext = createContext<AdminReviewContextValue | null>(null)

export function AdminReviewProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [owner, setOwner] = useState<boolean | null>(null)
  const [counts, setCounts] = useState<AdminReviewCounts>(EMPTY_COUNTS)

  const refresh = useCallback(async () => {
    if (!user || owner !== true) return
    const result = await getAdminReviewCounts()
    if (result.error || !result.data) {
      console.error(JSON.stringify({ event: 'admin_review_counts_failed', code: result.error?.code ?? 'empty_response' }))
      return
    }
    setCounts(result.data)
  }, [owner, user])

  useEffect(() => {
    let active = true
    setCounts(EMPTY_COUNTS)
    if (!user) {
      setOwner(false)
      return () => { active = false }
    }
    setOwner(null)
    void isAppOwner().then(async (result) => {
      if (!active) return
      const nextOwner = !result.error && result.data === true
      setOwner(nextOwner)
      if (!nextOwner) return
      const countsResult = await getAdminReviewCounts()
      if (!active) return
      if (countsResult.error || !countsResult.data) {
        console.error(JSON.stringify({ event: 'admin_review_counts_failed', code: countsResult.error?.code ?? 'empty_response' }))
        return
      }
      setCounts(countsResult.data)
    })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (owner !== true) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(onVisible, 60_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [owner, refresh])

  return (
    <AdminReviewContext.Provider value={{ owner, counts, refresh }}>
      {children}
    </AdminReviewContext.Provider>
  )
}

export function useAdminReview() {
  const value = useContext(AdminReviewContext)
  if (!value) throw new Error('useAdminReview must be used within AdminReviewProvider')
  return value
}
