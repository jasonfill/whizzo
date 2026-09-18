// What a learner has actually earned, in collectibles.
//
// The earn rate is FIXED ACROSS ALL TEN THEMES and nothing in this file reads
// the theme except to know how many slots there are to fill. A ribbon and a
// fossil cost exactly the same work; otherwise switching themes would be a way
// to farm easy wins, and a reward would stop meaning anything.
//
// One predicate, `earnsCollectible`, decides whether a round earned one. The
// count on home, the theme's collection screen and every results screen all
// come from it, so they can never disagree (docs/ux-coherence.md, "One
// collectible system"). Three ways to earn, each of which requires the system
// to have checked the work:
//
//   1. A graded round that clears the accuracy predicted for it. Beating the
//      prediction is the bar because it is the one that scales with the
//      learner — a hard set cleared is worth what an easy set cleared is.
//   2. A level promotion.
//   3. A typing lesson cleared at 90%+ accuracy, once per lesson. Typing has
//      no prediction to beat and no levels, so it has its own bar, and the
//      once-per-lesson rule stops a learner replaying the first lesson to fill
//      the wall.
//
// A round earns at most one collectible, however many of those it satisfies.
//
// Practice rounds earn nothing. Neither does a hinted word: hints make a round
// non-graded upstream, so those sessions never reach the first branch. A hinted
// word cannot buy a fossil.

import type { ProgressSnapshot, SessionRecord } from '../progress/types'
import { slotLabels, type Theme } from '../themes'

export interface Earned {
  /** How many collectibles the learner holds, never more than the set size. */
  owned: number
  total: number
  /** Owned as a fraction of the set, 0..1. */
  fraction: number
}

/** The accuracy a typing lesson has to reach to earn one, in percent. */
export const TYPING_ACCURACY_BAR = 90

/**
 * Did the system actually check this round, rather than take the learner's
 * word for it?
 *
 * `isTest` means "no hints were shown" and `verified` means "we checked the
 * answer" — the shared types are explicit that the two are orthogonal. Today
 * no graded quiz mode self-grades, so `isTest` alone happens to be enough; the
 * comment in useQuizSession even says so. That is a coincidence of the current
 * mode list, not a rule, and a reward is exactly the wrong thing to hang on a
 * coincidence. A flashcard self-grade must never buy a collectible.
 */
function wasChecked(s: SessionRecord): boolean {
  // Typing has no self-graded mode: every keystroke is checked by the app, and
  // a lesson is recorded as one round with no per-answer rows. Rounds written
  // before typing carried its verified counts sit at zero, and a rule that
  // read that as "unchecked" would strip every collectible a learner earned
  // before this shipped.
  if (isTypingLesson(s)) return s.evidence !== 'legacy'
  if (typeof s.verifiedItemsTotal !== 'number') {
    // No provenance recorded: 'client' summaries and legacy rows. Trust the
    // round only if it never claimed to be graded in the first place.
    return s.evidence !== 'legacy'
  }
  return s.verifiedItemsTotal >= s.itemsTotal
}

// Accuracy is 0–100 on every session the app writes: typing's RoundResult
// prints it as `${accuracy}%`, and spelling and flashcard rounds store
// `Math.round(correct / total * 100)` next to a prediction on the same scale.
// Nothing here rescales, because a guess ("looks like a fraction") would turn
// a genuine 1% round into a perfect one.

function beatPrediction(s: SessionRecord): boolean {
  // Only graded rounds count, only ones the system checked, and only where a
  // prediction was recorded to beat.
  if (!s.isTest || !wasChecked(s)) return false
  const predicted = s.meta?.predictedAccuracy
  if (typeof predicted !== 'number') return false
  return s.accuracy >= predicted
}

function wasPromotion(s: SessionRecord): boolean {
  return s.meta?.level === 'promote' && wasChecked(s)
}

function isTypingLesson(s: SessionRecord): boolean {
  return s.subject === 'typing' && s.activity === 'lesson'
}

function clearedTypingLesson(s: SessionRecord): boolean {
  return (
    isTypingLesson(s) &&
    s.listId !== null &&
    wasChecked(s) &&
    s.itemsTotal > 0 &&
    s.accuracy >= TYPING_ACCURACY_BAR
  )
}

/**
 * Does this one round earn a collectible?
 *
 * The same rule `earnedFor` counts with, asked about a single session so a
 * results screen can say so honestly. `prior` is every session that came
 * before it, for the rule that pays once per lesson: a typing lesson earns on
 * the first round that clears the bar and never again, however many times it
 * is replayed.
 */
export function earnsCollectible(session: SessionRecord, prior: readonly SessionRecord[]): boolean {
  if (beatPrediction(session) || wasPromotion(session)) return true
  if (!clearedTypingLesson(session)) return false
  return !prior.some(
    (p) => p.id !== session.id && p.listId === session.listId && clearedTypingLesson(p),
  )
}

/** Oldest first, so "prior" means what it says. The snapshot keeps newest first. */
function chronological(sessions: readonly SessionRecord[]): SessionRecord[] {
  return [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt)
}

export function earnedFor(snapshot: ProgressSnapshot, theme: Theme): Earned {
  const ordered = chronological(snapshot.sessions)
  let count = 0
  for (let i = 0; i < ordered.length; i++) {
    if (earnsCollectible(ordered[i]!, ordered.slice(0, i))) count += 1
  }
  const owned = Math.min(theme.total, count)
  return {
    owned,
    total: theme.total,
    fraction: theme.total > 0 ? owned / theme.total : 0,
  }
}

export interface RoundCollectible {
  /** Did this round earn one? */
  earned: boolean
  /**
   * Which slot of the theme's set it fills — the next unfilled one, in the
   * same order the collection screen fills them, so the results screen and
   * the wall name the same item.
   */
  slot: number
  /** That slot's name in the current theme. */
  name: string
}

/**
 * What one round earned, and what to call it.
 *
 * Works whether or not the snapshot already holds the round: the round is
 * taken out of the history by id, so an optimistic write does not count
 * itself as its own predecessor.
 */
export function roundCollectible(
  snapshot: ProgressSnapshot,
  theme: Theme,
  session: SessionRecord,
): RoundCollectible {
  const prior = snapshot.sessions.filter((s) => s.id !== session.id)
  const earned = earnsCollectible(session, prior)
  const before = earnedFor({ ...snapshot, sessions: prior }, theme).owned
  const slot = Math.min(theme.total - 1, Math.max(0, before))
  const name = slotLabels(theme)[slot] ?? theme.unitOne
  return { earned, slot, name }
}

/**
 * The shape a results screen knows a round by, when it does not have the
 * stored record in hand: enough to find the same round in the snapshot.
 */
export type RoundProbe = Pick<
  SessionRecord,
  'subject' | 'activity' | 'listId' | 'itemsTotal' | 'itemsCorrect' | 'accuracy'
>

/**
 * The newest stored session that matches a round summary, if the snapshot
 * has it. Play hooks commit the round before they show results, so it
 * normally does; a screen that finds nothing should build the record from
 * its summary rather than guess.
 */
export function findRound(snapshot: ProgressSnapshot, probe: RoundProbe): SessionRecord | undefined {
  const candidates = snapshot.sessions.filter(
    (s) =>
      s.subject === probe.subject &&
      s.activity === probe.activity &&
      s.listId === probe.listId &&
      s.itemsTotal === probe.itemsTotal &&
      s.itemsCorrect === probe.itemsCorrect &&
      s.accuracy === probe.accuracy,
  )
  if (!candidates.length) return undefined
  return candidates.reduce((newest, s) => (s.endedAt > newest.endedAt ? s : newest))
}
