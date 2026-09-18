// Typing lesson progress, read from the account.
//
// The typing game predates the database and used to keep every star in one
// localStorage key, so siblings on one browser shared a course and the same
// child on a second device started from nothing. Every finished lesson has
// been written to the shared progress store as well for some time; this reads
// it back, so the account is the record and the browser is only a cache.
//
// Per lesson: `snapshot.lists['typing:<lessonId>']` carries stars, plays and
// the best score and accuracy. Best WPM has no column on a list entry, so it
// is the highest `wpm` across the lesson's sessions.

import {
  listKey,
  type ListProgress,
  type ProgressSnapshot,
  type SessionRecord,
} from '../progress/types'
import type { RoundResult } from '../stats'

export interface LessonProgress {
  stars: number // best stars earned (0-3)
  bestWpm: number
  bestAccuracy: number
  bestScore: number
  plays: number
}

export const TYPING_SUBJECT = 'typing' as const

function isTypingLesson(s: SessionRecord): s is SessionRecord & { listId: string } {
  return s.subject === TYPING_SUBJECT && s.activity === 'lesson' && typeof s.listId === 'string'
}

/**
 * Every typing lesson the learner has finished, keyed by lesson id.
 *
 * Stars and counts come from the list entry; best WPM from the sessions. A
 * lesson that has sessions but no list entry (a round written before lists
 * existed) is rebuilt from its sessions so it is not shown as never played.
 */
export function lessonsFromSnapshot(snapshot: ProgressSnapshot): Record<string, LessonProgress> {
  const lessons: Record<string, LessonProgress> = {}

  for (const list of Object.values(snapshot.lists ?? {})) {
    if (list.subject !== TYPING_SUBJECT) continue
    lessons[list.listId] = {
      stars: list.stars,
      bestWpm: 0,
      bestAccuracy: list.bestAccuracy,
      bestScore: list.bestScore,
      plays: list.plays,
    }
  }

  // Which lessons the list entries already describe. For those, sessions only
  // contribute WPM; for the rest, sessions are all there is.
  const listed = new Set(Object.keys(lessons))

  for (const s of snapshot.sessions ?? []) {
    if (!isTypingLesson(s)) continue
    const wpm = s.wpm ?? 0
    if (listed.has(s.listId)) {
      const entry = lessons[s.listId]!
      entry.bestWpm = Math.max(entry.bestWpm, wpm)
      continue
    }
    const stars = typeof s.meta?.stars === 'number' ? s.meta.stars : 0
    const cur = lessons[s.listId]
    lessons[s.listId] = {
      stars: Math.max(cur?.stars ?? 0, stars),
      bestWpm: Math.max(cur?.bestWpm ?? 0, wpm),
      bestAccuracy: Math.max(cur?.bestAccuracy ?? 0, s.accuracy),
      bestScore: Math.max(cur?.bestScore ?? 0, s.score),
      plays: (cur?.plays ?? 0) + 1,
    }
  }

  return lessons
}

/** The star total across every lesson — what the home screen counts. */
export function totalStarsOf(lessons: Record<string, LessonProgress>): number {
  return Object.values(lessons).reduce((n, l) => n + l.stars, 0)
}

/** How many lessons have been finished at least once. */
export function lessonsDone(lessons: Record<string, LessonProgress>): number {
  return Object.values(lessons).filter((l) => l.plays > 0).length
}

/**
 * Fold one finished round into a lesson's progress: bests win, plays add.
 * The same rule whether the previous record came from the account or from a
 * round finished a moment ago.
 */
export function foldRound(
  existing: LessonProgress | undefined,
  result: RoundResult,
  stars: number,
): LessonProgress {
  return {
    stars: Math.max(existing?.stars ?? 0, stars),
    bestWpm: Math.max(existing?.bestWpm ?? 0, result.wpm),
    bestAccuracy: Math.max(existing?.bestAccuracy ?? 0, result.accuracy),
    bestScore: Math.max(existing?.bestScore ?? 0, result.score),
    plays: (existing?.plays ?? 0) + 1,
  }
}

/**
 * Two views of the same lesson — the account's and a round recorded before the
 * account caught up — reconciled: bests win, and the higher play count is the
 * true one (never the sum, which would count a round twice).
 */
export function mergeLesson(a: LessonProgress | undefined, b: LessonProgress | undefined): LessonProgress | undefined {
  if (!a) return b
  if (!b) return a
  return {
    stars: Math.max(a.stars, b.stars),
    bestWpm: Math.max(a.bestWpm, b.bestWpm),
    bestAccuracy: Math.max(a.bestAccuracy, b.bestAccuracy),
    bestScore: Math.max(a.bestScore, b.bestScore),
    plays: Math.max(a.plays, b.plays),
  }
}

/**
 * The list entry to commit for a finished lesson.
 *
 * The API and the in-memory snapshot both *replace* a list entry rather than
 * add to it (see progressWrite.ts and repo.ts `applyChange`), so the caller
 * sends the already-folded record — the same way spelling and quiz do.
 */
export function typingListChange(
  snapshot: ProgressSnapshot,
  lessonId: string,
  result: RoundResult,
  stars: number,
  now: number,
): ListProgress {
  const existing = snapshot.lists?.[listKey(TYPING_SUBJECT, lessonId)]
  return {
    subject: TYPING_SUBJECT,
    listId: lessonId,
    plays: (existing?.plays ?? 0) + 1,
    testsTaken: (existing?.testsTaken ?? 0) + 1,
    bestScore: Math.max(existing?.bestScore ?? 0, result.score),
    bestAccuracy: Math.max(existing?.bestAccuracy ?? 0, result.accuracy),
    stars: Math.max(existing?.stars ?? 0, stars),
    masteredAt: existing?.masteredAt ?? (stars >= 3 ? now : null),
  }
}
