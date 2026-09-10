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
import { useAuth } from '../../auth/AuthProvider'
import { useLearners } from '../learners/LearnerProvider'
import { ApiProgressRepo } from './apiRepo'
import { clearLocalProgress, LocalProgressRepo, loadLocalSnapshot } from './localRepo'
import {
  applyChange,
  mergeSnapshots,
  withDerivedEvidence,
  type ProgressChange,
  type ProgressRepo,
} from './repo'
import {
  defaultSkillState,
  emptySnapshot,
  type Attempt,
  type CustomWordList,
  type ProgressSnapshot,
  type QuizDeck,
  type SkillState,
  type Subject,
} from './types'

export type SyncState = 'idle' | 'loading' | 'merging' | 'error'

interface ProgressContextValue {
  snapshot: ProgressSnapshot
  /** 'local' while playing as a guest, 'cloud' once signed in. */
  mode: 'local' | 'cloud'
  sync: SyncState
  ready: boolean
  skill: (subject: Subject) => SkillState
  commit: (change: ProgressChange) => Promise<void>
  saveCustomLists: (lists: CustomWordList[]) => Promise<void>
  deleteCustomList: (id: string) => Promise<void>
  saveDeck: (deck: QuizDeck) => Promise<void>
  deleteDeck: (id: string) => Promise<void>
  reset: () => Promise<void>
  /** Every answer given in one round, oldest first. Fetched on demand. */
  attemptsForSession: (sessionId: string) => Promise<Attempt[]>
  /**
   * Fetch the learner's material again — decks and word lists — leaving
   * their progress alone.
   *
   * The snapshot loads once per learner, but the material in it can change
   * under a session: a grown-up sets a library deck as work and the task
   * appears on the child's list at the next look (assignments are fetched
   * fresh) while the deck it names is not in the snapshot until the next
   * sign-in. Only material is replaced, because a round's progress is written
   * optimistically and a wholesale reload could drop a write still in flight.
   */
  reloadMaterial: () => Promise<void>
  /** True while `reloadMaterial` is fetching, so a screen can wait rather than say "nothing here". */
  materialLoading: boolean
}

const ProgressContext = createContext<ProgressContextValue | null>(null)

/**
 * Marker so a guest snapshot is only ever merged into one learner, once. Keyed
 * by learner rather than by user since the inversion: a parent with two
 * children must not have the same pile of guest practice folded into both.
 */
const MERGED_KEY = 'cat-academy:merged-into'

function alreadyMerged(learnerId: string): boolean {
  try {
    return (localStorage.getItem(MERGED_KEY) ?? '').split(',').includes(learnerId)
  } catch {
    return false
  }
}

function markMerged(learnerId: string): void {
  try {
    const existing = (localStorage.getItem(MERGED_KEY) ?? '').split(',').filter(Boolean)
    localStorage.setItem(MERGED_KEY, [...new Set([...existing, learnerId])].join(','))
  } catch {
    /* ignore */
  }
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const { active, status: learnerStatus } = useLearners()
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(emptySnapshot)
  const [sync, setSync] = useState<SyncState>('loading')
  const [materialLoading, setMaterialLoading] = useState(false)
  const repoRef = useRef<ProgressRepo>(new LocalProgressRepo())

  const mode = repoRef.current.kind

  // Swap the storage backend whenever the active learner changes — signing in,
  // signing out, or a parent switching from one child to another. Selecting a
  // learner pulls their cloud snapshot and folds any guest play into it first,
  // so a kid who practiced before their account existed keeps everything.
  //
  // Keyed on the learner's id, not the record: the list is refetched now and
  // then (adding a sibling, a refresh) and hands back a new object for the same
  // child. Rebooting the store on that would drop `ready` and unmount the
  // screen they are on, mid-round.
  const activeId = active?.id ?? null
  useEffect(() => {
    if (status === 'loading') return
    // Wait for the learner list before deciding: booting into local mode and
    // then swapping would double-count the round in progress.
    if (status === 'signed-in' && learnerStatus === 'loading') return

    let canceled = false

    async function boot() {
      setSync('loading')
      try {
        if (status === 'signed-in' && activeId) {
          const cloud = new ApiProgressRepo(activeId)
          const cloudSnapshot = await cloud.load()
          if (canceled) return

          const local = loadLocalSnapshot()
          const hasGuestPlay =
            Object.keys(local.mastery).length > 0 || Object.keys(local.skills).length > 0

          if (hasGuestPlay && !alreadyMerged(activeId)) {
            setSync('merging')
            const merged = mergeSnapshots(cloudSnapshot, local)
            await cloud.pushSnapshot(merged)
            if (canceled) return
            markMerged(activeId)
            clearLocalProgress()
            repoRef.current = cloud
            setSnapshot(merged)
          } else {
            repoRef.current = cloud
            setSnapshot(cloudSnapshot)
          }
        } else {
          const local = new LocalProgressRepo()
          const loaded = await local.load()
          if (canceled) return
          repoRef.current = local
          setSnapshot(loaded)
        }
        if (!canceled) setSync('idle')
      } catch (err) {
        console.warn('[cat-academy] progress load failed, falling back to local', err)
        if (canceled) return
        const local = new LocalProgressRepo()
        repoRef.current = local
        setSnapshot(await local.load())
        setSync('error')
      }
    }

    void boot()
    return () => {
      canceled = true
    }
  }, [status, learnerStatus, activeId])

  const commit = useCallback(async (change: ProgressChange) => {
    // Reconciled first, so the optimistic snapshot and the stored one are the
    // same round rather than two accounts of it.
    const reconciled = withDerivedEvidence(change)
    // Optimistic: the UI updates immediately, the write follows. A failed write
    // is logged inside the repo rather than thrown, so a flaky connection never
    // interrupts a child mid-round.
    setSnapshot((prev) => applyChange(prev, reconciled))
    await repoRef.current.persist(reconciled)
  }, [])

  const skill = useCallback(
    (subject: Subject): SkillState => snapshot.skills[subject] ?? defaultSkillState(subject),
    [snapshot.skills],
  )

  const saveCustomLists = useCallback(
    async (lists: CustomWordList[]) => {
      const repo = repoRef.current
      if (repo instanceof ApiProgressRepo) {
        const saved = await repo.saveCustomLists(lists)
        setSnapshot((prev) => {
          const byId = new Map(prev.customLists.map((l) => [l.id, l]))
          for (const l of saved) byId.set(l.id, l)
          return { ...prev, customLists: [...byId.values()] }
        })
        return
      }
      const byId = new Map(snapshot.customLists.map((l) => [l.id, l]))
      for (const l of lists) byId.set(l.id, l)
      await commit({ customLists: [...byId.values()] })
    },
    [commit, snapshot.customLists],
  )

  const deleteCustomList = useCallback(
    async (id: string) => {
      const repo = repoRef.current
      if (repo instanceof ApiProgressRepo) await repo.deleteCustomList(id)
      const remaining = snapshot.customLists.filter((l) => l.id !== id)
      setSnapshot((prev) => ({ ...prev, customLists: remaining }))
      if (!(repo instanceof ApiProgressRepo)) await commit({ customLists: remaining })
    },
    [commit, snapshot.customLists],
  )

  const saveDeck = useCallback(
    async (deck: QuizDeck) => {
      const repo = repoRef.current
      if (repo instanceof ApiProgressRepo) {
        const saved = await repo.saveDecks([deck])
        setSnapshot((prev) => {
          const byId = new Map(prev.decks.map((d) => [d.id, d]))
          for (const d of saved.length ? saved : [deck]) byId.set(d.id, d)
          return { ...prev, decks: [...byId.values()] }
        })
        return
      }
      const byId = new Map(snapshot.decks.map((d) => [d.id, d]))
      byId.set(deck.id, deck)
      await commit({ decks: [...byId.values()] })
    },
    [commit, snapshot.decks],
  )

  const deleteDeck = useCallback(
    async (id: string) => {
      const repo = repoRef.current
      if (repo instanceof ApiProgressRepo) await repo.deleteDeck(id)
      const remaining = snapshot.decks.filter((d) => d.id !== id)
      setSnapshot((prev) => ({ ...prev, decks: remaining }))
      if (!(repo instanceof ApiProgressRepo)) await commit({ decks: remaining })
    },
    [commit, snapshot.decks],
  )

  const reset = useCallback(async () => {
    await repoRef.current.reset()
    setSnapshot(emptySnapshot())
  }, [])

  const reloadMaterial = useCallback(async () => {
    const repo = repoRef.current
    // A guest's material is only ever written from this device.
    if (!(repo instanceof ApiProgressRepo)) return
    setMaterialLoading(true)
    try {
      const fresh = await repo.load()
      // Still the same learner's store? A switch mid-fetch means this reply
      // belongs to somebody else's snapshot.
      if (repoRef.current !== repo) return
      setSnapshot((prev) => ({ ...prev, decks: fresh.decks, customLists: fresh.customLists }))
    } catch (err) {
      // The old material stays; the next look asks again.
      console.warn('[cat-academy] material reload failed', err)
    } finally {
      setMaterialLoading(false)
    }
  }, [])

  const attemptsForSession = useCallback(
    (sessionId: string) => repoRef.current.attemptsForSession(sessionId),
    [],
  )

  const value = useMemo<ProgressContextValue>(
    () => ({
      snapshot,
      mode,
      sync,
      ready: sync === 'idle' || sync === 'error',
      skill,
      commit,
      saveCustomLists,
      deleteCustomList,
      saveDeck,
      deleteDeck,
      reset,
      attemptsForSession,
      reloadMaterial,
      materialLoading,
    }),
    [
      snapshot,
      mode,
      sync,
      skill,
      commit,
      saveCustomLists,
      deleteCustomList,
      saveDeck,
      deleteDeck,
      reset,
      attemptsForSession,
      reloadMaterial,
      materialLoading,
    ],
  )

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress must be used inside <ProgressProvider>')
  return ctx
}
