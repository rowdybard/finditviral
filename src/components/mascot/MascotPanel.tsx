import { Link } from 'react-router-dom'
import type { BubblePlacement, MascotNotification } from './MascotBubble'
import { type MascotPrefs, setMascotPrefs } from './mascotPrefs'
import './mascotAnimations.css'

export default function MascotPanel({
  notifications,
  placement,
  prefs,
  onClose,
}: {
  notifications: MascotNotification[]
  placement: BubblePlacement
  prefs: MascotPrefs
  onClose: () => void
}) {
  const vertical = placement.openUp ? 'bottom-full mb-2' : 'top-full mt-2'
  const horizontal = placement.openLeft ? 'right-0' : 'left-0'

  return (
    <div
      role="dialog"
      aria-label="Scout notifications and settings"
      className={`mascot-bubble-in absolute ${vertical} ${horizontal} w-72 rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[4px_4px_0_0_#1c1917]`}
    >
      <div className="flex items-center justify-between border-b border-stone-300 px-3 py-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-brand-600">
          Scout's finds
        </span>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700"
          aria-label="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="px-3 py-4 text-xs font-medium text-stone-600">
            No news yet. Scout is keeping watch.
          </p>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li key={n.id} className="border-b border-stone-200 last:border-b-0">
                <Link to={n.link} onClick={onClose} className="block px-3 py-2 hover:bg-stone-100">
                  <span
                    className={`text-[10px] font-black uppercase tracking-wider ${
                      n.type === 'sighting' ? 'text-green-700'
                        : n.type === 'bounty' ? 'text-red-600'
                        : 'text-brand-600'
                    }`}
                  >
                    {n.type === 'sighting' ? 'Sighting' : n.type === 'bounty' ? 'Bounty' : 'Update'}
                  </span>
                  <p className="text-sm font-black leading-tight text-stone-950">{n.title}</p>
                  <p className="text-xs font-medium text-stone-600">{n.subtitle}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-stone-300 px-3 py-2.5">
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs font-bold text-stone-800">
          Mute alerts
          <input
            type="checkbox"
            checked={prefs.muted}
            onChange={(e) => setMascotPrefs({ muted: e.target.checked })}
            className="h-4 w-4 accent-brand-500"
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs font-bold text-stone-800">
          Reduce motion
          <input
            type="checkbox"
            checked={prefs.reduceMotion}
            onChange={(e) => setMascotPrefs({ reduceMotion: e.target.checked })}
            className="h-4 w-4 accent-brand-500"
          />
        </label>
        <button
          onClick={() => setMascotPrefs({ hidden: true })}
          className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs font-bold text-stone-600 transition-colors hover:bg-stone-100"
        >
          Hide Scout (bring back from the page footer)
        </button>
      </div>
    </div>
  )
}
