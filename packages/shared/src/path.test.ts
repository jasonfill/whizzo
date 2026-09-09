// The Mastery Path.
//
// The behaviors worth defending are all about not overwhelming somebody: a
// learner meets a handful of new things at a time, a round is never mostly
// things they have already failed, and the check is offered rather than sprung.

import { describe, expect, it } from 'vitest'
import {
  BATCH_SIZE,
  goalMet,
  MAX_REVIEW_SHARE,
  pathState,
  planPath,
  READY_SHARE,
  ROUND_SIZE,
  type PathInput,
} from './path.js'
import type { ItemMastery, QuizCard } from './progress.js'

function cards(n: number): QuizCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    term: `Q${i}`,
    definition: `A${i}`,
    hint: null,
    difficulty: 2,
  }))
}

function mastery(over: Partial<ItemMastery> = {}): ItemMastery {
  return {
    subject: 'quiz',
    itemKey: 'x',
    listId: null,
    difficulty: 2,
    mastery: 0.5,
    reps: 3,
    lapses: 0,
    correctStreak: 1,
    totalAttempts: 4,
    totalCorrect: 2,
    intervalDays: 2,
    dueOn: null,
    firstSeenAt: 1,
    lastSeenAt: 2,
    ...over,
  }
}

/** Known cards, by id, with an optional per-card override. */
function input(
  all: QuizCard[],
  known: Record<string, Partial<ItemMastery>> = {},
  due: string[] = [],
): PathInput {
  return {
    cards: all,
    masteryOf: (id) => (id in known ? mastery(known[id]) : undefined),
    isDue: (item) => due.includes(item.itemKey),
  }
}

/** A card the learner has taken all the way to free recall. */
const KNOWN = { mastery: 0.95, reps: 9, correctStreak: 3 }
/** A card met but still being worked. */
const LEARNING = { mastery: 0.4, reps: 3, correctStreak: 1 }

describe('a learner who has never opened the set', () => {
  it('is introduced to one batch, not the whole deck', () => {
    // Meeting forty cards at once is meeting all of them badly.
    const plan = planPath(input(cards(40)))
    expect(plan).toHaveLength(BATCH_SIZE)
    expect(plan.every((p) => p.role === 'batch')).toBe(true)
  })

  it('reports nothing done yet', () => {
    expect(pathState(input(cards(20)))).toMatchObject({ introduced: [], progress: 0 })
  })

  it('copes with a set smaller than a batch', () => {
    expect(planPath(input(cards(3)))).toHaveLength(3)
  })

  it('copes with an empty set', () => {
    expect(planPath(input([]))).toEqual([])
    expect(pathState(input([])).complete).toBe(false)
  })
})

describe('working a batch', () => {
  it('keeps returning to what has been met but is not known', () => {
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, LEARNING]))
    const plan = planPath(input(all, known))
    expect(plan.filter((p) => p.role === 'batch').map((p) => p.card.id)).toEqual(
      all.slice(0, 6).map((c) => c.id),
    )
  })

  it('does not open a new batch while the current one is still being worked', () => {
    // Opening the next one early is how a learner ends up meeting forty cards
    // at once, which is the thing batching exists to prevent.
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, LEARNING]))
    const plan = planPath(input(all, known))
    const fresh = plan.filter((p) => !known[p.card.id] && p.role === 'batch')
    expect(fresh).toHaveLength(0)
  })

  it('opens the next batch once the current one has largely moved on', () => {
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, KNOWN]))
    const plan = planPath(input(all, known))
    expect(plan.some((p) => !known[p.card.id])).toBe(true)
  })
})

describe('a round is never mostly things you already failed', () => {
  it('caps review however much is overdue', () => {
    // Accurate and demoralising is still demoralising.
    const all = cards(20)
    const known = Object.fromEntries(all.map((c) => [c.id, LEARNING]))
    const plan = planPath(input(all, known, all.map((c) => c.id)))
    const review = plan.filter((p) => p.role === 'review')
    expect(review.length).toBeLessThanOrEqual(Math.floor(ROUND_SIZE * MAX_REVIEW_SHARE))
  })

  it('still fills the round with something to work on', () => {
    const all = cards(20)
    const known = Object.fromEntries(all.map((c) => [c.id, LEARNING]))
    const plan = planPath(input(all, known, all.map((c) => c.id)))
    expect(plan).toHaveLength(ROUND_SIZE)
  })

  it('gives a learner with nothing due a full round of new material', () => {
    expect(planPath(input(cards(40)))).toHaveLength(BATCH_SIZE)
  })

  it('never asks the same card twice in one round', () => {
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 10).map((c) => [c.id, LEARNING]))
    const plan = planPath(input(all, known, all.slice(0, 5).map((c) => c.id)))
    expect(new Set(plan.map((p) => p.card.id)).size).toBe(plan.length)
  })

  it('never plans more than the round size', () => {
    const all = cards(60)
    const known = Object.fromEntries(all.map((c) => [c.id, LEARNING]))
    expect(planPath(input(all, known)).length).toBeLessThanOrEqual(ROUND_SIZE)
  })
})

describe('the check is offered, never sprung', () => {
  it('is not offered while the batch is still being learned', () => {
    // A Mastery Check on a batch that has not reached free recall is a round
    // the learner was set up to fail.
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, LEARNING]))
    expect(pathState(input(all, known)).readyForCheck).toBe(false)
  })

  it('is offered once most of the batch can be produced from memory', () => {
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, KNOWN]))
    expect(pathState(input(all, known)).readyForCheck).toBe(true)
  })

  it('needs most of the batch, not one card of it', () => {
    const all = cards(20)
    const known: Record<string, Partial<ItemMastery>> = {}
    all.slice(0, 6).forEach((c, i) => {
      known[c.id] = i === 0 ? KNOWN : LEARNING
    })
    expect(pathState(input(all, known)).readyForCheck).toBe(false)
    expect(READY_SHARE).toBeGreaterThan(0.5)
  })
})

describe('finishing', () => {
  it('is not met by doing one good round', () => {
    // A goal is a statement about a state. Closing it on a session would let
    // one good afternoon end a week's work.
    const all = cards(20)
    const known = Object.fromEntries(all.slice(0, 6).map((c) => [c.id, KNOWN]))
    expect(goalMet(input(all, known))).toBe(false)
  })

  it('is met when nearly everything can be produced from memory', () => {
    const all = cards(10)
    const known = Object.fromEntries(all.slice(0, 9).map((c) => [c.id, KNOWN]))
    expect(goalMet(input(all, known))).toBe(true)
  })

  it('respects a bar somebody set deliberately', () => {
    const all = cards(10)
    const known = Object.fromEntries(all.slice(0, 5).map((c) => [c.id, KNOWN]))
    expect(goalMet(input(all, known), 0.5)).toBe(true)
    expect(goalMet(input(all, known), 0.9)).toBe(false)
  })

  it('is never met by an empty set', () => {
    expect(goalMet(input([]))).toBe(false)
  })

  it('reports complete only when every card is at free recall', () => {
    const all = cards(5)
    const known = Object.fromEntries(all.map((c) => [c.id, KNOWN]))
    expect(pathState(input(all, known)).complete).toBe(true)
  })
})

describe('using real attempts when they are to hand', () => {
  it('prefers the ladder derived from attempts over the mastery cache', () => {
    // The cache is an approximation that rounds toward more scaffolding; the
    // attempts are the truth.
    const all = cards(3)
    const withAttempts: PathInput = {
      ...input(all, { c0: LEARNING }),
      attemptsOf: (id) =>
        id === 'c0'
          ? [
              {
                subject: 'quiz', itemKey: 'c0', activity: 'test', isTest: true, verified: true,
                correct: true, responseMs: 1, hintsUsed: 0, difficulty: 2, given: 'x',
                at: Date.UTC(2026, 0, 5), sessionId: 's1',
              },
            ]
          : undefined,
    }
    // One unaided correct first time tests the card out to free recall, which
    // the cached numbers alone would not say.
    expect(pathState(withAttempts).atFreeRecall).toBe(1)
  })
})
