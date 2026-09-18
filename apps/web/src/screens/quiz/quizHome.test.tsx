// The Flashcards screen shows the learner's list and a catalog of starters
// not yet added. Every total counts only the list (docs/ux-coherence.md).

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () => (await import('../../test/mockProviders')).authMock())
vi.mock('../../hooks/useBack', async () => (await import('../../test/mockProviders')).backMock())
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)

import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { emptySnapshot, type QuizDeck } from '../../lib/progress/types'
import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import QuizHome from './QuizHome'

const navigate = spies.navigate
const CAPITALS = STARTER_DECKS[0]!

function deck(over: Partial<QuizDeck> = {}): QuizDeck {
  return {
    id: 'd1',
    title: 'Organelles',
    description: '',
    tags: [],
    cards: [
      { id: 'c1', term: 'Nucleus', definition: 'Holds the DNA', hint: null, difficulty: 3 },
      { id: 'c2', term: 'Ribosome', definition: 'Makes proteins', hint: null, difficulty: 3 },
    ],
    source: 'user',
    termLabel: 'Term',
    definitionLabel: 'Definition',
    acceptedAt: 1,
    createdAt: 0,
    updatedAt: 1,
    ...over,
  }
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
})

describe('the Flashcards screen', () => {
  it('is called Flashcards, and counts only the learner’s list', () => {
    testState.snapshot = { ...emptySnapshot(), decks: [deck()] }
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Flashcards')
    // Two cards of their own; none of the starters' 141 until one is added.
    expect(screen.getByText('0 of 2 mastered')).toBeTruthy()
  })

  it('names how each deck got here', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [deck(), deck({ id: 'set-1', title: 'Set for me', source: 'assigned' })],
    }
    signIn(aLearner({ starterDecks: [CAPITALS.id] }))
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByText('Mine')).toBeTruthy()
    expect(screen.getByText('Set by a grown-up')).toBeTruthy()
    // One pill on the added starter in the list, one on each catalog card.
    expect(screen.getAllByText('Starter').length).toBe(STARTER_DECKS.length)
    expect(screen.getByText(CAPITALS.title)).toBeTruthy()
  })

  it('offers only the starters not yet added', () => {
    signIn(aLearner({ starterDecks: [CAPITALS.id] }))
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByText('Add a starter deck')).toBeTruthy()
    const adds = screen.getAllByRole('button', { name: /^Add / })
    expect(adds).toHaveLength(STARTER_DECKS.length - 1)
    expect(screen.queryByRole('button', { name: `Add ${CAPITALS.title}` })).toBeNull()
  })

  it('adds a starter by sending the whole list to the learner row', async () => {
    signIn(aLearner({ starterDecks: [STARTER_DECKS[1]!.id] }))
    render(<QuizHome navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: `Add ${CAPITALS.title}` }))
    await waitFor(() =>
      expect(spies.updateLearner).toHaveBeenCalledWith('l1', {
        starterDecks: [STARTER_DECKS[1]!.id, CAPITALS.id],
      }),
    )
  })

  it('says so when every starter is in the list', () => {
    signIn(aLearner({ starterDecks: STARTER_DECKS.map((d) => d.id) }))
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByText(/Every starter deck is in your list/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
  })

  it('does not hold a set deck or a starter against the free-tier deck limit', () => {
    // Three of their own is the limit; a set deck and a starter on top of it
    // change nothing, and the copy says which decks count.
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [
        deck({ id: 'a' }),
        deck({ id: 'b' }),
        deck({ id: 'set-1', source: 'assigned' }),
      ],
    }
    signIn(aLearner({ starterDecks: [CAPITALS.id] }))
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByRole('button', { name: /New deck/ })).not.toBeDisabled()
  })

  it('goes home from the header', () => {
    render(<QuizHome navigate={navigate} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(navigate).toHaveBeenCalledWith({ name: 'home' })
  })
})
