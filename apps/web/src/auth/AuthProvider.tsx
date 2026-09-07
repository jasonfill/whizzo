import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { ChildSessionResponse } from '@whizzo/shared'
import { apiRequest } from '../lib/api/client'
import { authRedirectUrl, isSupabaseConfigured, supabase } from '../lib/supabase'

/**
 * The legacy account flag, kept because the database still reads it.
 *
 * `is_learner_covered` has a second arm matching `profiles.plan = 'pro'`, which
 * is how every comped and hand-set account is covered today — no payment
 * provider is wired, so `learner_coverage` is empty and dropping this would
 * silently strip those accounts. It goes when real subscription rows exist.
 *
 * Nothing in the UI asks this any more. Coverage is a property of a learner:
 * ask `useCoverage`, or read `learner.covered`.
 */
export type LegacyPlan = 'free' | 'pro'

export interface Profile {
  id: string
  displayName: string
  avatarEmoji: string
  gradeHint: number | null
  plan: LegacyPlan
  planRenewsAt: string | null
}

export type AuthStatus = 'loading' | 'guest' | 'signed-in'

interface AuthContextValue {
  status: AuthStatus
  /** True when the app has Supabase credentials; false means guest-only build. */
  configured: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  error: string | null
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsEmailConfirm: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  /** Code + PIN sign-in for a learner whose parent provisioned an account. */
  signInWithCode: (loginCode: string, pin: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (patch: Partial<Pick<Profile, 'displayName' | 'avatarEmoji' | 'gradeHint'>>) => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/* eslint-disable @typescript-eslint/no-explicit-any */
function toProfile(row: any): Profile {
  return {
    id: row.id,
    displayName: row.display_name ?? 'Friend',
    avatarEmoji: row.avatar_emoji ?? '🙂',
    gradeHint: row.grade_hint ?? null,
    plan: (row.plan as LegacyPlan) ?? 'free',
    planRenewsAt: row.plan_renews_at ?? null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function messageFor(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Supabase messages are accurate but blunt; soften the common ones.
  if (/invalid login credentials/i.test(raw)) return 'That email and password did not match.'
  if (/user already registered/i.test(raw)) return 'There is already an account with that email.'
  if (/password should be at least/i.test(raw)) return 'Passwords need at least 6 characters.'
  if (/email rate limit/i.test(raw)) return 'Too many attempts just now — try again in a minute.'
  return raw
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'guest')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What the listener compares an incoming session against. A ref rather than
  // the state itself so the subscription, which is set up once, always sees the
  // current session instead of the one from its first render.
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (err) {
      console.warn('[cat-academy] could not load profile', err)
      return
    }
    if (data) {
      setProfile(toProfile(data))
      return
    }

    // The signup trigger normally creates this row. If it is missing (an
    // account made before the migration ran, say) create it here so the app
    // never sits in a half-signed-in state.
    const { data: created } = await supabase
      .from('profiles')
      .insert({ id: userId })
      .select()
      .maybeSingle()
    if (created) setProfile(toProfile(created))
  }, [])

  useEffect(() => {
    if (!supabase) return

    let cancelled = false

    // If the auth service is unreachable the app must still open — a kid on a
    // flaky connection gets guest mode, not an infinite spinner.
    const fallback = window.setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === 'loading' ? 'guest' : s))
    }, 6000)

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return
        setSession(data.session)
        if (data.session?.user) await loadProfile(data.session.user.id)
        setStatus(data.session ? 'signed-in' : 'guest')
      })
      .catch((err) => {
        console.warn('[cat-academy] could not reach auth, continuing as guest', err)
        if (!cancelled) setStatus('guest')
      })
      .finally(() => window.clearTimeout(fallback))

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (cancelled) return
      const prev = sessionRef.current

      // Supabase re-checks the session every time the tab regains focus and
      // announces the result as SIGNED_IN or TOKEN_REFRESHED even when nothing
      // changed. Treating that as a fresh sign-in reloads the profile, the
      // learner list and the progress store, which unmounts whatever screen
      // the learner was on — halfway through a deck of flashcards, say. So:
      //
      //   * same user, same token: nothing happened; ignore it;
      //   * same user, new token: keep the new token so requests keep working,
      //     but the account has not changed, so nothing else moves;
      //   * a different user, or none: a real change; handle it in full.
      if (next?.user && prev?.user && next.user.id === prev.user.id) {
        if (next.access_token !== prev.access_token) setSession(next)
        return
      }

      setSession(next)
      if (next?.user) {
        await loadProfile(next.user.id)
        setStatus('signed-in')
      } else if (event === 'SIGNED_OUT') {
        setProfile(null)
        setStatus('guest')
      }
    })

    return () => {
      cancelled = true
      window.clearTimeout(fallback)
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (!supabase) throw new Error('Accounts are not set up in this build.')
      setError(null)
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() || email.split('@')[0] },
          emailRedirectTo: authRedirectUrl(),
        },
      })
      if (err) {
        setError(messageFor(err))
        throw err
      }
      // With email confirmation on, Supabase returns a user but no session.
      return { needsEmailConfirm: !data.session }
    },
    [],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Accounts are not set up in this build.')
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (err) {
      setError(messageFor(err))
      throw err
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Accounts are not set up in this build.')
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectUrl() },
    })
    if (err) {
      setError(messageFor(err))
      throw err
    }
  }, [])

  /**
   * A child signing in on their own device with the code and PIN their parent
   * set up. The API checks the PIN and hands back a real Supabase session,
   * which goes into the client here — from this point the app cannot tell this
   * session apart from any other, which is the point.
   */
  const signInWithCode = useCallback(async (loginCode: string, pin: string) => {
    if (!supabase) throw new Error('Accounts are not set up in this build.')
    setError(null)
    try {
      const result = await apiRequest<ChildSessionResponse>('/child-login', {
        method: 'POST',
        anonymous: true,
        body: { loginCode: loginCode.trim().toUpperCase(), pin },
      })
      const { error: err } = await supabase.auth.setSession({
        access_token: result.session.accessToken,
        refresh_token: result.session.refreshToken,
      })
      if (err) throw err
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code or PIN is not right')
      throw err
    }
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Accounts are not set up in this build.')
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl(),
    })
    if (err) {
      setError(messageFor(err))
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
    setStatus('guest')
  }, [])

  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, 'displayName' | 'avatarEmoji' | 'gradeHint'>>) => {
      if (!supabase || !profile) return
      const row = {
        ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
        ...(patch.avatarEmoji !== undefined ? { avatar_emoji: patch.avatarEmoji } : {}),
        ...(patch.gradeHint !== undefined ? { grade_hint: patch.gradeHint } : {}),
      }
      setProfile({ ...profile, ...patch })
      const { error: err } = await supabase.from('profiles').update(row).eq('id', profile.id)
      if (err) setError(messageFor(err))
    },
    [profile],
  )

  // Identity-stable across token refreshes: a refreshed session carries a new
  // user object describing the same person, and anything keyed on `user`
  // (the learner list, for one) must not reload because a token rotated.
  const userId = session?.user?.id ?? null
  const user = useMemo(() => session?.user ?? null, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      configured: isSupabaseConfigured,
      session,
      user,
      profile,
      error,
      signUp,
      signIn,
      signInWithGoogle,
      signInWithCode,
      sendPasswordReset,
      signOut,
      updateProfile,
      clearError: () => setError(null),
    }),
    [
      status,
      session,
      user,
      profile,
      error,
      signUp,
      signIn,
      signInWithGoogle,
      signInWithCode,
      sendPasswordReset,
      signOut,
      updateProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
