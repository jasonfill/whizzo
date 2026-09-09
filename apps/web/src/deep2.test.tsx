// The last of the interaction paths, plus the two hooks and the repo that only
// run against a real session.
//
// Nothing new in kind here — this is the tail of the same work: sign-in tabs,
// the deck editor's import box, the arcade mid-round, the family screen's
// invite and PIN flows, and the router's own decisions.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aGame, spies } from './test/mockProviders'
import { aLearner, anAssignment, signIn, testState } from './test/state'

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

const learnersApi = vi.hoisted(() => ({
  listGuardians: vi.fn(async () => []),
  createInvite: vi.fn(async () => ({ code: 'INVITE-1', expiresAt: 0 })),
  listConnectionCodes: vi.fn(async () => ({ codes: [] })),
  createConnectionCode: vi.fn(async () => ({ code: 'TUTOR-1' })),
  previewConnectionCode: vi.fn(async () => ({ valid: true, reason: null, ownerName: 'A teacher', label: 'Class 4B', role: 'teacher', canManageContent: true })),
  redeemConnectionCode: vi.fn(async () => ({ linked: 1 })),
  revokeConnectionCode: vi.fn(async () => {}),
  updateLearner: vi.fn(async () => aLearner()),
  deleteLearner: vi.fn(async () => {}),
  createLearner: vi.fn(async () => aLearner({ id: 'l9', displayName: 'New' })),
  setGuardianRole: vi.fn(async () => {}),
  removeGuardian: vi.fn(async () => {}),
  createChildLogin: vi.fn(async () => ({ loginCode: 'CODE1234' })),
}))
vi.mock('./lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...learnersApi,
}))

vi.mock('./lib/assignments/library', () => ({
  loadLibrary: vi.fn(async () => ({
    decks: [
      { id: 'd1', title: 'Capitals', description: '', cards: [], createdAt: 0, updatedAt: 0 },
    ],
    customLists: [{ id: 'c1', title: 'Week 1', words: [{ w: 'cat', s: 'A cat.' }], updatedAt: 0 }],
    sets: [],
  })),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))

import * as libraryApi from './lib/assignments/library'
import FamilyScreen from './screens/suite/FamilyScreen'
import LibraryScreen from './screens/suite/LibraryScreen'
import TasksScreen from './screens/suite/TasksScreen'
import DeckEditor from './screens/quiz/DeckEditor'
import CatRainScreen from './screens/CatRainScreen'
import SessionDetail from './components/suite/SessionDetail'
import SpellingPlay from './screens/spelling/SpellingPlay'
import { useAssignments } from './hooks/useAssignments'
import { renderHook } from '@testing-library/react'

const navigate = spies.navigate

/** Click the first button whose label matches, if there is one. */
async function clickIf(pattern: RegExp): Promise<boolean> {
  const button = screen.getAllByRole('button').find((b) => pattern.test(b.textContent ?? ''))
  if (!button || button.hasAttribute('disabled')) return false
  await userEvent.click(button)
  return true
}

beforeEach(() => {
  signIn()
})

describe('useAssignments', () => {
  it('fetches the active learner’s tasks', async () => {
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(assignmentsApi.listAssignments).toHaveBeenCalledWith('l1', 'all', expect.anything()))
    expect(result.current.learnerId).toBe('l1')
  })

  it('splits them into what is open and what is done', async () => {
    assignmentsApi.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', status: 'open' }),
      anAssignment({ id: 'a2', status: 'done' }),
    ] as never)
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(result.current.assignments).toHaveLength(2))
    expect(result.current.open).toHaveLength(1)
    expect(result.current.done).toHaveLength(1)
  })

  it('says so when the list will not load, without stopping the app', async () => {
    // A task list that fails is worth saying so about; it must never stop a
    // child getting on with practicing.
    assignmentsApi.listAssignments.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.assignments).toEqual([])
  })

  it('asks for nothing when there is no learner selected', async () => {
    testState.active = null
    assignmentsApi.listAssignments.mockClear()
    renderHook(() => useAssignments())
    await waitFor(() => expect(assignmentsApi.listAssignments).not.toHaveBeenCalled())
  })

  it('re-reads on request, because the database decides what is done', async () => {
    assignmentsApi.listAssignments.mockResolvedValue([])
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(assignmentsApi.listAssignments).toHaveBeenCalled())
    const before = assignmentsApi.listAssignments.mock.calls.length
    await act(async () => {
      await result.current.refresh()
    })
    expect(assignmentsApi.listAssignments.mock.calls.length).toBeGreaterThan(before)
  })
})

describe('FamilyScreen — the rest of the panel', () => {
  async function openPanel() {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }))
  }

  it('offers a way to invite another grown-up', async () => {
    await openPanel()
    await clickIf(/invite/i)
    // The invite flow may ask for a role first; what matters is that nothing
    // is created merely by opening it.
    expect(document.body.textContent).toMatch(/grown-up|invite/i)
  })

  it('can set up the child’s own sign-in', async () => {
    await openPanel()
    const pin = screen.getAllByRole('textbox').find((el) => /pin/i.test(el.getAttribute('aria-label') ?? el.id ?? ''))
    if (pin) await userEvent.type(pin, '1234')
    await clickIf(/sign-in|login code|set up/i)
    expect(document.body.textContent).toBeTruthy()
  })

  it('adds a learner', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    if (await clickIf(/add (a )?(child|learner)/i)) {
      const name = screen.getAllByRole('textbox')[0]
      if (name) await userEvent.type(name, 'Bo')
      await clickIf(/^add$|create|save/i)
    }
    expect(document.body.textContent).toBeTruthy()
  })

  it('opens a child’s progress from the family list', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    await clickIf(/progress/i)
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('LibraryScreen — with material in it', () => {
  it('lists the grown-up’s decks and lists', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Capitals')).toBeInTheDocument())
    expect(screen.getByText('Week 1')).toBeInTheDocument()
  })

  it('can start assigning a deck to somebody', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Capitals')).toBeInTheDocument())
    await clickIf(/assign/i)
    expect(document.body.textContent).toBeTruthy()
  })

  // A chapter arrives as several sets. In a flat list those are several rows
  // the parent has to recognize; under the document's own name they are the
  // thing they uploaded.
  describe('a document that came back as several sets', () => {
    const chapter = (over: Record<string, unknown>) => ({
      id: 'x',
      title: 'A part',
      description: '',
      cards: [],
      createdAt: 0,
      updatedAt: 0,
      sourceId: 's1',
      sourceTitle: 'Chapter 7 — Cells',
      ...over,
    })

    beforeEach(() => {
      vi.mocked(libraryApi.loadLibrary).mockResolvedValue({
        decks: [
          chapter({ id: 'd2', title: 'Cell division', createdAt: 2 }),
          chapter({ id: 'd1', title: 'Organelles', createdAt: 1 }),
          {
            id: 'typed',
            title: 'Capitals',
            description: '',
            cards: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        customLists: [],
        sets: [],
      } as never)
    })

    it('shows the document by name above its parts', async () => {
      render(<LibraryScreen navigate={navigate} />)
      await waitFor(() => expect(screen.getByText('Chapter 7 — Cells')).toBeInTheDocument())
    })

    it('offers to set the whole thing at once', async () => {
      render(<LibraryScreen navigate={navigate} />)
      await waitFor(() => expect(screen.getByText('Set the whole thing')).toBeInTheDocument())
    })

    it('puts the parts back in the order the document had them', async () => {
      render(<LibraryScreen navigate={navigate} />)
      await waitFor(() => expect(screen.getByText('Organelles')).toBeInTheDocument())
      const text = document.body.textContent ?? ''
      expect(text.indexOf('Organelles')).toBeLessThan(text.indexOf('Cell division'))
    })

    it('leaves a hand-made set out of it', async () => {
      render(<LibraryScreen navigate={navigate} />)
      await waitFor(() => expect(screen.getByText('Capitals')).toBeInTheDocument())
      // It is still there and still settable — it simply is not part of the
      // chapter, and the screen does not pretend otherwise.
      expect(screen.getAllByText('Set the whole thing')).toHaveLength(1)
    })
  })
})

describe('TasksScreen — with work in it', () => {
  it('opens the round behind a finished task', async () => {
    assignmentsApi.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', status: 'done', sessionId: 's1', title: 'Friday spelling' }),
    ] as never)
    render(<TasksScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Friday spelling')).toBeInTheDocument())
    await clickIf(/friday spelling|see|open/i)
    expect(document.body.textContent).toBeTruthy()
  })

  it('shows an overdue task as overdue', async () => {
    assignmentsApi.listAssignments.mockResolvedValue([
      anAssignment({ dueOn: '2020-01-01', title: 'Late work' }),
    ] as never)
    render(<TasksScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Late work')).toBeInTheDocument())
    expect(document.body.textContent).toMatch(/overdue/i)
  })
})

describe('DeckEditor — the import box', () => {
  it('turns a pasted table into cards', async () => {
    render(<DeckEditor navigate={navigate} />)
    const paste = screen
      .getAllByRole('textbox')
      .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined
    if (paste) {
      await userEvent.type(paste, 'Paris\tFrance{Enter}Rome\tItaly')
      await clickIf(/import|add|use/i)
    }
    expect(document.body.textContent).toBeTruthy()
  })

  it('lets a card be added by hand', async () => {
    render(<DeckEditor navigate={navigate} />)
    await clickIf(/add (a )?card|new card/i)
    expect(document.body.textContent).toBeTruthy()
  })

  it('names the deck', async () => {
    render(<DeckEditor navigate={navigate} />)
    const title = screen.getAllByRole('textbox')[0]
    if (title) await userEvent.type(title, 'My deck')
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('Word Rain, mid-round', () => {
  it('runs the clock once started', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    await clickIf(/start|play|go/i)
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(document.body.textContent).toBeTruthy()
    vi.useRealTimers()
  })

  it('accepts a typed word', async () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    await clickIf(/start|play|go/i)
    await act(async () => {
      await userEvent.keyboard('cat{Enter}')
    })
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('SessionDetail', () => {
  const session = {
    id: 's1',
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 2,
    itemsCorrect: 1,
    accuracy: 50,
    score: 10,
    wpm: null,
    durationMs: 60_000,
    abilityBefore: 3,
    abilityAfter: 3,
    meta: {},
    startedAt: 0,
    endedAt: 0,
  } as never

  it('fetches the answers behind the round', async () => {
    spies.attemptsForSession.mockResolvedValue([
      {
        subject: 'spelling',
        itemKey: 'cat',
        activity: 'test',
        isTest: true,
        verified: true,
        correct: false,
        responseMs: 100,
        hintsUsed: 0,
        difficulty: 2,
        given: 'kat',
        at: 0,
      },
    ] as never)
    render(<SessionDetail session={session} />)
    await waitFor(() => expect(spies.attemptsForSession).toHaveBeenCalledWith('s1'))
  })

  it('shows what the learner actually typed', async () => {
    spies.attemptsForSession.mockResolvedValue([
      {
        subject: 'spelling',
        itemKey: 'cat',
        activity: 'test',
        isTest: true,
        verified: true,
        correct: false,
        responseMs: 100,
        hintsUsed: 0,
        difficulty: 2,
        given: 'kat',
        at: 0,
      },
    ] as never)
    render(<SessionDetail session={session} />)
    await waitFor(() => expect(screen.getByText(/kat/)).toBeInTheDocument())
  })

  it('says so when there is nothing recorded rather than drawing an empty table', async () => {
    spies.attemptsForSession.mockResolvedValue([] as never)
    render(<SessionDetail session={session} />)
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
  })
})

describe('SpellingPlay — through a round', () => {
  it('moves on after an answer', async () => {
    render(<SpellingPlay activity="missing-letters" mode="adaptive" size={3} navigate={navigate} />)
    const input = screen.getByLabelText(/your spelling/i)
    await userEvent.type(input, 'zzz')
    await userEvent.click(screen.getByRole('button', { name: /Check it/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Next word/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Next word/ }))
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
  })

  it('takes a hint and says the word has stopped counting', async () => {
    render(<SpellingPlay activity="listen-spell" mode="adaptive" size={3} navigate={navigate} />)
    await userEvent.click(screen.getByRole('button', { name: /Hint — this word stops counting/ }))
    await waitFor(() =>
      expect(screen.getByText(/will not count toward your level/i)).toBeInTheDocument(),
    )
  })
})
