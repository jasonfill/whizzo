// Presence is opt-in, and this is where that promise is kept or broken: the
// home screen's Today strip subscribes to the same channel as the planner, and
// only one of them is somewhere.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveLearner } from './useLiveChannel'

const opened = vi.hoisted(() => ({ paths: [] as string[], closed: 0 }))
vi.mock('../lib/live/client', () => ({
  openLive: (path: string) => {
    opened.paths.push(path)
    return () => {
      opened.closed += 1
    }
  },
}))
vi.mock('../lib/api/client', () => ({ ORIGIN_ID: 'origin-under-test' }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

describe('useLiveLearner', () => {
  beforeEach(async () => {
    const { resetLivePool } = await import('../lib/live/pool')
    resetLivePool()
    opened.paths = []
    opened.closed = 0
  })

  it('subscribes silently by default', () => {
    renderHook(() => useLiveLearner('l1'))
    expect(opened.paths).toEqual(['/live/learners/l1'])
  })

  // The whole point of the pool: the planner, the Today strip and a running
  // round all listening is one socket, not three.
  it('opens one connection however many consumers ask', () => {
    renderHook(() => useLiveLearner('l1'))
    renderHook(() => useLiveLearner('l1'))
    renderHook(() => useLiveLearner('l1'))
    expect(opened.paths).toEqual(['/live/learners/l1'])
  })

  it('keeps separate connections for separate learners', () => {
    renderHook(() => useLiveLearner('l1'))
    renderHook(() => useLiveLearner('l2'))
    expect(opened.paths).toEqual(['/live/learners/l1', '/live/learners/l2'])
  })

  // A silent listener that stays put must not lose presence when the screen
  // that was announcing goes away.
  it('reopens when the last announcing consumer leaves', () => {
    renderHook(() => useLiveLearner('l1'))
    const announcing = renderHook(() => useLiveLearner('l1', { announce: true }))
    expect(opened.paths).toEqual(['/live/learners/l1', '/live/learners/l1?announce=1'])

    announcing.unmount()
    expect(opened.paths.at(-1)).toBe('/live/learners/l1')
  })

  it('closes the connection when the last consumer goes', () => {
    const only = renderHook(() => useLiveLearner('l1'))
    only.unmount()
    expect(opened.closed).toBe(1)
  })

  it('announces only when asked', () => {
    renderHook(() => useLiveLearner('l1', { announce: true }))
    expect(opened.paths).toEqual(['/live/learners/l1?announce=1'])
  })

  it('opens nothing without a learner', () => {
    renderHook(() => useLiveLearner(null, { announce: true }))
    expect(opened.paths).toEqual([])
  })
})
