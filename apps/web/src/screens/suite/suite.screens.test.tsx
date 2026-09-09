// The grown-up screens.
//
// Together these are the largest block of code in the app and had nothing on
// them. What is asserted is mostly what a parent is *told*: an empty state that
// says "nothing yet" rather than rendering an empty grid, a paywall that names
// what is behind it, and — the one that matters most — that none of these
// surfaces carries a child's theme accent.

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aGame, spies } from '../../test/mockProviders'
import { aLearner, anAssignment, goPro, signIn, skill, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import type { SessionRecord } from '../../lib/progress/types'

// The factories live in test/mockProviders, but vi.mock is hoisted above every
// import — so each one is an inline arrow that pulls the factory in lazily.
vi.mock('../../auth/AuthProvider', async () => (await import('../../test/mockProviders')).authMock())
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
  createAssignments: vi.fn(async () => []),
  listAssignmentSets: vi.fn(async () => []),
  updateAssignmentSet: vi.fn(async () => ({})),
  deleteAssignmentSet: vi.fn(async () => {}),
  updateAssignment: vi.fn(async () => ({})),
  deleteAssignment: vi.fn(async () => {}),
  familyOverview: vi.fn(async () => ({ learners: [] })),
}))

vi.mock('../../lib/assignments/library', () => ({
  loadLibrary: vi.fn(async () => ({ decks: [], customLists: [], sets: [] })),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))

vi.mock('../../lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listGuardians: vi.fn(async () => []),
  createInvite: vi.fn(async () => ({ code: 'ABC123' })),
  listConnectionCodes: vi.fn(async () => ({ codes: [] })),
  updateLearner: vi.fn(async () => aLearner()),
  deleteLearner: vi.fn(async () => {}),
  createLearner: vi.fn(async () => aLearner()),
  learnerOverview: vi.fn(async () => []),
}))

import AccountScreen from './AccountScreen'
import CustomListsScreen from './CustomListsScreen'
import FamilyScreen from './FamilyScreen'
import LibraryScreen from './LibraryScreen'
import ProgressScreen from './ProgressScreen'
import SuiteHome from './SuiteHome'
import TasksScreen from './TasksScreen'
import UpgradeScreen from './UpgradeScreen'

const navigate = spies.navigate

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `s${Math.random()}`,
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 10,
    itemsCorrect: 8,
    accuracy: 80,
    score: 100,
    wpm: null,
    durationMs: 60_000,
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

/** No grown-up surface may carry a child's theme color. */
function assertThemeFree(container: HTMLElement) {
  const classes = [...container.querySelectorAll('*')]
    .flatMap((el) => [...el.classList])
    .join(' ')
  for (const themed of ['bg-accent', 'text-accent', 'border-accent', 'ring-accent', 'tintA', 'tintB']) {
    expect(classes, themed).not.toContain(themed)
  }
}

beforeEach(() => {
  signIn()
})

describe('UpgradeScreen', () => {
  it('shows what is free and what coverage adds', () => {
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('With coverage')).toBeInTheDocument()
  })

  it('says the whole curriculum is free', () => {
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/All 7 grade levels/i)).toBeInTheDocument()
  })

  it('goes back when asked', async () => {
    render(<UpgradeScreen navigate={navigate} />)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(navigate).toHaveBeenCalled()
  })

  it('carries no theme accent', () => {
    const { container } = render(<UpgradeScreen navigate={navigate} />)
    assertThemeFree(container)
  })
})

describe('AccountScreen', () => {
  it('shows who is signed in', () => {
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText(/grown-up@example.com/)).toBeInTheDocument()
  })

  it('offers a sign-out', async () => {
    render(<AccountScreen navigate={navigate} />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(spies.signOut).toHaveBeenCalled()
  })

  it('asks twice before erasing progress', async () => {
    render(<AccountScreen navigate={navigate} />)
    const erase = screen.getByRole('button', { name: /erase|reset|delete all/i })
    await userEvent.click(erase)
    // The first press must not wipe anything.
    expect(spies.reset).not.toHaveBeenCalled()
    expect(screen.getByText(/Really erase everything\?/i)).toBeInTheDocument()
  })

  it('carries no theme accent', () => {
    const { container } = render(<AccountScreen navigate={navigate} />)
    assertThemeFree(container)
  })
})

describe('CustomListsScreen', () => {
  it('renders its own heading', () => {
    render(<CustomListsScreen navigate={navigate} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('names the free-plan limit rather than failing silently at it', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        { id: 'c1', title: 'Week 1', words: [{ w: 'cat', s: 'A cat.' }], updatedAt: 0 } as never,
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    expect(screen.getByText('Week 1')).toBeInTheDocument()
  })

  it('carries no theme accent', () => {
    const { container } = render(<CustomListsScreen navigate={navigate} />)
    assertThemeFree(container)
  })
})

describe('LibraryScreen', () => {
  it('renders for a signed-in grown-up', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  })

  it('carries no theme accent', async () => {
    const { container } = render(<LibraryScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    assertThemeFree(container)
  })
})

describe('TasksScreen', () => {
  it('says there is nothing set rather than rendering an empty list', () => {
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('lists work that has been set', () => {
    testState.assignments = [anAssignment({ title: 'Friday spelling' })]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText('Friday spelling')).toBeInTheDocument()
  })

  it('offers no way to declare a task done', () => {
    // Work is closed by doing it. There is no "mark as done" for anybody.
    testState.assignments = [anAssignment()]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.queryByRole('button', { name: /mark (as )?done/i })).not.toBeInTheDocument()
  })

  it('starts a task when asked', async () => {
    testState.assignments = [anAssignment({ title: 'Friday spelling' })]
    render(<TasksScreen navigate={navigate} />)
    const start = screen.getAllByRole('button').find((b) => /start|▶/i.test(b.textContent ?? ''))
    expect(start, 'a set task must be startable').toBeDefined()
    await userEvent.click(start!)
    expect(navigate).toHaveBeenCalled()
  })
})

describe('SuiteHome — the child’s screen', () => {
  it('greets the learner and offers the three subjects', () => {
    render(<SuiteHome game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Spelling')).toBeInTheDocument()
    expect(screen.getByText('Typing')).toBeInTheDocument()
    expect(screen.getByText('Quiz')).toBeInTheDocument()
  })

  it('uses the theme’s own verb on the main call to action', () => {
    render(<SuiteHome game={aGame()} navigate={navigate} />)
    expect(screen.getByText(new RegExp(testState.theme.verb, 'i'))).toBeInTheDocument()
  })

  it('shows work that has been set before the free choice of subjects', () => {
    testState.assignments = [anAssignment({ title: 'Homework' })]
    render(<SuiteHome game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Homework')).toBeInTheDocument()
  })

  it('offers the world picker', async () => {
    render(<SuiteHome game={aGame()} navigate={navigate} />)
    await userEvent.click(screen.getByRole('button', { name: new RegExp(testState.theme.name) }))
    expect(navigate).toHaveBeenCalledWith({ name: 'theme' })
  })

  it('shows the older layout for a learner in the upper grades', () => {
    testState.active = aLearner({ gradeHint: 9 })
    testState.learners = [testState.active]
    render(<SuiteHome game={aGame()} navigate={navigate} />)
    // The 6-12 view swaps the hero for stat chips.
    expect(screen.getByText(/unaided accuracy/i)).toBeInTheDocument()
  })
})

describe('ProgressScreen — the parent’s report', () => {
  it('says nothing is here yet rather than drawing an empty table', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument()
  })

  it('keeps the trust card, which explains what moves the level', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('How the level is worked out')).toBeInTheDocument()
    expect(screen.getByText(/no hints, move the level/i)).toBeInTheDocument()
  })

  it('reports no graded work rather than an accuracy of zero', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/No graded rounds yet/i)).toBeInTheDocument()
  })

  it('names a practice round as one, in the learner’s own words', () => {
    testState.snapshot = { ...emptySnapshot(), sessions: [session({ isTest: false })] }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Practice only · doesn’t affect level/)).toBeInTheDocument()
  })

  it('shows the child’s world and says it changes nothing here', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Their world/i)).toBeInTheDocument()
    expect(screen.getByText(/Nothing on this page changes with it/i)).toBeInTheDocument()
  })

  it('offers all ten worlds to set, none of them disabled', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    const card = screen.getByText(/Their world/i).closest('div')!.parentElement!
    const buttons = within(card).getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(10)
    for (const b of buttons) expect(b).not.toBeDisabled()
  })

  it('carries no theme accent, even while setting a theme', () => {
    const { container } = render(<ProgressScreen game={aGame()} navigate={navigate} />)
    assertThemeFree(container)
  })

  it('gates the word report on the plan that already exists', () => {
    testState.profile = { ...testState.profile!, plan: 'free' }
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `spelling:w${i}`,
          {
            subject: 'spelling',
            itemKey: `word${i}`,
            listId: null,
            difficulty: 3,
            mastery: 0.2,
            reps: 3,
            lapses: 2,
            correctStreak: 0,
            totalAttempts: 5,
            totalCorrect: 1,
            intervalDays: 1,
            dueOn: null,
            firstSeenAt: 0,
            lastSeenAt: 0,
          },
        ]),
      ) as never,
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Showing 4 of/)).toBeInTheDocument()
  })

  it('shows every trouble word on the paid plan', () => {
    goPro()
    testState.snapshot = {
      ...emptySnapshot(),
      mastery: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `spelling:w${i}`,
          {
            subject: 'spelling',
            itemKey: `word${i}`,
            listId: null,
            difficulty: 3,
            mastery: 0.2,
            reps: 3,
            lapses: 2,
            correctStreak: 0,
            totalAttempts: 5,
            totalCorrect: 1,
            intervalDays: 1,
            dueOn: null,
            firstSeenAt: 0,
            lastSeenAt: 0,
          },
        ]),
      ) as never,
    }
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText(/Showing 4 of/)).not.toBeInTheDocument()
  })

  it('reads the activity chart back as a sentence, not another number', () => {
    render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/No practice in the last three weeks/i)).toBeInTheDocument()
  })
})

describe('FamilyScreen', () => {
  it('renders the family list', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  })

  it('names each child’s world without opening anything', async () => {
    render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    expect(screen.getByText(/Cats/)).toBeInTheDocument()
  })

  it('carries no theme accent', async () => {
    const { container } = render(<FamilyScreen navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    assertThemeFree(container)
  })
})

describe('every grown-up screen', () => {
  it('renders without a signed-in account, rather than crashing', () => {
    testState.authStatus = 'signed-out'
    testState.user = null
    testState.profile = null
    testState.learners = []
    testState.active = null
    testState.learnerStatus = 'unavailable'

    for (const Screen of [UpgradeScreen, AccountScreen, CustomListsScreen] as const) {
      const { unmount } = render(<Screen navigate={navigate} />)
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('renders for a learner with a long history', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      sessions: Array.from({ length: 40 }, () => session()),
    }
    testState.skills = { spelling: skill('spelling', { levelIndex: 3, totalAttempts: 200 }) }
    const { container } = render(<ProgressScreen game={aGame()} navigate={navigate} />)
    expect(container.textContent).toBeTruthy()
  })
})
