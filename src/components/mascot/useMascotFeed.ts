import { useEffect, useRef, useState, useCallback } from 'react'
import { listPublicBounties, listPublicSightings } from '../../lib/launchApi'
import type { MascotNotification } from './MascotBubble'

const POLL_INTERVAL = 30_000

const HISTORY_LIMIT = 20

export function useMascotFeed({ muted = false }: { muted?: boolean } = {}) {
  const [queue, setQueue] = useState<MascotNotification[]>([])
  const [history, setHistory] = useState<MascotNotification[]>([])
  const [unread, setUnread] = useState(0)
  const lastSeenRef = useRef<string>(new Date().toISOString())
  const mountedRef = useRef(true)
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  useEffect(() => {
    mountedRef.current = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (!mountedRef.current) return

      const since = lastSeenRef.current

      const [sightingsRes, bountiesRes] = await Promise.all([
        listPublicSightings({ limit: 10 }),
        listPublicBounties({ limit: 10 }),
      ])

      if (!mountedRef.current) return

      const newNotifs: MascotNotification[] = []
      const newSightings = (sightingsRes.data ?? []).filter((sighting) => sighting.created_at > since).slice(0, 3)
      const newBounties = (bountiesRes.data ?? []).filter((bounty) => bounty.created_at > since).slice(0, 3)

      for (const s of newSightings) {
        const productName = s.product_name ?? 'a product'
        const productSlug = s.product_slug ?? ''
        const storeName = s.store_name ?? 'a store'
        newNotifs.push({
          id: `sighting-${s.id}`,
          type: 'sighting',
          title: productName,
          subtitle: `Spotted at ${storeName}`,
          link: `/products/${productSlug}`,
        })
      }

      for (const b of newBounties) {
        const productName = b.product_name ?? 'a product'
        const reward = b.reward_cents
          ? ` $${(b.reward_cents / 100).toFixed(0)} reward`
          : ''
        const location = b.store_name ?? `ZIP ${b.zip_code ?? '48910'}`
        newNotifs.push({
          id: `bounty-${b.id}`,
          type: 'bounty',
          title: productName,
          subtitle: `Bounty posted${reward} — ${location}`,
          link: `/bounties/${b.id}`,
        })
      }

      newNotifs.sort((a, b) => a.id.localeCompare(b.id))

      const newest = [...newSightings, ...newBounties]
        .map((item) => item.created_at)
        .sort()
        .at(-1)
      if (newest) {
        lastSeenRef.current = newest
      }

      if (newNotifs.length > 0) {
        setHistory((prev) => [...newNotifs, ...prev].slice(0, HISTORY_LIMIT))
        setUnread((u) => u + newNotifs.length)
        if (!mutedRef.current) {
          setQueue((prev) => [...prev, ...newNotifs])
        }
      }

      timer = setTimeout(poll, POLL_INTERVAL)
    }

    timer = setTimeout(poll, POLL_INTERVAL)

    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [])

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
