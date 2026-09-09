// The write boundary.
//
// RLS decides *whose* rows may be touched. These schemas decide whether the
// payload is a coherent piece of progress at all — so a hole here is a hole
// the database will happily store.
//
// Most of what follows checks the things a hostile or buggy client would send:
// out-of-range numbers, strings where numbers belong, and fields the caller is
// not supposed to be able to set.

import { describe, expect, it } from 'vitest'
import {
  achievementSchema,
  assignmentDraftSchema,
  assignmentPatchSchema,
  attemptSchema,
  itemMasterySchema,
  listProgressSchema,
  quizCardSchema,
  quizDeckSchema,
  sessionRecordSchema,
  skillStateSchema,
  subjectSchema,
} from './schemas.js'

const UUID = '11111111-2222-4333-8444-555555555555'

function attempt(over: Record<string, unknown> = {}) {
  return {
    subject: 'spelling',
    itemKey: 'cat',
    activity: 'test',
    isTest: true,
    verified: true,
    correct: true,
    responseMs: 120,
    hintsUsed: 0,
    difficulty: 3,
    given: 'cat',
    at: 1700000000000,
    ...over,
  }
}

function session(over: Record<string, unknown> = {}) {
  return {
    id: UUID,
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 10,
    itemsCorrect: 9,
    accuracy: 90,
    score: 100,
    wpm: null,
    durationMs: 60000,
    abilityBefore: 3,
    abilityAfter: 3.2,
    meta: {},
    startedAt: 1700000000000,
    endedAt: 1700000060000,
    ...over,
  }
}

describe('subjectSchema', () => {
  it('accepts the three real subjects', () => {
    for (const s of ['spelling', 'typing', 'quiz']) {
      expect(subjectSchema.safeParse(s).success).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const s of ['math', '', null, 1, 'SPELLING']) {
      expect(subjectSchema.safeParse(s).success).toBe(false)
    }
  })
})

describe('attemptSchema', () => {
  it('accepts a well-formed attempt', () => {
    expect(attemptSchema.safeParse(attempt()).success).toBe(true)
  })

  it('defaults verified to true for clients that predate the flag', () => {
    const parsed = attemptSchema.parse(attempt({ verified: undefined }))
    expect(parsed.verified).toBe(true)
  })

  it('keeps an explicit verified:false rather than defaulting over it', () => {
    // This is the flag that keeps a self-graded answer out of the mastered
    // band. Losing it here would silently promote every claim.
    expect(attemptSchema.parse(attempt({ verified: false })).verified).toBe(false)
  })

  it('rejects a negative hint count', () => {
    expect(attemptSchema.safeParse(attempt({ hintsUsed: -1 })).success).toBe(false)
  })

  it('rejects a non-finite difficulty', () => {
    for (const d of [Infinity, -Infinity, NaN]) {
      expect(attemptSchema.safeParse(attempt({ difficulty: d })).success).toBe(false)
    }
  })

  it('rejects a timestamp before the epoch', () => {
    expect(attemptSchema.safeParse(attempt({ at: -1 })).success).toBe(false)
  })

  it('rejects an item key long enough to be an attack rather than a word', () => {
    expect(attemptSchema.safeParse(attempt({ itemKey: 'x'.repeat(201) })).success).toBe(false)
    expect(attemptSchema.safeParse(attempt({ itemKey: '' })).success).toBe(false)
  })

  it('caps what a learner typed, so a paste cannot become a row', () => {
    expect(attemptSchema.safeParse(attempt({ given: 'x'.repeat(401) })).success).toBe(false)
  })

  it('rejects a malformed session id', () => {
    expect(attemptSchema.safeParse(attempt({ sessionId: 'not-a-uuid' })).success).toBe(false)
  })
})

describe('sessionRecordSchema', () => {
  it('accepts a well-formed session', () => {
    expect(sessionRecordSchema.safeParse(session()).success).toBe(true)
  })

  it('requires a real uuid for the id', () => {
    expect(sessionRecordSchema.safeParse(session({ id: '1' })).success).toBe(false)
  })

  it('rejects an accuracy outside 0..100', () => {
    expect(sessionRecordSchema.safeParse(session({ accuracy: 101 })).success).toBe(false)
    expect(sessionRecordSchema.safeParse(session({ accuracy: -1 })).success).toBe(false)
  })

  it('rejects negative counts', () => {
    expect(sessionRecordSchema.safeParse(session({ itemsTotal: -1 })).success).toBe(false)
    expect(sessionRecordSchema.safeParse(session({ durationMs: -1 })).success).toBe(false)
  })

  it('defaults meta rather than requiring it', () => {
    expect(sessionRecordSchema.parse(session({ meta: undefined })).meta).toEqual({})
  })

  it('accepts provenance fields for round-tripping', () => {
    // Accepted so a snapshot survives a load/save cycle. The route overwrites
    // them from the attempts; that rule is asserted in the repo tests, not here.
    const parsed = sessionRecordSchema.parse(
      session({ evidence: 'attempts', verifiedItemsTotal: 10, verifiedItemsCorrect: 9 }),
    )
    expect(parsed.evidence).toBe('attempts')
  })

  it('rejects an evidence kind that is not one of the three', () => {
    expect(sessionRecordSchema.safeParse(session({ evidence: 'trust-me' })).success).toBe(false)
  })
})

describe('skillStateSchema', () => {
  const state = {
    subject: 'spelling',
    ability: 4,
    abilitySd: 1,
    levelIndex: 2,
    placed: true,
    totalAttempts: 10,
    totalCorrect: 8,
    streakDays: 3,
    bestStreakDays: 5,
    lastActiveOn: '2026-01-15',
    settings: {},
  }

  it('accepts a well-formed state', () => {
    expect(skillStateSchema.safeParse(state).success).toBe(true)
  })

  it('rejects a negative level index', () => {
    expect(skillStateSchema.safeParse({ ...state, levelIndex: -1 }).success).toBe(false)
  })

  it('rejects a negative uncertainty', () => {
    expect(skillStateSchema.safeParse({ ...state, abilitySd: -1 }).success).toBe(false)
  })

  it('rejects a malformed day string', () => {
    for (const d of ['2026-1-5', '15/01/2026', 'today', '20260115']) {
      expect(skillStateSchema.safeParse({ ...state, lastActiveOn: d }).success).toBe(false)
    }
  })

  it('accepts a null last-active day for a learner who has never played', () => {
    expect(skillStateSchema.safeParse({ ...state, lastActiveOn: null }).success).toBe(true)
  })

  it('defaults settings so an older client is not rejected for omitting them', () => {
    expect(skillStateSchema.parse({ ...state, settings: undefined }).settings).toEqual({})
  })
})

describe('itemMasterySchema', () => {
  const item = {
    subject: 'spelling',
    itemKey: 'cat',
    listId: null,
    difficulty: 3,
    mastery: 0.5,
    reps: 2,
    lapses: 0,
    correctStreak: 2,
    totalAttempts: 3,
    totalCorrect: 2,
    intervalDays: 4,
    dueOn: '2026-01-20',
    firstSeenAt: 1,
    lastSeenAt: 2,
  }

  it('accepts a well-formed record', () => {
    expect(itemMasterySchema.safeParse(item).success).toBe(true)
  })

  it('holds mastery to 0..1, so a client cannot declare itself expert', () => {
    expect(itemMasterySchema.safeParse({ ...item, mastery: 1.5 }).success).toBe(false)
    expect(itemMasterySchema.safeParse({ ...item, mastery: -0.1 }).success).toBe(false)
  })

  it('rejects a negative review interval', () => {
    expect(itemMasterySchema.safeParse({ ...item, intervalDays: -1 }).success).toBe(false)
  })
})

describe('listProgressSchema', () => {
  const list = {
    subject: 'spelling',
    listId: 'g2-short-vowels',
    plays: 1,
    testsTaken: 1,
    bestScore: 100,
    bestAccuracy: 90,
    stars: 3,
    masteredAt: null,
  }

  it('accepts a well-formed record', () => {
    expect(listProgressSchema.safeParse(list).success).toBe(true)
  })

  it('caps stars at three', () => {
    expect(listProgressSchema.safeParse({ ...list, stars: 4 }).success).toBe(false)
    expect(listProgressSchema.safeParse({ ...list, stars: -1 }).success).toBe(false)
  })
})

describe('achievementSchema', () => {
  it('accepts a well-formed unlock', () => {
    const ok = { achievementId: 'first-steps', subject: 'typing', unlockedAt: 1 }
    expect(achievementSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects an empty achievement id', () => {
    expect(
      achievementSchema.safeParse({ achievementId: '', subject: 'typing', unlockedAt: 1 }).success,
    ).toBe(false)
  })
})

describe('assignments — what a grown-up may and may not set', () => {
  const draft = { subject: 'spelling', activity: 'test', title: 'Friday list' }

  it('accepts a minimal draft', () => {
    expect(assignmentDraftSchema.safeParse(draft).success).toBe(true)
  })

  it('requires a title somebody could read', () => {
    expect(assignmentDraftSchema.safeParse({ ...draft, title: '' }).success).toBe(false)
    expect(
      assignmentDraftSchema.safeParse({ ...draft, title: 'x'.repeat(121) }).success,
    ).toBe(false)
  })

  it('holds a minimum accuracy to a real percentage', () => {
    expect(assignmentDraftSchema.safeParse({ ...draft, minAccuracy: 0 }).success).toBe(false)
    expect(assignmentDraftSchema.safeParse({ ...draft, minAccuracy: 101 }).success).toBe(false)
    expect(assignmentDraftSchema.safeParse({ ...draft, minAccuracy: 80 }).success).toBe(true)
  })

  it('strips status, completedAt and sessionId from a draft', () => {
    // A task is closed by the round that satisfied it, so none of these are
    // ever something a caller supplies.
    const parsed = assignmentDraftSchema.parse({
      ...draft,
      status: 'done',
      completedAt: 1,
      sessionId: UUID,
    })
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('completedAt')
    expect(parsed).not.toHaveProperty('sessionId')
  })

  it('will not let a patch declare work finished', () => {
    // Finishing work is something you do, not something you say.
    expect(assignmentPatchSchema.safeParse({ status: 'done' }).success).toBe(false)
    expect(assignmentPatchSchema.safeParse({ status: 'canceled' }).success).toBe(true)
    expect(assignmentPatchSchema.safeParse({ status: 'open' }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Card enrichment
// ---------------------------------------------------------------------------
//
// These fields are what let one pasted list be practiced many ways. They are
// all optional on purpose: every deck saved before they existed still has to
// validate, and a parent pasting two columns is never asked for any of them.

function card(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    term: 'mitochondrion',
    definition: 'the powerhouse of the cell',
    hint: null,
    difficulty: 2.4,
    ...over,
  }
}

describe('quizCardSchema', () => {
  it('accepts a card with none of the enrichment fields', () => {
    expect(quizCardSchema.safeParse(card()).success).toBe(true)
  })

  it('accepts every enrichment field at once', () => {
    const result = quizCardSchema.safeParse(
      card({
        category: 'organelles',
        example: 'The mitochondrion makes ATP.',
        order: 3,
        media: { kind: 'image', url: 'https://example.test/cell.png', alt: 'a cell' },
        answerKind: 'text',
        tolerance: null,
        altAnswers: ['mitochondria'],
        explanation: 'It releases energy from glucose.',
        sourcePages: [4, 5],
        generated: ['example', 'category'],
      }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts an explicitly null category rather than demanding it be absent', () => {
    // normalizeDeck writes null for a blank one, and that round trip must work.
    expect(quizCardSchema.safeParse(card({ category: null, example: null })).success).toBe(true)
  })

  it('refuses an answer kind it does not know how to grade', () => {
    expect(quizCardSchema.safeParse(card({ answerKind: 'vibes' })).success).toBe(false)
  })

  it('refuses a media kind that is not an image or a sound', () => {
    expect(
      quizCardSchema.safeParse(card({ media: { kind: 'video', url: 'u', alt: 'a' } })).success,
    ).toBe(false)
  })

  it('refuses a negative tolerance, which would accept nothing', () => {
    expect(quizCardSchema.safeParse(card({ tolerance: -1 })).success).toBe(false)
  })

  it('refuses an infinite tolerance, which would accept everything', () => {
    expect(quizCardSchema.safeParse(card({ tolerance: Number.POSITIVE_INFINITY })).success).toBe(
      false,
    )
  })

  it('bounds the arrays, because a deck is read and written whole', () => {
    expect(quizCardSchema.safeParse(card({ altAnswers: Array(9).fill('x') })).success).toBe(false)
    expect(quizCardSchema.safeParse(card({ sourcePages: Array(9).fill(1) })).success).toBe(false)
  })

  it('refuses a fractional page number', () => {
    expect(quizCardSchema.safeParse(card({ sourcePages: [1.5] })).success).toBe(false)
  })

  it('still refuses a card with no answer side', () => {
    expect(quizCardSchema.safeParse(card({ definition: '' })).success).toBe(false)
  })
})

describe('quizDeckSchema carries enrichment through', () => {
  it('keeps the fields on the way in', () => {
    const parsed = quizDeckSchema.safeParse({
      id: UUID,
      title: 'Cells',
      cards: [card({ category: 'organelles', explanation: 'why' })],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.cards[0]).toMatchObject({
        category: 'organelles',
        explanation: 'why',
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------
//
// The pool a piece of work counts toward. Bounded rather than enumerated on
// purpose: the registry ships with the client and grows without a schema
// change, and an unknown track resolves to General rather than being rejected.
// A learner must never lose work because a registry moved on.

describe('track on the write boundary', () => {
  it('accepts a deck with no track, which is most of them', () => {
    expect(quizDeckSchema.safeParse({ id: UUID, title: 'Cells', cards: [] }).success).toBe(true)
  })

  it('accepts a filed deck and keeps the filing', () => {
    const parsed = quizDeckSchema.safeParse({
      id: UUID,
      title: 'Cells',
      cards: [],
      track: 'science.biology',
      objectives: ['bio.cell-structure'],
    })
    expect(parsed.success && parsed.data.track).toBe('science.biology')
  })

  it('accepts an explicitly null track, which is how "unfile this" arrives', () => {
    expect(
      quizDeckSchema.safeParse({ id: UUID, title: 'x', cards: [], track: null }).success,
    ).toBe(true)
  })

  it('does not reject a track it has never heard of', () => {
    // The registry is the authority and it is not on this side of the wire.
    expect(
      quizDeckSchema.safeParse({ id: UUID, title: 'x', cards: [], track: 'made.up' }).success,
    ).toBe(true)
  })

  it('bounds it, because an unbounded string is an unbounded row', () => {
    expect(
      quizDeckSchema.safeParse({ id: UUID, title: 'x', cards: [], track: 'a'.repeat(61) }).success,
    ).toBe(false)
    expect(
      quizDeckSchema.safeParse({ id: UUID, title: 'x', cards: [], objectives: Array(5).fill('o') })
        .success,
    ).toBe(false)
  })

  it('carries the pool on an attempt, so attempts alone can still rebuild', () => {
    const parsed = attemptSchema.safeParse(attempt({ track: 'world.spanish' }))
    expect(parsed.success && parsed.data.track).toBe('world.spanish')
  })

  it('records which rung a question was asked at, and refuses one that is not a rung', () => {
    expect(attemptSchema.safeParse(attempt({ askedAt: 2 })).success).toBe(true)
    expect(attemptSchema.safeParse(attempt({ askedAt: 4 })).success).toBe(false)
    expect(attemptSchema.safeParse(attempt({ askedAt: -1 })).success).toBe(false)
    // Absent is the honest state for every attempt recorded before the ladder.
    expect(attemptSchema.safeParse(attempt()).success).toBe(true)
  })

  it('lets a skill state name its pool', () => {
    const parsed = skillStateSchema.safeParse({
      subject: 'quiz',
      track: 'science.biology',
      ability: 2,
      abilitySd: 1,
      levelIndex: 0,
      placed: false,
      totalAttempts: 0,
      totalCorrect: 0,
      streakDays: 0,
      bestStreakDays: 0,
      lastActiveOn: null,
    })
    expect(parsed.success && parsed.data.track).toBe('science.biology')
  })
})

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
//
// A goal is set instead of an activity — "master this set" rather than "do
// Learn on this deck" — which stops a grown-up having to choose between Learn
// and Test, a pedagogical decision they should never have been handed.

describe('goal assignments', () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    subject: 'quiz',
    activity: 'mastery-path',
    targetId: 'deck-1',
    title: 'Chapter 7',
    ...over,
  })

  it('accepts an ordinary activity task with no goal at all', () => {
    expect(assignmentDraftSchema.safeParse(draft({ activity: 'learn' })).success).toBe(true)
  })

  it('accepts a goal, with the bar left to the default', () => {
    const parsed = assignmentDraftSchema.safeParse(draft({ goal: { kind: 'mastery' } }))
    expect(parsed.success).toBe(true)
  })

  it('accepts a bar somebody set deliberately', () => {
    const parsed = assignmentDraftSchema.safeParse(
      draft({ goal: { kind: 'mastery', fraction: 0.8 } }),
    )
    expect(parsed.success && parsed.data.goal?.fraction).toBe(0.8)
  })

  it('refuses a goal it does not know how to measure', () => {
    expect(assignmentDraftSchema.safeParse(draft({ goal: { kind: 'vibes' } })).success).toBe(false)
  })

  it('refuses a bar nobody could clear, or one already cleared', () => {
    expect(
      assignmentDraftSchema.safeParse(draft({ goal: { kind: 'mastery', fraction: 1.5 } })).success,
    ).toBe(false)
    expect(
      assignmentDraftSchema.safeParse(draft({ goal: { kind: 'mastery', fraction: 0 } })).success,
    ).toBe(false)
  })
})
