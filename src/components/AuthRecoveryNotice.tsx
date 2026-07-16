import { useState } from 'react'

type AuthRecoveryNoticeProps = {
  onRetry: () => Promise<void>
}

export default function AuthRecoveryNotice({ onRetry }: AuthRecoveryNoticeProps) {
  const [retrying, setRetrying] = useState(false)

  return (
    <div className="flex justify-center px-5 py-16">
      <div role="status" aria-live="polite" className="w-full max-w-md rounded-xl border-2 border-amber-300 bg-amber-50 p-6 text-center">
        <h1 className="text-xl font-extrabold text-stone-900">Having trouble reconnecting</h1>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          We have not treated this interruption as a sign-out. Any local work on this device is still here.
          Check your connection, then try again.
        </p>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            try {
              await onRetry()
            } finally {
              setRetrying(false)
            }
          }}
          className="mt-5 rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-2.5 text-sm font-bold text-stone-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? 'Reconnecting…' : 'Try again'}
        </button>
      </div>
    </div>
  )
}
