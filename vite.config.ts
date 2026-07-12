import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY

  if (mode === 'production' && (!supabaseUrl || !supabaseKey)) {
    throw new Error(
      'Production builds require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  }
})
