import { createClient } from '@supabase/supabase-js'
import { mockSupabase } from './mockSupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder'),
)

if (!isSupabaseConfigured) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Supabase calls will fail.',
  )
}

const realSupabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: (...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url
        if (url?.includes('placeholder.supabase.co')) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'Supabase not configured' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        return fetch(...args)
      },
    },
  },
)

export const supabase = isSupabaseConfigured
  ? realSupabase
  : (mockSupabase as unknown as typeof realSupabase)
