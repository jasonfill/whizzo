// Which learner is the app currently showing?
//
// Before the inversion this question did not exist: the signed-in user *was*
// the learner. Now one session may hold several — a parent with three children,
// a teacher with a class — so somebody has to hold the selection, and every
// read and write downstream is scoped to it.
//
// The selection is remembered per signed-in user, so a parent who was last
// looking at one child comes back to that child rather than to a picker.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { createLearner, listLearners, updateLearner, type Learner, type NewLearner } from './api'

export type LearnerStatus = 'loading' | 'ready' | 'unavailable' | 'error'

interface LearnerContextValue {
  /** Every learner this session can see: owned, guarded, or itself. */
  learners: Learner[]
  /** The learner the app is currently showing, if any. */
  active: Learner | null
  status: LearnerStatus
  error: string | null
  /** True when the session owns the active learner, rather than guarding it. */
  isOwner: boolean
  /**
   * True when the person signed in *is* the learner on screen — a child who
   * signed in with their code, or a teenager with their own Google account.
   * The one role distinction the app makes: grown-up screens (family, library,
   * billing, setting tasks) hide behind it, and the learner's own screens
   * read as theirs rather than as a report about them.
   */
  isLearnerSession: boolean
  select: (learnerId: string) => void
  create: (learner: NewLearner) => Promise<Learner>
  /**
   * Patch one learner and swap the returned row into place, so every reader
   * of `active` sees the change without a full reload. Cosmetic fields only:
   * the API refuses the rest.
   */
  update: (learnerId: string, patch: LearnerPatch) => Promise<Learner>
  refresh: () => Promise<void>
}

export type LearnerPatch = Parameters<typeof updateLearner>[1]

const LearnerContext = createContext<LearnerContextValue | null>(null)

const ACTIVE_KEY = 'cat-academy:active-learner'

function readActive(userId: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_KEY}:${userId}`)
  } catch {
    return null
  }
}

function writeActive(userId: string, learnerId: string): void {
  try {
    localStorage.setItem(`${ACTIVE_KEY}:${userId}`, learnerId)
  } catch {
    /* a private window is not a reason to fail a lesson */
  }
}

/**
 * Pick who to show when there is no remembered choice. A session that belongs
 * to a learner shows that learner; otherwise the first one the adult created,
 * which for the overwhelmingly common single-child case is the only one.
 */
function pickDefault(learners: Learner[], userId: string): Learner | null {
  return learners.find((l) => l.authUserId === userId) ?? learners[0] ?? null
}

export function LearnerProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth()
  const [learners, setLearners] = useState<Learner[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [status, setStatus] = useState<LearnerStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setLearners([])
      setActiveId(null)
      setStatus('unavailable')
      return
    }
    try {
      const rows = await listLearners()
      setLearners(rows)
      setActiveId((current) => {
        // Keep the current selection if it survived the refresh, so adding a
        // sibling does not yank a child out of the middle of a lesson.
        if (current && rows.some((l) => l.id === current)) return current
        const remembered = readActive(user.id)
        if (remembered && rows.some((l) => l.id === remembered)) return remembered
        return pickDefault(rows, user.id)?.id ?? null
      })
      setStatus('ready')
      setError(null)
    } catch (err) {
      console.warn('[cat-academy] could not load learners', err)
      setError(err instanceof Error ? err.message : 'Could not load learners')
      setStatus('error')
    }
  }, [user])

  useEffect(() => {
    if (authStatus === 'loading') return
    if (authStatus !== 'signed-in') {
      setLearners([])
      setActiveId(null)
      setStatus('unavailable')
      return
    }
    void load()
  }, [authStatus, load])

  const select = useCallback(
    (learnerId: string) => {
      setActiveId(learnerId)
      if (user) writeActive(user.id, learnerId)
    },
    [user],
  )

  const create = useCallback(
    async (learner: NewLearner) => {
      if (!user) throw new Error('Sign in before adding a learner')
      // The API takes the owner from the caller's token; passing it would be a
      // claim the server would have to ignore anyway.
      const created = await createLearner(learner)
      setLearners((prev) => [...prev, created])
      // A newly added learner becomes the active one: the adult added them in
      // order to do something with them.
      select(created.id)
      return created
    },
    [select, user],
  )

  const update = useCallback(async (learnerId: string, patch: LearnerPatch) => {
    const updated = await updateLearner(learnerId, patch)
    setLearners((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
    return updated
  }, [])

  const active = useMemo(
    () => learners.find((l) => l.id === activeId) ?? null,
    [learners, activeId],
  )

  const value = useMemo<LearnerContextValue>(
    () => ({
      learners,
      active,
      status,
      error,
      isOwner: Boolean(active && user && active.ownerId === user.id),
      isLearnerSession: Boolean(active && user && active.authUserId === user.id),
      select,
      create,
      update,
      refresh: load,
    }),
    [learners, active, status, error, user, select, create, update, load],
  )

  return <LearnerContext.Provider value={value}>{children}</LearnerContext.Provider>
}

export function useLearners(): LearnerContextValue {
  const ctx = useContext(LearnerContext)
  if (!ctx) throw new Error('useLearners must be used inside <LearnerProvider>')
  return ctx
}
