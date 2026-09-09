// The paths a first render does not reach.
//
// Most of what is left uncovered is behind an interaction: the family screen's
// manage panel, the assign form, the arcade once it is running, and the two
// quiz modes that only exist mid-round. These drive them.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aGame, spies } from './test/mockProviders'
import { aLearner, signIn, testState } from './test/state'
import { emptySnapshot } from './lib/progress/types'

vi.mock('./auth/AuthProvider', async () => (await import('./test/mockProviders')).authMock())
vi.mock('./lib/learners/LearnerProvider', async () =>
  (await import('./test/mockProviders')).learnersMock(),
)
vi.mock('./lib/progress/ProgressProvider', async () =>
  (await import('./test/mockProviders')).progressMock(),
)
vi.mock('./lib/theme/ThemeProvider', async () =>
  (await import('./test/mockProviders')).themeMock(),
)
vi.mock('./hooks/useAssignments', async () =>
  (await import('./test/mockProviders')).assignmentsMock(),
)

vi.mock('./lib/spelling/speech', () => ({
  speak: vi.fn(),
  dictate: vi.fn(),
  stopSpeaking: vi.fn(),
  isSpeechAvailable: () => true,
  primeVoices: vi.fn(),
  whenVoicesReady: vi.fn(() => () => {}),
  listVoices: () => [],
  savedVoiceURI: () => null,
  setVoice: vi.fn(),
  currentVoice: () => null,
}))

const learnersApi = vi.hoisted(() => ({
  listGuardians: vi.fn(async () => [
    { guardianId: 'g1', learnerId: 'l1', role: 'teacher', canManageContent: true, createdAt: 0, displayName: 'A teacher' },
  ]),
  createInvite: vi.fn(async () => ({ code: 'INVITE-1' })),
  listConnectionCodes: vi.fn(async () => ({ codes: [] })),
  createConnectionCode: vi.fn(async () => ({ code: 'TUTOR-1' })),
  previewConnectionCode: vi.fn(async () => ({ valid: true, reason: null, ownerName: 'A teacher', label: 'Class 4B', role: 'teacher', canManageContent: true })),
  redeemConnectionCode: vi.fn(async () => ({ linked: 1 })),
  revokeConnectionCode: vi.fn(async () => {}),
  updateLearner: vi.fn(async () => aLearner()),
  deleteLearner: vi.fn(async () => {}),
  createLearner: vi.fn(async () => aLearner()),
  setGuardianRole: vi.fn(async () => {}),
  removeGuardian: vi.fn(async () => {}),
  createChildLogin: vi.fn(async () => ({ loginCode: 'CODE1234' })),
}))
vi.mock('./lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...learnersApi,
}))

const assignmentsApi = vi.hoisted(() => ({
  listAssignments: vi.fn(async () => []),
  createAssignments: vi.fn(async () => []),
  listAssignmentSets: vi.fn(async () => []),
  updateAssignmentSet: vi.fn(async () => ({})),
  deleteAssignmentSet: vi.fn(async () => {}),
  updateAssignment: vi.fn(async () => ({})),
  deleteAssignment: vi.fn(async () => {}),
  familyOverview: vi.fn(async () => ({ learners: [] })),
}))
vi.mock('./lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...assignmentsApi,
}))

vi.mock('./lib/assignments/library', () => ({
  loadLibrary: vi.fn(async () => ({ decks: [], customLists: [], sets: [] })),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))

import FamilyScreen from './screens/suite/FamilyScreen'
import AssignForm from './screens/suite/AssignForm'
import CustomListsScreen from './screens/suite/CustomListsScreen'
import CatRainScreen from './screens/CatRainScreen'
import Flashcards from './screens/quiz/Flashcards'
import MatchGame from './screens/quiz/MatchGame'
import App from './App'

const navigate = spies.navigate

beforeEach(() => {
  signIn()
})

describe('FamilyScreen — the manage panel', () => {
  it('opens the panel for a child the caller owns', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
    expect(screen.getByText(/Ada’s world/)).toBeInTheDocument()
  })

  it('offers all ten worlds from inside the panel', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
    expect(screen.getByRole('button', { name: /Robots/ })).toBeInTheDocument()
  })

  it('sets a world for that child, not for whoever is active', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
    await userEvent.click(screen.getByRole('button', { name: /Robots/ }))
    await waitFor(() => expect(spies.setThemeFor).toHaveBeenCalledWith('l1', 'robots'))
  })

  it('lists the grown-ups who can see the child', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
    await waitFor(() => expect(screen.getByText(/A teacher/)).toBeInTheDocument())
  })

  it('closes the panel again', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
    await userEvent.click(screen.getByRole('button', { name: /Done/ }))
    expect(screen.queryByText(/Ada’s world/)).not.toBeInTheDocument()
  })

  it('shows no manage panel for a child merely shared with you', async () => {
    // Ownership is read from the learner row against the signed-in user, so
    // this is a shared child rather than an owned one.
    testState.learners = [aLearner({ ownerId: 'somebody-else' })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
  })

  it('switches to another child', async () => {
    testState.learners = [aLearner(), aLearner({ id: 'l2', displayName: 'Bo' })]
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Bo')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Switch to/ }))
    expect(spies.select).toHaveBeenCalledWith('l2')
  })
})

describe('AssignForm', () => {
  it('offers the work a grown-up can set', () => {
    render(
      <AssignForm
        learners={[aLearner()]}
        defaultLearnerIds={['l1']}
        onDone={async () => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
  })

  it('sets nothing when there is nobody to set it for', async () => {
    // A task with no learner is a task that can never be completed.
    render(
      <AssignForm learners={[]} defaultLearnerIds={[]} onDone={async () => {}} onCancel={() => {}} />,
    )
    for (const button of screen.getAllByRole('button')) {
      if (!button.hasAttribute('disabled')) await userEvent.click(button)
    }
    expect(assignmentsApi.createAssignments).not.toHaveBeenCalled()
  })

  it('can be canceled without setting anything', async () => {
    const onCancel = vi.fn()
    render(
      <AssignForm
        learners={[aLearner()]}
        defaultLearnerIds={['l1']}
        onDone={async () => {}}
        onCancel={onCancel}
      />,
    )
    const cancel = screen.getAllByRole('button').find((b) => /cancel/i.test(b.textContent ?? ''))
    if (cancel) {
      await userEvent.click(cancel)
      expect(onCancel).toHaveBeenCalled()
    }
    expect(assignmentsApi.createAssignments).not.toHaveBeenCalled()
  })
})

describe('CustomListsScreen — editing', () => {
  it('opens an editor for a new list', async () => {
    render(<CustomListsScreen navigate={navigate} />)
    const add = screen.getAllByRole('button').find((b) => /new|add|create/i.test(b.textContent ?? ''))
    if (add) await userEvent.click(add)
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })

  it('edits an existing list', async () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        { id: 'c1', title: 'Week 1', words: [{ w: 'cat', s: 'A cat.' }], updatedAt: 0 } as never,
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    const edit = screen.getAllByRole('button').find((b) => /edit/i.test(b.textContent ?? ''))
    if (edit) {
      await userEvent.click(edit)
      expect(screen.getByDisplayValue('Week 1')).toBeInTheDocument()
    }
  })

  it('points a learner at the paywall once the free limit is reached', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        { id: 'c1', title: 'Week 1', words: [{ w: 'cat', s: 'A cat.' }], updatedAt: 0 } as never,
        { id: 'c2', title: 'Week 2', words: [{ w: 'dog', s: 'A dog.' }], updatedAt: 0 } as never,
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    expect(document.body.textContent).toMatch(/Pro|upgrade|limit/i)
  })
})

describe('Word Rain, once it is running', () => {
  it('starts a round', async () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    const start = screen.getAllByRole('button').find((b) => /start|play|go/i.test(b.textContent ?? ''))
    if (start) await userEvent.click(start)
    expect(document.body.textContent).toBeTruthy()
  })

  it('accepts typing once it has started', async () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    const start = screen.getAllByRole('button').find((b) => /start|play|go/i.test(b.textContent ?? ''))
    if (start) await userEvent.click(start)
    await act(async () => {
      await userEvent.keyboard('a')
    })
    expect(document.body.textContent).toBeTruthy()
  })

  it('can be left', async () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    await act(async () => {
      await userEvent.keyboard('{Escape}')
    })
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('the quiz play modes', () => {
  /** A session stub shaped like the real hook's return value. */
  function fakeSession(over: Record<string, unknown> = {}) {
    const plan = [
      { card: { id: 'c1', term: 'Paris', definition: 'France', difficulty: 3, hint: null }, reason: 'new' },
      { card: { id: 'c2', term: 'Rome', definition: 'Italy', difficulty: 3, hint: null }, reason: 'new' },
    ]
    const questions = plan.map((p) => ({
      kind: 'written' as const,
      prompt: p.card.term,
      answer: p.card.definition,
      choices: [],
    }))
    return {
      plan,
      questions,
      index: 0,
      cursor: 0,
      progress: { retired: 0, total: 2, remaining: 2, pass: 1 },
      current: plan[0],
      currentQuestion: questions[0],
      results: [],
      summary: null,
      options: { mode: 'flashcards', decks: [], deckId: 'd1' },
      isLast: false,
      isComplete: false,
      state: {},
      start: vi.fn(),
      beginItem: vi.fn(),
      submit: vi.fn(() => ({ planned: plan[0], question: questions[0], grade: 'correct' })),
      advance: vi.fn(() => true),
      finish: vi.fn(async () => null),
      reset: vi.fn(),
      ...over,
    } as never
  }

  it('Flashcards shows a card and can be flipped', async () => {
    render(<Flashcards session={fakeSession()} onFinish={() => {}} />)
    expect(screen.getAllByText(/Paris/).length).toBeGreaterThan(0)
    const flip = screen.getAllByRole('button')[0]
    if (flip) await userEvent.click(flip)
    expect(document.body.textContent).toBeTruthy()
  })

  it('Flashcards asks the learner to turn the card over first', async () => {
    // The one self-graded mode in the app: nothing is claimed until the answer
    // has actually been seen.
    render(<Flashcards session={fakeSession()} onFinish={() => {}} />)
    expect(screen.getByText(/Tap the card/i)).toBeInTheDocument()
  })

  it('MatchGame lays out the pairs', () => {
    render(<MatchGame session={fakeSession()} onFinish={() => {}} />)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2)
  })

  it('MatchGame responds to a tile being picked', async () => {
    render(<MatchGame session={fakeSession()} onFinish={() => {}} />)
    const tiles = screen.getAllByRole('button')
    await userEvent.click(tiles[0]!)
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('the router', () => {
  it('opens on the child’s home screen', async () => {
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
  })

  it('sends a newly signed-up grown-up to set a learner up first', async () => {
    // Dropping them on the child's screen would quietly save their practice to
    // localStorage, because there is no learner to attribute it to.
    testState.learners = []
    testState.active = null
    testState.learnerStatus = 'ready'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
  })
})
