// Presence is opt-in, and this is where that promise is kept or broken: the
// home screen's Today strip subscribes to the same channel as the planner, and
// only one of them is somewhere.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveLearner } from './useLiveChannel'

const opened = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('../lib/live/client', () => ({
  openLive: (path: string) => {
    opened.paths.push(path)
    return () => {}
  },
}))
vi.mock('../lib/api/client', () => ({ ORIGIN_ID: 'origin-under-test' }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

describe('useLiveLearner', () => {
  it('subscribes silently by default', () => {
    opened.paths = []
    renderHook(() => useLiveLearner('l1'))
    expect(opened.paths).toEqual(['/live/learners/l1'])
  })

  it('announces only when asked', () => {
    opened.paths = []
    renderHook(() => useLiveLearner('l1', { announce: true }))
    expect(opened.paths).toEqual(['/live/learners/l1?announce=1'])
  })

  it('opens nothing without a learner', () => {
    opened.paths = []
    renderHook(() => useLiveLearner(null, { announce: true }))
    expect(opened.paths).toEqual([])
  })
})
