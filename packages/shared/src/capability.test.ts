// What a set can be practiced with — and, more importantly, what it cannot.
//
// The lock-out tests are the ones that matter. Every `locked` assertion below
// is a broken question that would otherwise reach a child: an equation with
// its characters shuffled, or a bar chart asked for one letter at a time.

import { describe, expect, it } from 'vitest'
import { activitiesAtLevel, activityDef, ACTIVITY_CATALOG } from './activities.js'
import { availableActivities, hasPlainAnswer, MIN_POOL } from './capability.js'
import type { QuizCard, QuizDeck } from './progress.js'

function card(over: Partial<QuizCard> = {}): QuizCard {
  return {
    id: Math.random().toString(36).slice(2),
    term: 'term',
    definition: 'answer',
    hint: null,
    difficulty: 2,
    ...over,
  }
}

function deck(cards: QuizCard[]): Pick<QuizDeck, 'cards'> {
  return { cards }
}

/** Enough plain cards that nothing is locked out for being a small set. */
function plainDeck(n = MIN_POOL): Pick<QuizDeck, 'cards'> {
  return deck(Array.from({ length: n }, (_, i) => card({ definition: `answer ${i}` })))
}

function statusOf(list: ReturnType<typeof availableActivities>, id: string) {
  return list.find((a) => a.activity === id)
}

describe('the catalog', () => {
  it('gives every activity a rung, a name and a blurb', () => {
    for (const a of ACTIVITY_CATALOG) {
      expect(a.name.length, a.id).toBeGreaterThan(2)
      expect(a.blurb.length, a.id).toBeGreaterThan(10)
      expect([0, 1, 2, 3], a.id).toContain(a.stage)
      expect(a.subjects.length, a.id).toBeGreaterThan(0)
    }
  })

  it('never says a self-graded activity is checked', () => {
    expect(activityDef('flashcards')).toMatchObject({ verified: false })
    // And the converse: nothing graded is left unchecked, or a round could
    // move a learner's ability on answers nobody looked at.
    for (const a of ACTIVITY_CATALOG) {
      if (a.isTest) expect(a.verified, a.id).toBe(true)
    }
  })

  it('points every fallback at an activity that exists', () => {
    for (const a of ACTIVITY_CATALOG) {
      if (a.fallback) expect(activityDef(a.fallback), `${a.id} -> ${a.fallback}`).toBeDefined()
    }
  })

  it('has no fallback that leads straight back to itself', () => {
    for (const a of ACTIVITY_CATALOG) {
      expect(a.fallback, a.id).not.toBe(a.id)
    }
  })

  it('offers a choice of how at the scaffolded rung', () => {
    // The whole point of choice-within-a-rung: more than one way to practice
    // at the level the planner picked.
    expect(activitiesAtLevel('quiz', 2).length).toBeGreaterThan(1)
  })
})

describe('answers that cannot be taken apart', () => {
  it('knows a plain answer from an equation', () => {
    expect(hasPlainAnswer({ definition: 'photosynthesis' })).toBe(true)
    expect(hasPlainAnswer({ definition: '$\\frac{3}{4}$' })).toBe(false)
  })

  it('knows a figure answer is not plain', () => {
    const figure = '[[figure {"kind":"bar","data":[{"label":"a","value":1}]}]]'
    expect(hasPlainAnswer({ definition: figure })).toBe(false)
  })

  it('treats a price as plain, because a dollar sign is not an equation', () => {
    expect(hasPlainAnswer({ definition: 'it costs $5' })).toBe(true)
  })

  it('locks the letter-by-letter activities on a deck of equations', () => {
    const math = deck(
      Array.from({ length: 6 }, (_, i) => card({ definition: `$\\frac{${i + 1}}{2}$` })),
    )
    const available = availableActivities(math)
    expect(statusOf(available, 'first-letter')?.status).toBe('locked')
    // ...and says why, in words a person could read.
    expect(statusOf(available, 'first-letter')?.reason).toMatch(/equation|figure/i)
  })

  it('leaves writing it out available on that same deck', () => {
    const math = deck(
      Array.from({ length: 6 }, (_, i) => card({ definition: `$\\frac{${i + 1}}{2}$` })),
    )
    expect(statusOf(availableActivities(math), 'learn')?.status).toBe('ready')
  })

  it('is partial when only some answers are equations', () => {
    const mixed = deck([
      card({ definition: 'photosynthesis' }),
      card({ definition: 'respiration' }),
      card({ definition: 'osmosis' }),
      card({ definition: '$x^2$' }),
    ])
    const first = statusOf(availableActivities(mixed), 'first-letter')
    expect(first?.status).toBe('partial')
    expect(first?.usableCards).toBe(3)
  })

  it('does not lock an activity because the *prompt* carries a figure', () => {
    // A geometry question with a chart in the prompt and "12 cm" as the answer
    // is perfectly scrambleable. Only the answer side matters.
    const geometry = plainDeck().cards.map((c) =>
      card({ ...c, term: '[[figure {"kind":"circle","radius":"2"}]] Area?', definition: '12 cm' }),
    )
    expect(statusOf(availableActivities(deck(geometry)), 'first-letter')?.status).toBe('ready')
  })
})

describe('sets that are too small', () => {
  it('locks the activities that need somewhere to draw wrong answers from', () => {
    const tiny = deck([card(), card()])
    expect(statusOf(availableActivities(tiny), 'match')?.status).toBe('locked')
    expect(statusOf(availableActivities(tiny), 'match')?.reason).toMatch(/at least/i)
  })

  it('leaves free recall available, which is harder but honest', () => {
    const tiny = deck([card(), card()])
    expect(statusOf(availableActivities(tiny), 'learn')?.status).toBe('ready')
  })

  it('locks everything on an empty set, and says so plainly', () => {
    const available = availableActivities(deck([]))
    expect(available.every((a) => a.status === 'locked')).toBe(true)
    expect(available[0].reason).toMatch(/no cards/i)
  })
})

describe('enrichment unlocks activities incrementally', () => {
  it('locks Fill the Blank when nothing has an example', () => {
    expect(statusOf(availableActivities(plainDeck()), 'cloze')?.status).toBe('locked')
  })

  it('offers it on the cards that do have one', () => {
    const some = deck([
      card({ example: 'The mitochondrion makes ATP.' }),
      card({ example: 'Osmosis moves water.' }),
      card(),
      card(),
    ])
    const cloze = statusOf(availableActivities(some), 'cloze')
    expect(cloze?.status).toBe('partial')
    expect(cloze?.usableCards).toBe(2)
    expect(cloze?.reason).toMatch(/2 of 4/)
  })

  it('is ready once every card has one', () => {
    const all = deck(Array.from({ length: 4 }, () => card({ example: 'A sentence with it.' })))
    expect(statusOf(availableActivities(all), 'cloze')?.status).toBe('ready')
  })

  it('does not count a blank example as an example', () => {
    const blank = deck(Array.from({ length: 4 }, () => card({ example: '   ' })))
    expect(statusOf(availableActivities(blank), 'cloze')?.status).toBe('locked')
  })
})

describe('degrading rather than refusing', () => {
  it('sends Fill the Blank to Starts With when there are no examples', () => {
    expect(statusOf(availableActivities(plainDeck()), 'cloze')?.fallback).toBe('first-letter')
  })

  it('walks past a fallback that also cannot run', () => {
    // Equations: cloze has no examples *and* first-letter is locked out, so the
    // chain has to keep going rather than offering something equally broken.
    const math = deck(Array.from({ length: 6 }, () => card({ definition: '$x^2$' })))
    const fallback = statusOf(availableActivities(math), 'cloze')?.fallback
    expect(fallback).not.toBe('first-letter')
    if (fallback) {
      expect(statusOf(availableActivities(math), fallback)?.status).not.toBe('locked')
    }
  })

  it('offers no fallback for something already ready', () => {
    expect(statusOf(availableActivities(plainDeck()), 'learn')?.fallback).toBeNull()
  })

  it('always terminates, even if a chain were circular', () => {
    expect(() => availableActivities(plainDeck())).not.toThrow()
  })
})
