import { useEffect, useRef } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileScriptLoad&render=explicit'

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    window.onTurnstileScriptLoad = () => resolve()
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.appendChild(script)
  })

  return scriptPromise
}

type TurnstileWidgetProps = {
  siteKey: string
  onToken: (token: string | null) => void
  onUnavailable?: () => void
}

export type TurnstileWidgetHandle = {
  reset: () => void
}

export default function TurnstileWidget({ siteKey, onToken, onUnavailable }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const onUnavailableRef = useRef(onUnavailable)

  onTokenRef.current = onToken
  onUnavailableRef.current = onUnavailable

  useEffect(() => {
    let widgetId: string | null = null
    let active = true

    loadTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => {
        if (active) onUnavailableRef.current?.()
      })

    return () => {
      active = false
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={containerRef} />
}

export function resetTurnstile() {
  window.turnstile?.reset()
}
