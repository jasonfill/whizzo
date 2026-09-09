// What was promised, what is owed, and what has been handed over.
//
// A ledger rather than a feed, and owed comes first because it is the only part
// that is an action list. Everything else is bookkeeping around the one
// interaction this feature exists for: one tap to say the ice cream happened.

import { useCallback, useEffect, useState } from 'react'
import {
  canCancel,
  canFulfill,
  CRITERION_LABEL,
  ledger,
  needsChasing,
  type Reward,
} from '@whizzo/shared'
import { Button, Card, Pill } from '../ui'
import { cancelReward, fulfillReward, rewardsFor } from '../../lib/rewards/api'
import OfferReward from './OfferReward'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { allDecks } from '../../lib/quiz/decks'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'

export default function RewardLedger({
  learnerId,
  learnerName,
  userId,
  ownsLearner,
}: {
  learnerId: string
  learnerName: string
  userId: string
  ownsLearner: boolean
}) {
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [offering, setOffering] = useState(false)
  const { snapshot } = useProgress()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const { rewards: next } = await rewardsFor(learnerId, signal)
      setRewards(next)
    } catch {
      setRewards([])
    }
  }, [learnerId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const settle = async (reward: Reward) => {
    setBusy(reward.id)
    setError(null)
    try {
      await fulfillReward(reward.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    } finally {
      setBusy(null)
    }
  }

  const withdraw = async (reward: Reward) => {
    setBusy(reward.id)
    setError(null)
    try {
      await cancelReward(reward.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    } finally {
      setBusy(null)
    }
  }

  if (!rewards) return null

  if (offering) {
    return (
      <OfferReward
        learnerId={learnerId}
        learnerName={learnerName}
        decks={allDecks(snapshot, STARTER_DECKS)}
        onDone={async () => {
          setOffering(false)
          await load()
        }}
        onCancel={() => setOffering(false)}
      />
    )
  }

  if (!rewards.length) {
    return (
      <Card className="mb-4">
        <h3 className="mb-1 font-extrabold text-ink">Rewards</h3>
        <p className="mb-3 text-sm font-bold text-stone">
          Nothing promised yet. A reward is earned from work the app checked — never from
          {' '}{learnerName} saying they did it.
        </p>
        <Button onClick={() => setOffering(true)}>🎁 Promise something</Button>
      </Card>
    )
  }

  const books = ledger(rewards)

  return (
    <Card className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold text-ink">Rewards</h3>
        <Button variant="ghost" onClick={() => setOffering(true)}>
          🎁 Promise something
        </Button>
      </div>

      {/* Owed first. An earned, unfulfilled reward is worse than no reward at
          all, because it teaches a child that the system's word is not good —
          so it is the top of the list and the only thing chased. */}
      {books.unpaid.length > 0 && (
        <section className="mb-4">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">
            Earned — not yet given
          </p>
          <ul className="flex flex-col gap-2">
            {books.unpaid.map((reward) => (
              <li
                key={reward.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200"
              >
                <div>
                  <p className="font-extrabold text-ink">{reward.title}</p>
                  <p className="text-xs font-bold text-stone">
                    {CRITERION_LABEL[reward.criterion.type]}
                    {needsChasing(reward) && ' · waiting on you'}
                  </p>
                </div>
                {canFulfill(reward, userId) ? (
                  <Button onClick={() => settle(reward)} disabled={busy === reward.id}>
                    ✅ Given
                  </Button>
                ) : (
                  // Only whoever promised it can settle it: a tutor cannot know
                  // whether a parent bought the ice cream.
                  <Pill className="bg-white text-xs text-muted">whoever promised it settles it</Pill>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {books.promised.length > 0 && (
        <section className="mb-4">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">
            Working toward
          </p>
          <ul className="flex flex-col gap-2">
            {books.promised.map((reward) => (
              <li
                key={reward.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-quiet px-4 py-3"
              >
                <div>
                  <p className="font-extrabold text-ink">{reward.title}</p>
                  <p className="text-xs font-bold text-stone">
                    {CRITERION_LABEL[reward.criterion.type]}
                  </p>
                </div>
                {canCancel(reward, userId, ownsLearner) && (
                  <Button
                    variant="ghost"
                    onClick={() => withdraw(reward)}
                    disabled={busy === reward.id}
                  >
                    Take it back
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {books.paid.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">Given</p>
          <ul className="flex flex-col gap-1">
            {books.paid.slice(0, 5).map((reward) => (
              <li key={reward.id} className="text-sm font-bold text-muted">
                {reward.title}
                {reward.fulfilledAt && ` · ${new Date(reward.fulfilledAt).toLocaleDateString()}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="mt-2 font-bold text-rose-600">{error}</p>}
    </Card>
  )
}
