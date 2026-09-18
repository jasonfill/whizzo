// The promise, from the child's side.
//
// Two rules: the learner sees what they are working toward and what has come
// due, and nothing else — no ledger, no paying, no buttons. And the child is
// never nagged: an earned reward is one gentle line, not a countdown.

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rewardsApi = vi.hoisted(() => ({
  rewardsFor: vi.fn(),
}))
vi.mock('../../lib/rewards/api', () => rewardsApi)

import PromisedRewards from './PromisedRewards'
import type { Reward } from '@whizzo/shared'

const NOW = Date.now()

function reward(over: Partial<Reward> = {}): Reward {
  return {
    id: 'r1',
    learnerId: 'l1',
    createdBy: 'u-parent',
    title: 'Ice cream',
    note: null,
    kind: 'direct',
    criterion: { type: 'set_mastered', targetId: 'd1', threshold: 0.9 },
    maxAwards: 1,
    awardsMade: 0,
    status: 'offered',
    offeredAt: NOW - 86_400_000,
    expiresOn: null,
    earnedAt: null,
    sessionId: null,
    fulfilledAt: null,
    fulfilledBy: null,
    fulfilledNote: null,
    ...over,
  }
}

function show(rewards: Reward[]) {
  rewardsApi.rewardsFor.mockResolvedValue({ rewards })
  return render(<PromisedRewards learnerId="l1" />)
}

beforeEach(() => {
  rewardsApi.rewardsFor.mockReset()
})

describe('when nothing is promised', () => {
  it('shows nothing at all', async () => {
    const { container } = show([])
    await waitFor(() => expect(rewardsApi.rewardsFor).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('shows nothing when everything promised has already been given', async () => {
    const { container } = show([
      reward({ status: 'fulfilled', earnedAt: 1, fulfilledAt: NOW, fulfilledBy: 'u-parent' }),
    ])
    await waitFor(() => expect(rewardsApi.rewardsFor).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('shows nothing for a promise that ran out before it was earned', async () => {
    // Nothing can earn it any more, so "working toward" it would be a lie.
    const { container } = show([reward({ expiresOn: '2000-01-01' })])
    await waitFor(() => expect(rewardsApi.rewardsFor).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('shows nothing rather than an error when the load fails', async () => {
    rewardsApi.rewardsFor.mockRejectedValue(new Error('offline'))
    const { container } = render(<PromisedRewards learnerId="l1" />)
    await waitFor(() => expect(rewardsApi.rewardsFor).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('what the learner is told', () => {
  it('says what they are working toward, and what it takes', async () => {
    show([reward()])
    expect(await screen.findByText('Working toward: Ice cream')).toBeTruthy()
    expect(screen.getByText('Masters a set')).toBeTruthy()
    expect(screen.getByText('Rewards 🎁')).toBeTruthy()
  })

  it('says when one has come due, once and gently', async () => {
    show([reward({ status: 'earned', earnedAt: NOW - 10 * 86_400_000 })])
    expect(await screen.findByText('Earned! Ice cream')).toBeTruthy()
    expect(screen.getByText('Ask a grown-up for it.')).toBeTruthy()
    // However long it has been sitting, the child is not the one chased.
    expect(screen.queryByText(/waiting/i)).toBeNull()
    expect(screen.queryByText(/days/i)).toBeNull()
  })

  it('puts what has come due above what is still being worked toward', async () => {
    show([
      reward({ id: 'a', title: 'Later' }),
      reward({ id: 'b', title: 'Now', status: 'earned', earnedAt: NOW }),
    ])
    await screen.findByText('Earned! Now')
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('Now')
    expect(items[1]).toContain('Later')
  })

  it('offers nothing to press', async () => {
    // Paying, withdrawing and offering live in Family. This is a promise, not
    // a control panel.
    show([reward(), reward({ id: 'b', status: 'earned', earnedAt: NOW })])
    await screen.findByText('Working toward: Ice cream')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
