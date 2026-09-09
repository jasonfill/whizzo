// Where a task's "Start" button goes.
//
// The failure that matters is silent: a task pointing at something deleted
// since it was set must return null so the caller can say so, rather than
// navigating a child into an empty round.

import { describe, expect, it } from 'vitest'
import { ASSIGNABLE, assignableFor, routeForAssignment, targetName } from './routing'
import { activityDef } from '@whizzo/shared'
import { MODES } from '../quiz/session'
import { ACTIVITIES } from '../spelling/activities'
import { GRADES } from '../../data/spelling'
import { CURRICULUM } from '../../data/lessons'
import type { Assignment } from '../progress/types'

function task(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    setId: 's1',
    learnerId: 'l1',
    subject: 'spelling',
    activity: 'test',
    targetId: null,
    size: null,
    title: 'Friday spelling',
    note: null,
    minAccuracy: null,
    dueOn: null,
    status: 'open',
    completedAt: null,
    sessionId: null,
    sortOrder: 0,
    createdAt: 0,
    ...over,
  } as Assignment
}

describe('assignableFor', () => {
  it('finds every activity the picker offers', () => {
    for (const a of ASSIGNABLE) {
      expect(assignableFor(a.subject, a.activity)).toBeDefined()
    }
  })

  it('does not invent one for an unknown activity', () => {
    expect(assignableFor('spelling', 'telepathy')).toBeUndefined()
  })

  it('does not confuse two subjects that share an activity name', () => {
    // Both spelling and quiz have an activity called 'test'.
    const spelling = assignableFor('spelling', 'test')
    const quiz = assignableFor('quiz', 'test')
    if (spelling && quiz) expect(spelling).not.toBe(quiz)
  })
})

describe('routeForAssignment', () => {
  it('sends a spelling task pinned to a list into that list', () => {
    const listId = GRADES[0]!.lists[0]!.id
    const route = routeForAssignment(task({ targetId: listId }))
    expect(route).toMatchObject({ name: 'spell-play', mode: 'list', listId })
  })

  it('sends an unpinned spelling task into the adaptive mix', () => {
    // "Just do some spelling" means whatever is due, not a fixed list.
    expect(routeForAssignment(task({ targetId: null }))).toMatchObject({
      name: 'spell-play',
      mode: 'adaptive',
    })
  })

  it('carries the size a grown-up asked for', () => {
    expect(routeForAssignment(task({ size: 20 }))).toMatchObject({ size: 20 })
  })

  it('sends a quiz task to the deck in the mode it was set in', () => {
    const route = routeForAssignment(
      task({ subject: 'quiz', activity: 'test', targetId: 'deck-1' }),
    )
    expect(route).toMatchObject({ name: 'quiz-play', deckId: 'deck-1' })
  })

  it('sends a typing task to its lesson', () => {
    const id = CURRICULUM[0]!.id
    expect(routeForAssignment(task({ subject: 'typing', activity: 'lesson', targetId: id })))
      .toMatchObject({ name: 'lesson', id })
  })

  it('returns null for an activity that no longer exists', () => {
    expect(routeForAssignment(task({ activity: 'telepathy' }))).toBeNull()
    expect(routeForAssignment(task({ subject: 'quiz', activity: 'telepathy' }))).toBeNull()
  })

  it('returns null for a typing task with nothing to open', () => {
    expect(routeForAssignment(task({ subject: 'typing', activity: 'lesson', targetId: null })))
      .toBeNull()
  })

  it('produces a startable route for every assignable activity', () => {
    for (const a of ASSIGNABLE) {
      const route = routeForAssignment(
        task({ subject: a.subject, activity: a.activity, targetId: a.subject === 'typing' ? CURRICULUM[0]!.id : null }),
      )
      expect(route, `${a.subject}/${a.activity}`).not.toBeNull()
    }
  })
})

describe('targetName', () => {
  const noDecks = new Map<string, string>()

  it('names the spelling list a task points at', () => {
    const list = GRADES[0]!.lists[0]!
    expect(targetName(task({ targetId: list.id }), noDecks)).toBe(list.title)
  })

  it('says what an unpinned task means rather than leaving it blank', () => {
    expect(targetName(task({ targetId: null }), noDecks)).toBe('whatever is due')
  })

  it('names a deck from the titles it was given', () => {
    const decks = new Map([['d1', 'Capital cities']])
    expect(targetName(task({ subject: 'quiz', targetId: 'd1' }), decks)).toBe('Capital cities')
  })

  it('says plainly when the deck has been deleted since', () => {
    // A parent seeing this needs to know why the task will not start.
    expect(targetName(task({ subject: 'quiz', targetId: 'gone' }), noDecks)).toMatch(/deleted/)
  })

  it('falls back to a readable phrase for a missing spelling list', () => {
    expect(targetName(task({ targetId: 'no-such-list' }), noDecks)).toBe('a word list')
  })

  it('never returns an empty string', () => {
    for (const subject of ['spelling', 'typing', 'quiz'] as const) {
      for (const targetId of [null, 'missing']) {
        expect(targetName(task({ subject, targetId }), noDecks)).toBeTruthy()
      }
    }
  })
})

// The list is generated now, so the thing worth pinning is that generating it
// did not quietly drop or invent anything a grown-up can set.
describe('what can be assigned', () => {
  it('offers every quiz mode and every spelling activity, and typing', () => {
    const quiz = ASSIGNABLE.filter((a) => a.subject === 'quiz').map((a) => a.activity).sort()
    const spelling = ASSIGNABLE.filter((a) => a.subject === 'spelling').map((a) => a.activity).sort()
    expect(quiz).toEqual(MODES.map((m) => m.id).sort())
    expect(spelling).toEqual(ACTIVITIES.map((a) => a.id).sort())
    expect(ASSIGNABLE.filter((a) => a.subject === 'typing')).toHaveLength(1)
  })

  it('does not offer a question kind as though it were a round', () => {
    // `letter-hint`, `word-bank` and `cloze` are how a card is asked inside
    // Learn, chosen per card by the ladder. Setting one as homework would be a
    // task with nowhere to go.
    const ids = ASSIGNABLE.map((a) => a.activity)
    expect(ids).not.toContain('letter-hint')
    expect(ids).not.toContain('word-bank')
    expect(ids).not.toContain('cloze')
  })

  it('can route every single thing it offers', () => {
    for (const a of ASSIGNABLE) {
      const route = routeForAssignment({
        subject: a.subject,
        activity: a.activity,
        targetId: a.subject === 'typing' ? CURRICULUM[0]!.id : 'x',
      } as never)
      expect(route, `${a.subject}/${a.activity}`).not.toBeNull()
    }
  })

  it('agrees with the catalog about which activities are checked', () => {
    for (const a of ASSIGNABLE) {
      expect(a.graded, a.activity).toBe(activityDef(a.activity)?.isTest)
    }
  })
})

describe('a goal, rather than an activity', () => {
  it('routes to the set, where the planner decides what today is', () => {
    // The learner presses Continue; the app works out what that means.
    const route = routeForAssignment({
      subject: 'quiz',
      activity: 'mastery-path',
      targetId: 'deck-1',
    } as never)
    expect(route).toMatchObject({ name: 'quiz-play', deckId: 'deck-1' })
  })

  it('cannot be started when the set it named is gone', () => {
    // Null so the caller says so plainly rather than opening an empty round.
    expect(
      routeForAssignment({ subject: 'quiz', activity: 'mastery-path', targetId: null } as never),
    ).toBeNull()
  })
})
