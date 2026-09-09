// What a round says about itself, and — mostly — what it does not.
//
// The two properties worth protecting: a round nobody has joined is silent,
// and typing goes out on a pause rather than on a keystroke.

import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_IDLE_MS } from '@whizzo/shared'
import { useLiveRound } from './useLiveRound'

const sent = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }))
// `watchers` is everyone announced; `others` drops anyone sharing this
// session's user id. The two differ exactly when a learner is working on a
// grown-up's account, which is the case this hook has to get right.
const watchers = vi.hoisted(() => ({
  all: [] as Array<{ userId: string; name: string | null }>,
  others: [] as Array<{ userId: string; name: string | null }>,
}))

vi.mock('../lib/learners/LearnerProvider', () => ({
  useLearners: () => ({ active: { id: 'learner-1', displayName: 'Ada' } }),
}))
vi.mock('./useLiveChannel', () => ({
  useLiveLearner: () => ({ status: 'open', watchers: watchers.all, others: watchers.others }),
}))
vi.mock('../lib/api/client', () => ({
  api: {
    post: async (_path: string, body: Record<string, unknown>) => {
      sent.bodies.push(body)
    },
  },
}))

const kinds = () => sent.bodies.map((b) => b.kind)
const drafts = () => sent.bodies.filter((b) => b.kind === 'round.draft').map((b) => b.text)

const ROUND = {
  roundId: 'r1',
  activity: 'listen-spell',
  subject: 'quiz',
  title: 'Week 4',
  cards: 10,
}

beforeEach(() => {
  vi.useFakeTimers()
  sent.bodies = []
  watchers.all = []
  watchers.others = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a round nobody has joined', () => {
  it('announces itself once and then says nothing', () => {
    const { result } = renderHook(() => useLiveRound())

    act(() => result.current.begin(ROUND))
    act(() => {
      result.current.card({
        roundId: 'r1',
        at: 1,
        cards: 10,
        prompt: 'necessary',
        outcome: null,
        answer: null,
        selfGraded: false,
        responseMs: null,
      })
      result.current.draft('r1', 1, 'neces')
      vi.advanceTimersByTime(DRAFT_IDLE_MS * 3)
    })

    // The begin is how a grown-up finds out there is something to join; after
    // that, an unwatched round is free.
    expect(kinds()).toEqual(['round.begin'])
  })
})

describe('a round somebody is following', () => {
  beforeEach(() => {
    watchers.all = [{ userId: 'grown-up-1', name: 'Mom' }]
    watchers.others = [{ userId: 'grown-up-1', name: 'Mom' }]
  })

  it('sends what is in the box once typing pauses', () => {
    const { result } = renderHook(() => useLiveRound())
    act(() => result.current.begin(ROUND))

    act(() => {
      result.current.draft('r1', 1, 'n')
      result.current.draft('r1', 1, 'ne')
      result.current.draft('r1', 1, 'nec')
      result.current.draft('r1', 1, 'nece')
    })
    // Mid-typing: nothing has gone out yet.
    expect(drafts()).toEqual([])

    act(() => vi.advanceTimersByTime(DRAFT_IDLE_MS))
    // One message for four keystrokes, carrying only where they got to.
    expect(drafts()).toEqual(['nece'])
  })

  it('does not repeat itself when the pause did not change anything', () => {
    const { result } = renderHook(() => useLiveRound())
    act(() => result.current.begin(ROUND))

    act(() => {
      result.current.draft('r1', 1, 'necessary')
      vi.advanceTimersByTime(DRAFT_IDLE_MS)
    })
    act(() => {
      result.current.draft('r1', 1, 'necessary')
      vi.advanceTimersByTime(DRAFT_IDLE_MS * 4)
    })

    expect(drafts()).toEqual(['necessary'])
  })

  // Two pauses in one answer is two messages, which is the point — it is the
  // per-keystroke feed that was never wanted, not the second thought.
  it('sends again after a second pause', () => {
    const { result } = renderHook(() => useLiveRound())
    act(() => result.current.begin(ROUND))

    act(() => {
      result.current.draft('r1', 1, 'neces')
      vi.advanceTimersByTime(DRAFT_IDLE_MS)
    })
    act(() => {
      result.current.draft('r1', 1, 'necessary')
      vi.advanceTimersByTime(DRAFT_IDLE_MS * 2)
    })

    expect(drafts()).toEqual(['neces', 'necessary'])
  })

  // Otherwise a draft written before the answer lands arrives after it, and a
  // watcher sees them typing a word they have already finished.
  it('drops a pending draft when the card resolves', () => {
    const { result } = renderHook(() => useLiveRound())
    act(() => result.current.begin(ROUND))

    act(() => {
      result.current.draft('r1', 1, 'necess')
      result.current.card({
        roundId: 'r1',
        at: 1,
        cards: 10,
        prompt: 'necessary',
        outcome: 'right',
        answer: 'necessary',
        selfGraded: false,
        responseMs: 4000,
      })
      vi.advanceTimersByTime(DRAFT_IDLE_MS * 3)
    })

    expect(drafts()).toEqual([])
    expect(kinds()).toEqual(['round.begin', 'round.tick'])
  })

  it('reports the end of the round', () => {
    const { result } = renderHook(() => useLiveRound())
    act(() => result.current.begin(ROUND))
    act(() => result.current.end({ roundId: 'r1', cards: 10, correct: 8 }))

    expect(sent.bodies.at(-1)).toMatchObject({ kind: 'round.end', cards: 10, correct: 8 })
  })

  // The household where a young learner works on a grown-up's account: the
  // watcher shares this session's user id, so `others` is empty even though
  // somebody is plainly there. Gating on that would mean the round never
  // emitted and the watch screen sat on "not practising" throughout.
  it('emits when the only watcher shares the learner’s account', () => {
    watchers.all = [{ userId: 'grown-up-1', name: 'Mom' }]
    watchers.others = []

    const { result } = renderHook(() => useLiveRound())
    expect(result.current.watched).toBe(true)

    act(() => result.current.begin(ROUND))
    act(() => {
      result.current.draft('r1', 1, 'necessary')
      vi.advanceTimersByTime(DRAFT_IDLE_MS)
    })

    expect(drafts()).toEqual(['necessary'])
  })

  // Callers put this object in effect dependency arrays: a fresh one each
  // render turns "say which card is up" into "say it again on every render".
  it('returns the same object until something actually changes', () => {
    const { result, rerender } = renderHook(() => useLiveRound())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('names who is following, for the line the learner always sees', () => {
    const { result } = renderHook(() => useLiveRound())
    expect(result.current.watched).toBe(true)
    expect(result.current.watcherNames).toEqual(['Mom'])
  })
})
