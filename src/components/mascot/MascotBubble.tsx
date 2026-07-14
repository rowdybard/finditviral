import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './mascotAnimations.css'

export type MascotNotification = {
  id: string
  type: 'sighting' | 'bounty' | 'notification'
  title: string
  subtitle: string
  link: string
}

export type BubblePlacement = {
  openUp: boolean
  openLeft: boolean
}

const AUTO_DISMISS_MS = 5500
const TICK_MS = 250

export default function MascotBubble({
  notification,
  placement = { openUp: true, openLeft: true },
  onDismiss,
}: {
  notification: MascotNotification
  placement?: BubblePlacement
  onDismiss: () => void
}) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let remaining = AUTO_DISMISS_MS
    const timer = setInterval(() => {
      if (document.hidden) return
      remaining -= TICK_MS
      if (remaining <= 0) {
        clearInterval(timer)
        setLeaving(true)
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (leaving) {
      const t = setTimeout(onDismiss, 250)
      return () => clearTimeout(t)
    }
  }, [leaving, onDismiss])

  const accent =
    notification.type === 'sighting'
      ? 'border-green-600 bg-[#fffdf7]'
      : notification.type === 'bounty'
        ? 'border-red-600 bg-[#fffdf7]'
        : 'border-brand-500 bg-[#fffdf7]'

  const label =
    notification.type === 'sighting' ? 'New Sighting!'
      : notification.type === 'bounty' ? 'New Bounty!'
      : 'Update'

  const vertical = placement.openUp ? 'bottom-full mb-2' : 'top-full mt-2'
  const horizontal = placement.openLeft ? 'right-0' : 'left-0'

  return (
    <div
      className={`mascot-bubble-in ${leaving ? 'mascot-bubble-out' : ''} absolute ${vertical} ${horizontal} w-64 rounded-xl border-2 ${accent} p-3 shadow-[4px_4px_0_0_#1c1917]`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`text-[10px] font-black uppercase tracking-wider ${
            notification.type === 'sighting' ? 'text-green-700'
              : notification.type === 'bounty' ? 'text-red-600'
              : 'text-brand-600'
          }`}
        >
          {label}
        </span>
        <button
          onClick={() => setLeaving(true)}
          className="text-stone-400 hover:text-stone-700"
          aria-label="Dismiss"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <Link
        to={notification.link}
        onClick={() => setLeaving(true)}
        className="block"
      >
        <p className="text-sm font-black leading-tight text-stone-950">
          {notification.title}
        </p>
        <p className="mt-0.5 text-xs font-medium text-stone-600">
          {notification.subtitle}
        </p>
      </Link>
      {/* Speech tail */}
      <div
        className={`absolute ${placement.openUp ? '-bottom-2 border-r-2 border-b-2' : '-top-2 border-l-2 border-t-2'} ${placement.openLeft ? 'right-6' : 'left-6'} h-4 w-4 rotate-45`}
        style={{ borderColor: notification.type === 'sighting' ? '#16a34a' : notification.type === 'bounty' ? '#dc2626' : '#e85d04', background: '#fffdf7' }}
      />
    </div>
  )
}
