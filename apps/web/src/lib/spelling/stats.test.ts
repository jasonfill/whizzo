// Readings of a learner's progress.
//
// These feed both the child's screen and the parent's report, so a mistake
// here is a mistake a grown-up will act on. The one that matters most is that
// nothing counts a subject other than spelling: mastery is keyed by the word
// itself, and 'a' is a word in more than one subject.

import { describe, expect, it } from 'vitest'
import {
  attemptedWords,
  breakdown,
  dueWords,
  gradeBreakdown,
  listBreakdown,
  totalCurriculumWords,
  troubleWords,
  turnaroundWords,
  wordHistory,
} from './stats'
import { emptySnapshot, masteryKey, todayString, addDays } from '../progress/types'
import type { ItemMastery, ProgressSnapshot } from '../progress/types'
import { ALL_WORDS, GRADES } from '../../data/spelling'

function item(over: Partial<ItemMastery> = {}): ItemMastery {
  return {
    subject: 'spelling',
    itemKey: 'cat',
    listId: null,
    difficulty: 2,
    mastery: 0.5,
    reps: 2,
    lapses: 0,
    correctStreak: 1,
    totalAttempts: 2,
    totalCorrect: 1,
    intervalDays: 1,
    dueOn: null,
    firstSeenAt: 0,
    lastSeenAt: 0,
    ...over,
  }
}

function withMastery(items: ItemMastery[]): ProgressSnapshot {
  const mastery: Record<string, ItemMastery> = {}
  for (const m of items) mastery[masteryKey(m.subject, m.itemKey)] = m
  return { ...emptySnapshot(), mastery }
}

describe('breakdown', () => {
  const words = [{ w: 'cat' }, { w: 'dog' }, { w: 'bird' }] as never

  it('calls everything unseen for a learner who has done nothing', () => {
    expect(breakdown(emptySnapshot(), words)).toMatchObject({
      total: 3,
      mastered: 0,
      practiced: 0,
      learning: 0,
      unseen: 3,
    })
  })

  it('sorts each word into exactly one band', () => {
    const snap = withMastery([
      item({ itemKey: 'cat', mastery: 0.95, correctStreak: 3 }),
      item({ itemKey: 'dog', mastery: 0.5 }),
      item({ itemKey: 'bird', mastery: 0.1 }),
    ])
    const b = breakdown(snap, words)
    expect(b.mastered + b.practiced + b.learning + b.unseen).toBe(b.total)
    expect(b).toMatchObject({ mastered: 1, practiced: 1, learning: 1, unseen: 0 })
  })

  it('ignores mastery recorded under another subject', () => {
    // 'cat' is a spelling word and could be a quiz card too. Counting the quiz
    // record here would tell a parent their child had mastered spelling they
    // had never attempted.
    const snap = withMastery([item({ subject: 'quiz', itemKey: 'cat', mastery: 1, correctStreak: 9 })])
    expect(breakdown(snap, words).mastered).toBe(0)
  })
})

describe('gradeBreakdown', () => {
  it('covers each grade’s own words and nothing else', () => {
    for (const g of GRADES) {
      const b = gradeBreakdown(emptySnapshot(), g.grade)
      expect(b.total).toBeGreaterThan(0)
      expect(b.total).toBeLessThan(ALL_WORDS.length)
    }
  })

  it('adds up to the whole curriculum across every grade', () => {
    const total = GRADES.reduce((n, g) => n + gradeBreakdown(emptySnapshot(), g.grade).total, 0)
    expect(total).toBe(totalCurriculumWords())
  })
})

describe('listBreakdown', () => {
  it('is empty for a list that does not exist rather than throwing', () => {
    expect(listBreakdown(emptySnapshot(), 'no-such-list').total).toBe(0)
  })
})

describe('dueWords', () => {
  const today = todayString()

  it('includes a word never scheduled', () => {
    const snap = withMastery([item({ dueOn: null })])
    expect(dueWords(snap, today)).toHaveLength(1)
  })

  it('includes a word due today and one overdue', () => {
    const snap = withMastery([
      item({ itemKey: 'a', dueOn: today }),
      item({ itemKey: 'b', dueOn: addDays(today, -5) }),
    ])
    expect(dueWords(snap, today)).toHaveLength(2)
  })

  it('leaves a word scheduled for the future alone', () => {
    const snap = withMastery([item({ dueOn: addDays(today, 3) })])
    expect(dueWords(snap, today)).toHaveLength(0)
  })

  it('does not pull in another subject’s due cards', () => {
    const snap = withMastery([item({ subject: 'quiz', dueOn: null })])
    expect(dueWords(snap, today)).toHaveLength(0)
  })
})

describe('troubleWords — what a parent is shown to work on', () => {
  it('ignores a word seen only once, which is not yet evidence of trouble', () => {
    const snap = withMastery([item({ totalAttempts: 1, mastery: 0.1 })])
    expect(troubleWords(snap)).toHaveLength(0)
  })

  it('ignores a word already mastered', () => {
    const snap = withMastery([item({ mastery: 0.9, totalAttempts: 5 })])
    expect(troubleWords(snap)).toHaveLength(0)
  })

  it('puts the weakest word first', () => {
    const snap = withMastery([
      item({ itemKey: 'ok', mastery: 0.7 }),
      item({ itemKey: 'bad', mastery: 0.1 }),
      item({ itemKey: 'mid', mastery: 0.4 }),
    ])
    expect(troubleWords(snap).map((m) => m.itemKey)).toEqual(['bad', 'mid', 'ok'])
  })

  it('breaks a tie on how often the word has slipped', () => {
    const snap = withMastery([
      item({ itemKey: 'steady', mastery: 0.4, lapses: 0 }),
      item({ itemKey: 'slippy', mastery: 0.4, lapses: 6 }),
    ])
    expect(troubleWords(snap)[0]!.itemKey).toBe('slippy')
  })

  it('honors the limit the caller asked for', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      item({ itemKey: `w${i}`, mastery: 0.1, totalAttempts: 4 }),
    )
    expect(troubleWords(withMastery(many), 4)).toHaveLength(4)
  })

  it('stays empty for a learner with no history, rather than inventing rows', () => {
    expect(troubleWords(emptySnapshot())).toEqual([])
  })
})

describe('turnaroundWords', () => {
  it('is a word that was missed and is now mastered', () => {
    const snap = withMastery([item({ lapses: 2, mastery: 0.9 })])
    expect(turnaroundWords(snap)).toHaveLength(1)
  })

  it('does not count a word that was never missed in the first place', () => {
    const snap = withMastery([item({ lapses: 0, mastery: 0.95 })])
    expect(turnaroundWords(snap)).toHaveLength(0)
  })

  it('does not count a word still being missed', () => {
    const snap = withMastery([item({ lapses: 3, mastery: 0.2 })])
    expect(turnaroundWords(snap)).toHaveLength(0)
  })
})

describe('wordHistory — what the session quotes back', () => {
  it('reports nothing for a word never attempted', () => {
    expect(wordHistory(emptySnapshot(), 'cat')).toEqual({ attempts: 0, correct: 0 })
  })

  it('reports the running tally', () => {
    const snap = withMastery([item({ itemKey: 'cat', totalAttempts: 7, totalCorrect: 2 })])
    expect(wordHistory(snap, 'cat')).toEqual({ attempts: 7, correct: 2 })
  })

  it('looks the word up case-insensitively', () => {
    const snap = withMastery([item({ itemKey: 'cat', totalAttempts: 3, totalCorrect: 3 })])
    expect(wordHistory(snap, 'CAT').attempts).toBe(3)
  })
})

describe('attemptedWords', () => {
  it('is only spelling, newest first', () => {
    const snap = withMastery([
      item({ itemKey: 'old', lastSeenAt: 1 }),
      item({ itemKey: 'new', lastSeenAt: 9 }),
      item({ subject: 'quiz', itemKey: 'card', lastSeenAt: 5 }),
    ])
    expect(attemptedWords(snap).map((m) => m.itemKey)).toEqual(['new', 'old'])
  })
})

describe('the curriculum itself', () => {
  it('reports a real total', () => {
    expect(totalCurriculumWords()).toBe(ALL_WORDS.length)
    expect(totalCurriculumWords()).toBeGreaterThan(0)
  })
})
