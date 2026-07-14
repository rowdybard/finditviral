import { useEffect, useRef } from 'react'
import type { MascotNotification } from './MascotBubble'

const FLASH_INTERVAL = 1000

export function useTabFlash(current: MascotNotification | null) {
  const unseenRef = useRef(0)
  const lastTypeRef = useRef<MascotNotification['type']>('sighting')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const originalTitleRef = useRef('')
  const showingAlertRef = useRef(false)
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    function stopFlashing() {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (showingAlertRef.current) {
        document.title = originalTitleRef.current
        showingAlertRef.current = false
      }
      unseenRef.current = 0
    }

    function onVisibilityChange() {
      if (!document.hidden) stopFlashing()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopFlashing()
    }
  }, [])

  useEffect(() => {
    if (!current || !document.hidden) return
    if (seenIdsRef.current.has(current.id)) return
    seenIdsRef.current.add(current.id)

    unseenRef.current += 1
    lastTypeRef.current = current.type

    if (!timerRef.current) {
      originalTitleRef.current = document.title
      timerRef.current = setInterval(() => {
        if (showingAlertRef.current) {
          document.title = originalTitleRef.current
          showingAlertRef.current = false
        } else {
          const label =
            lastTypeRef.current === 'sighting' ? 'New Sighting!' : 'New Bounty!'
          document.title = `(${unseenRef.current}) ${label}`
          showingAlertRef.current = true
        }
      }, FLASH_INTERVAL)
    }
  }, [current])
}
