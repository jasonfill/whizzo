// The deck's own slice of the round log.
//
// A grown-up standing on a deck should see what has been done with it without
// going to the report: every round on this deck and nothing from any other,
// newest first, each openable to its answers, and honest about the window an
// uncovered learner is shown.

import { fireEvent, render as renderBare, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)

import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import type { SessionRecord } from '../../lib/progress/types'
import DeckHistory from './DeckHistory'

/** The upsell link navigates through the router, so the component needs one. */
const render = (ui: ReactElement) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const DECK = 'deck-cells'

function round(over: Partial<SessionRecord> = {}): SessionRecord {
  const at = Date.now()
  return {
    id: `s-${Math.random()}`,
    subject: 'quiz',
    activity: 'learn',
    listId: DECK,
    isTest: true,
    itemsTotal: 8,
    itemsCorrect: 6,
    accuracy: 75,
    score: 60,
    wpm: null,
    durationMs: 125_000,
    abilityBefore: 2,
    abilityAfter: 2.1,
    meta: {},
    startedAt: at - 125_000,
    endedAt: at,
    evidence: 'attempts',
    verifiedItemsTotal: 8,
    verifiedItemsCorrect: 6,
    ...over,
  }
}

function rows() {
  return screen.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') !== null)
}

beforeEach(() => {
  signIn()
  spies.attemptsForSession.mockResolvedValue([])
})

describe('what is listed', () => {
  it('says so when the deck has never been played', () => {
    testState.snapshot = emptySnapshot()
    render(<DeckHistory deckId={DECK} />)
    expect(screen.getByText('Rounds on this deck')).toBeTruthy()
    expect(screen.getByText('No rounds on this deck yet.')).toBeTruthy()
  })

  it('shows only this deck, newest first', () => {
    const now = Date.now()
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [
        round({ id: 'old', activity: 'learn', endedAt: now - 60_000, startedAt: now - 120_000 }),
        round({ id: 'other', activity: 'test', listId: 'another-deck' }),
        round({ id: 'spell', subject: 'spelling', activity: 'test', listId: DECK }),
        round({ id: 'new', activity: 'match', endedAt: now - 1_000, startedAt: now - 30_000 }),
      ],
    }
    render(<DeckHistory deckId={DECK} />)
    expect(rows().length).toBe(2)
    expect(rows()[0]!.textContent).toContain('Match')
    expect(rows()[1]!.textContent).toContain('Learn')
    expect(screen.queryByText('Test')).toBeNull()
  })

  it('shows the score, the time taken, and whether the round was graded', () => {
    testState.snapshot = { ...emptySnapshot(), sessions: [round()] }
    render(<DeckHistory deckId={DECK} learnerName="Ada" />)
    expect(screen.getByText(/Every round Ada has played here/)).toBeTruthy()
    expect(screen.getByText('6/8 · 75%')).toBeTruthy()
    expect(screen.getByText('⏱️ 2m 5s')).toBeTruthy()
    expect(screen.getByText('Graded')).toBeTruthy()
  })

  it('marks a self-graded flashcard flip as practice, with nothing checked', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [
        round({
          activity: 'flashcards',
          isTest: false,
          verifiedItemsTotal: 0,
          verifiedItemsCorrect: 0,
        }),
      ],
    }
    render(<DeckHistory deckId={DECK} />)
    expect(screen.getByText('Practice only')).toBeTruthy()
    expect(screen.getByText('0/8 checked')).toBeTruthy()
  })

  it('names a tutor round as one', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [round({ activity: 'tutor', isTest: false, itemsCorrect: 0, accuracy: 0, verifiedItemsTotal: 0, verifiedItemsCorrect: 0 })],
    }
    render(<DeckHistory deckId={DECK} />)
    expect(screen.getByText('Tutor round')).toBeTruthy()
    expect(screen.getByText('Practice only')).toBeTruthy()
  })

  it('never says session', () => {
    testState.snapshot = { ...emptySnapshot(), sessions: [round()] }
    render(<DeckHistory deckId={DECK} />)
    expect(document.body.textContent).not.toMatch(/session/i)
  })
})

describe('opening a round', () => {
  it('shows the answers behind it, and closes again', async () => {
    testState.snapshot = { ...emptySnapshot(), sessions: [round({ id: 'r1' })] }
    spies.attemptsForSession.mockResolvedValue([
      {
        itemKey: `${DECK}:c1`,
        subject: 'quiz',
        correct: true,
        given: 'Mitochondria',
        verified: true,
        hintsUsed: 0,
        responseMs: 1800,
        channel: 'mcp',
      },
    ])
    render(<DeckHistory deckId={DECK} />)
    const row = rows()[0]!
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Answered "Mitochondria"')).toBeTruthy()
    expect(spies.attemptsForSession).toHaveBeenCalledWith('r1')
    // An answer given to the tutor says so.
    expect(screen.getByText('via tutor')).toBeTruthy()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('how many are shown', () => {
  it('shows ten, then offers the rest', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: Array.from({ length: 14 }, (_, i) => round({ id: `r${i}` })),
    }
    render(<DeckHistory deckId={DECK} />)
    expect(rows().length).toBe(10)
    fireEvent.click(screen.getByText('Show 4 more'))
    expect(rows().length).toBe(14)
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('says how much history an uncovered learner is shown, rather than hiding the rest', () => {
    const old = Date.now() - 120 * 86_400_000
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [round(), round({ startedAt: old, endedAt: old }), round({ startedAt: old, endedAt: old })],
    }
    render(<DeckHistory deckId={DECK} />)
    expect(rows().length).toBe(1)
    expect(screen.getByText(/2 older rounds are outside the 30-day window/)).toBeTruthy()
    expect(screen.getByText('Covering this learner')).toBeTruthy()
  })

  it('shows a covered learner everything', () => {
    signIn(aLearner({ covered: true }))
    const old = Date.now() - 120 * 86_400_000
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: [round(), round({ startedAt: old, endedAt: old })],
    }
    render(<DeckHistory deckId={DECK} />)
    expect(rows().length).toBe(2)
    expect(screen.queryByText(/older/)).toBeNull()
  })
})
