// The task list, and the one thing it has to tell the snapshot.
//
// Assignments are fetched fresh so a task set from another device shows up at
// the next look. The deck a task names, though, lives in the snapshot, which
// loaded once — so a task naming a deck the snapshot has never seen is the
// signal to fetch the material again, and only then.

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)
vi.mock('../lib/progress/ProgressProvider', async () =>
  (await import('../test/mockProviders')).progressMock(),
)

const net = vi.hoisted(() => ({
  listAssignments: vi.fn(async (): Promise<unknown[]> => []),
}))
vi.mock('../lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...net,
}))

import { resetSpies, spies } from '../test/mockProviders'
import { anAssignment, signIn, testState } from '../test/state'
import { emptySnapshot } from '../lib/progress/types'
import { useAssignments } from './useAssignments'

function deck(id: string) {
  return {
    id,
    title: id,
    description: '',
    tags: [],
    cards: [],
    source: 'user' as const,
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  signIn()
  resetSpies()
  net.listAssignments.mockReset().mockResolvedValue([])
  testState.snapshot = emptySnapshot()
})

describe('a task naming a deck the snapshot has not seen', () => {
  it('asks for the material again', async () => {
    net.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', subject: 'quiz', targetId: 'lib-1', status: 'open' }),
    ])
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(result.current.assignments).toHaveLength(1))
    await waitFor(() => expect(spies.reloadMaterial).toHaveBeenCalledTimes(1))
  })

  it('asks once per set of missing decks, so a deck that is really gone is not a loop', async () => {
    net.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', subject: 'quiz', targetId: 'gone', status: 'open' }),
    ])
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(spies.reloadMaterial).toHaveBeenCalledTimes(1))
    await result.current.refresh()
    await waitFor(() => expect(result.current.assignments).toHaveLength(1))
    expect(spies.reloadMaterial).toHaveBeenCalledTimes(1)
  })

  it('does not ask when the deck is already here', async () => {
    testState.snapshot = { ...emptySnapshot(), decks: [deck('lib-1')] }
    net.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', subject: 'quiz', targetId: 'lib-1', status: 'open' }),
    ])
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(result.current.assignments).toHaveLength(1))
    expect(spies.reloadMaterial).not.toHaveBeenCalled()
  })

  it('ignores finished tasks and other subjects', async () => {
    net.listAssignments.mockResolvedValue([
      anAssignment({ id: 'a1', subject: 'quiz', targetId: 'lib-1', status: 'done' }),
      anAssignment({ id: 'a2', subject: 'spelling', targetId: 'g4-w1', status: 'open' }),
    ])
    const { result } = renderHook(() => useAssignments())
    await waitFor(() => expect(result.current.assignments).toHaveLength(2))
    expect(spies.reloadMaterial).not.toHaveBeenCalled()
  })
})
