// The client half of rewards.
//
// Note what is missing: there is no `markEarned`. Earning is derived in the
// same transaction as the round that caused it, from evidence the app checked,
// and a client function for it would be the whole feature undone.

import type { Reward, RewardCriterion } from '@whizzo/shared'
import { api } from '../api/client'

export function rewardsFor(learnerId: string, signal?: AbortSignal): Promise<{ rewards: Reward[] }> {
  return api.get(`/learners/${learnerId}/rewards`, signal)
}

export interface NewReward {
  learnerId: string
  title: string
  note?: string | null
  criterion: RewardCriterion
  maxAwards?: number
  expiresOn?: string | null
}

export function offerReward(reward: NewReward): Promise<{ reward: Reward }> {
  return api.post('/rewards', reward)
}

/** Say it has been handed over. An assertion, recorded with a name on it. */
export function fulfillReward(id: string, note?: string): Promise<{ reward: Reward }> {
  return api.post(`/rewards/${id}/fulfill`, { note: note ?? null })
}

export function cancelReward(id: string): Promise<{ reward: Reward }> {
  return api.post(`/rewards/${id}/cancel`)
}
