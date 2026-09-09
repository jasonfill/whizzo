// The parent's report, with something actually in it.
//
// The existing suite tests cover the empty states and the trust card. What is
// added here is the report as a parent with a term of practice behind them
// would see it: the activity chart read back as a sentence, the trouble-word
// list, the session log with each round openable, and the two places the free
// plan draws a line and says so rather than quietly showing less.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)
vi.mock('../../hooks/useAssignments', async () =>
  (await import('../../test/mockProviders')).assignmentsMock(),
)
vi.mock('../../lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAssignments: vi.fn(async () => []),
  listAssignmentSets: vi.fn(async () => []),
}))

import { aGame, spies } from '../../test/mockProviders'
import { aLearner, anAssignment, signIn, skill, testState } from '../../test/state'
import { addDays, emptySnapshot, masteryKey, todayString } from '../../lib/progress/types'
import type { ProgressSnapshot, SessionRecord } from '../../lib/progress/types'
import ProgressScreen from './ProgressScreen'

const navigate = spies.navigate

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `s-${Math.random()}`,
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 10,
    itemsCorrect: 8,
    accuracy: 80,
    score: 100,
    wpm: null,
    durationMs: 90_000,
    abilityBefore: 3,
    abilityAfter: 3.2,
    meta: { predictedAccuracy: 70 },
    startedAt: Date.now(),
    endedAt: Date.now(),
    evidence: 'attempts',
    verifiedItemsTotal: 10,
    verifiedItemsCorrect: 8,
    ...over,
  }
}

function mastery(itemKey: string, over: Record<string, unknown> = {}) {
  return {
    subject: 'spelling',
    itemKey,
    listId: null,
    difficulty: 0.2,
    mastery: 0.2,
    reps: 5,
    lapses: 3,
    correctStreak: 0,
    totalAttempts: 6,
    totalCorrect: 2,
    intervalDays: 1,
    dueOn: todayString(),
    firstSeenAt: 1,
    lastSeenAt: 2,
    ...over,
  } as never
}

/** A day-by-day pile of practice, most recent last. */
function daily(pattern: number[]): ProgressSnapshot['daily'] {
  const today = todayString()
  return pattern.map((items, i) => ({
    day: addDays(today, i - (pattern.length - 1)),
    subject: 'spelling',
    seconds: items * 6,
    items,
    correct: Math.round(items * 0.8),
    sessions: items > 0 ? 1 : 0,
  })) as never
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
  testState.skills = { spelling: skill('spelling', { placed: true }) }
  spies.attemptsForSession.mockResolvedValue([])
})

describe('the activity chart, read back in words', () => {
  it('says practice is picking up', () => {
    // A chart is another number. The sentence under it is the answer a parent
    // came for.
    testState.snapshot = { ...emptySnapshot(), daily: daily([...Array(14).fill(0), ...Array(7).fill(20)]) }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Picking up/)).toBeTruthy()
  })

  it('says practice is slowing down', () => {
    testState.snapshot = { ...emptySnapshot(), daily: daily([...Array(7).fill(20), ...Array(14).fill(0)]) }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Nothing this week|Slowing down/)).toBeTruthy()
  })

  it('says so plainly when a steady week follows a steady month', () => {
    testState.snapshot = { ...emptySnapshot(), daily: daily(Array(21).fill(10)) }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Steady/)).toBeTruthy()
  })

  it('offers a way back rather than a scolding after a gap', () => {
    testState.snapshot = { ...emptySnapshot(), daily: daily([...Array(14).fill(15), ...Array(7).fill(0)]) }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/nothing is lost by coming back to it/)).toBeTruthy()
  })
})

describe('the words that keep going wrong', () => {
  it('lists them', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: Object.fromEntries(
        ['because', 'friend', 'through'].map((w) => [`spelling:${w}`, mastery(w)]),
      ),
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('because')).toBeTruthy()
  })

  it('names the limit rather than quietly showing fewer', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`spelling:w${i}`, mastery(`w${i}`)]),
      ),
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Showing 4 of 9/)).toBeTruthy()
    // "Covering this learner", not "Family Pro" — what is bought is a child,
    // and there is no tier to be on.
    fireEvent.click(screen.getByText('Covering this learner'))
    expect(navigate).toHaveBeenCalledWith({ name: 'upgrade' })
  })

  it('celebrates words that turned around', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: {
        'spelling:because': mastery('because', {
          mastery: 0.95,
          lapses: 4,
          correctStreak: 5,
          totalCorrect: 10,
          totalAttempts: 14,
        }),
      },
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(document.body.textContent).toContain('because')
  })
})

describe('the session log', () => {
  beforeEach(() => {
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [
        session({ id: 'a', subject: 'spelling', activity: 'test' }),
        session({ id: 'b', subject: 'quiz', activity: 'flashcards', isTest: false }),
        session({ id: 'c', subject: 'typing', activity: 'lesson', isTest: false, wpm: 24 }),
      ],
    }
  })

  it('names each round in words a parent would use', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(document.body.textContent).toMatch(/Flashcards|Typing lesson|Test/)
  })

  it('opens a round to show the answers behind it', async () => {
    spies.attemptsForSession.mockResolvedValue([
      {
        itemKey: 'because',
        subject: 'spelling',
        correct: false,
        given: 'becuase',
        verified: true,
        hintsUsed: 0,
        responseMs: 3000,
      },
    ])
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    const rows = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') !== null)
    expect(rows.length).toBeGreaterThan(0)
    fireEvent.click(rows[0]!)
    expect(await screen.findByText('Answered "becuase"')).toBeTruthy()
  })

  it('closes it again', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    const row = screen.getAllByRole('button').find((b) => b.getAttribute('aria-expanded') !== null)!
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('says how much history is kept, rather than hiding the rest', () => {
    const old = Date.now() - 120 * 86_400_000
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: Array.from({ length: 5 }, (_, i) =>
        session({ id: `old-${i}`, startedAt: old, endedAt: old }),
      ),
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/outside\s+the 30-day window/)).toBeTruthy()
  })
})

describe('the other two subjects', () => {
  it('summarizes typing and offers a way into it', () => {
    const game = aGame({
      state: { lessons: { l1: { plays: 2, stars: 3, bestWpm: 26, bestAccuracy: 95 } }, totalStars: 3 },
    })
    render(<ProgressScreen game={game} navigate={navigate} />)
    expect(screen.getByText(/best 26 WPM/)).toBeTruthy()
    fireEvent.click(screen.getByText('Open typing →'))
    expect(navigate).toHaveBeenCalledWith({ name: 'typing' })
  })

  it('summarizes quiz and offers a way into it', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('Open quiz →'))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })
})

describe('work the grown-up has set', () => {
  it('is shown alongside the report, with a way to set more', () => {
    testState.assignments = [anAssignment({ title: 'Friday spelling' })]
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    const assign = screen.queryByText('Assign something new')
    if (!assign) return
    fireEvent.click(assign)
    expect(navigate).toHaveBeenCalledWith({ name: 'library' })
  })
})

// The panel that turns one meaningless average into something a parent can act
// on. It is deliberately absent for a learner with only one pool: a list of one
// is not a comparison, and a screen that grows a section for nothing is noise.
describe('progress by subject', () => {
  function studying(entries: Array<[string, string | null, number, number]>) {
    const decks = entries.map(([id, track]) => ({
      id,
      track,
      title: id,
      description: '',
      tags: [],
      cards: [{ id: 'c1', term: 't', definition: 'd', hint: null, difficulty: 2 }],
      source: 'user' as const,
      termLabel: 'Term',
      definitionLabel: 'Definition',
      createdAt: 0,
      updatedAt: 0,
    }))
    const mastery: Record<string, unknown> = {}
    entries.forEach(([id, , score]) => {
      const itemKey = `${id}:c1`
      mastery[masteryKey('quiz', itemKey)] = {
        subject: 'quiz', itemKey, listId: id, difficulty: 2, mastery: score, reps: 4,
        lapses: 0, correctStreak: score >= 0.8 ? 3 : 0, totalAttempts: 4, totalCorrect: 3,
        intervalDays: 2, dueOn: null, firstSeenAt: 1, lastSeenAt: 2,
      }
    })
    testState.snapshot = { ...testState.snapshot, decks: decks as never, mastery: mastery as never }
  }

  it('breaks the score out once there is more than one subject', () => {
    studying([['bio', 'science.biology', 0.9, 1], ['esp', 'world.spanish', 0.4, 1]])
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('By subject')).toBeTruthy()
    expect(screen.getByText('Biology')).toBeTruthy()
    expect(screen.getByText('Spanish')).toBeTruthy()
  })

  it('says how much of each is mastered', () => {
    studying([['bio', 'science.biology', 0.9, 1], ['esp', 'world.spanish', 0.4, 1]])
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('1 of 1 mastered')).toBeTruthy()
  })

  it('stays out of the way for a learner with one subject', () => {
    studying([['bio', 'science.biology', 0.9, 1]])
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText('By subject')).toBeNull()
  })

  it('files unfiled decks under General rather than hiding them', () => {
    studying([['misc', null, 0.5, 1], ['bio', 'science.biology', 0.5, 1]])
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('General')).toBeTruthy()
  })
})

// Retention is the one card here about the future rather than the past, so it
// is also the one that can be confidently wrong. The tests are mostly about
// what it refuses to say.
describe('will it stick?', () => {
  /** Covered, because retention is one of the things coverage buys. */
  function covered(...items: Array<Record<string, unknown>>) {
    signIn(aLearner({ displayName: 'Ada', covered: true }))
    testState.skills = { spelling: skill('spelling', { placed: true }) }
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: Object.fromEntries(items.map((m, i) => [`spelling:i${i}`, m])),
    } as never
  }

  it('splits what is known from what is going', () => {
    covered(
      mastery('secure', { intervalDays: 40, dueOn: addDays(todayString(), 40), lapses: 0 }),
      mastery('gone', { intervalDays: 2, dueOn: addDays(todayString(), -9), lapses: 0 }),
    )
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Will it stick?')).toBeTruthy()
    expect(screen.getByText('Secure')).toBeTruthy()
    expect(screen.getByText('Slipping')).toBeTruthy()
  })

  it('scores only what has actually been tested', () => {
    // One measured and holding, one never attempted. 100%, not 50% — a word
    // nobody has met has not been forgotten.
    covered(
      mastery('known', { intervalDays: 40, dueOn: addDays(todayString(), 40), lapses: 0 }),
      mastery('unseen', { totalAttempts: 0, reps: 0, lapses: 0, dueOn: null }),
    )
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('100% holding')).toBeTruthy()
  })

  it('says nothing at all when there is nothing to say', () => {
    covered(mastery('unseen', { totalAttempts: 0, reps: 0, lapses: 0, dueOn: null }))
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText('Will it stick?')).toBeNull()
  })

  it('is one of the things covering a learner buys', () => {
    signIn(aLearner({ displayName: 'Ada', covered: false }))
    testState.skills = { spelling: skill('spelling', { placed: true }) }
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: {
        'spelling:i0': mastery('known', {
          intervalDays: 40,
          dueOn: addDays(todayString(), 40),
          lapses: 0,
        }),
      },
    } as never
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText('Will it stick?')).toBeNull()
  })

  it('offers the printable sheet whether or not it is unlocked', () => {
    // A locked door you can see beats a feature nobody knows exists.
    covered(mastery('known', { intervalDays: 40, dueOn: addDays(todayString(), 40) }))
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText(/Weekly sheet to print/))
    expect(navigate).toHaveBeenCalledWith({ name: 'progress-print' })
  })
})
