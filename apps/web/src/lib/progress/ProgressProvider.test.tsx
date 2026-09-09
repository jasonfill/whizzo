// Which store a learner's progress goes to, and what happens at the moment
// they sign in.
//
// The merge is the dangerous part. A child plays as a guest, makes an account,
// and their practice has to end up in it — once, into one learner. Folding the
// same guest pile into two siblings would give the second child work they
// never did.

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressProvider, useProgress } from './ProgressProvider'
import { defaultSkillState, emptySnapshot } from './types'
import type { ProgressSnapshot } from './types'
import type { Learner } from '../learners'

let authStatus = 'signed-out'
let active: Learner | null = null
let learnerStatus = 'unavailable'

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ status: authStatus }) }))
vi.mock('../learners/LearnerProvider', () => ({
  useLearners: () => ({ active, status: learnerStatus }),
}))

const cloudLoad = vi.fn(async () => emptySnapshot())
const pushSnapshot = vi.fn(async (_s: ProgressSnapshot) => {})
const persist = vi.fn(async () => {})
const localReset = vi.fn(async () => {})
const cloudSaveLists = vi.fn(async (l: unknown[]) => l)
const cloudDeleteList = vi.fn(async (_id: string) => {})
const cloudSaveDecks = vi.fn(async (d: unknown[]) => d)
const cloudDeleteDeck = vi.fn(async (_id: string) => {})
const cloudReset = vi.fn(async () => {})
const cloudAttempts = vi.fn(async () => [{ id: 'attempt-1' }])

vi.mock('./apiRepo', () => ({
  ApiProgressRepo: class {
    kind = 'cloud'
    constructor(public learnerId: string) {}
    load = cloudLoad
    pushSnapshot = pushSnapshot
    persist = persist
    saveCustomLists = cloudSaveLists
    deleteCustomList = cloudDeleteList
    saveDecks = cloudSaveDecks
    deleteDeck = cloudDeleteDeck
    reset = cloudReset
    attemptsForSession = cloudAttempts
  },
}))

let localSnapshot = emptySnapshot()
// Clearing really empties the pile, which is the mechanism that stops a second
// child inheriting it. Mocking it as a no-op would test nothing.
const clearLocalProgress = vi.fn(() => {
  localSnapshot = emptySnapshot()
})

vi.mock('./localRepo', () => ({
  LocalProgressRepo: class {
    kind = 'local'
    load = vi.fn(async () => localSnapshot)
    persist = persist
    reset = localReset
    attemptsForSession = vi.fn(async () => [])
  },
  loadLocalSnapshot: () => localSnapshot,
  clearLocalProgress: () => clearLocalProgress(),
}))

function withPractice(attempts: number): ProgressSnapshot {
  return {
    ...emptySnapshot(),
    skills: {
      spelling: { ...defaultSkillState('spelling'), totalAttempts: attempts, totalCorrect: attempts },
    },
    mastery: { 'spelling:cat': { itemKey: 'cat' } as never },
  }
}

function Probe() {
  const p = useProgress()
  const { mode, ready, snapshot } = p
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="sync">{p.sync}</span>
      <span data-testid="attempts">{snapshot.skills.spelling?.totalAttempts ?? 0}</span>
      <span data-testid="lists">{snapshot.customLists.map((l) => l.id).join(',')}</span>
      <span data-testid="decks">{snapshot.decks.map((d) => d.id).join(',')}</span>
      <span data-testid="level">{p.skill('spelling').levelIndex}</span>
      <button onClick={() => void p.saveCustomLists([{ id: 'list-1', title: 'Week 1' } as never])}>
        save-list
      </button>
      <button onClick={() => void p.deleteCustomList('list-1')}>delete-list</button>
      <button onClick={() => void p.saveDeck({ id: 'deck-1', title: 'Capitals' } as never)}>
        save-deck
      </button>
      <button onClick={() => void p.deleteDeck('deck-1')}>delete-deck</button>
      <button
        onClick={() =>
          void p.commit({
            skill: { ...defaultSkillState('spelling'), totalAttempts: 7 },
          } as never)
        }
      >
        commit
      </button>
      <button onClick={() => void p.reset()}>reset</button>
      <button onClick={() => void p.attemptsForSession('s1')}>attempts</button>
    </div>
  )
}

const click = async (label: string) => {
  await act(async () => {
    screen.getByText(label).click()
  })
}

function renderProvider() {
  return render(
    <ProgressProvider>
      <Probe />
    </ProgressProvider>,
  )
}

const learner = (id: string): Learner => ({ id, displayName: 'Ada' }) as Learner

beforeEach(() => {
  vi.clearAllMocks()
  cloudLoad.mockResolvedValue(emptySnapshot())
  cloudSaveLists.mockImplementation(async (l: unknown[]) => l)
  cloudSaveDecks.mockImplementation(async (d: unknown[]) => d)
  cloudAttempts.mockResolvedValue([{ id: 'attempt-1' }] as never)
  localSnapshot = emptySnapshot()
  authStatus = 'signed-out'
  active = null
  learnerStatus = 'unavailable'
  localStorage.clear()
})

describe('as a guest', () => {
  it('stores progress locally', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('mode')).toHaveTextContent('local')
  })

  it('never reaches for the cloud', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(cloudLoad).not.toHaveBeenCalled()
  })
})

describe('signed in', () => {
  beforeEach(() => {
    authStatus = 'signed-in'
    learnerStatus = 'ready'
    active = learner('l1')
  })

  it('loads the learner’s cloud snapshot', async () => {
    cloudLoad.mockResolvedValue(withPractice(12))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
    expect(screen.getByTestId('attempts')).toHaveTextContent('12')
  })

  it('waits for the learner list before choosing a store', async () => {
    // Booting into local and swapping afterwards would double-count whatever
    // round was in progress.
    learnerStatus = 'loading'
    renderProvider()
    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(cloudLoad).not.toHaveBeenCalled()
  })

  it('falls back to local storage when the cloud will not load', async () => {
    // A flaky connection must not stop a child practicing.
    cloudLoad.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('mode')).toHaveTextContent('local')
  })
})

describe('the sign-in merge', () => {
  beforeEach(() => {
    authStatus = 'signed-in'
    learnerStatus = 'ready'
    active = learner('l1')
    localSnapshot = withPractice(5)
  })

  it('folds guest practice into the account', async () => {
    cloudLoad.mockResolvedValue(withPractice(10))
    renderProvider()
    await waitFor(() => expect(pushSnapshot).toHaveBeenCalled())
    expect(screen.getByTestId('attempts')).toHaveTextContent('15')
  })

  it('clears the guest pile once it has been folded in', async () => {
    renderProvider()
    await waitFor(() => expect(clearLocalProgress).toHaveBeenCalled())
  })

  it('never folds the same guest pile into a second child', async () => {
    // A parent with two children must not have one pile of guest practice
    // appear under both. Two things stop it: the pile is cleared once it has
    // been folded in, and a per-learner marker records that it happened.
    const first = renderProvider()
    await waitFor(() => expect(pushSnapshot).toHaveBeenCalledTimes(1))
    first.unmount()

    pushSnapshot.mockClear()
    active = learner('l2')
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('does not merge twice into the same learner if the pile survives', async () => {
    // The marker is the belt to the clearing's braces: if clearing fails —
    // a private window, storage full — signing in again must not double the
    // learner's attempt counts.
    const first = renderProvider()
    await waitFor(() => expect(pushSnapshot).toHaveBeenCalledTimes(1))
    first.unmount()

    pushSnapshot.mockClear()
    localSnapshot = withPractice(5) // clearing "failed"
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('does not merge when there is no guest practice to merge', async () => {
    localSnapshot = emptySnapshot()
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
    expect(pushSnapshot).not.toHaveBeenCalled()
    expect(clearLocalProgress).not.toHaveBeenCalled()
  })
})

describe('a round of practice', () => {
  it('shows immediately, and is written afterwards', async () => {
    // A flaky connection must never interrupt a child mid-round, so the UI
    // moves first and the write follows.
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    await click('commit')
    expect(screen.getByTestId('attempts')).toHaveTextContent('7')
    expect(persist).toHaveBeenCalled()
  })

  it('reads a skill nobody has practiced as a fresh one', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('level')).toHaveTextContent('0')
  })

  it('empties the store on a reset', async () => {
    localSnapshot = withPractice(9)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('attempts')).toHaveTextContent('9'))
    await click('reset')
    expect(localReset).toHaveBeenCalled()
    expect(screen.getByTestId('attempts')).toHaveTextContent('0')
  })

  it('fetches the answers behind a round from whichever store is in use', async () => {
    authStatus = 'signed-in'
    learnerStatus = 'ready'
    active = learner('l1')
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
    await click('attempts')
    expect(cloudAttempts).toHaveBeenCalledWith('s1')
  })
})

describe('material a learner owns', () => {
  describe('as a guest', () => {
    it('is saved through the ordinary local write', async () => {
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
      await click('save-list')
      expect(screen.getByTestId('lists')).toHaveTextContent('list-1')
      expect(persist).toHaveBeenCalled()
    })

    it('is removed the same way', async () => {
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
      await click('save-list')
      await click('delete-list')
      expect(screen.getByTestId('lists')).toHaveTextContent('')
    })

    it('holds decks too', async () => {
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
      await click('save-deck')
      expect(screen.getByTestId('decks')).toHaveTextContent('deck-1')
      await click('delete-deck')
      expect(screen.getByTestId('decks')).toHaveTextContent('')
    })
  })

  describe('signed in', () => {
    beforeEach(() => {
      authStatus = 'signed-in'
      learnerStatus = 'ready'
      active = learner('l1')
    })

    it('goes to its own endpoint rather than riding the snapshot', async () => {
      // A word list is not a round of practice; sending it through the change
      // stream would rewrite the whole pile to save one list.
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
      await click('save-list')
      expect(cloudSaveLists).toHaveBeenCalled()
      expect(screen.getByTestId('lists')).toHaveTextContent('list-1')
    })

    it('takes the server’s version of what was saved', async () => {
      cloudSaveLists.mockResolvedValueOnce([{ id: 'list-server' } as never])
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
      await click('save-list')
      expect(screen.getByTestId('lists')).toHaveTextContent('list-server')
    })

    it('deletes a list on the server and locally', async () => {
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
      await click('save-list')
      await click('delete-list')
      expect(cloudDeleteList).toHaveBeenCalledWith('list-1')
      expect(screen.getByTestId('lists')).toHaveTextContent('')
    })

    it('saves and deletes decks the same way', async () => {
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
      await click('save-deck')
      expect(cloudSaveDecks).toHaveBeenCalled()
      expect(screen.getByTestId('decks')).toHaveTextContent('deck-1')
      await click('delete-deck')
      expect(cloudDeleteDeck).toHaveBeenCalledWith('deck-1')
      expect(screen.getByTestId('decks')).toHaveTextContent('')
    })

    it('keeps the deck it was given when the server returned nothing', async () => {
      cloudSaveDecks.mockResolvedValueOnce([])
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('cloud'))
      await click('save-deck')
      expect(screen.getByTestId('decks')).toHaveTextContent('deck-1')
    })
  })
})

describe('useProgress outside a provider', () => {
  it('fails loudly rather than silently losing a round', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ProgressProvider/)
  })
})
