// The ladder's rules, and in particular the ones that fail toward *not*
// promoting. Every test here that asserts an item did NOT move up is guarding
// against a way the numbers could quietly look better than the learning.

import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_STAGE,
  ACTIVITY_STAGE_VERSION,
  applyAttemptToLadder,
  askedAtOf,
  DEMOTION_SLIPS,
  deriveLadderState,
  initialLadderState,
  PROMOTION_EVIDENCE,
  stageOf,
  supportLevelFromMastery,
  SUPPORT_LEVELS,
  SUPPORT_LEVEL_NAMES,
} from './ladder.js'
import type { Attempt } from './progress.js'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 5, 12) // midday, so a day offset never crosses two

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    subject: 'quiz',
    itemKey: 'd:1',
    activity: 'learn',
    isTest: true,
    verified: true,
    correct: true,
    responseMs: 1000,
    hintsUsed: 0,
    difficulty: 2,
    given: 'x',
    at: T0,
    sessionId: 's1',
    ...over,
  }
}

/** A correct, checked answer at `activity`, on day `d`, in round `s`. */
function ok(activity: string, d: number, s: string): Attempt {
  return attempt({ activity, at: T0 + d * DAY, sessionId: s })
}
function miss(activity: string, d: number, s: string): Attempt {
  return attempt({ activity, at: T0 + d * DAY, sessionId: s, correct: false })
}

describe('the activity map', () => {
  it('places every known activity on a real rung', () => {
    for (const level of Object.values(ACTIVITY_STAGE)) {
      expect(SUPPORT_LEVELS).toContain(level)
    }
  })

  it('names every level', () => {
    for (const level of SUPPORT_LEVELS) {
      expect(SUPPORT_LEVEL_NAMES[level].length).toBeGreaterThan(3)
    }
  })

  it('treats an activity nobody has classified as exposure', () => {
    // An unclassified activity must never be able to promote something by
    // accident, so the safe default is the rung that promotes nothing.
    expect(stageOf('some-new-mode')).toBe(0)
  })

  it('maps the existing activities the way the ladder claims', () => {
    expect(stageOf('proofread')).toBe(1)
    expect(stageOf('scramble')).toBe(2)
    expect(stageOf('listen-spell')).toBe(3)
    expect(stageOf('test')).toBe(3)
  })

  it('carries a version, because moving an activity rewrites history', () => {
    expect(ACTIVITY_STAGE_VERSION).toBeGreaterThanOrEqual(1)
    expect(initialLadderState().version).toBe(ACTIVITY_STAGE_VERSION)
  })
})

describe('what rung a question was actually asked at', () => {
  it('believes the attempt over the mode', () => {
    // Learn is a container: it asks each card at whatever rung that card is
    // on. Reading the mode alone would call a scaffolded question free recall.
    expect(askedAtOf({ activity: 'learn', askedAt: 2 })).toBe(2)
    expect(askedAtOf({ activity: 'learn', askedAt: 1 })).toBe(1)
  })

  it('falls back to the mode for attempts recorded before the ladder existed', () => {
    expect(askedAtOf({ activity: 'learn' })).toBe(3)
    expect(askedAtOf({ activity: 'proofread', askedAt: null })).toBe(1)
  })

  it('ignores a rung that is not a rung', () => {
    expect(askedAtOf({ activity: 'proofread', askedAt: 9 })).toBe(1)
    expect(askedAtOf({ activity: 'proofread', askedAt: -1 })).toBe(1)
  })

  it('does not let a scaffolded question inside Learn promote to free recall', () => {
    // Two correct scaffolded answers on two days: the item climbs to the
    // *scaffolded* rung, not past it.
    const scaffolded = [
      attempt({ activity: 'learn', askedAt: 1, at: T0, sessionId: 'a' }),
      attempt({ activity: 'learn', askedAt: 1, at: T0 + DAY, sessionId: 'b' }),
    ]
    expect(deriveLadderState(scaffolded).level).toBe(1)
  })

  it('does not test out on a scaffolded first answer inside Learn', () => {
    // Without askedAt this reads as `learn` -> rung 3 -> instant test-out on a
    // question that showed the learner half the answer.
    expect(deriveLadderState([attempt({ activity: 'learn', askedAt: 2 })]).level).toBe(0)
  })
})

describe('climbing', () => {
  it('starts at the bottom with nothing banked', () => {
    expect(deriveLadderState([])).toMatchObject({ level: 0, progress: 0, transfer: 0 })
  })

  it('needs two corrects to move up a rung', () => {
    const one = deriveLadderState([ok('proofread', 0, 's1')])
    expect(one).toMatchObject({ level: 0, progress: 1 })

    const two = deriveLadderState([ok('proofread', 0, 's1'), ok('proofread', 1, 's2')])
    expect(two).toMatchObject({ level: 1, progress: 0 })
  })

  it('spends the banked evidence on the way up', () => {
    // Two corrects buy one rung, not two.
    const state = deriveLadderState([
      ok('scramble', 0, 's1'),
      ok('scramble', 1, 's2'),
      ok('scramble', 2, 's3'),
    ])
    expect(state).toMatchObject({ level: 1, progress: 1 })
  })

  it('climbs all the way to free recall with enough spaced evidence', () => {
    const attempts = [0, 1, 2, 3, 4, 5].map((d) => ok('test', d, `s${d}`))
    expect(deriveLadderState(attempts).level).toBe(3)
  })

  it('never goes past free recall, however much evidence arrives', () => {
    const attempts = Array.from({ length: 20 }, (_, d) => ok('test', d, `s${d}`))
    expect(deriveLadderState(attempts).level).toBe(3)
  })

  it('records the day an item moved up', () => {
    const state = deriveLadderState([ok('proofread', 0, 's1'), ok('proofread', 1, 's2')])
    expect(state.promotedOn).toBe('2026-01-06')
  })
})

describe('the rules that refuse to promote', () => {
  it('does not count a second correct in the same round', () => {
    // This is the requeue: a missed card comes back four places later, in the
    // same sitting. Fixing the error is valuable; it is not evidence that the
    // item survived a gap, because no gap happened.
    const state = deriveLadderState([ok('proofread', 0, 's1'), ok('proofread', 0, 's1')])
    expect(state).toMatchObject({ level: 0, progress: 1 })
  })

  it('does not count a second correct on the same day in a different round', () => {
    // Three rounds after school is still one sitting as far as retention goes.
    const state = deriveLadderState([ok('proofread', 0, 's1'), ok('proofread', 0, 's2')])
    expect(state).toMatchObject({ level: 0, progress: 1 })
  })

  it('still refuses a same-day double when no round id has been assigned yet', () => {
    // `Attempt.sessionId` is set by whoever *stores* the round, so attempts
    // held client-side mid-round have none. The same-day rule is the backstop
    // that keeps the requeue from promoting before the id exists.
    const noSession = [
      attempt({ activity: 'proofread', at: T0, sessionId: null }),
      attempt({ activity: 'proofread', at: T0 + 600_000, sessionId: null }),
    ]
    expect(deriveLadderState(noSession)).toMatchObject({ level: 0, progress: 1 })
  })

  it('promotes once a real day has passed', () => {
    const state = deriveLadderState([ok('proofread', 0, 's1'), ok('proofread', 1, 's2')])
    expect(state.level).toBe(1)
  })

  it('is not fooled by a self-graded miss between two same-day corrects', () => {
    // Found by review, and it defeated the one rule this module exists for.
    // The banked evidence used to be tracked outside the fold, and a wrong
    // *unverified* answer cleared it — so a learner who tapped "missed it" on
    // a flashcard between two proofread answers got a same-day promotion.
    const state = deriveLadderState([
      ok('proofread', 0, 's1'),
      attempt({ activity: 'flashcards', verified: false, correct: false, at: T0 + 1000, sessionId: 's1' }),
      attempt({ activity: 'proofread', at: T0 + 2000, sessionId: 's2' }),
    ])
    expect(state).toMatchObject({ level: 0, progress: 1 })
  })

  it('is not fooled by a self-graded correct either', () => {
    const state = deriveLadderState([
      ok('proofread', 0, 's1'),
      attempt({ activity: 'flashcards', verified: false, at: T0 + 1000, sessionId: 's1' }),
      attempt({ activity: 'proofread', at: T0 + 2000, sessionId: 's2' }),
    ])
    expect(state).toMatchObject({ level: 0, progress: 1 })
  })

  it('ignores a self-graded answer entirely', () => {
    const selfGraded = [
      attempt({ activity: 'flashcards', verified: false, at: T0, sessionId: 'a' }),
      attempt({ activity: 'flashcards', verified: false, at: T0 + DAY, sessionId: 'b' }),
      attempt({ activity: 'flashcards', verified: false, at: T0 + 2 * DAY, sessionId: 'c' }),
    ]
    // A learner tapping "Got it" three times has moved nothing at all.
    expect(deriveLadderState(selfGraded)).toMatchObject({ level: 0, progress: 0 })
  })

  it('learns nothing from a question easier than where the item already is', () => {
    const climbed = [ok('scramble', 0, 's1'), ok('scramble', 1, 's2')] // -> level 1
    const withEasy = [...climbed, ok('study', 2, 's3'), ok('study', 3, 's4')]
    expect(deriveLadderState(withEasy)).toMatchObject({ level: 1, progress: 0 })
  })
})

describe('slipping back', () => {
  // Climbed rather than tested out: the first answer is a recognition
  // question, so nothing jumps straight to the top.
  const toLevelTwo = [
    ok('proofread', 0, 's1'),
    ok('proofread', 1, 's2'), // -> 1
    ok('scramble', 2, 's3'),
    ok('scramble', 3, 's4'), // -> 2
  ]

  it('forgives a single miss, because that is what the frontier looks like', () => {
    // An item practiced at the edge of what a learner can do is *meant* to be
    // missed sometimes. Demoting on every miss is not merely harsh, it is
    // unstable — the ladder simulation showed a learner getting 90% right
    // ping-ponging and never reaching free recall at all.
    const state = deriveLadderState([...toLevelTwo, miss('scramble', 4, 's5')])
    expect(state).toMatchObject({ level: 2, progress: 0, slips: 1 })
  })

  it('costs one rung on a second miss running, not all of them', () => {
    const state = deriveLadderState([
      ...toLevelTwo,
      miss('scramble', 4, 's5'),
      miss('scramble', 5, 's6'),
    ])
    expect(state).toMatchObject({ level: 1, slips: 0 })
  })

  it('clears the slip when the learner gets it right again', () => {
    const state = deriveLadderState([
      ...toLevelTwo,
      miss('scramble', 4, 's5'),
      ok('scramble', 5, 's6'),
      miss('scramble', 6, 's7'),
    ])
    // Two misses, but not two running — the item holds its rung.
    expect(state).toMatchObject({ level: 2, slips: 1 })
  })

  it('costs one rung from the top, too', () => {
    const state = deriveLadderState([
      ok('test', 0, 's1'),
      miss('test', 1, 's2'),
      miss('test', 2, 's3'),
    ])
    expect(state.level).toBe(2)
  })

  it('never falls below the bottom', () => {
    const many = Array.from({ length: 10 }, (_, d) => miss('test', d, `s${d}`))
    expect(deriveLadderState(many).level).toBe(0)
  })

  it('clears the banked evidence, so a miss is not half-forgiven', () => {
    const state = deriveLadderState([
      ok('proofread', 0, 's1'), // progress 1
      miss('proofread', 1, 's2'), // wipes it
      ok('proofread', 2, 's3'), // progress 1 again, not a promotion
    ])
    expect(state).toMatchObject({ level: 0, progress: 1 })
  })

  it('is not triggered by getting an easier question wrong', () => {
    const climbed = [ok('scramble', 0, 's1'), ok('scramble', 1, 's2')] // level 1
    const state = deriveLadderState([...climbed, miss('study', 2, 's3')])
    expect(state.level).toBe(1)
  })
})

describe('testing out', () => {
  it('lands a first-time unaided correct straight at free recall', () => {
    const state = deriveLadderState([ok('test', 0, 's1')])
    expect(state.level).toBe(3)
  })

  it('does not test out on a hinted answer', () => {
    const hinted = [attempt({ activity: 'test', hintsUsed: 1 })]
    expect(deriveLadderState(hinted).level).toBe(0)
  })

  it('does not test out on a recognition question', () => {
    expect(deriveLadderState([ok('proofread', 0, 's1')]).level).toBe(0)
  })

  it('does not test out on a self-graded claim', () => {
    const claimed = [attempt({ activity: 'test', verified: false })]
    expect(deriveLadderState(claimed).level).toBe(0)
  })

  it('can still slip back afterwards', () => {
    const state = deriveLadderState([
      ok('test', 0, 's1'),
      miss('test', 1, 's2'),
      miss('test', 2, 's3'),
    ])
    expect(state.level).toBe(2)
  })
})

describe('transfer runs alongside, not above', () => {
  it('counts a correct application without touching the rung', () => {
    const state = deriveLadderState([ok('apply', 0, 's1')])
    expect(state).toMatchObject({ level: 0, transfer: 1 })
  })

  it('does not count an application the app could not check', () => {
    const unchecked = [attempt({ activity: 'use-it', verified: false })]
    expect(deriveLadderState(unchecked).transfer).toBe(0)
  })

  it('does not block a promotion the learner had earned', () => {
    // Also found by review: a correct transfer answer used to overwrite the
    // banked recall evidence, so applying a concept *delayed* the promotion
    // the learner had already half-earned. Transfer runs alongside the rungs.
    const state = deriveLadderState([
      ok('proofread', 0, 's1'),
      ok('apply', 1, 's2'),
      attempt({ activity: 'proofread', at: T0 + DAY + 1000, sessionId: 's3' }),
    ])
    expect(state).toMatchObject({ level: 1, transfer: 1 })
  })

  it('leaves an item at free recall in rotation there', () => {
    // Applying something does not retire it from being asked from memory.
    const state = deriveLadderState([ok('test', 0, 's1'), ok('apply', 1, 's2')])
    expect(state).toMatchObject({ level: 3, transfer: 1 })
  })
})

describe('derivation is order-independent and pure', () => {
  it('sorts attempts by time, so storage order cannot change the answer', () => {
    const inOrder = [ok('proofread', 0, 's1'), ok('proofread', 1, 's2')]
    const reversed = [...inOrder].reverse()
    expect(deriveLadderState(reversed)).toEqual(deriveLadderState(inOrder))
  })

  it('does not mutate what it was given', () => {
    const attempts = [ok('proofread', 0, 's1'), ok('proofread', 1, 's2')]
    const copy = JSON.parse(JSON.stringify(attempts))
    deriveLadderState(attempts)
    expect(attempts).toEqual(copy)
  })

  it('never mutates the state it is handed', () => {
    const state = initialLadderState()
    const frozen = Object.freeze({ ...state })
    expect(() => applyAttemptToLadder(frozen, ok('proofread', 0, 's1'))).not.toThrow()
    expect(frozen).toEqual(state)
  })

  it('folds one attempt at a time to exactly where a full derive lands', () => {
    // The fold is now total — all the bookkeeping lives in the state — so
    // stepping through by hand and deriving in one go cannot disagree. That
    // property is what closed both review bugs.
    const attempts = [
      ok('proofread', 0, 's1'),
      attempt({ activity: 'flashcards', verified: false, correct: false, at: T0 + 100, sessionId: 's1' }),
      ok('proofread', 1, 's2'),
      miss('scramble', 2, 's3'),
      ok('scramble', 3, 's4'),
      ok('apply', 4, 's5'),
    ]
    let stepped = initialLadderState()
    for (const a of attempts) stepped = applyAttemptToLadder(stepped, a)
    expect(stepped).toEqual(deriveLadderState(attempts))
  })

  it('gives the same answer twice for the same history', () => {
    const attempts = [ok('proofread', 0, 's1'), miss('proofread', 1, 's2'), ok('scramble', 2, 's3')]
    expect(deriveLadderState(attempts)).toEqual(deriveLadderState(attempts))
  })

  it('needs exactly the documented amount of evidence, in both directions', () => {
    expect(PROMOTION_EVIDENCE).toBe(2)
    expect(DEMOTION_SLIPS).toBe(2)
  })
})

describe('bridging from cached mastery', () => {
  // `deriveLadderState` is the truth and it needs attempts; the planner has
  // only the mastery cache. Every boundary here rounds toward *more*
  // scaffolding, because the two errors are not equal: an easier question than
  // necessary costs a few seconds, a harder one costs the belief that they can
  // do it.
  const at = (mastery: number, reps = 4, correctStreak = 3) =>
    supportLevelFromMastery({ mastery, reps, correctStreak })

  it('starts a card nobody has answered at the bottom', () => {
    expect(supportLevelFromMastery(undefined)).toBe(0)
    expect(at(0.9, 0)).toBe(0)
  })

  it('recognizes before it asks for production', () => {
    expect(at(0.1)).toBe(1)
    expect(at(0.34)).toBe(1)
  })

  it('scaffolds the middle', () => {
    expect(at(0.35)).toBe(2)
    expect(at(0.69)).toBe(2)
  })

  it('asks for free recall only when the card is holding', () => {
    expect(at(0.9, 4, 3)).toBe(3)
    expect(at(0.9, 4, 2)).toBe(3)
  })

  it('drops back to a scaffold when the streak has just broken', () => {
    // Handing a learner a blank page straight after they missed it is the
    // moment they are least likely to succeed.
    expect(at(0.95, 9, 0)).toBe(2)
    expect(at(0.95, 9, 1)).toBe(2)
  })
})
