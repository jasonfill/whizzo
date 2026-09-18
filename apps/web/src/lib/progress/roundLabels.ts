// How a round is named and measured wherever a grown-up sees one listed —
// the Progress log, a deck's own history, a finished task. One place, so the
// same round never reads "Learn" on one screen and "learn" on another.

import { activityDef } from '@whizzo/shared'
import { MODES } from '../quiz/session'
import { ACTIVITIES } from '../spelling/activities'
import type { SessionRecord } from './types'

export const SUBJECT_EMOJI: Record<string, string> = {
  spelling: '🔤',
  typing: '⌨️',
  quiz: '🃏',
}

/**
 * Session rows store the raw activity id; show the name a person would use.
 *
 * Subject matters here: both spelling and quiz have an activity called 'test',
 * and looking the id up without it would label a quiz round "Spelling Test".
 */
export function activityLabel(activity: string, subject: string): string {
  if (subject === 'quiz') {
    const quizMode = MODES.find((m) => m.id === activity)
    if (quizMode) return quizMode.name
    if (activity === 'review') return 'Card review'
    // Rounds the app itself cannot start — a tutor round run through an
    // assistant — are named by the catalog.
    const def = activityDef(activity)
    if (def) return def.name
    return activity
  }
  const known = ACTIVITIES.find((a) => a.id === activity)
  if (known) return known.name
  if (activity === 'lesson') return 'Typing lesson'
  if (activity === 'cat-rain') return 'Word Rain'
  return activity
}

/**
 * Whether fewer than all of a round's answers were checked by the app — the
 * rest were self-graded. A fully checked round needs no caveat, and only a
 * round that carried its own answers can say either way.
 */
export function partlyChecked(s: SessionRecord): boolean {
  return (
    typeof s.verifiedItemsTotal === 'number' &&
    s.evidence === 'attempts' &&
    s.verifiedItemsTotal < s.itemsTotal
  )
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
