import { useState } from 'react'
import type { BubblePlacement } from './MascotBubble'
import './mascotAnimations.css'

const STORAGE_KEY = 'fiv-mascot-onboarding-done'

const STEPS = [
  {
    title: 'Meet Scout!',
    body: 'Your FindItViral sidekick. Scout keeps watch while you browse and hangs out wherever you drop him.',
  },
  {
    title: 'Scout barks the news',
    body: 'Whenever a new sighting or bounty is posted, Scout pops up a bubble and wears a badge for unread news. Tap it to jump straight to the page.',
  },
  {
    title: 'Make yourself at home',
    body: 'Drag Scout anywhere and he snaps to the nearest edge. Click him for recent finds, plus mute and hide options. Quiet day? He naps.',
  },
]

export function hasSeenMascotOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export default function MascotOnboarding({
  placement,
  onDone,
}: {
  placement: BubblePlacement
  onDone: () => void
}) {
  const [step, setStep] = useState(0)
  const isLast = step === STEPS.length - 1

  function finish() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // ignore
    }
    onDone()
  }

  const vertical = placement.openUp ? 'bottom-full mb-2' : 'top-full mt-2'
  const horizontal = placement.openLeft ? 'right-0' : 'left-0'

  return (
    <div
      role="dialog"
      aria-label="Mascot introduction"
      className={`mascot-bubble-in absolute ${vertical} ${horizontal} w-64 rounded-xl border-2 border-stone-950 bg-[#fffdf7] p-3 shadow-[4px_4px_0_0_#1c1917]`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-brand-600">
          {step + 1} of {STEPS.length}
        </span>
        <button
          onClick={finish}
          className="text-stone-400 hover:text-stone-700"
          aria-label="Skip introduction"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="text-sm font-black leading-tight text-stone-950">{STEPS[step].title}</p>
      <p className="mt-1 text-xs font-medium leading-snug text-stone-600">{STEPS[step].body}</p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1.5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full border border-stone-950 ${i <= step ? 'bg-brand-500' : 'bg-transparent'}`}
            />
          ))}
        </div>
        <button
          onClick={() => (isLast ? finish() : setStep(step + 1))}
          className="rounded-lg border-2 border-stone-950 bg-brand-500 px-3 py-1 text-xs font-black uppercase text-white shadow-[2px_2px_0_0_#1c1917] transition-colors hover:bg-brand-600"
        >
          {isLast ? 'Got it!' : 'Next'}
        </button>
      </div>
      {/* Speech tail */}
      <div
        className={`absolute ${placement.openUp ? '-bottom-2 border-r-2 border-b-2' : '-top-2 border-l-2 border-t-2'} ${placement.openLeft ? 'right-6' : 'left-6'} h-4 w-4 rotate-45 border-stone-950 bg-[#fffdf7]`}
      />
    </div>
  )
}
