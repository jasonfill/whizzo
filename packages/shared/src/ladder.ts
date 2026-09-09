// The mastery ladder.
//
// Where an item sits is three coordinates, not one rung — see
// docs/learning-activities-spec.md, *The mastery ladder*. This module owns the
// first: **retrieval support**, which is how much scaffolding a question gives
// before the learner has to produce the answer.
//
//   0 Encounter    they have met it
//   1 Recognize    they can pick it out from among others
//   2 Recall-cued  they can produce it with a scaffold
//   3 Recall-free  they can produce it from nothing
//
// Two things make this worth having in `shared` rather than in the planner.
//
// **It is derivable from attempts alone.** `attempts` is the append-only record
// every other table is a cache of, and it carries everything needed here: the
// activity, whether the answer was right, whether the app checked it, which
// round it was in, and when. So a level is never a number somebody stored and
// might have got wrong — it is recomputed, the same way `rebuild_item_mastery`
// recomputes mastery. The API needs that as much as the web app does.
//
// **The rules are easy to get subtly wrong in a way that flatters the numbers.**
// Every one of them below fails toward *not* promoting, on purpose.

import type { Attempt, DayString } from './progress.js'
import { todayString } from './progress.js'

export type SupportLevel = 0 | 1 | 2 | 3

export const SUPPORT_LEVELS: SupportLevel[] = [0, 1, 2, 3]

export const SUPPORT_LEVEL_NAMES: Record<SupportLevel, string> = {
  0: 'Encounter',
  1: 'Recognize',
  2: 'Recall with a scaffold',
  3: 'Recall from memory',
}

/**
 * Which rung an activity asks a question at.
 *
 * **Versioned, and the version matters.** A level is derived from history, so
 * moving an activity between rungs silently rewrites what every past attempt
 * meant. Anything that caches a derived level stores the version alongside it
 * and recomputes when they disagree; anything that compares two learners'
 * levels across a version boundary is comparing different things.
 *
 * Bump this when a value changes, never when one is added — a new activity
 * cannot change the meaning of an attempt that predates it.
 */
export const ACTIVITY_STAGE_VERSION = 1

/**
 * Existing activities map on directly, which is the evidence that the ladder
 * describes the app we already have rather than a new one.
 */
export const ACTIVITY_STAGE: Readonly<Record<string, SupportLevel>> = Object.freeze({
  // Spelling
  study: 0,
  proofread: 1,
  'missing-letters': 2,
  scramble: 2,
  'listen-spell': 3,
  test: 3,

  // Quiz
  flashcards: 0,
  match: 1,
  // Every card asked as a four-way choice, start to finish. Recognition and
  // nothing more, whatever the card's own rung — which is why it sits here
  // and never at the rung Learn would have asked at.
  choice: 1,
  learn: 3,
  // Unprompted free recall of a whole set: the least supported retrieval there
  // is, and the strongest evidence a rung can carry.
  recall: 3,
  review: 2,
  // A tutor round run through an assistant is Learn from outside: each card is
  // asked at its own rung and records it in `askedAt`, so the mode's rung is
  // only the fallback, and it is the same one Learn has.
  tutor: 3,

  // Typing rounds are a motor skill rather than a retrieval, but a lesson is
  // unaided production of what was just shown, so it sits where that sits.
  lesson: 3,
  practice: 2,
  rain: 2,
})

/**
 * The rung an activity asks at. Unknown activities are treated as level 0 —
 * exposure — because an activity nobody has classified must not be able to
 * promote an item by accident.
 */
export function stageOf(activity: string): SupportLevel {
  return ACTIVITY_STAGE[activity] ?? 0
}

/**
 * The rung one attempt was actually asked at.
 *
 * `askedAt` wins when it is there, because a mode is a container: a round of
 * Learn asks each card at whatever rung that card is on, so `activity` alone
 * would read a scaffolded question back as unaided recall. Attempts recorded
 * before the ladder existed have no `askedAt`, and for those the mode's own
 * rung is the honest answer.
 */
export function askedAtOf(attempt: Pick<Attempt, 'activity' | 'askedAt'>): SupportLevel {
  const asked = attempt.askedAt
  if (asked === 0 || asked === 1 || asked === 2 || asked === 3) return asked
  return stageOf(attempt.activity)
}

/** Where one item sits, and what the evidence for that was. */
export interface LadderState {
  level: SupportLevel
  /** Corrects banked toward the next rung. Never more than one short of it. */
  progress: number
  /** How many times this item has been answered correctly at a transfer activity. */
  transfer: number
  /**
   * Consecutive misses at or above the current rung, with no correct between.
   * One is a lapse; two is the item not holding. See `applyAttemptToLadder`.
   */
  slips: number
  /**
   * The round and day the banked correct came from.
   *
   * Held in the state rather than tracked by the caller. It used to be
   * bookkeeping in `deriveLadderState`, and that let two bugs in: an
   * unverified miss cleared it (so a self-graded wrong answer between two
   * same-day corrects let massed practice promote — defeating the one rule
   * this whole module exists to enforce), and a correct transfer answer
   * overwrote it (so applying a concept blocked a legitimate promotion).
   * Both came from bookkeeping that did not know which attempts had actually
   * mattered. In the state, only the code that changes the state can move it.
   */
  bankedSession: string | null
  bankedDay: DayString | null
  /** The day the item last moved up, for the spacing rule and for reporting. */
  promotedOn: DayString | null
  /** Which `ACTIVITY_STAGE` this was computed against. */
  version: number
}

/** Corrects needed at the current rung before an item moves up. */
export const PROMOTION_EVIDENCE = 2

/**
 * Consecutive misses before an item drops a rung. Two rather than one, because
 * one is what practicing at the frontier looks like when it is working.
 */
export const DEMOTION_SLIPS = 2

export function initialLadderState(): LadderState {
  return {
    level: 0,
    progress: 0,
    transfer: 0,
    slips: 0,
    bankedSession: null,
    bankedDay: null,
    promotedOn: null,
    version: ACTIVITY_STAGE_VERSION,
  }
}

/** Activities that ask a learner to use the item somewhere new, not to recall it. */
const TRANSFER_ACTIVITIES = new Set(['apply', 'compare', 'solve', 'use-it'])

function dayOf(at: number): DayString {
  return todayString(new Date(at))
}

/**
 * Fold one attempt into an item's ladder state.
 *
 * Four rules, each of which fails toward *not* promoting:
 *
 * 1. **Only checked answers are evidence.** An unverified attempt — a
 *    flashcard self-grade — moves nothing. The learner may well have known it;
 *    nobody watched.
 * 2. **A within-round repeat never promotes.** A missed card comes back four
 *    places later, and that second correct is massed practice minutes after
 *    the first. It is worth a great deal for fixing the error and nothing at
 *    all as evidence of durable retrieval, so it restores the item without
 *    advancing it. Without this rule the requeue policy quietly manufactures
 *    promotions, which is the most likely way this ladder goes wrong: it fails
 *    in the direction of numbers that look good.
 * 3. **The two corrects must be on different days.** Same reason, at a longer
 *    scale — the whole claim being made is that the item survived a gap.
 * 4. **One miss costs the banked evidence; two in a row cost a rung.** A lapse
 *    is a lapse, not amnesia — and demoting on every single miss turns out to
 *    be worse than harsh, it is unstable. An item practiced at the learner's
 *    frontier is *meant* to be missed sometimes; if one miss both wipes the
 *    progress and drops the rung, the item ping-pongs and a learner who is
 *    genuinely getting 90% of them right never reaches free recall at all.
 *    The ladder simulation caught exactly that. So a miss always spends the
 *    banked corrects, and the rung only moves when the item misses twice
 *    running with nothing right in between. Dropping to zero is never on the
 *    table: that would make one bad evening undo a month.
 *
 * An attempt *below* the current level is practice and is left alone. There is
 * no way to demote by getting an easier question wrong, and no way to promote
 * by getting an easier question right.
 */
export function applyAttemptToLadder(previous: LadderState | undefined, attempt: Attempt): LadderState {
  const state = previous ?? initialLadderState()

  // Transfer runs alongside the rungs, not through them. It touches nothing
  // else — including the banked evidence, which it used to clobber.
  if (TRANSFER_ACTIVITIES.has(attempt.activity)) {
    if (attempt.correct && attempt.verified) return { ...state, transfer: state.transfer + 1 }
    return state
  }

  // Rule 1. Nothing unchecked is evidence of anything — and that includes not
  // being evidence that the learner has *forgotten* it.
  if (!attempt.verified) return state

  // A question easier than where the item already sits tells us nothing new.
  if (askedAtOf(attempt) < state.level) return state

  if (!attempt.correct) {
    // Rule 4. The banked evidence always goes; the rung only goes on a second
    // consecutive miss.
    const slips = state.slips + 1
    const spent = { ...state, progress: 0, bankedSession: null, bankedDay: null }
    if (slips < DEMOTION_SLIPS) return { ...spent, slips }
    return { ...spent, level: Math.max(0, state.level - 1) as SupportLevel, slips: 0 }
  }

  const day = dayOf(attempt.at)

  // Rules 2 and 3: this correct only counts if it is a different round *and* a
  // different day from the one already banked.
  if (state.progress > 0) {
    const sameRound = state.bankedSession != null && state.bankedSession === attempt.sessionId
    if (sameRound || state.bankedDay === day) return state
  }

  const progress = state.progress + 1
  if (progress < PROMOTION_EVIDENCE) {
    return {
      ...state,
      progress,
      slips: 0,
      bankedSession: attempt.sessionId ?? null,
      bankedDay: day,
    }
  }

  // Nothing passes level 3: free production stays in rotation rather than
  // being retired by anything that comes after it.
  return {
    ...state,
    level: Math.min(3, state.level + 1) as SupportLevel,
    progress: 0,
    slips: 0,
    bankedSession: null,
    bankedDay: null,
    promotedOn: day,
  }
}

/**
 * Derive an item's ladder state from its whole history.
 *
 * This is the function the rest of the app should use. Attempts are sorted by
 * time first, because a caller handing them over in storage order rather than
 * chronological order would otherwise get a plausible and wrong answer.
 *
 * **Testing out.** An item answered right, first time, unaided and checked
 * arrives at level 3 without climbing — a learner who already knows something
 * should not have to prove it four times. Arriving is not passing: it still
 * cannot go beyond 3, and it is not yet *mastered*, which is a separate and
 * stricter claim.
 */
export function deriveLadderState(attempts: Attempt[]): LadderState {
  if (!attempts.length) return initialLadderState()

  const ordered = [...attempts].sort((a, b) => a.at - b.at)
  const first = ordered[0]

  let state = initialLadderState()
  let start = 0

  if (
    askedAtOf(first) === 3 &&
    first.correct &&
    first.verified &&
    first.hintsUsed === 0 &&
    first.isTest
  ) {
    state = { ...state, level: 3, promotedOn: dayOf(first.at) }
    start = 1
  }

  for (let i = start; i < ordered.length; i++) {
    state = applyAttemptToLadder(state, ordered[i])
  }

  return state
}

// ---------------------------------------------------------------------------
// Bridging from cached mastery
// ---------------------------------------------------------------------------
//
// `deriveLadderState` is the truth, and it needs attempts. The planner does not
// have them: `ProgressSnapshot` carries `ItemMastery`, which is a *cache* of
// what the attempts said, and loading every attempt to plan a ten-card round
// would be absurd.
//
// So until a derived level is cached on the mastery row itself — the same
// treatment `rebuild_item_mastery` already gives the mastery number — this maps
// the cached numbers onto a rung.
//
// **It deliberately under-estimates.** Every boundary below rounds toward more
// scaffolding, because the two errors are not equal: offering an easier
// question than necessary costs a learner a few seconds, and offering a harder
// one than they are ready for costs them the belief that they can do it.

/** The bits of `ItemMastery` this needs, so callers need not pass the whole row. */
export interface MasteryShape {
  mastery: number
  reps: number
  correctStreak: number
}

export function supportLevelFromMastery(item: MasteryShape | undefined): SupportLevel {
  if (!item || item.reps === 0) return 0
  // One right answer is not evidence of anything; two in a row at least rhymes
  // with the promotion rule.
  if (item.mastery < 0.35) return 1
  if (item.mastery < 0.7) return 2
  return item.correctStreak >= 2 ? 3 : 2
}
