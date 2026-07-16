/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_TURNSTILE_SITE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

type TurnstileOptions = {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  'retry-callback'?: () => void
  execution?: 'render' | 'execute'
  appearance?: 'always' | 'execute' | 'interaction-only'
}

interface Window {
  turnstile?: {
    render: (container: HTMLElement, options: TurnstileOptions) => string
    remove: (widgetId: string) => void
    reset: (widgetId?: string) => void
    execute: (widgetId: string) => void
    getResponse: (widgetId?: string) => string | undefined
  }
}

declare module '@fontsource-variable/*'
