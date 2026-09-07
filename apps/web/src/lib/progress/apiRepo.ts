// Progress storage for a signed-in learner, over the API.
//
// This replaces the old CloudProgressRepo, which spoke to Supabase directly.
// The shape of the class is deliberately unchanged: the same ProgressRepo
// contract, the same fire-and-forget write semantics, the same in-memory
// snapshot. Only the transport moved, so nothing above the storage boundary
// had to learn anything new.
//
// Addressed by learner id, not by the signed-in user: the person holding the
// session is often a parent recording progress for a child. The API checks
// that, and Row Level Security checks it again underneath.

import type {
  DecksResponse,
  SessionAttemptsResponse,
  SnapshotResponse,
  WordListsResponse,
} from '@whizzo/shared'
import { api, ApiError } from '../api/client'
import { applyChange, type ProgressChange, type ProgressRepo } from './repo'
import {
  emptySnapshot,
  todayString,
  type Attempt,
  type CustomWordList,
  type ProgressSnapshot,
  type QuizDeck,
} from './types'

export class ApiProgressRepo implements ProgressRepo {
  readonly kind = 'cloud' as const

  private snapshot: ProgressSnapshot = emptySnapshot()

  constructor(private readonly learnerId: string) {}

  async load(): Promise<ProgressSnapshot> {
    const { snapshot } = await api.get<SnapshotResponse>(
      `/learners/${this.learnerId}/progress`,
    )
    this.snapshot = snapshot
    return snapshot
  }

  /**
   * One round of practice.
   *
   * Failures are logged, not thrown — the same bargain the direct-to-Supabase
   * version made. A child mid-round should never be interrupted by a flaky
   * connection, and the worst case is one lost round rather than a corrupted
   * record, because the API applies each change in a single transaction.
   */
  async persist(change: ProgressChange): Promise<void> {
    this.snapshot = applyChange(this.snapshot, change)
    try {
      await api.post<void>(`/learners/${this.learnerId}/progress`, { ...change, today: todayString() })
    } catch (err) {
      console.warn('[cat-academy] progress write failed', err)
    }
  }

  /** Push a whole merged snapshot at once — the guest-to-account sync. */
  async pushSnapshot(snapshot: ProgressSnapshot): Promise<void> {
    this.snapshot = snapshot
    // Deliberately not swallowed: the caller only clears the local copy once
    // this resolves, so a failure here has to be loud or guest play is lost.
    await api.put<void>(`/learners/${this.learnerId}/progress`, snapshot)
  }

  async saveCustomLists(lists: CustomWordList[]): Promise<CustomWordList[]> {
    if (!lists.length) return []
    const { customLists } = await api.post<WordListsResponse>(
      `/learners/${this.learnerId}/word-lists`,
      { customLists: lists },
    )
    return customLists
  }

  async deleteCustomList(id: string): Promise<void> {
    try {
      await api.del<void>(`/learners/${this.learnerId}/word-lists/${id}`)
    } catch (err) {
      // Already gone is the outcome the caller wanted.
      if (err instanceof ApiError && err.isMissing) return
      throw err
    }
  }

  async saveDecks(decks: QuizDeck[]): Promise<QuizDeck[]> {
    if (!decks.length) return []
    const { decks: saved } = await api.post<DecksResponse>(
      `/learners/${this.learnerId}/decks`,
      { decks },
    )
    return saved
  }

  async deleteDeck(id: string): Promise<void> {
    try {
      await api.del<void>(`/learners/${this.learnerId}/decks/${id}`)
    } catch (err) {
      if (err instanceof ApiError && err.isMissing) return
      throw err
    }
  }

  async reset(): Promise<void> {
    await api.del<void>(`/learners/${this.learnerId}/progress`)
    this.snapshot = emptySnapshot()
  }

  /**
   * The answers behind one session. Fetched on demand rather than held in the
   * snapshot: a year of practice is a lot of rows, and nobody needs them until
   * they open a round to look at it.
   */
  async attemptsForSession(sessionId: string): Promise<Attempt[]> {
    const { attempts } = await api.get<SessionAttemptsResponse>(
      `/learners/${this.learnerId}/sessions/${sessionId}/attempts`,
    )
    return attempts
  }
}
