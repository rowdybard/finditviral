import { useCallback, useEffect, useRef, useState } from 'react'
import { getPersonalNotifications } from '../../lib/launchApi'
import type { PersonalNotification } from '../../types/database'
import type { MascotNotification } from './MascotBubble'

const POLL_INTERVAL = 180_000
const HISTORY_LIMIT = 20
const LAST_SEEN_KEY = 'fiv-mascot-last-seen'

function loadLastSeen(): string {
  try {
    const stored = localStorage.getItem(LAST_SEEN_KEY)
    if (stored) return stored
  } catch {
    // ignore
  }
  return new Date(0).toISOString()
}

function mapNotification(n: PersonalNotification): MascotNotification {
  let type: MascotNotification['type'] = 'notification'
  if (n.event_type === 'bounty_claim') {
    type = 'bounty'
  } else if (n.event_type === 'moderation' && n.title.includes('Sighting')) {
    type = 'sighting'
  }
  return {
    id: n.id,
    type,
    title: n.title,
    subtitle: n.subtitle,
    link: n.link,
  }
}

export function useMascotFeed({ muted = false }: { muted?: boolean } = {}) {
  const [queue, setQueue] = useState<MascotNotification[]>([])
  const [history, setHistory] = useState<MascotNotification[]>([])
  const [unread, setUnread] = useState(0)
  const lastSeenRef = useRef<string>(loadLastSeen())
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const poll = useCallback(async () => {
    if (document.hidden) return

    const result = await getPersonalNotifications(20)
    if (result.error || !result.data) return

    const fresh = result.data
      .filter((n) => n.occurred_at > lastSeenRef.current)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 5)

    if (fresh.length === 0) return

    lastSeenRef.current = new Date().toISOString()
    try {
      localStorage.setItem(LAST_SEEN_KEY, lastSeenRef.current)
    } catch {
      // ignore
    }

    const mapped = fresh.map(mapNotification)

    setHistory((prev) => [...mapped, ...prev].slice(0, HISTORY_LIMIT))
    setUnread((u) => u + fresh.length)
    if (!mutedRef.current) {
      setQueue((prev) => [...prev, ...mapped])
    }
  }, [])

  useEffect(() => {
    poll()

    const timer = setInterval(poll, POLL_INTERVAL)

    function onVisibilityChange() {
      if (!document.hidden) poll()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [poll])

  const dequeue = useCallback(() => {
    setQueue((prev) => prev.slice(1))
  }, [])

  const markAllRead = useCallback(() => {
    setUnread(0)
  }, [])

  return {
    current: queue[0] ?? null,
    dequeue,
    queueLength: queue.length,
    history,
    unread,
    markAllRead,
  }
}
