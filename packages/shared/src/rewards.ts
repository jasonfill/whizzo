// Promises, evidence, and getting paid.
//
// Collectibles are the in-app payoff. This is the other kind: a grown-up
// promises something real and needs to know when it was genuinely earned and
// whether they have actually handed it over.
//
// One idea holds the whole thing together: **there are two parties and each can
// only be trusted about their own side.** The child's side is verified — earning
// is derived from attempts the app checked, and nobody taps "earned". The
// grown-up's side is asserted — whether the ice cream was bought is not
// something software can check, ever, so fulfillment is a claim, recorded and
// attributed as one. That symmetry is the design, and it is the same
// distinction the app already draws between a checked answer and a self-grade,
// applied to the adult.

export type RewardStatus = 'offered' | 'earned' | 'claimed' | 'fulfilled' | 'canceled' | 'expired'

export type RewardCriterionType =
  | 'assignment'
  | 'set_mastered'
  | 'mastery_count'
  | 'checkpoint'
  | 'streak'
  | 'verified_items'
  | 'minutes'

export interface RewardCriterion {
  type: RewardCriterionType
  /** An assignment, a deck — whatever the type names. */
  targetId?: string | null
  /** How much of it. A fraction for `set_mastered`, a count for the rest. */
  threshold?: number
}

export interface Reward {
  id: string
  learnerId: string
  createdBy: string | null
  title: string
  note: string | null
  kind: 'direct' | 'store'
  criterion: RewardCriterion
  maxAwards: number
  awardsMade: number
  status: RewardStatus
  offeredAt: number
  expiresOn: string | null
  earnedAt: number | null
  sessionId: string | null
  fulfilledAt: number | null
  fulfilledBy: string | null
  fulfilledNote: string | null
}

/** What each criterion is called, for the form and for the ledger. */
export const CRITERION_LABEL: Record<RewardCriterionType, string> = {
  checkpoint: 'Still knows it weeks later',
  assignment: 'Finishes a piece of work',
  set_mastered: 'Masters a set',
  mastery_count: 'Masters this many cards',
  streak: 'Practices this many days running',
  verified_items: 'Gets this many checked answers right',
  minutes: 'Practices this many minutes',
}

/**
 * The criterion worth featuring.
 *
 * A reward for *still knowing it three weeks later* is the only one that cannot
 * be farmed in an afternoon, and it is the exact behavior a parent is paying
 * for. Every other app rewards activity; this rewards retention.
 */
export const SUGGESTED_CRITERION: RewardCriterionType = 'checkpoint'

/**
 * Criteria that need a clock.
 *
 * None of them may be offered, because a reward earnable only under a timer
 * puts money behind the one activity with a documented anxiety cost, aimed at
 * the learners most exposed to it. Fluency is reportable; it is not payable.
 */
export const UNPAYABLE_CRITERIA: readonly RewardCriterionType[] = []

export interface CriterionProblem {
  reason: string
}

/**
 * Whether this is a reward that can be earned honestly.
 *
 * Every check here is a way somebody could otherwise collect without doing the
 * work, and the second one is the least obvious and the most important.
 */
export function checkCriterion(
  criterion: RewardCriterion,
  context: { learnerOwnsTarget?: boolean; targetItemCount?: number } = {},
): CriterionProblem | null {
  if (criterion.type === 'minutes') {
    return {
      reason:
        'Minutes are an input, not an outcome — a child can sit in front of it. Pick something they have to get right.',
    }
  }

  // `can_manage_learner_content` deliberately counts a learner as able to
  // manage their own decks. Without this, a child types a three-card deck
  // — "cat" / "cat" — masters it in ninety seconds and collects.
  if (context.learnerOwnsTarget) {
    return {
      reason: 'That is a set they made themselves. Pick something you set them, or a subject.',
    }
  }

  // "Master a set" on four cards is not an achievement.
  if (
    (criterion.type === 'set_mastered' || criterion.type === 'checkpoint') &&
    context.targetItemCount !== undefined &&
    context.targetItemCount < MIN_ITEMS_FOR_SET_REWARD
  ) {
    return {
      reason: `That set only has ${context.targetItemCount} cards. Pick one with at least ${MIN_ITEMS_FOR_SET_REWARD}.`,
    }
  }

  const threshold = criterion.threshold ?? 1
  if (threshold <= 0) return { reason: 'Pick how much has to be done.' }

  return null
}

export const MIN_ITEMS_FOR_SET_REWARD = 10

/** Whether the payout has been settled. */
export function isSettled(reward: Reward): boolean {
  return reward.status === 'fulfilled'
}

/**
 * Whether this reward is waiting on the grown-up.
 *
 * The one thing the app should nag about. An earned, unfulfilled reward is
 * worse than no reward at all, because it teaches a child that the system's
 * word is not good.
 */
export function isUnpaid(reward: Reward): boolean {
  return reward.status === 'earned' || reward.status === 'claimed'
}

/** How long a promise may sit unpaid before the grown-up hears about it. */
export const NAG_AFTER_DAYS = 3

export function needsChasing(reward: Reward, now = Date.now()): boolean {
  if (!isUnpaid(reward) || reward.earnedAt === null) return false
  return now - reward.earnedAt > NAG_AFTER_DAYS * 86_400_000
}

/**
 * Whether the person looking may mark this paid.
 *
 * The author only. A tutor cannot know whether a parent bought the ice cream,
 * and a parent cannot settle a tutor's promise — the payer settles their own
 * debt.
 */
export function canFulfill(reward: Reward, userId: string): boolean {
  return isUnpaid(reward) && reward.createdBy === userId
}

/**
 * Whether the person looking may withdraw this.
 *
 * The author, or the learner's owner — a parent has to be able to veto what
 * somebody else is promising their child. And only before it is earned: once a
 * promise has come due it cannot be taken back.
 */
export function canCancel(
  reward: Reward,
  userId: string,
  ownsLearner: boolean,
): boolean {
  if (reward.status !== 'offered') return false
  return reward.createdBy === userId || ownsLearner
}

export type LedgerBucket = 'promised' | 'unpaid' | 'paid'

export function bucketOf(reward: Reward): LedgerBucket | null {
  if (reward.status === 'offered') return 'promised'
  if (isUnpaid(reward)) return 'unpaid'
  if (reward.status === 'fulfilled') return 'paid'
  return null
}

/**
 * The parent's ledger: promised, earned-and-unpaid, paid.
 *
 * Unpaid first, because it is the only part that is an action list. Everything
 * else is bookkeeping around the one interaction the feature exists for.
 */
export function ledger(rewards: readonly Reward[]): Record<LedgerBucket, Reward[]> {
  const out: Record<LedgerBucket, Reward[]> = { unpaid: [], promised: [], paid: [] }
  for (const reward of rewards) {
    const bucket = bucketOf(reward)
    if (bucket) out[bucket].push(reward)
  }
  out.unpaid.sort((a, b) => (a.earnedAt ?? 0) - (b.earnedAt ?? 0))
  out.paid.sort((a, b) => (b.fulfilledAt ?? 0) - (a.fulfilledAt ?? 0))
  return out
}
