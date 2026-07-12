import { useEffect, useRef } from 'react'

type TurnstileWidgetProps = {
  siteKey: string
  resetKey: number
  onToken: (token: string | null) => void
}

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script'
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export default function TurnstileWidget({ siteKey, resetKey, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let widgetId: string | undefined

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile) return
      containerRef.current.replaceChildren()
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = TURNSTILE_SCRIPT_ID
        script.src = TURNSTILE_SCRIPT_URL
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', renderWidget)
      return () => {
        cancelled = true
        script?.removeEventListener('load', renderWidget)
        if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
      }
    }

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, resetKey, onToken])

  return <div ref={containerRef} className="min-h-[65px]" aria-label="Bot verification" />
}
