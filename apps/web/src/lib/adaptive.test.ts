// The adaptive engine.
//
// simulate-adaptive.ts already checks that whole simulated learners converge,
// which is the behavior that matters — but it is aggregate, it is random, and
// it cannot say *which* rule broke when the numbers drift. These pin the rules
// one at a time.
//
// The invariant running through the file: a learner's claim about their own
// answer is worth less than an answer the system checked, and can never on its
// own reach "mastered".

import { describe, expect, it } from 'vitest'
import {
  applyAttemptToMastery,
  blendMastery,
  blendSelfReport,
  evaluateLevel,
  expectedCorrect,
  isDue,
  LEARNING_THRESHOLD,
  MASTERED_THRESHOLD,
  masteryBand,
  overdueBy,
  placeLevel,
  recentAccuracy,
  UNVERIFIED_CEILING,
  updateAbility,
  updateStreak,
} from './adaptive'
import { addDays, defaultSkillState, todayString } from './progress/types'
import type { Attempt, ItemMastery, SkillState } from './progress/types'

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    subject: 'spelling',
    itemKey: 'cat',
    activity: 'test',
    isTest: true,
    verified: true,
    correct: true,
    responseMs: 100,
    hintsUsed: 0,
    difficulty: 3,
    given: 'cat',
    at: 0,
    ...over,
  }
}

const TODAY = '2026-01-15'

describe('expectedCorrect', () => {
  it('is even money when ability matches difficulty', () => {
    expect(expectedCorrect(4, 4)).toBeCloseTo(0.5, 5)
  })

  it('rises with ability and falls with difficulty', () => {
    expect(expectedCorrect(6, 4)).toBeGreaterThan(0.5)
    expect(expectedCorrect(2, 4)).toBeLessThan(0.5)
  })

  it('stays a probability at the extremes', () => {
    for (const [a, d] of [[-50, 50], [50, -50], [0, 0]]) {
      const p = expectedCorrect(a!, d!)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('is symmetric about the gap between the two', () => {
    expect(expectedCorrect(5, 3)).toBeCloseTo(1 - expectedCorrect(3, 5), 10)
  })
})

describe('updateAbility', () => {
  const base = { ability: 4, abilitySd: 1, totalAttempts: 20 }

  it('moves ability up on a correct answer and down on a wrong one', () => {
    expect(updateAbility(base, 4, true).ability).toBeGreaterThan(4)
    expect(updateAbility(base, 4, false).ability).toBeLessThan(4)
  })

  it('moves further on a surprise than on an expected result', () => {
    // Getting a much harder word right says more than getting an easy one right.
    const surprise = updateAbility(base, 7, true).ability - 4
    const expected = updateAbility(base, 1, true).ability - 4
    expect(surprise).toBeGreaterThan(expected)
  })

  it('settles down as evidence accumulates', () => {
    const green = updateAbility({ ...base, totalAttempts: 0 }, 6, true).ability - 4
    const seasoned = updateAbility({ ...base, totalAttempts: 500 }, 6, true).ability - 4
    expect(green).toBeGreaterThan(seasoned)
  })

  it('reports how surprising the result was', () => {
    expect(updateAbility(base, 9, true).surprise).toBeGreaterThan(
      updateAbility(base, 4, true).surprise,
    )
  })
})

describe('blendMastery — checked answers', () => {
  it('does not call one lucky first answer mastery', () => {
    const first = blendMastery(0, 0, true)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(MASTERED_THRESHOLD)
  })

  it('zeroes a first miss', () => {
    expect(blendMastery(0, 0, false)).toBe(0)
  })

  it('climbs with repeated correct answers and can reach mastered', () => {
    let m = 0
    for (let reps = 0; reps < 12; reps++) m = blendMastery(m, reps, true)
    expect(m).toBeGreaterThanOrEqual(MASTERED_THRESHOLD)
  })

  it('falls on a miss', () => {
    expect(blendMastery(0.9, 5, false)).toBeLessThan(0.9)
  })

  it('stays within 0..1 however it is driven', () => {
    let m = 0.5
    for (let i = 0; i < 50; i++) {
      m = blendMastery(m, i, i % 3 === 0)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(1)
    }
  })
})

describe('blendSelfReport — a claim is worth less than a check', () => {
  it('never carries a card past the unverified ceiling', () => {
    let m = 0
    for (let reps = 0; reps < 200; reps++) m = blendSelfReport(m, reps, true)
    expect(m).toBeLessThanOrEqual(UNVERIFIED_CEILING)
  })

  it('keeps that ceiling below mastered, so mastered always means checked', () => {
    expect(UNVERIFIED_CEILING).toBeLessThan(MASTERED_THRESHOLD)
  })

  it('credits a claimed hit less than a checked one', () => {
    expect(blendSelfReport(0.3, 3, true)).toBeLessThan(blendMastery(0.3, 3, true))
  })

  it('takes "I missed it" at full weight — bad news against their own interest', () => {
    expect(blendSelfReport(0.9, 5, false)).toBe(blendMastery(0.9, 5, false))
  })

  it('never claws back what checked answers already earned', () => {
    // Flicking through a deck you genuinely know must not demote you.
    const earned = 0.95
    expect(blendSelfReport(earned, 10, true)).toBeGreaterThanOrEqual(earned)
  })
})

describe('masteryBand', () => {
  function item(over: Partial<ItemMastery> = {}): ItemMastery {
    return {
      subject: 'spelling',
      itemKey: 'cat',
      listId: null,
      difficulty: 3,
      mastery: 0,
      reps: 0,
      lapses: 0,
      correctStreak: 0,
      totalAttempts: 1,
      totalCorrect: 0,
      intervalDays: 0,
      dueOn: null,
      firstSeenAt: 0,
      lastSeenAt: 0,
      ...over,
    }
  }

  it('calls an unseen item new', () => {
    expect(masteryBand(undefined)).toBe('new')
    expect(masteryBand(item({ totalAttempts: 0 }))).toBe('new')
  })

  it('needs both a high score and a streak to call something mastered', () => {
    expect(masteryBand(item({ mastery: 0.95, correctStreak: 2 }))).toBe('mastered')
    // High score, no streak — which is exactly the shape self-report produces.
    expect(masteryBand(item({ mastery: 0.95, correctStreak: 1 }))).not.toBe('mastered')
  })

  it('separates practiced from learning at the threshold', () => {
    expect(masteryBand(item({ mastery: LEARNING_THRESHOLD }))).toBe('practiced')
    expect(masteryBand(item({ mastery: LEARNING_THRESHOLD - 0.01 }))).toBe('learning')
  })
})

describe('applyAttemptToMastery', () => {
  it('creates a record for a word seen for the first time', () => {
    const next = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    expect(next).toMatchObject({ itemKey: 'cat', totalAttempts: 1, totalCorrect: 1, reps: 1 })
  })

  it('counts a practice attempt as seen but leaves mastery alone', () => {
    const first = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    const after = applyAttemptToMastery(first, attempt({ isTest: false }), { today: TODAY })
    expect(after.mastery).toBe(first.mastery)
    expect(after.totalAttempts).toBe(2)
    expect(after.reps).toBe(1) // reps only counts graded sightings
  })

  it('does not advance the streak on a self-graded claim', () => {
    // The streak is half of what defines "mastered"; the other half is capped.
    // Together they mean mastered always rests on checked answers.
    const first = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    const claimed = applyAttemptToMastery(first, attempt({ verified: false }), { today: TODAY })
    expect(claimed.correctStreak).toBe(first.correctStreak)
  })

  it('cannot reach the mastered band on self-report alone', () => {
    let item = applyAttemptToMastery(undefined, attempt({ verified: false }), { today: TODAY })
    for (let i = 0; i < 50; i++) {
      item = applyAttemptToMastery(item, attempt({ verified: false }), { today: TODAY })
    }
    expect(masteryBand(item)).not.toBe('mastered')
  })

  it('counts a lapse only when a streak was actually broken', () => {
    const built = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    const lapsed = applyAttemptToMastery(built, attempt({ correct: false }), { today: TODAY })
    expect(lapsed.lapses).toBe(1)
    // A second miss in a row is not a second lapse; the streak was already gone.
    const again = applyAttemptToMastery(lapsed, attempt({ correct: false }), { today: TODAY })
    expect(again.lapses).toBe(1)
  })

  it('sends a missed word back to the short-term queue', () => {
    const built = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    const missed = applyAttemptToMastery(built, attempt({ correct: false }), { today: TODAY })
    expect(missed.intervalDays).toBeLessThanOrEqual(2)
  })

  it('stretches the interval as a checked streak builds', () => {
    let item = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    const early = item.intervalDays
    for (let i = 0; i < 5; i++) item = applyAttemptToMastery(item, attempt(), { today: TODAY })
    expect(item.intervalDays).toBeGreaterThan(early)
  })

  it('caps how much time off a claimed answer can buy', () => {
    let item = applyAttemptToMastery(undefined, attempt({ verified: false }), { today: TODAY })
    for (let i = 0; i < 20; i++) {
      item = applyAttemptToMastery(item, attempt({ verified: false }), { today: TODAY })
    }
    // A learner tapping through claiming everything gets the cards back within
    // days, not weeks.
    expect(item.intervalDays).toBeLessThanOrEqual(3)
  })

  it('never shortens a schedule that checked answers stretched', () => {
    let item = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    for (let i = 0; i < 6; i++) item = applyAttemptToMastery(item, attempt(), { today: TODAY })
    const earned = item.intervalDays
    const claimed = applyAttemptToMastery(item, attempt({ verified: false }), { today: TODAY })
    expect(claimed.intervalDays).toBeGreaterThanOrEqual(earned)
  })

  it('schedules the next look relative to the day given', () => {
    const item = applyAttemptToMastery(undefined, attempt(), { today: TODAY })
    expect(item.dueOn).toBe(addDays(TODAY, item.intervalDays))
  })
})

describe('due dates', () => {
  const item = { dueOn: TODAY } as ItemMastery

  it('treats a word never scheduled as due now', () => {
    expect(isDue({ dueOn: null } as ItemMastery, TODAY)).toBe(true)
    expect(overdueBy({ dueOn: null } as ItemMastery, TODAY)).toBeGreaterThan(0)
  })

  it('is due on the day itself and after, but not before', () => {
    expect(isDue(item, TODAY)).toBe(true)
    expect(isDue(item, addDays(TODAY, 3))).toBe(true)
    expect(isDue(item, addDays(TODAY, -1))).toBe(false)
  })

  it('measures how overdue a word is', () => {
    expect(overdueBy(item, addDays(TODAY, 4))).toBe(4)
  })
})

describe('evaluateLevel', () => {
  function state(over: Partial<SkillState> = {}): SkillState {
    return { ...defaultSkillState('spelling'), levelIndex: 2, ability: 4, ...over }
  }
  const base = {
    levelDifficulty: 4,
    levelCount: 7,
    levelMastered: 0.7,
    levelAttempts: 30,
    recentAccuracy: 0.9,
  }

  it('promotes only when ability, mastery and accuracy all agree', () => {
    expect(evaluateLevel({ state: state({ ability: 4.8 }), ...base }).direction).toBe('promote')
  })

  it('refuses to promote on a lucky streak with nothing mastered', () => {
    expect(
      evaluateLevel({ state: state({ ability: 4.8 }), ...base, levelMastered: 0.1 }).direction,
    ).toBe('hold')
  })

  it('refuses to promote on too little evidence', () => {
    expect(
      evaluateLevel({ state: state({ ability: 4.8 }), ...base, levelAttempts: 5 }).direction,
    ).toBe('hold')
  })

  it('lets a strong speller test out without grinding the whole band', () => {
    const out = evaluateLevel({
      state: state({ ability: 5.5 }),
      ...base,
      levelAttempts: 12,
      levelMastered: 0,
      recentAccuracy: 0.95,
    })
    expect(out.direction).toBe('promote')
  })

  it('demotes when the band is clearly too hard', () => {
    const out = evaluateLevel({
      state: state({ ability: 2.5 }),
      ...base,
      levelAttempts: 20,
      recentAccuracy: 0.3,
    })
    expect(out.direction).toBe('demote')
    expect(out.levelIndex).toBe(1)
  })

  it('demotes on weaker evidence than it promotes on', () => {
    // Being stuck a band too high hurts more than a band too low.
    const demote = evaluateLevel({
      state: state({ ability: 2.5 }),
      ...base,
      levelAttempts: 16,
      recentAccuracy: 0.3,
    })
    const promote = evaluateLevel({
      state: state({ ability: 4.8 }),
      ...base,
      levelAttempts: 16,
    })
    expect(demote.direction).toBe('demote')
    expect(promote.direction).toBe('hold')
  })

  it('never walks off either end of the curriculum', () => {
    const top = evaluateLevel({
      state: state({ levelIndex: 6, ability: 99 }),
      ...base,
      recentAccuracy: 1,
    })
    expect(top.levelIndex).toBe(6)
    const bottom = evaluateLevel({
      state: state({ levelIndex: 0, ability: -99 }),
      ...base,
      recentAccuracy: 0,
    })
    expect(bottom.levelIndex).toBe(0)
  })
})

describe('placeLevel', () => {
  const grades = [2, 3, 4, 5, 6, 7, 8]

  it('rounds down rather than up, so the first round is solid ground', () => {
    // The 0.4 bias means a learner measured most of the way to the next band
    // still starts in the lower one. Precision matters less on day one than
    // not opening with sixty words they cannot spell.
    expect(grades[placeLevel(5.9, grades)]).toBe(5)
    expect(grades[placeLevel(4.5, grades)]).toBe(4)
  })

  it('places a learner on the band their ability names', () => {
    for (const grade of grades) {
      expect(grades[placeLevel(grade, grades)]).toBe(grade)
    }
  })

  it('stays inside the curriculum at both extremes', () => {
    expect(placeLevel(-10, grades)).toBe(0)
    expect(placeLevel(100, grades)).toBe(grades.length - 1)
  })

  it('places a stronger speller no lower than a weaker one', () => {
    let previous = -1
    for (const ability of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const level = placeLevel(ability, grades)
      expect(level).toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })
})

describe('updateStreak', () => {
  it('starts a streak on the first active day', () => {
    const next = updateStreak(defaultSkillState('spelling'), TODAY)
    expect(next.streakDays).toBe(1)
    expect(next.lastActiveOn).toBe(TODAY)
  })

  it('extends a streak on consecutive days', () => {
    const yesterday = { ...defaultSkillState('spelling'), streakDays: 3, lastActiveOn: addDays(TODAY, -1) }
    expect(updateStreak(yesterday, TODAY).streakDays).toBe(4)
  })

  it('does not double-count two rounds on the same day', () => {
    const already = { ...defaultSkillState('spelling'), streakDays: 3, lastActiveOn: TODAY }
    expect(updateStreak(already, TODAY).streakDays).toBe(3)
  })

  it('resets after a missed day', () => {
    const stale = { ...defaultSkillState('spelling'), streakDays: 9, lastActiveOn: addDays(TODAY, -3) }
    expect(updateStreak(stale, TODAY).streakDays).toBe(1)
  })

  it('remembers the best streak even after one breaks', () => {
    const stale = {
      ...defaultSkillState('spelling'),
      streakDays: 9,
      bestStreakDays: 9,
      lastActiveOn: addDays(TODAY, -3),
    }
    expect(updateStreak(stale, TODAY).bestStreakDays).toBe(9)
  })
})

describe('recentAccuracy', () => {
  it('is zero with nothing to go on', () => {
    expect(recentAccuracy([])).toBe(0)
  })

  it('reads over the most recent attempts only', () => {
    const old = Array.from({ length: 40 }, () => attempt({ correct: false }))
    const fresh = Array.from({ length: 10 }, () => attempt({ correct: true }))
    expect(recentAccuracy([...old, ...fresh], 10)).toBe(1)
  })

  it('returns a fraction between zero and one', () => {
    const mixed = [attempt({ correct: true }), attempt({ correct: false })]
    expect(recentAccuracy(mixed)).toBeCloseTo(0.5, 5)
  })
})

describe('the engine as a whole', () => {
  it('lets a consistent learner reach mastered on checked answers', () => {
    let item = applyAttemptToMastery(undefined, attempt(), { today: todayString() })
    for (let i = 0; i < 10; i++) {
      item = applyAttemptToMastery(item, attempt(), { today: todayString() })
    }
    expect(masteryBand(item)).toBe('mastered')
  })

  it('but never lets the same learner get there by self-report', () => {
    let item = applyAttemptToMastery(undefined, attempt({ verified: false }), {
      today: todayString(),
    })
    for (let i = 0; i < 50; i++) {
      item = applyAttemptToMastery(item, attempt({ verified: false }), { today: todayString() })
    }
    expect(masteryBand(item)).not.toBe('mastered')
  })
})
