// A deck's own screen, by how the deck got into the list: the action row is
// different for each of the three kinds, and each can be undone in its own
// way (docs/ux-coherence.md).

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

const lib = vi.hoisted(() => ({
  loadLibrary: vi.fn(async () => ({ decks: [] as unknown[], customLists: [] as unknown[] })),
  getLibraryDeck: vi.fn(async (): Promise<unknown> => null),
  acceptLibraryDeck: vi.fn(async () => 1234),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))
vi.mock('../../lib/assignments/library', () => lib)
vi.mock('../../lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAssignmentSets: vi.fn(async () => []),
  createAssignments: vi.fn(async () => []),
}))

import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { emptySnapshot, type QuizDeck } from '../../lib/progress/types'
import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import DeckScreen from './DeckScreen'

const navigate = spies.navigate
const STARTER = STARTER_DECKS[0]!

function deck(over: Partial<QuizDeck> = {}): QuizDeck {
  return {
    id: 'set-1',
    title: 'Set for me',
    description: 'From the library',
    tags: [],
    cards: [
      { id: 'c1', term: 'Paris', definition: 'France', hint: null, difficulty: 3 },
      { id: 'c2', term: 'Rome', definition: 'Italy', hint: null, difficulty: 3 },
    ],
    source: 'assigned',
    termLabel: 'City',
    definitionLabel: 'Country',
    acceptedAt: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
  lib.saveLibraryDecks.mockClear()
  testState.snapshot = { ...emptySnapshot(), decks: [deck()] }
})

describe('a starter deck in the list', () => {
  beforeEach(() => signIn(aLearner({ starterDecks: [STARTER.id] })))

  it('can be removed, and says the answers are kept', async () => {
    render(<DeckScreen deckId={STARTER.id} navigate={navigate} />)
    expect(screen.getByText('Starter')).toBeTruthy()
    expect(screen.getByText(/Your answers are kept if you add it back/)).toBeTruthy()
    fireEvent.click(screen.getByText('➖ Remove from my decks'))
    await waitFor(() => expect(spies.updateLearner).toHaveBeenCalledWith('l1', { starterDecks: [] }))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })

  it('offers neither editing nor deleting', () => {
    render(<DeckScreen deckId={STARTER.id} navigate={navigate} />)
    expect(screen.queryByText('✏️ Edit deck')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('goes back to Flashcards', () => {
    render(<DeckScreen deckId={STARTER.id} navigate={navigate} />)
    fireEvent.click(screen.getByText('← Flashcards'))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })
})

describe('a starter deck not yet added, opened by link', () => {
  it('offers to add it rather than calling it gone', async () => {
    render(<DeckScreen deckId={STARTER.id} navigate={navigate} />)
    expect(screen.getByText('Not added yet')).toBeTruthy()
    expect(screen.queryByText(/deleted on another device/)).toBeNull()
    fireEvent.click(screen.getByText('➕ Add this starter deck'))
    await waitFor(() =>
      expect(spies.updateLearner).toHaveBeenCalledWith('l1', { starterDecks: [STARTER.id] }),
    )
  })

  it('still calls an unknown id gone', () => {
    render(<DeckScreen deckId="no-such-deck" navigate={navigate} />)
    expect(screen.getByText('Deck not found')).toBeTruthy()
    expect(screen.getByText(/deleted on another device/)).toBeTruthy()
  })
})

describe('a deck set by a grown-up', () => {
  it('is practiced, not edited or deleted, by the learner', () => {
    // The child is the session: signed in as the learner on screen.
    signIn(aLearner({ authUserId: 'u1' }))
    render(<DeckScreen deckId="set-1" navigate={navigate} />)
    expect(screen.getByText('Set by a grown-up')).toBeTruthy()
    expect(screen.getByText('Flashcards')).toBeTruthy()
    expect(screen.queryByText('✏️ Edit deck')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText(/Duplicate/)).toBeNull()
    expect(screen.getByText(/withdraw the task to remove it/)).toBeTruthy()
  })

  it('lets a grown-up copy it into their own library, and nothing more', async () => {
    render(<DeckScreen deckId="set-1" navigate={navigate} />)
    expect(screen.queryByText('✏️ Edit deck')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
    fireEvent.click(screen.getByText('📋 Duplicate into my library'))
    await waitFor(() => expect(lib.saveLibraryDecks).toHaveBeenCalled())
    expect(spies.saveDeck).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'library-deck' }))
  })
})

describe('a deck of the learner’s own', () => {
  it('keeps Edit, Duplicate and Delete', () => {
    testState.snapshot = { ...emptySnapshot(), decks: [deck({ id: 'd1', source: 'user' })] }
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    expect(screen.getByText('Mine')).toBeTruthy()
    expect(screen.getByText('✏️ Edit deck')).toBeTruthy()
    expect(screen.getByText('📋 Duplicate')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })
})
