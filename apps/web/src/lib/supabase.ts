// Supabase client. Deliberately optional: if the two env vars are missing the
// app runs unauthenticated against localStorage, which keeps `npm run dev`
// working for a contributor who has not set up a project yet and keeps the
// GitHub Pages build from failing. That is also the one case where App.tsx
// lifts the sign-in gate — with no auth service there is no way through it.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Google sign-in comes back to authRedirectUrl() with a `?code=`,
        // which this exchanges for a session on load.
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

/**
 * Where OAuth, the confirmation email, and the password-reset link should
 * return to. Uses Vite's base so the same build works on localhost and on
 * whizzo.app.
 *
 * Supabase only honors this when it matches the project's **Redirect URLs**
 * allow-list; anything else lands on the project's Site URL instead. See
 * supabase/README.md §3.
 */
export function authRedirectUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}
