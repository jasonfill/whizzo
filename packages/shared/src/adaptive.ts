// ---------------------------------------------------------------------------
// The adaptive engine.
//
// Two ideas do all the work, and both are driven only by recorded attempts:
//
//   1. Ability estimation. Learner ability and item difficulty share one scale.
//      After every graded attempt we compare what happened to what the model
//      expected and nudge the estimate — the same math as an Elo rating, which
//      is the discrete-response cousin of the item response theory that
//      standardized reading and spelling assessments are built on.
//
//   2. Spaced repetition. A word answered correctly comes back later and later;
//      a word missed comes back tomorrow. Intervals are per-word, so the
//      schedule is a direct function of that learner's own history.
//
// Nothing here reads the clock beyond "today", and nothing is random unless a
// caller passes a seeded picker, so the behavior is testable.
//
// Moved here from apps/web/src/lib/adaptive.ts, unchanged, because a round run
// server-side (docs/mcp-tutor-spec.md) has to fold its attempts into mastery
// and ability with exactly the arithmetic the app uses. One engine, two callers.
// ---------------------------------------------------------------------------

import {
  addDays,
  daysBetween,
  todayString,
  type Attempt,
  type DayString,
  type ItemMastery,
  type SkillState,
} from './progress.js'

// --- Ability -------------------------------------------------------------

/** Probability this learner spells an item of this difficulty correctly. */
export function expectedCorrect(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp((difficulty - ability) * 1.15))
}

/**
 * Learning rate. Large while we know little about the learner (so placement
 * converges in a handful of items), small once there is real evidence.
 */
function learningRate(attempts: number): number {
  return Math.max(0.06, 0.55 / Math.sqrt(1 + attempts / 8))
}

export interface AbilityUpdate {
  ability: number
  abilitySd: number
  /** How surprising the result was, 0..1. Used for encouraging feedback copy. */
  surprise: number
}

/**
 * Update ability from one graded attempt. Practice attempts (hints shown,
 * multiple choice, letters visible) deliberately do NOT move the estimate —
 * only unaided spelling counts, which is what keeps the level honest.
 */
export function updateAbility(
  state: Pick<SkillState, 'ability' | 'abilitySd' | 'totalAttempts'>,
  difficulty: number,
  correct: boolean,
): AbilityUpdate {
  const expected = expectedCorrect(state.ability, difficulty)
  const observed = correct ? 1 : 0
  const k = learningRate(state.totalAttempts)
  const ability = state.ability + k * (observed - expected)

  // Confidence tightens with evidence but never fully collapses, so a learner
  // who improves after a long break can still move.
  const abilitySd = Math.max(0.25, state.abilitySd * 0.97)

  return {
    ability: Math.round(Math.max(0.5, Math.min(12, ability)) * 1000) / 1000,
    abilitySd: Math.round(abilitySd * 1000) / 1000,
    surprise: Math.abs(observed - expected),
  }
}

// --- Spaced repetition ---------------------------------------------------

/** Interval ladder in days, indexed by consecutive correct answers. */
const INTERVALS = [1, 2, 4, 8, 16, 32, 60]

/**
 * A missed word is due again immediately rather than tomorrow, so it comes back
 * in the learner's next round of the same sitting. Waiting a day to revisit a
 * word somebody got wrong five minutes ago wastes the one moment they are most
 * primed to fix it, and a child practicing three rounds after school would
 * otherwise never see their own mistakes again that day.
 */
const RELEARN_INTERVAL_DAYS = 0

function intervalForStreak(streak: number, difficulty: number, ability: number): number {
  const base = INTERVALS[Math.min(streak, INTERVALS.length - 1)]
  // A word well below the learner's level can wait a little longer; one above
  // their level comes back sooner.
  const relative = ability - difficulty
  const stretch = Math.max(0.6, Math.min(1.6, 1 + relative * 0.15))
  return Math.round(base * stretch * 10) / 10
}

/** Recency-weighted mastery: the most recent result counts most. */
export function blendMastery(previous: number, reps: number, correct: boolean): number {
  // First graded sighting: take the result at face value but discounted, so one
  // lucky answer does not read as mastery.
  if (reps === 0) return correct ? 0.55 : 0
  const weight = 0.38
  const next = previous * (1 - weight) + (correct ? 1 : 0) * weight
  return Math.round(Math.max(0, Math.min(1, next)) * 1000) / 1000
}

/** How much of a self-reported "I got it" counts, against 0.38 for a checked answer. */
const SELF_REPORT_WEIGHT = 0.15

/**
 * The ceiling a card can reach on self-report alone — deliberately below
 * MASTERED_THRESHOLD, so "mastered" always means the system saw it happen.
 */
export const UNVERIFIED_CEILING = 0.7

/** A self-reported correct answer never buys more than a couple of days off. */
const UNVERIFIED_MAX_INTERVAL_DAYS = 3

/**
 * Fold a self-graded attempt into mastery, trusting the two answers very
 * differently.
 *
 * "I missed it" is a learner volunteering bad news against their own interest,
 * and there is no reason to doubt it — it lands at full weight, same as a
 * checked answer. "I got it" is a claim about a card nobody verified, so it
 * earns a fraction of the credit and can never on its own carry a card into
 * the mastered band. A learner who taps through claiming everything gets the
 * cards back tomorrow rather than a clean sheet, which is the point.
 */
export function blendSelfReport(previous: number, reps: number, correct: boolean): number {
  if (!correct) return blendMastery(previous, reps, false)
  const next = previous * (1 - SELF_REPORT_WEIGHT) + SELF_REPORT_WEIGHT
  // The ceiling caps what self-report can *build*, and must never claw back
  // what checked answers already earned: a learner flicking through a deck
  // they have genuinely mastered should not be demoted for it.
  const capped = Math.max(previous, Math.min(UNVERIFIED_CEILING, next))
  return Math.round(Math.max(0, capped) * 1000) / 1000
}

export const MASTERED_THRESHOLD = 0.8
export const LEARNING_THRESHOLD = 0.45

export type MasteryBand = 'new' | 'learning' | 'practiced' | 'mastered'

export function masteryBand(item: ItemMastery | undefined): MasteryBand {
  if (!item || item.totalAttempts === 0) return 'new'
  if (item.mastery >= MASTERED_THRESHOLD && item.correctStreak >= 2) return 'mastered'
  if (item.mastery >= LEARNING_THRESHOLD) return 'practiced'
  return 'learning'
}

export interface ApplyAttemptOptions {
  today?: DayString
  ability?: number
}

/**
 * Fold one attempt into an item's mastery record. Practice attempts still
 * update reps and the schedule (the learner did see the word) but only graded
 * attempts move the mastery number.
 *
 * Verification is the second axis. An attempt the system checked is worth what
 * it always was; a self-graded one is discounted, capped, and kept out of the
 * mastered band entirely. See blendSelfReport.
 */
export function applyAttemptToMastery(
  previous: ItemMastery | undefined,
  attempt: Attempt,
  opts: ApplyAttemptOptions = {},
): ItemMastery {
  const today = opts.today ?? todayString()
  const ability = opts.ability ?? attempt.difficulty
  const base: ItemMastery = previous ?? {
    subject: attempt.subject,
    itemKey: attempt.itemKey,
    listId: null,
    difficulty: attempt.difficulty,
    mastery: 0,
    reps: 0,
    lapses: 0,
    correctStreak: 0,
    totalAttempts: 0,
    totalCorrect: 0,
    intervalDays: 0,
    dueOn: null,
    firstSeenAt: attempt.at,
    lastSeenAt: attempt.at,
  }

  // An encounter — a card shown with its answer, nothing asked, recorded at
  // rung 0 — is not an answer of either kind. It says the card was met and
  // nothing else: no streak, no lapse, no schedule. A study round through the
  // tutor (docs/mcp-tutor-spec.md) is the first thing to record one; the rule
  // lives here so any future study mode in the app gets it for free.
  if (attempt.askedAt === 0) {
    return {
      ...base,
      difficulty: attempt.difficulty || base.difficulty,
      totalAttempts: base.totalAttempts + 1,
      lastSeenAt: attempt.at,
    }
  }

  // A self-graded claim does not advance the streak, because the streak is half
  // of what defines the mastered band and the other half is already capped.
  // Mastered therefore always rests on answers the system checked.
  const selfReported = attempt.verified === false
  const correctStreak = attempt.correct
    ? selfReported
      ? base.correctStreak
      : base.correctStreak + 1
    : 0
  const lapses = !attempt.correct && base.correctStreak > 0 ? base.lapses + 1 : base.lapses
  const mastery = !attempt.isTest
    ? base.mastery
    : selfReported
      ? blendSelfReport(base.mastery, base.reps, attempt.correct)
      : blendMastery(base.mastery, base.reps, attempt.correct)

  // Scheduling: a miss re-enters the short-term queue; a hit climbs the ladder.
  // A self-reported hit climbs it too, but only so far — an unverified card
  // comes back within a few days, where a checked one can go weeks.
  const intervalDays = !attempt.correct
    ? RELEARN_INTERVAL_DAYS
    : selfReported
      ? // Same rule as the mastery ceiling: a claim buys a few days at most,
        // and never shortens a schedule that checked answers have stretched.
        Math.max(
          base.intervalDays,
          Math.min(
            UNVERIFIED_MAX_INTERVAL_DAYS,
            intervalForStreak(Math.max(0, correctStreak - 1), base.difficulty, ability),
          ),
        )
      : intervalForStreak(correctStreak - 1, base.difficulty, ability)

  return {
    ...base,
    difficulty: attempt.difficulty || base.difficulty,
    mastery,
    reps: base.reps + (attempt.isTest ? 1 : 0),
    lapses,
    correctStreak,
    totalAttempts: base.totalAttempts + 1,
    totalCorrect: base.totalCorrect + (attempt.correct ? 1 : 0),
    intervalDays,
    dueOn: addDays(today, intervalDays),
    lastSeenAt: attempt.at,
  }
}

export function isDue(item: ItemMastery, today: DayString = todayString()): boolean {
  if (!item.dueOn) return true
  return daysBetween(item.dueOn, today) >= 0
}

/** How overdue an item is, in days. Negative means not due yet. */
export function overdueBy(item: ItemMastery, today: DayString = todayString()): number {
  if (!item.dueOn) return 999
  return daysBetween(item.dueOn, today)
}

// --- Level promotion -----------------------------------------------------

export interface LevelDecision {
  levelIndex: number
  direction: 'promote' | 'demote' | 'hold'
  reason: string
}

export interface PromotionInput {
  state: SkillState
  /** Difficulty of the current level, i.e. the grade number it targets. */
  levelDifficulty: number
  /** Number of levels in the curriculum. */
  levelCount: number
  /** Fraction of the current level's words at mastered band, 0..1. */
  levelMastered: number
  /** Graded attempts recorded at the current level. */
  levelAttempts: number
  /** Accuracy over the learner's most recent graded attempts, 0..1. */
  recentAccuracy: number
}

/**
 * Decide whether the learner moves up a grade band.
 *
 * There are two ways up. The normal route needs three independent signals to
 * agree, so a lucky streak is not enough: the ability estimate has to clear the
 * level, the learner has to have actually mastered most of the level's words,
 * and recent graded accuracy has to be high.
 *
 * The second route is a test-out. A learner who arrives already spelling well
 * above the band should not have to grind through sixty words they can
 * already spell to prove it — once the ability estimate is a clear grade and a
 * bit beyond the level, and recent work is nearly flawless, they move up on
 * evidence alone. Without this a strong speller stalls mid-curriculum being
 * asked words that are far too easy, which is exactly what the simulation in
 * scripts/simulate-adaptive.ts is there to catch.
 *
 * Demotion is deliberately easier to trigger than promotion — being stuck one
 * band too high is far more damaging than one band too low.
 */
export function evaluateLevel(input: PromotionInput): LevelDecision {
  const { state, levelDifficulty, levelCount, levelMastered, levelAttempts, recentAccuracy } = input
  const level = state.levelIndex

  if (
    level < levelCount - 1 &&
    levelAttempts >= 24 &&
    state.ability >= levelDifficulty + 0.6 &&
    levelMastered >= 0.6 &&
    recentAccuracy >= 0.85
  ) {
    return {
      levelIndex: level + 1,
      direction: 'promote',
      reason: 'Mastered this level and spelling above it consistently.',
    }
  }

  // Test-out: the words here are demonstrably too easy.
  if (
    level < levelCount - 1 &&
    levelAttempts >= 12 &&
    state.ability >= levelDifficulty + 1.2 &&
    recentAccuracy >= 0.9
  ) {
    return {
      levelIndex: level + 1,
      direction: 'promote',
      reason: 'These words are too easy for you — skipping ahead.',
    }
  }

  if (
    level > 0 &&
    levelAttempts >= 16 &&
    state.ability <= levelDifficulty - 1.0 &&
    recentAccuracy < 0.5
  ) {
    return {
      levelIndex: level - 1,
      direction: 'demote',
      reason: 'These words are still too hard — backing up to rebuild confidence.',
    }
  }

  return { levelIndex: level, direction: 'hold', reason: 'Keep practicing this level.' }
}

/**
 * Placement from a short diagnostic: pick the level whose difficulty best
 * matches the ability the diagnostic produced, biased one notch down so the
 * learner starts on solid ground.
 */
export function placeLevel(ability: number, levelDifficulties: number[]): number {
  let best = 0
  let bestGap = Infinity
  levelDifficulties.forEach((d, i) => {
    const gap = Math.abs(ability - 0.4 - d)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  })
  return best
}

// --- Streaks -------------------------------------------------------------

export function updateStreak(state: SkillState, today: DayString = todayString()): SkillState {
  if (state.lastActiveOn === today) return state
  const gap = state.lastActiveOn ? daysBetween(state.lastActiveOn, today) : Infinity
  const streakDays = gap === 1 ? state.streakDays + 1 : 1
  return {
    ...state,
    streakDays,
    bestStreakDays: Math.max(state.bestStreakDays, streakDays),
    lastActiveOn: today,
  }
}

/** Accuracy over the most recent graded attempts, used by evaluateLevel. */
export function recentAccuracy(attempts: Attempt[], window = 30): number {
  const graded = attempts.filter((a) => a.isTest).slice(-window)
  if (graded.length === 0) return 0
  return graded.filter((a) => a.correct).length / graded.length
}
