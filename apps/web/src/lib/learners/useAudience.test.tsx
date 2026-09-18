import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudience } from './useAudience'
import { testState, aLearner, resetTestState } from '../../test/state'

vi.mock('./LearnerProvider', async () => (await import('../../test/mockProviders')).learnersMock())

describe('who a grown-up is to the people on their screen', () => {
  beforeEach(() => {
    resetTestState()
    localStorage.clear()
  })

  it('is a family when they own a learner', () => {
    testState.learners = [aLearner({ viewerRole: 'owner' })]
    expect(renderHook(() => useAudience()).result.current.label).toBe('Family')
  })

  it('is a family when a code let them in as a parent', () => {
    testState.learners = [aLearner({ viewerRole: 'parent' })]
    expect(renderHook(() => useAudience()).result.current.label).toBe('Family')
  })

  it('is a roster of learners when every link is a teacher’s', () => {
    testState.learners = [aLearner({ viewerRole: 'teacher' }), aLearner({ id: 'l2', viewerRole: 'teacher' })]
    const { result } = renderHook(() => useAudience())
    expect(result.current.label).toBe('Learners')
    expect(result.current.manage).toBe('Manage learners →')
  })

  it('stays a family for a parent who also tutors', () => {
    testState.learners = [aLearner({ viewerRole: 'owner' }), aLearner({ id: 'l2', viewerRole: 'teacher' })]
    expect(renderHook(() => useAudience()).result.current.label).toBe('Family')
  })

  it('falls back to what they said at sign-up when nobody is linked yet', () => {
    testState.learners = []
    localStorage.setItem('cat-academy:signup-intent', JSON.stringify({ role: 'tutor' }))
    expect(renderHook(() => useAudience()).result.current.label).toBe('Learners')
    localStorage.clear()
    expect(renderHook(() => useAudience()).result.current.label).toBe('Family')
  })
})
