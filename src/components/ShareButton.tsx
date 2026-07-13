import { useState } from 'react'
import { Check, ShareNetwork } from '@phosphor-icons/react'

type ShareButtonProps = {
  title: string
  text: string
  path: string
  accent?: 'red' | 'green' | 'yellow'
}

const accentClasses = {
  red: 'hover:bg-red-50 focus-visible:ring-red-600',
  green: 'hover:bg-green-50 focus-visible:ring-green-600',
  yellow: 'hover:bg-yellow-50 focus-visible:ring-yellow-500',
}

export default function ShareButton({
  title,
  text,
  path,
  accent = 'red',
}: ShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function handleShare() {
    const url = new URL(path, window.location.origin).toString()

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setStatus('copied')
      window.setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('failed')
      window.setTimeout(() => setStatus('idle'), 2500)
    }
  }

  const label = status === 'copied' ? 'Copied' : status === 'failed' ? 'Try again' : 'Share'

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-stone-900 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accentClasses[accent]}`}
      aria-label={`${label}: ${title}`}
    >
      {status === 'copied' ? (
        <Check aria-hidden="true" size={20} weight="bold" />
      ) : (
        <ShareNetwork aria-hidden="true" size={20} weight="bold" />
      )}
      <span aria-live="polite">{label}</span>
    </button>
  )
}
