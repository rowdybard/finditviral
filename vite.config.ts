import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const TURNSTILE_TEST_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
])

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  const turnstileSiteKey = process.env.VITE_TURNSTILE_SITE_KEY || env.VITE_TURNSTILE_SITE_KEY

  if (mode === 'production' && (!supabaseUrl || !supabaseKey || !turnstileSiteKey)) {
    throw new Error(
      'Production builds require VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_TURNSTILE_SITE_KEY.',
    )
  }

  if (mode === 'production' && TURNSTILE_TEST_SITE_KEYS.has(turnstileSiteKey)) {
    throw new Error(
      'Production builds cannot use a Cloudflare Turnstile test site key. Set VITE_TURNSTILE_SITE_KEY to the real widget site key.',
    )
  }

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
    test: {
      environment: 'jsdom',
      setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))],
      exclude: [...configDefaults.exclude, 'workers/**', 'dist/**', 'e2e/**'],
    },
  }
})
