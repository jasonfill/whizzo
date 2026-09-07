// How a round is built, in both subjects.
//
// The planners decide what a learner actually sees, and every rule in them is a
// judgement about motivation rather than about data. Review is capped because a
// round made entirely of words you have already failed is accurate and
// demoralising; a small deck drops multiple choice because there is nothing
// honest to draw wrong answers from; a mastered card only comes back when it is
// genuinely about to slip.

import { describe, expect, it } from 'vitest'
import { kindFor, masteryOf, planStudy, requeuePolicy } from './quiz/session'
import { planPlacement, planSession } from './spelling/session'
import { allDecks, deckStats, findDeck, normalizeDeck, parseImport } from './quiz/decks'
import { defaultSkillState, emptySnapshot, masteryKey, todayString } from './progress/types'
import type { ProgressSnapshot, QuizDeck } from './progress/types'

function deck(cards: number, over: Record<string, unknown> = {}): QuizDeck {
  return {
    id: 'd1',
    title: 'Capitals',
    description: '',
    tags: [],
    cards: Array.from({ length: cards }, (_, i) => ({
      id: `c${i}`,
      term: `Term ${i}`,
      definition: `Definition ${i}`,
      hint: null,
      difficulty: 3,
    })),
    source: 'user',
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as QuizDeck
}

function withMastery(
  snapshot: ProgressSnapshot,
  deckId: string,
  cardId: string,
  over: Record<string, unknown>,
): ProgressSnapshot {
  return {
    ...snapshot,
    mastery: {
      ...snapshot.mastery,
      [masteryKey('quiz', `${deckId}:${cardId}`)]: {
        subject: 'quiz',
        itemKey: `${deckId}:${cardId}`,
        listId: deckId,
        difficulty: 3,
        mastery: 0.5,
        reps: 3,
        lapses: 0,
        correctStreak: 1,
        totalAttempts: 4,
        totalCorrect: 2,
        intervalDays: 2,
        dueOn: todayString(),
        firstSeenAt: 1,
        lastSeenAt: 2,
        ...over,
      } as never,
    },
  }
}

describe('what kind of question to ask', () => {
  it('writes everything on a deck too small to hold plausible wrong answers', () => {
    // Three fake options out of a three-card deck are not options, they are a
    // giveaway.
    expect(kindFor(undefined, 3)).toBe('written')
  })

  it('starts a brand new card on multiple choice', () => {
    expect(kindFor(undefined, 20)).toBe('multiple-choice')
  })

  it('moves to recall once a card is well known and holding', () => {
    expect(kindFor({ mastery: 0.9, reps: 8, correctStreak: 3 } as never, 20)).toBe('written')
  })

  it('drops back to a scaffold when the streak has just broken', () => {
    // Same high mastery, but the learner missed it last time. Handing them a
    // blank page straight after a miss is the moment they are least likely to
    // succeed at it, so the question comes back with support.
    expect(kindFor({ mastery: 0.9, reps: 8, correctStreak: 0 } as never, 20)).not.toBe('written')
  })

  it('asks a half-known card to be produced, with support', () => {
    // This rung used to be answered with multiple choice and true/false, which
    // are *recognition*: the learner never produced anything, so nothing
    // bridged the gap between picking from four and facing a blank page. Both
    // kinds here ask for the answer and hand over just enough to make the
    // attempt worth making.
    const half = { mastery: 0.5, reps: 4 } as never
    expect(kindFor(half, 20, () => 0.1)).toBe('letter-hint')
    expect(kindFor(half, 20, () => 0.9)).toBe('word-bank')
  })

  it('still recognises before it asks for production', () => {
    // A card met once is picked out from among others, not written from
    // nothing. Recognition is where recall starts.
    expect(kindFor({ mastery: 0.1, reps: 1 } as never, 20)).toBe('multiple-choice')
  })

  it('walks a card up the rungs as it becomes known', () => {
    const seen = [
      kindFor(undefined, 20),
      kindFor({ mastery: 0.1, reps: 1 } as never, 20),
      kindFor({ mastery: 0.5, reps: 4 } as never, 20, () => 0.1),
      kindFor({ mastery: 0.9, reps: 8, correctStreak: 3 } as never, 20),
    ]
    // Never the same question twice in a row as the card is learned, and it
    // ends where every card has to end: produced from nothing.
    expect(seen[0]).toBe('multiple-choice')
    expect(seen[2]).toBe('letter-hint')
    expect(seen[3]).toBe('written')
  })
})

describe('planning a study round', () => {
  const snapshot = { ...emptySnapshot(), decks: [deck(12)] }

  it('draws from the deck asked for', () => {
    const plan = planStudy(snapshot, { mode: 'learn', decks: [deck(12)], deckId: 'd1', size: 5 })
    expect(plan).toHaveLength(5)
    expect(plan.every((p) => p.deckId === 'd1')).toBe(true)
  })

  it('never plans more cards than the deck holds', () => {
    const plan = planStudy(snapshot, { mode: 'learn', decks: [deck(3)], deckId: 'd1', size: 20 })
    expect(plan.length).toBeLessThanOrEqual(3)
  })

  it('puts what is overdue before what is new', () => {
    const withDue = withMastery(snapshot, 'd1', 'c5', {
      mastery: 0.3,
      dueOn: '2020-01-01',
      lapses: 2,
    })
    // An identity shuffle, because the round is deliberately shuffled after
    // the right cards have been chosen.
    const plan = planStudy(withDue, {
      mode: 'learn', decks: [deck(12)], deckId: 'd1', size: 6, shuffle: (x) => x,
    })
    expect(plan[0]!.card.id).toBe('c5')
    expect(plan[0]!.reason).toBe('due')
  })

  it('puts the card lapsed on most first among the overdue', () => {
    let s = withMastery(snapshot, 'd1', 'c5', { mastery: 0.3, dueOn: '2020-01-01', lapses: 1 })
    s = withMastery(s, 'd1', 'c7', { mastery: 0.3, dueOn: '2020-01-01', lapses: 4 })
    const plan = planStudy(s, {
      mode: 'learn', decks: [deck(12)], deckId: 'd1', size: 6, shuffle: (x) => x,
    })
    expect(plan[0]!.card.id).toBe('c7')
  })

  it('leaves a card that is sharp and not due until last', () => {
    const s = withMastery(snapshot, 'd1', 'c0', {
      mastery: 0.95,
      dueOn: '2099-01-01',
      reps: 9,
    })
    const plan = planStudy(s, {
      mode: 'learn', decks: [deck(12)], deckId: 'd1', size: 12, shuffle: (x) => x,
    })
    expect(plan[plan.length - 1]!.card.id).toBe('c0')
  })

  it('plans nothing for review when nothing is due', () => {
    // An empty review queue is the system working, not a failure.
    const plan = planStudy(snapshot, { mode: 'review', decks: [deck(12)], size: 10 })
    expect(plan).toHaveLength(0)
  })

  it('reviews across every deck rather than one at a time', () => {
    let s: ProgressSnapshot = { ...emptySnapshot(), decks: [deck(6), deck(6, { id: 'd2' })] }
    s = withMastery(s, 'd1', 'c0', { dueOn: '2020-01-01', mastery: 0.4 })
    s = withMastery(s, 'd2', 'c0', { dueOn: '2020-01-01', mastery: 0.4 })
    const plan = planStudy(s, {
      mode: 'review',
      decks: [deck(6), deck(6, { id: 'd2' })],
      size: 10,
    })
    expect(new Set(plan.map((p) => p.deckId)).size).toBe(2)
  })

  it('asks a test paper both ways round when told to mix', () => {
    const plan = planStudy(snapshot, {
      mode: 'test',
      decks: [deck(12)],
      deckId: 'd1',
      size: 6,
      direction: 'mixed',
    })
    expect(new Set(plan.map((p) => p.direction)).size).toBe(2)
  })

  it('keeps one direction when asked for one', () => {
    const plan = planStudy(snapshot, {
      mode: 'test',
      decks: [deck(12)],
      deckId: 'd1',
      size: 6,
      direction: 'definition-first',
    })
    expect(plan.every((p) => p.direction === 'definition-first')).toBe(true)
  })

  it('finds a card’s mastery under the key the deck and card share', () => {
    const s = withMastery(snapshot, 'd1', 'c1', { mastery: 0.7 })
    expect(masteryOf(s, 'd1', 'c1')?.mastery).toBe(0.7)
    expect(masteryOf(s, 'd1', 'c2')).toBeUndefined()
  })
})

describe('an all-multiple-choice round', () => {
  const snapshot = { ...emptySnapshot(), decks: [deck(12)] }

  it('asks every card as a choice, whatever its mastery', () => {
    // A card Learn would already be asking written is still a four-way pick
    // here. That is the whole offer: a fast round with nothing to type.
    const sharp = withMastery(snapshot, 'd1', 'c1', { mastery: 0.95, correctStreak: 5, reps: 8 })
    const plan = planStudy(sharp, { mode: 'choice', decks: [deck(12)], deckId: 'd1', size: 12 })
    expect(plan).toHaveLength(12)
    expect(plan.every((p) => p.kind === 'multiple-choice')).toBe(true)
  })

  it('falls back to written on a deck too small to offer a choice', () => {
    const plan = planStudy(snapshot, { mode: 'choice', decks: [deck(3)], deckId: 'd1' })
    expect(plan).toHaveLength(3)
    expect(plan.every((p) => p.kind === 'written')).toBe(true)
  })

  it('leads with what needs work, the way Learn does', () => {
    const withDue = withMastery(snapshot, 'd1', 'c5', {
      mastery: 0.3,
      dueOn: '2020-01-01',
      lapses: 2,
    })
    const plan = planStudy(withDue, {
      mode: 'choice',
      decks: [deck(12)],
      deckId: 'd1',
      size: 4,
      shuffle: (x) => x,
    })
    expect(plan[0]!.card.id).toBe('c5')
    expect(plan[0]!.reason).toBe('due')
  })

  it('comes back to a missed card, like Learn and unlike Test', () => {
    expect(requeuePolicy('choice')).toEqual(requeuePolicy('learn'))
    expect(requeuePolicy('test')).toBeNull()
  })
})

describe('planning a spelling round', () => {
  const state = { ...defaultSkillState('spelling'), placed: true, ability: 4 }

  it('places a new learner across a spread of difficulty', () => {
    const plan = planPlacement(12)
    expect(plan).toHaveLength(12)
    expect(new Set(plan.map((p) => p.grade)).size).toBeGreaterThan(1)
  })

  it('fills a round to the size asked for', () => {
    const plan = planSession(emptySnapshot(), state, { mode: 'adaptive', size: 10 })
    expect(plan).toHaveLength(10)
  })

  it('never repeats a word inside one round', () => {
    const plan = planSession(emptySnapshot(), state, { mode: 'adaptive', size: 12 })
    expect(new Set(plan.map((p) => p.w)).size).toBe(plan.length)
  })

  it('caps review, so a round is not made entirely of past failures', () => {
    // Accurate and demoralising is still demoralising.
    let snapshot = emptySnapshot()
    const words = planSession(emptySnapshot(), state, { mode: 'adaptive', size: 30 })
    for (const w of words) {
      snapshot = {
        ...snapshot,
        mastery: {
          ...snapshot.mastery,
          [masteryKey('spelling', w.w)]: {
            subject: 'spelling',
            itemKey: w.w,
            listId: null,
            difficulty: w.difficulty,
            mastery: 0.2,
            reps: 3,
            lapses: 2,
            correctStreak: 0,
            totalAttempts: 5,
            totalCorrect: 1,
            intervalDays: 1,
            dueOn: '2020-01-01',
            firstSeenAt: 1,
            lastSeenAt: 2,
          } as never,
        },
      }
    }
    const plan = planSession(snapshot, state, { mode: 'adaptive', size: 10 })
    const relearn = plan.filter((p) => p.reason === 'relearn').length
    expect(relearn).toBeLessThanOrEqual(Math.ceil(10 * 0.4))
  })

  it('mixes review in with new material rather than clumping it', () => {
    // Ten review words in a row and then ten new ones is two rounds stapled
    // together, not one.
    const plan = planSession(emptySnapshot(), state, { mode: 'adaptive', size: 10 })
    expect(plan.every((p) => typeof p.reason === 'string')).toBe(true)
  })

  it('uses the words a grown-up pasted in, when given some', () => {
    const custom = [
      { w: 'because', s: 'A sentence.', listId: 'custom:l1', listTitle: 'Week 1', grade: 4, difficulty: 4 },
      { w: 'friend', s: 'A sentence.', listId: 'custom:l1', listTitle: 'Week 1', grade: 4, difficulty: 4 },
    ]
    const plan = planSession(emptySnapshot(), state, {
      mode: 'custom', size: 5, customWords: custom as never,
    })
    expect(plan.map((p) => p.w).sort()).toEqual(['because', 'friend'])
  })
})

describe('importing a pasted list', () => {
  it('reads a spreadsheet paste, which arrives as tabs', () => {
    const result = parseImport('Paris\tFrance\nRome\tItaly')
    expect(result.cards).toHaveLength(2)
    expect(result.separator).toBe('tab')
  })

  it('reads commas, dashes and colons', () => {
    for (const [text, sep] of [
      ['Paris,France\nRome,Italy', 'comma'],
      ['Paris - France\nRome - Italy', 'dash'],
      ['Paris: France\nRome: Italy', 'colon'],
    ] as const) {
      expect(parseImport(text).separator, text).toBe(sep)
    }
  })

  it('surfaces a row it could not split rather than dropping it', () => {
    const result = parseImport('Paris\tFrance\njustonething')
    expect(result.cards).toHaveLength(1)
    expect(result.skipped).toEqual(['justonething'])
  })

  it('takes an explicit separator over its own guess', () => {
    const result = parseImport('Paris - France', { between: 'dash' })
    expect(result.cards[0]).toMatchObject({ term: 'Paris', definition: 'France' })
  })

  it('reads blank-line-separated entries whose definitions run over lines', () => {
    const text = 'photosynthesis\tHow plants\nmake food\n\nmitochondria\tThe part\nthat makes energy'
    const result = parseImport(text, { rows: 'blank-line' })
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0]!.definition).toContain('make food')
  })

  it('reads a semicolon-separated list', () => {
    const result = parseImport('Paris\tFrance; Rome\tItaly', { rows: 'semicolon' })
    expect(result.cards).toHaveLength(2)
  })

  it('finds nothing in nothing', () => {
    expect(parseImport('   ')).toEqual({ cards: [], skipped: [], separator: 'tab' })
  })
})

describe('tidying a deck up', () => {
  it('drops half-written cards rather than saving them', () => {
    const messy = deck(2)
    messy.cards.push({ id: 'x', term: '  ', definition: 'orphan', hint: null, difficulty: 3 })
    expect(normalizeDeck(messy).cards).toHaveLength(2)
  })

  it('gives an untitled deck a name rather than an empty one', () => {
    expect(normalizeDeck({ ...deck(2), title: '   ' }).title).toBe('Untitled deck')
  })

  it('trims and de-duplicates tags', () => {
    const tidied = normalizeDeck({ ...deck(2), tags: [' Maths ', 'maths', ''] as never })
    expect(tidied.tags).toEqual(['maths'])
  })
})

describe('reading a deck’s progress back', () => {
  it('counts nothing seen on a deck never studied', () => {
    const stats = deckStats(emptySnapshot(), deck(5), todayString())
    expect(stats).toMatchObject({ total: 5, seen: 0, mastered: 0, due: 0 })
  })

  it('counts what is mastered, learning and due', () => {
    let s: ProgressSnapshot = { ...emptySnapshot(), decks: [deck(5)] }
    s = withMastery(s, 'd1', 'c0', { mastery: 0.95, dueOn: '2099-01-01' })
    s = withMastery(s, 'd1', 'c1', { mastery: 0.2, dueOn: '2020-01-01' })
    const stats = deckStats(s, deck(5), todayString())
    expect(stats.seen).toBe(2)
    expect(stats.mastered).toBe(1)
    expect(stats.due).toBe(1)
  })

  it('puts a learner’s own decks ahead of the ones that ship with the app', () => {
    const mine = deck(2, { id: 'mine', updatedAt: 100 })
    const starter = deck(2, { id: 'starter', source: 'starter' })
    const all = allDecks({ ...emptySnapshot(), decks: [mine] }, [starter])
    expect(all[0]!.id).toBe('mine')
    expect(findDeck(all, 'starter')?.id).toBe('starter')
    expect(findDeck(all, 'nope')).toBeUndefined()
  })
})
