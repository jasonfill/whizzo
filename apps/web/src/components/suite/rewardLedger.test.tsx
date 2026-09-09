// The parent's ledger.
//
// One interaction is what this exists for: a tap to say the ice cream
// happened. Everything else is bookkeeping around it — and the two rules being
// defended are that an owed promise is the top of the list, and that only the
// person who made it can settle it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rewardsApi = vi.hoisted(() => ({
  rewardsFor: vi.fn(),
  fulfillReward: vi.fn(),
  cancelReward: vi.fn(),
  offerReward: vi.fn(),
}))
vi.mock('../../lib/rewards/api', () => rewardsApi)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)

import RewardLedger from './RewardLedger'
import type { Reward } from '@whizzo/shared'

const PARENT = 'u-parent'
const TUTOR = 'u-tutor'
const NOW = Date.now()

function reward(over: Partial<Reward> = {}): Reward {
  return {
    id: 'r1',
    learnerId: 'l1',
    createdBy: PARENT,
    title: 'Ice cream',
    note: null,
    kind: 'direct',
    criterion: { type: 'checkpoint', targetId: 'd1', threshold: 0.9 },
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

function show(rewards: Reward[], userId = PARENT, ownsLearner = true) {
  rewardsApi.rewardsFor.mockResolvedValue({ rewards })
  return render(
    <RewardLedger learnerId="l1" learnerName="Ava" userId={userId} ownsLearner={ownsLearner} />,
  )
}

beforeEach(() => {
  for (const fn of Object.values(rewardsApi)) fn.mockReset()
  rewardsApi.fulfillReward.mockResolvedValue({ reward: reward() })
  rewardsApi.cancelReward.mockResolvedValue({ reward: reward({ status: 'canceled' }) })
})

describe('with nothing promised', () => {
  it('says where a reward comes from, rather than showing an empty box', async () => {
    show([])
    // The sentence that matters: never from the child saying they did it.
    expect(await screen.findByText(/never from/i)).toBeTruthy()
    expect(screen.getByText(/Ava saying they did it/)).toBeTruthy()
  })
})

describe('what is owed comes first', () => {
  it('puts an earned promise at the top with a way to settle it', async () => {
    show([reward({ id: 'a' }), reward({ id: 'b', status: 'earned', earnedAt: NOW })])
    expect(await screen.findByText('Earned — not yet given')).toBeTruthy()
    expect(screen.getByText('✅ Given')).toBeTruthy()
  })

  it('marks the ones that have been sitting', async () => {
    // An earned, unfulfilled reward is worse than no reward at all.
    show([reward({ status: 'earned', earnedAt: NOW - 10 * 86_400_000 })])
    expect(await screen.findByText(/waiting on you/)).toBeTruthy()
  })

  it('does not nag about one earned this morning', async () => {
    show([reward({ status: 'earned', earnedAt: NOW - 3600_000 })])
    await screen.findByText('✅ Given')
    expect(screen.queryByText(/waiting on you/)).toBeNull()
  })

  it('settles it in one tap', async () => {
    show([reward({ id: 'b', status: 'earned', earnedAt: NOW })])
    fireEvent.click(await screen.findByText('✅ Given'))
    await waitFor(() => expect(rewardsApi.fulfillReward).toHaveBeenCalledWith('b'))
  })
})

describe('only whoever promised it may settle it', () => {
  it('offers no button to somebody else', async () => {
    // A tutor cannot know whether a parent bought the ice cream.
    show([reward({ createdBy: TUTOR, status: 'earned', earnedAt: NOW })], PARENT)
    expect(await screen.findByText(/whoever promised it settles it/)).toBeTruthy()
    expect(screen.queryByText('✅ Given')).toBeNull()
  })
})

describe('taking one back', () => {
  it('can be withdrawn before it is earned', async () => {
    show([reward({ id: 'a' })])
    fireEvent.click(await screen.findByText('Take it back'))
    await waitFor(() => expect(rewardsApi.cancelReward).toHaveBeenCalledWith('a'))
  })

  it('cannot be withdrawn once it has come due', async () => {
    // A child who watched an ice cream disappear has learned something about
    // this app we do not want them to learn.
    show([reward({ status: 'earned', earnedAt: NOW })])
    await screen.findByText('✅ Given')
    expect(screen.queryByText('Take it back')).toBeNull()
  })

  it('is not offered to somebody who neither promised it nor owns the child', async () => {
    show([reward({ createdBy: TUTOR })], PARENT, false)
    await screen.findByText('Ice cream')
    expect(screen.queryByText('Take it back')).toBeNull()
  })

  it('is offered to a parent for a promise a tutor made to their child', async () => {
    show([reward({ createdBy: TUTOR })], PARENT, true)
    expect(await screen.findByText('Take it back')).toBeTruthy()
  })
})

describe('what has been given', () => {
  it('keeps a record, so nobody has to remember', async () => {
    show([
      reward({ id: 'p', status: 'fulfilled', earnedAt: 1, fulfilledAt: NOW, fulfilledBy: PARENT }),
    ])
    expect(await screen.findByText('Given')).toBeTruthy()
  })
})

describe('when saving fails', () => {
  it('says so rather than looking like it worked', async () => {
    rewardsApi.fulfillReward.mockRejectedValue(new Error('Only whoever promised this can.'))
    show([reward({ status: 'earned', earnedAt: NOW })])
    fireEvent.click(await screen.findByText('✅ Given'))
    expect(await screen.findByText(/Only whoever promised this can/)).toBeTruthy()
  })
})

// Making a promise. Short on purpose: what they get, what for, how much. When
// it is earned and whether the evidence is good enough are the app's business.
describe('promising something', () => {
  async function openForm() {
    show([])
    fireEvent.click(await screen.findByText(/Promise something/))
  }

  it('is offered from the empty state, so the feature is not a dead end', async () => {
    show([])
    expect(await screen.findByText(/Promise something/)).toBeTruthy()
  })

  it('is offered alongside a list that already has promises in it', async () => {
    show([reward()])
    expect(await screen.findByText(/Promise something/)).toBeTruthy()
  })

  it('says what a reward rests on before anything is typed', async () => {
    await openForm()
    expect(screen.getByText(/never.*saying they did it/i)).toBeTruthy()
  })

  it('starts on the criterion worth picking, and says why', async () => {
    // Retention is the only one that cannot be rushed in an afternoon.
    await openForm()
    expect(screen.getByText(/cannot be rushed in an afternoon/)).toBeTruthy()
  })

  it('never offers minutes, which a child can sit through', async () => {
    await openForm()
    const options = [...screen.getByLabelText(/For what/i).querySelectorAll('option')]
    expect(options.map((o) => (o as HTMLOptionElement).value)).not.toContain('minutes')
  })

  it('will not promise something with no name', async () => {
    await openForm()
    expect(screen.getByText('Promise it').closest('button')!.disabled).toBe(true)
  })

  it('sends the promise once it has a name', async () => {
    rewardsApi.offerReward.mockResolvedValue({ reward: reward() })
    await openForm()
    fireEvent.change(screen.getByPlaceholderText('Ice cream'), { target: { value: 'Ice cream' } })
    fireEvent.click(screen.getByText('Promise it'))
    await waitFor(() =>
      expect(rewardsApi.offerReward).toHaveBeenCalledWith(
        expect.objectContaining({ learnerId: 'l1', title: 'Ice cream' }),
      ),
    )
  })

  it('says so when the server refuses it', async () => {
    rewardsApi.offerReward.mockRejectedValue(new Error('That is a set they made themselves.'))
    await openForm()
    fireEvent.change(screen.getByPlaceholderText('Ice cream'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Promise it'))
    expect(await screen.findByText(/made themselves/)).toBeTruthy()
  })

  it('goes back without promising anything when canceled', async () => {
    await openForm()
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Promise it')).toBeNull())
    expect(rewardsApi.offerReward).not.toHaveBeenCalled()
  })
})
