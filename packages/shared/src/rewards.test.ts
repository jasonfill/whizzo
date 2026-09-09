// Promises, evidence, and getting paid.
//
// Two things are being defended here, and neither is about revenue. A reward
// must not be collectable without doing the work — and a promise that has come
// due must not be quietly forgotten by the grown-up who made it.

import { describe, expect, it } from 'vitest'
import {
  canCancel,
  canFulfill,
  checkCriterion,
  CRITERION_LABEL,
  ledger,
  MIN_ITEMS_FOR_SET_REWARD,
  NAG_AFTER_DAYS,
  needsChasing,
  SUGGESTED_CRITERION,
  type Reward,
  type RewardCriterionType,
} from './rewards.js'

const NOW = 1_700_000_000_000
const PARENT = 'u-parent'
const TUTOR = 'u-tutor'

function reward(over: Partial<Reward> = {}): Reward {
  return {
    id: 'r1',
    learnerId: 'l1',
    createdBy: PARENT,
    title: 'Ice cream',
    note: null,
    kind: 'direct',
    criterion: { type: 'checkpoint', targetId: 'deck-1', threshold: 0.9 },
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

describe('what may be promised', () => {
  it('names every criterion', () => {
    for (const [type, label] of Object.entries(CRITERION_LABEL)) {
      expect(label.length, type).toBeGreaterThan(8)
    }
  })

  it('suggests the one that cannot be farmed in an afternoon', () => {
    // A reward for *still knowing it three weeks later* is the exact behavior
    // a parent is paying for. Every other app rewards activity.
    expect(SUGGESTED_CRITERION).toBe('checkpoint')
  })

  it('accepts an honest criterion', () => {
    expect(
      checkCriterion({ type: 'set_mastered', targetId: 'd1', threshold: 0.9 }, {
        learnerOwnsTarget: false,
        targetItemCount: 40,
      }),
    ).toBeNull()
  })
})

describe('ways somebody could otherwise collect without doing the work', () => {
  it('refuses a set the learner made themselves', () => {
    // `can_manage_learner_content` counts a learner as able to manage their own
    // decks — so without this a child types "cat / cat" three times, masters it
    // in ninety seconds, and collects.
    const problem = checkCriterion(
      { type: 'set_mastered', targetId: 'd1' },
      { learnerOwnsTarget: true, targetItemCount: 40 },
    )
    expect(problem?.reason).toMatch(/made themselves/)
  })

  it('refuses a set too small to be an achievement', () => {
    const problem = checkCriterion(
      { type: 'set_mastered', targetId: 'd1' },
      { targetItemCount: 4 },
    )
    expect(problem?.reason).toMatch(new RegExp(String(MIN_ITEMS_FOR_SET_REWARD)))
  })

  it('refuses minutes, because a child can sit in front of it', () => {
    const problem = checkCriterion({ type: 'minutes', threshold: 30 })
    expect(problem?.reason).toMatch(/input, not an outcome/)
  })

  it('refuses a bar of nothing', () => {
    expect(checkCriterion({ type: 'streak', threshold: 0 })?.reason).toMatch(/how much/)
  })

  it('does not demand a size for criteria that have no set', () => {
    for (const type of ['streak', 'verified_items', 'assignment'] as RewardCriterionType[]) {
      expect(checkCriterion({ type, threshold: 5 }), type).toBeNull()
    }
  })
})

describe('who may settle it', () => {
  it('lets the author mark their own promise paid', () => {
    expect(canFulfill(reward({ status: 'earned', earnedAt: NOW }), PARENT)).toBe(true)
  })

  it('does not let somebody else settle it', () => {
    // A tutor cannot know whether a parent bought the ice cream. The payer
    // settles their own debt.
    expect(canFulfill(reward({ status: 'earned', earnedAt: NOW }), TUTOR)).toBe(false)
  })

  it('has nothing to settle before it is earned', () => {
    expect(canFulfill(reward(), PARENT)).toBe(false)
  })

  it('cannot be settled twice', () => {
    const paid = reward({ status: 'fulfilled', fulfilledAt: NOW, fulfilledBy: PARENT })
    expect(canFulfill(paid, PARENT)).toBe(false)
  })
})

describe('who may withdraw it', () => {
  it('lets the author take back what they offered', () => {
    expect(canCancel(reward(), PARENT, false)).toBe(true)
  })

  it("lets a parent veto what a tutor promised their child", () => {
    // They have to be able to, and to see it in order to.
    expect(canCancel(reward({ createdBy: TUTOR }), PARENT, true)).toBe(true)
  })

  it('does not let an unrelated grown-up withdraw it', () => {
    expect(canCancel(reward({ createdBy: TUTOR }), PARENT, false)).toBe(false)
  })

  it('cannot take back a promise that has already come due', () => {
    // Earning latches. A child who watched an ice cream disappear has learned
    // something about this app we do not want them to learn.
    const earned = reward({ status: 'earned', earnedAt: NOW })
    expect(canCancel(earned, PARENT, true)).toBe(false)
  })
})

describe('chasing an unpaid promise', () => {
  it('says nothing while it is fresh', () => {
    expect(needsChasing(reward({ status: 'earned', earnedAt: NOW - 3600_000 }), NOW)).toBe(false)
  })

  it('speaks up once it has been sitting', () => {
    // An earned, unfulfilled reward is worse than no reward: it teaches a child
    // that the system's word is not good.
    const stale = reward({ status: 'earned', earnedAt: NOW - (NAG_AFTER_DAYS + 1) * 86_400_000 })
    expect(needsChasing(stale, NOW)).toBe(true)
  })

  it('never chases one that was paid', () => {
    const paid = reward({
      status: 'fulfilled',
      earnedAt: NOW - 30 * 86_400_000,
      fulfilledAt: NOW,
      fulfilledBy: PARENT,
    })
    expect(needsChasing(paid, NOW)).toBe(false)
  })

  it('never chases one that has not been earned', () => {
    expect(needsChasing(reward(), NOW)).toBe(false)
  })
})

describe('the ledger', () => {
  it('separates what is promised, owed and settled', () => {
    const books = ledger([
      reward({ id: 'a' }),
      reward({ id: 'b', status: 'earned', earnedAt: NOW }),
      reward({ id: 'c', status: 'fulfilled', fulfilledAt: NOW, fulfilledBy: PARENT, earnedAt: 1 }),
    ])
    expect(books.promised.map((r) => r.id)).toEqual(['a'])
    expect(books.unpaid.map((r) => r.id)).toEqual(['b'])
    expect(books.paid.map((r) => r.id)).toEqual(['c'])
  })

  it('puts the longest-owed first, because that is the action list', () => {
    const books = ledger([
      reward({ id: 'new', status: 'earned', earnedAt: NOW }),
      reward({ id: 'old', status: 'earned', earnedAt: NOW - 86_400_000 }),
    ])
    expect(books.unpaid.map((r) => r.id)).toEqual(['old', 'new'])
  })

  it('shows what was paid most recently first', () => {
    const books = ledger([
      reward({ id: 'older', status: 'fulfilled', fulfilledAt: 1, fulfilledBy: PARENT, earnedAt: 1 }),
      reward({ id: 'newer', status: 'fulfilled', fulfilledAt: 2, fulfilledBy: PARENT, earnedAt: 1 }),
    ])
    expect(books.paid.map((r) => r.id)).toEqual(['newer', 'older'])
  })

  it('leaves withdrawn and expired promises out of all three', () => {
    const books = ledger([reward({ status: 'canceled' }), reward({ status: 'expired' })])
    expect(books.promised.concat(books.unpaid, books.paid)).toEqual([])
  })

  it('copes with nothing at all', () => {
    expect(ledger([])).toEqual({ unpaid: [], promised: [], paid: [] })
  })
})
