// Cross-subject readings of the snapshot that more than one screen needs.
//
// The important one is `unaidedAccuracy`. Everywhere the product talks about a
// level, it means the level that unaided answers earned — a hinted word stops
// counting, and a practice round never counted. Deriving that here rather than
// on each screen is what keeps the student home, the session footer and the
// parent report quoting the same number.

import { areaOf, GENERAL_TRACK, showsAbility, skillKey, trackOf } from '@whizzo/shared'
import { masteryBand } from '../adaptive'
import type { ProgressSnapshot, SessionRecord } from './types'

/** Rounds the system graded: no hints taken, spelled from scratch. */
export function gradedSessions(snapshot: ProgressSnapshot): SessionRecord[] {
  return snapshot.sessions.filter((s) => s.isTest)
}

/**
 * Accuracy over graded rounds only, 0..100, or null when there are none yet.
 *
 * Null rather than zero on purpose: "no graded work yet" and "graded work that
 * went badly" are different things, and showing 0% for the first is a lie.
 */
export function unaidedAccuracy(snapshot: ProgressSnapshot): number | null {
  let total = 0
  let correct = 0
  for (const s of gradedSessions(snapshot)) {
    total += s.itemsTotal
    correct += s.itemsCorrect
  }
  if (total === 0) return null
  return Math.round((correct / total) * 100)
}

/** The longest run of consecutive days across every subject. */
export function bestStreak(snapshot: ProgressSnapshot): number {
  return Object.values(snapshot.skills).reduce((n, s) => Math.max(n, s?.streakDays ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Per-track reading
// ---------------------------------------------------------------------------
//
// The reason tracks exist. "Quiz: 71%" averages Spanish vocabulary, cell
// biology and state capitals — three unrelated things — and tells a parent
// nothing they can act on. Split by pool it becomes "Biology 62% · Spanish
// 88%", which says where to help.

export interface TrackReading {
  trackId: string
  name: string
  areaName: string
  /** Distinct cards answered in this pool. */
  items: number
  /** Cards at the mastered band. */
  mastered: number
  /** Accuracy over answers the app checked, 0..100, or null when none. */
  accuracy: number | null
  /** Only shown where it means something — see `showsAbility`. */
  ability: number | null
  lastPracticedAt: number | null
}

/**
 * One reading per pool the learner has actually worked in.
 *
 * Built from `mastery` rather than from sessions, because mastery is per item
 * and a pool is a set of items — a round that crossed decks belongs to no
 * single pool, and counting it under one would be inventing a number.
 *
 * Pools with no work in them are left out entirely. A report listing twenty
 * subjects at 0% is a worse report than one listing the three a learner has
 * touched.
 */
export function trackReadings(
  snapshot: ProgressSnapshot,
  deckTrackOf: (deckId: string) => string | null | undefined,
): TrackReading[] {
  const byTrack = new Map<string, { items: number; mastered: number; last: number | null }>()

  for (const item of Object.values(snapshot.mastery)) {
    if (!item || item.subject !== 'quiz') continue
    // The item key is `deckId:cardId`; the deck knows the pool.
    const deckId = item.itemKey.slice(0, item.itemKey.indexOf(':'))
    const id = trackOf(deckTrackOf(deckId)).id
    const bucket = byTrack.get(id) ?? { items: 0, mastered: 0, last: null }
    bucket.items += 1
    if (masteryBand(item) === 'mastered') bucket.mastered += 1
    bucket.last = Math.max(bucket.last ?? 0, item.lastSeenAt) || null
    byTrack.set(id, bucket)
  }

  const readings: TrackReading[] = []
  for (const [trackId, bucket] of byTrack) {
    const track = trackOf(trackId)
    const skill = snapshot.skills[skillKey('quiz', trackId === GENERAL_TRACK ? null : trackId)]
    const checked = accuracyIn(snapshot, trackId, deckTrackOf)
    readings.push({
      trackId,
      name: track.name,
      areaName: areaOf(trackId).name,
      items: bucket.items,
      mastered: bucket.mastered,
      accuracy: checked,
      ability: showsAbility(trackId, bucket.items) ? (skill?.ability ?? null) : null,
      lastPracticedAt: bucket.last,
    })
  }

  // Most worked first: the pool a learner is actually in is the one a parent
  // opened the report to read about.
  return readings.sort((a, b) => b.items - a.items || a.name.localeCompare(b.name))
}

/**
 * Accuracy in one pool, over answers the app checked.
 *
 * Checked answers only, for the same reason every other number in the product
 * uses them: a self-graded round is a claim, and a report built on claims is
 * not a report.
 */
function accuracyIn(
  snapshot: ProgressSnapshot,
  trackId: string,
  deckTrackOf: (deckId: string) => string | null | undefined,
): number | null {
  let total = 0
  let correct = 0
  for (const session of snapshot.sessions) {
    if (session.subject !== 'quiz') continue
    const sessionTrack = session.track ?? (session.listId ? deckTrackOf(session.listId) : null)
    if (trackOf(sessionTrack).id !== trackId) continue
    total += session.verifiedItemsTotal ?? 0
    correct += session.verifiedItemsCorrect ?? 0
  }
  if (total === 0) return null
  return Math.round((correct / total) * 100)
}
