// The week, open in two places at once.
//
// These cover the rule that decides who wins when a remote change and a local
// one land close together: newer by the server's clock, applied through one
// door. Getting it wrong looks like a card that flickers between two states,
// or worse, one that quietly reverts.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent, PlannerItem } from '@whizzo/shared'
import { usePlannerWeek } from './usePlannerWeek'

const LEARNER = 'learner-1'
const MON = '2026-09-07'

const item = (over: Partial<PlannerItem> = {}): PlannerItem =>
  ({
    id: 'card-1',
    learnerId: LEARNER,
    weekStart: MON,
    onDay: MON,
    kind: 'task',
    title: 'Bio worksheet',
    courseId: null,
    assessmentId: null,
    minutes: 25,
    purpose: null,
    proposed: false,
    target: null,
    status: 'open',
    doneAt: null,
    doneBy: null,
    sessionId: null,
    deletedAt: null,
    sortOrder: 1000,
    createdBy: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }) as PlannerItem

const week = () => ({
  week: { learnerId: LEARNER, weekStart: MON, priorities: [], wins: [], goals: [], reflection: null, busyDays: [] },
  band: 'growing',
  canWrite: true,
  items: [item()],
  carryOver: [],
  assessments: [],
  assignments: [],
  reviewDue: {},
  sessionCounts: {},
  comments: [],
  courses: [],
  prefs: { learnerId: LEARNER, dailyMinutes: 60, sessionsPerDay: 2, studyDays: [1, 2, 3, 4, 5] },
})

const net = vi.hoisted(() => ({
  loadWeek: vi.fn(),
  updateItem: vi.fn(),
}))

vi.mock('../lib/planner/api', () => ({
  loadWeek: net.loadWeek,
  updateItem: net.updateItem,
  createItem: vi.fn(),
  deleteItem: vi.fn(),
  duplicateItem: vi.fn(),
  patchWeek: vi.fn(),
  restoreItem: vi.fn(),
}))

vi.mock('../lib/learners/LearnerProvider', () => ({
  useLearners: () => ({ active: { id: LEARNER, displayName: 'Ada' } }),
}))

// Stand in for the channel: the test plays the part of the other browser.
const live = vi.hoisted(() => ({ emit: null as null | ((e: LiveEvent) => void), resync: null as null | (() => void) }))
vi.mock('./useLiveChannel', () => ({
  useLiveLearner: (_id: string | null, handlers: { onEvent?: (e: LiveEvent) => void; onResync?: () => void }) => {
    live.emit = (e) => handlers.onEvent?.(e)
    live.resync = () => handlers.onResync?.()
    return { status: 'open', watchers: [], others: [] }
  },
}))

function remote(payload: unknown, kind: LiveEvent['kind'] = 'planner.item'): LiveEvent {
  return { kind, subjectId: LEARNER, at: Date.now(), actorId: 'someone', actorName: 'Mom', originId: 'other-tab', payload }
}

describe('the week, open in two places', () => {
  beforeEach(() => {
    net.loadWeek.mockReset().mockResolvedValue(week())
    net.updateItem.mockReset()
  })

  async function mounted() {
    const hook = renderHook(() => usePlannerWeek(MON))
    await waitFor(() => expect(hook.result.current.data).not.toBeNull())
    return hook
  }

  it('applies a card somebody else moved', async () => {
    const { result } = await mounted()

    act(() => live.emit!(remote(item({ onDay: '2026-09-09', updatedAt: 2000 }))))

    expect(result.current.data!.items[0]!.onDay).toBe('2026-09-09')
  })

  it('takes a card away when somebody else removes it', async () => {
    const { result } = await mounted()

    act(() => live.emit!(remote({ itemId: 'card-1' }, 'planner.item.removed')))

    expect(result.current.data!.items).toHaveLength(0)
  })

  // The important one. A remote event that has been sitting in a socket buffer
  // must not undo a change made after it.
  it('ignores a remote change older than what we already hold', async () => {
    const { result } = await mounted()

    act(() => live.emit!(remote(item({ title: 'Newer', updatedAt: 3000 }))))
    expect(result.current.data!.items[0]!.title).toBe('Newer')

    act(() => live.emit!(remote(item({ title: 'Stale', updatedAt: 2000 }))))
    expect(result.current.data!.items[0]!.title).toBe('Newer')
  })

  // Our own write's response goes through the same door, so a remote change
  // that landed at the server after it still wins.
  it('does not let a slow response overwrite a newer remote change', async () => {
    const { result } = await mounted()
    let release: (v: PlannerItem) => void = () => {}
    net.updateItem.mockReturnValue(new Promise<PlannerItem>((resolve) => (release = resolve)))

    const inFlight = act(async () => {
      void result.current.patch(item(), { minutes: 30 })
      // Somebody else's later change arrives while ours is still in the air.
      live.emit!(remote(item({ title: 'Theirs', updatedAt: 5000 })))
      // Now our response lands, carrying the state as of *our* write.
      release(item({ minutes: 30, updatedAt: 4000 }))
    })
    await inFlight

    await waitFor(() => expect(result.current.data!.items[0]!.title).toBe('Theirs'))
    expect(result.current.data!.items[0]!.updatedAt).toBe(5000)
  })

  // The card is gone; a change that was waiting on a focused field must not
  // bring it back when focus leaves.
  it('does not resurrect a card deleted while its title was being edited', async () => {
    const { result } = await mounted()
    document.body.innerHTML = '<div data-live-key="card-1"><input id="title" /></div>'
    const input = document.querySelector<HTMLInputElement>('#title')!
    input.focus()

    // A rename arrives and is held, because the field has focus.
    act(() => live.emit!(remote(item({ title: 'Renamed', updatedAt: 2000 }))))
    expect(result.current.data!.items[0]!.title).toBe('Bio worksheet')

    // Then the card is deleted, which applies at once.
    act(() => live.emit!(remote({ itemId: 'card-1' }, 'planner.item.removed')))
    expect(result.current.data!.items).toHaveLength(0)

    await act(async () => {
      input.blur()
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(result.current.data!.items).toHaveLength(0)
    document.body.innerHTML = ''
  })

  it('adds a note somebody else left, once', async () => {
    const { result } = await mounted()
    const comment = { id: 'c1', learnerId: LEARNER, weekStart: MON, itemId: null, authorId: 'mom', authorName: 'Mom', body: 'Nice work', createdAt: 1 }

    act(() => live.emit!(remote(comment, 'planner.comment')))
    act(() => live.emit!(remote(comment, 'planner.comment')))

    expect(result.current.data!.comments).toHaveLength(1)
  })

  // The channel keeps no history, so this is the only way back to the truth.
  it('re-reads the week when the stream comes back', async () => {
    await mounted()
    expect(net.loadWeek).toHaveBeenCalledTimes(1)

    await act(async () => live.resync!())

    await waitFor(() => expect(net.loadWeek).toHaveBeenCalledTimes(2))
  })
})
