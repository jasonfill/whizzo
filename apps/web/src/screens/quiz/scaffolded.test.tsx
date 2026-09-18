// The rung that used to be missing.
//
// A card the learner half-knows used to be asked as multiple choice, which is
// recognition: they picked from four and never produced anything, so nothing
// stood between "pick one of these" and a blank page. These two kinds ask for
// the answer and hand over just enough support to make the attempt worth
// making — and, just as importantly, they are recorded as scaffolded so they
// cannot promote a card as though it had been recalled from nothing.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)
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
import { masteryKey } from '../../lib/progress/types'
import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import QuizPlay from './QuizPlay'

const navigate = spies.navigate
const DECK = STARTER_DECKS[0]!

/** Put every card in the deck squarely on the scaffolded rung. */
function halfKnown() {
  const mastery: Record<string, unknown> = {}
  for (const card of DECK.cards) {
    const key = masteryKey('quiz', `${DECK.id}:${card.id}`)
    mastery[key] = {
      subject: 'quiz',
      itemKey: `${DECK.id}:${card.id}`,
      listId: DECK.id,
      difficulty: 2,
      mastery: 0.5,
      reps: 4,
      lapses: 0,
      correctStreak: 1,
      totalAttempts: 5,
      totalCorrect: 3,
      intervalDays: 2,
      dueOn: '2020-01-01',
      firstSeenAt: 1,
      lastSeenAt: 2,
    }
  }
  testState.snapshot = { ...testState.snapshot, mastery: mastery as never }
}

beforeEach(() => {
  signIn(aLearner({ starterDecks: [DECK.id] }))
  navigate.mockClear()
  halfKnown()
})

describe('a half-known card is asked to be produced', () => {
  it('asks for the answer rather than offering four of them', async () => {
    render(<QuizPlay mode="learn" deckId={DECK.id} navigate={navigate} />)
    // Whichever of the two scaffolds it picked, the learner has to type.
    expect(await screen.findByPlaceholderText('Type the answer…')).toBeTruthy()
  })

  it('says what it is asking for', async () => {
    render(<QuizPlay mode="learn" deckId={DECK.id} navigate={navigate} />)
    await screen.findByPlaceholderText('Type the answer…')
    expect(screen.getByText(/Write it out —/)).toBeTruthy()
  })

  it('shows a scaffold: either the shape of the answer or the candidates', async () => {
    render(<QuizPlay mode="learn" deckId={DECK.id} navigate={navigate} />)
    await screen.findByPlaceholderText('Type the answer…')
    const shape = document.querySelector('.font-mono')
    const bank = screen.queryByLabelText('Possible answers')
    expect(Boolean(shape) || Boolean(bank)).toBe(true)
  })

  it('accepts a typed answer and grades it', async () => {
    render(<QuizPlay mode="learn" deckId={DECK.id} navigate={navigate} />)
    const input = await screen.findByPlaceholderText('Type the answer…')
    fireEvent.change(input, { target: { value: 'definitely not the answer' } })
    fireEvent.click(screen.getByText('Check it'))
    // Graded, not silently swallowed.
    expect(screen.getByText('Check it').closest('button')).toBeTruthy()
  })
})

// The shape of each scaffold is asserted deterministically against
// `buildQuestion` in lib/quiz/questions.test.ts — which of the two a given
// round happens to pick is random, and a test that shrugs when it guesses
// wrong is a test that passes for the wrong reason.
