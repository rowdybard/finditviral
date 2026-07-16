import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { activeMarket } from '../lib/market'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export type ViewerLocationSource = 'profile' | 'market'

type ViewerLocation = {
  zipCode: string
  source: ViewerLocationSource
  loading: boolean
}

const ViewerLocationContext = createContext<ViewerLocation | undefined>(undefined)

function isZipCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{5}$/.test(value)
}

export function ViewerLocationProvider({ children }: { children: ReactNode }) {
  const { user, authStatus } = useAuth()
  const [location, setLocation] = useState<ViewerLocation>({
    zipCode: activeMarket.defaultZip,
    source: 'market',
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    if (authStatus === 'initializing') {
      setLocation((current) => ({ ...current, loading: true }))
      return () => { cancelled = true }
    }

    if (!user) {
      setLocation({ zipCode: activeMarket.defaultZip, source: 'market', loading: false })
      return () => { cancelled = true }
    }

    setLocation((current) => ({ ...current, loading: true }))
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('profile_locations')
          .select('zip_code')
          .eq('user_id', user.id)
          .maybeSingle()
        if (cancelled) return
        const zipCode = data && isZipCode(data.zip_code) ? data.zip_code : activeMarket.defaultZip
        if (error) console.warn(JSON.stringify({ event: 'viewer_location_load_failed' }))
        setLocation({
          zipCode,
          source: isZipCode(data?.zip_code) ? 'profile' : 'market',
          loading: false,
        })
      } catch {
        if (cancelled) return
        console.warn(JSON.stringify({ event: 'viewer_location_load_failed' }))
        setLocation({ zipCode: activeMarket.defaultZip, source: 'market', loading: false })
      }
    })()

    return () => { cancelled = true }
  }, [authStatus, user?.id])

  const value = useMemo(() => location, [location])
  return <ViewerLocationContext.Provider value={value}>{children}</ViewerLocationContext.Provider>
}

export function useViewerLocation(): ViewerLocation {
  const context = useContext(ViewerLocationContext)
  if (!context) throw new Error('useViewerLocation must be used within ViewerLocationProvider')
  return context
}
