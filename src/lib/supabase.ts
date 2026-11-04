import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types'
import { describeSupabaseConfigIssue, validateSupabaseConfig, type SupabaseConfigIssue } from './supabase-config'

const config = validateSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  (import.meta.env.VITE_ENV_SAFETY_STRIPPED ?? '').split(',').filter(Boolean),
)

export const supabaseConfigIssue: SupabaseConfigIssue | null = config.ok ? null : config.issue

// Public (anon/publishable) values only; validation above rejects secret-shaped keys.
export const supabasePublicConfig = config.ok ? { url: config.url, key: config.key } : null

export const supabase = config.ok
  ? createClient<Database>(config.url, config.key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error(`Supabase is not configured. ${describeSupabaseConfigIssue(supabaseConfigIssue ?? 'missing-url')}`)
  }
  return supabase
}
