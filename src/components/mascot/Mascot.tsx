import { useCallback, useEffect, useRef, useState } from 'react'
import MascotSprite, { type MascotMood } from './MascotSprite'
import MascotBubble, { type BubblePlacement, type MascotNotification } from './MascotBubble'
import MascotOnboarding, { hasSeenMascotOnboarding } from './MascotOnboarding'
import MascotPanel from './MascotPanel'
import { useMascotFeed } from './useMascotFeed'
import { useTabFlash } from './useTabFlash'
import { useMascotPrefs } from './mascotPrefs'
import './mascotAnimations.css'

const STORAGE_KEY = 'fiv-mascot-pos'
const WIDTH = 80
const HEIGHT = 100
const SLEEP_AFTER_MS = 120_000
const EDGE_MARGIN = 12
const TOP_MIN = 64
const DRAG_THRESHOLD = 5

type Pos = { x: number; y: number }

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Pos
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampPos(parsed)
      }
    }
  } catch {
    // ignore
  }
  return { x: window.innerWidth - WIDTH - EDGE_MARGIN, y: window.innerHeight - HEIGHT - 80 }
}

function clampPos(pos: Pos): Pos {
  return {
    x: Math.max(EDGE_MARGIN, Math.min(pos.x, window.innerWidth - WIDTH - EDGE_MARGIN)),
    y: Math.max(TOP_MIN, Math.min(pos.y, window.innerHeight - HEIGHT - EDGE_MARGIN)),
  }
}

export default function Mascot() {
  const prefs = useMascotPrefs()
  const { current, dequeue, history, unread, markAllRead } = useMascotFeed({ muted: prefs.muted })
  const [pos, setPos] = useState<Pos>(() => loadPos())
  const [dragging, setDragging] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [mood, setMood] = useState<MascotMood>('idle')
  const [petting, setPetting] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenMascotOnboarding())
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const movedRef = useRef(false)
  const draggingRef = useRef(false)
  const lastActivityRef = useRef(Date.now())

  useTabFlash(current)

  // React to the event type, then quickly return to a quiet idle
  useEffect(() => {
    if (current) {
      lastActivityRef.current = Date.now()
      setMood(current.type === 'bounty' ? 'alert' : 'excited')
      const t = setTimeout(() => setMood('idle'), 2000)
      return () => clearTimeout(t)
    }
  }, [current])

  // Fall asleep after inactivity
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > SLEEP_AFTER_MS) {
        setMood((m) => (m === 'idle' ? 'sleeping' : m))
      }
    }, 15_000)
    return () => clearInterval(timer)
  }, [])

  // Occasional stroll: pace back and forth, then sit back down
  useEffect(() => {
    let startTimer: ReturnType<typeof setTimeout>
    let stopTimer: ReturnType<typeof setTimeout>
    function schedule() {
      startTimer = setTimeout(() => {
        if (draggingRef.current) {
          schedule()
          return
        }
        setMood((m) => (m === 'idle' ? 'walking' : m))
        stopTimer = setTimeout(() => {
          setMood((m) => (m === 'walking' ? 'idle' : m))
          schedule()
        }, 4200)
      }, 15_000 + Math.random() * 20_000)
    }
    schedule()
    return () => {
      clearTimeout(startTimer)
      clearTimeout(stopTimer)
    }
  }, [])

  // Persist position
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
    } catch {
      // ignore
    }
  }, [pos])

  // Reposition on resize
  useEffect(() => {
    function onResize() {
      setPos((prev) => clampPos(prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      const next = !open
      if (next) markAllRead()
      return next
    })
  }, [markAllRead])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    lastActivityRef.current = Date.now()
    setMood((m) => (m === 'sleeping' || m === 'walking' ? 'idle' : m))
    setDragging(true)
    setSnapping(false)
    draggingRef.current = true
    movedRef.current = false
    dragStart.current = { x: e.clientX, y: e.clientY }
    dragOffset.current = {
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    if (!movedRef.current) {
      const dist = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y)
      if (dist < DRAG_THRESHOLD) return
      movedRef.current = true
    }
    setPos(clampPos({
      x: e.clientX - dragOffset.current.dx,
      y: e.clientY - dragOffset.current.dy,
    }))
  }, [dragging])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false)
    draggingRef.current = false
    lastActivityRef.current = Date.now()
    if (movedRef.current) {
      // Gently snap to the nearest horizontal edge
      setSnapping(true)
      setPos((prev) => clampPos({
        x: prev.x + WIDTH / 2 < window.innerWidth / 2
          ? EDGE_MARGIN
          : window.innerWidth - WIDTH - EDGE_MARGIN,
        y: prev.y,
      }))
      setTimeout(() => setSnapping(false), 400)
    } else {
      setPetting(true)
      setTimeout(() => setPetting(false), 1600)
      togglePanel()
    }
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }, [togglePanel])

  if (prefs.hidden) return null

  const placement: BubblePlacement = {
    openUp: pos.y > 140,
    openLeft: pos.x + WIDTH / 2 > window.innerWidth / 2,
  }

  return (
    <div
      className={`fixed z-[60] ${prefs.reduceMotion ? 'mascot-reduce-motion' : ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT,
        transition: snapping ? 'left 0.35s cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
      }}
    >
      {/* Onboarding, panel, or notification bubble */}
      {showOnboarding ? (
        <MascotOnboarding
          placement={placement}
          onDone={() => setShowOnboarding(false)}
        />
      ) : panelOpen ? (
        <MascotPanel
          notifications={history}
          placement={placement}
          prefs={prefs}
          onClose={() => setPanelOpen(false)}
        />
      ) : (
        current && (
          <MascotBubble
            key={current.id}
            notification={current as MascotNotification}
            placement={placement}
            onDismiss={dequeue}
          />
        )
      )}

      {/* Unread badge */}
      {unread > 0 && !panelOpen && (
        <span
          className="mascot-badge absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-stone-950 bg-red-600 px-1 text-[10px] font-black leading-none text-white"
          aria-label={`${unread} unread notifications`}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {/* Character */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            togglePanel()
          }
        }}
        className={`${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${petting ? 'mascot-wiggle' : ''} ${mood === 'walking' ? 'mascot-walk-pace' : ''} touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
        style={{ width: WIDTH, height: HEIGHT }}
        role="button"
        tabIndex={0}
        aria-label="Scout the mascot. Click for notifications and settings, drag to move."
      >
        <MascotSprite mood={mood} />
      </div>
    </div>
  )
}
