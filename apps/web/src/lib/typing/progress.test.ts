// Typing lesson progress, read back from the account.
//
// The list entry is the record of stars and counts; the sessions carry WPM.
// What matters is that a snapshot from any device reads the same, and that a
// round finished a moment ago and the same round back from the store are one
// round, not two.

import { describe, expect, it } from 'vitest'
import {
  foldRound,
  lessonsDone,
  lessonsFromSnapshot,
  mergeLesson,
  totalStarsOf,
  typingListChange,
} from './progress'
import { emptySnapshot, type ListProgress, type SessionRecord } from '../progress/types'
import type { RoundResult } from '../stats'

function list(over: Partial<ListProgress> = {}): ListProgress {
  return {
    subject: 'typing',
    listId: 'home-fj',
    plays: 2,
    testsTaken: 2,
    bestScore: 700,
    bestAccuracy: 96,
    stars: 2,
    masteredAt: null,
    ...over,
  }
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's',
    subject: 'typing',
    activity: 'lesson',
    listId: 'home-fj',
    isTest: true,
    itemsTotal: 100,
    itemsCorrect: 96,
    accuracy: 96,
    score: 700,
    wpm: 28,
    durationMs: 60_000,
    abilityBefore: null,
    abilityAfter: null,
    meta: { stars: 2 },
    startedAt: 0,
    endedAt: 1,
    ...over,
  }
}

function round(over: Partial<RoundResult> = {}): RoundResult {
  return {
    wpm: 30,
    accuracy: 95,
    correct: 95,
    incorrect: 5,
    totalTyped: 100,
    elapsedMs: 60_000,
    maxCombo: 10,
    score: 500,
    ...over,
  }
}

describe('lessonsFromSnapshot', () => {
  it('is empty for a learner who has never typed', () => {
    expect(lessonsFromSnapshot(emptySnapshot())).toEqual({})
  })

  it('reads stars and counts from the list entry, and WPM from the sessions', () => {
    const snapshot = {
      ...emptySnapshot(),
      lists: { 'typing:home-fj': list() },
      sessions: [session({ id: 'a', wpm: 28 }), session({ id: 'b', wpm: 35 })],
    }
    expect(lessonsFromSnapshot(snapshot)).toEqual({
      'home-fj': { stars: 2, plays: 2, bestScore: 700, bestAccuracy: 96, bestWpm: 35 },
    })
  })

  it('ignores every other subject', () => {
    const snapshot = {
      ...emptySnapshot(),
      lists: {
        'spelling:g2-1': list({ subject: 'spelling', listId: 'g2-1' }),
        'typing:home-fj': list(),
      },
      sessions: [session({ subject: 'spelling', listId: 'g2-1', wpm: 99 })],
    }
    const lessons = lessonsFromSnapshot(snapshot)
    expect(Object.keys(lessons)).toEqual(['home-fj'])
    expect(lessons['home-fj']!.bestWpm).toBe(0)
  })

  it('rebuilds a lesson from its sessions when the list entry is missing', () => {
    // A round written before list entries existed is still a round played.
    const snapshot = {
      ...emptySnapshot(),
      sessions: [
        session({ id: 'a', score: 300, accuracy: 90, meta: { stars: 1 } }),
        session({ id: 'b', score: 900, accuracy: 99, wpm: 40, meta: { stars: 3 } }),
      ],
    }
    expect(lessonsFromSnapshot(snapshot)['home-fj']).toEqual({
      stars: 3,
      plays: 2,
      bestScore: 900,
      bestAccuracy: 99,
      bestWpm: 40,
    })
  })

  it('leaves an arcade round out — it is not a lesson', () => {
    const snapshot = {
      ...emptySnapshot(),
      sessions: [session({ activity: 'arcade', listId: null })],
    }
    expect(lessonsFromSnapshot(snapshot)).toEqual({})
  })
})

describe('the totals', () => {
  it('adds up stars and counts finished lessons', () => {
    const lessons = {
      a: { stars: 3, plays: 1, bestScore: 0, bestAccuracy: 0, bestWpm: 0 },
      b: { stars: 1, plays: 2, bestScore: 0, bestAccuracy: 0, bestWpm: 0 },
      c: { stars: 0, plays: 0, bestScore: 0, bestAccuracy: 0, bestWpm: 0 },
    }
    expect(totalStarsOf(lessons)).toBe(4)
    expect(lessonsDone(lessons)).toBe(2)
  })
})

describe('folding a round in', () => {
  it('starts a lesson from nothing', () => {
    expect(foldRound(undefined, round(), 2)).toEqual({
      stars: 2,
      bestWpm: 30,
      bestAccuracy: 95,
      bestScore: 500,
      plays: 1,
    })
  })

  it('keeps the bests and counts the play', () => {
    const before = { stars: 3, bestWpm: 40, bestAccuracy: 99, bestScore: 900, plays: 4 }
    expect(foldRound(before, round({ wpm: 5, accuracy: 20, score: 10 }), 0)).toEqual({
      ...before,
      plays: 5,
    })
  })
})

describe('reconciling the account with a round still pending', () => {
  it('takes the higher play count, never the sum', () => {
    // Both sides describe the same round; adding them would count it twice.
    const account = { stars: 2, bestWpm: 30, bestAccuracy: 95, bestScore: 500, plays: 3 }
    const local = { stars: 3, bestWpm: 28, bestAccuracy: 97, bestScore: 450, plays: 3 }
    expect(mergeLesson(account, local)).toEqual({
      stars: 3,
      bestWpm: 30,
      bestAccuracy: 97,
      bestScore: 500,
      plays: 3,
    })
  })

  it('passes a lone side through', () => {
    const only = { stars: 1, bestWpm: 1, bestAccuracy: 1, bestScore: 1, plays: 1 }
    expect(mergeLesson(undefined, only)).toBe(only)
    expect(mergeLesson(only, undefined)).toBe(only)
    expect(mergeLesson(undefined, undefined)).toBeUndefined()
  })
})

describe('the list entry sent to the account', () => {
  it('is the folded record, since the store replaces rather than adds', () => {
    const snapshot = { ...emptySnapshot(), lists: { 'typing:home-fj': list({ masteredAt: 5 }) } }
    expect(typingListChange(snapshot, 'home-fj', round({ score: 100, accuracy: 50 }), 1, 99)).toEqual({
      subject: 'typing',
      listId: 'home-fj',
      plays: 3,
      testsTaken: 3,
      bestScore: 700,
      bestAccuracy: 96,
      stars: 2,
      masteredAt: 5,
    })
  })

  it('marks the lesson mastered the first time it earns three stars', () => {
    const change = typingListChange(emptySnapshot(), 'home-fj', round(), 3, 42)
    expect(change).toMatchObject({ plays: 1, stars: 3, masteredAt: 42 })
  })

  it('does not mark it mastered for fewer', () => {
    expect(typingListChange(emptySnapshot(), 'home-fj', round(), 2, 42).masteredAt).toBeNull()
  })
})
