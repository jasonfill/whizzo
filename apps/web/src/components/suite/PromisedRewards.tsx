// What a grown-up has promised, as the learner sees it.
//
// Read-only on purpose. The ledger, the paying and the offering live in
// Family; this is the promise as it looks from the child's side of it — what
// they are working toward, and what has come due. The child is never nagged
// and never chases: when a reward is earned and not yet given, the app says so
// once, gently, and protects the promise on their behalf
// (docs/learning-activities-spec.md §11, "Where it lives").

import { useEffect, useState } from 'react'
import { CRITERION_LABEL, ledger, type Reward } from '@whizzo/shared'
import { Card } from '../ui'
import { rewardsFor } from '../../lib/rewards/api'

export default function PromisedRewards({ learnerId }: { learnerId: string }) {
  const [rewards, setRewards] = useState<Reward[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    rewardsFor(learnerId, controller.signal)
      .then(({ rewards: next }) => setRewards(next))
      // Nothing promised is the same as nothing to show. A failed load should
      // not put an error in front of a child on their own home screen.
      .catch(() => setRewards([]))
    return () => controller.abort()
  }, [learnerId])

  if (!rewards) return null
  const books = ledger(rewards)
  if (!books.unpaid.length && !books.promised.length) return null

  return (
    <Card className="mb-6">
      <h2 className="mb-3 text-xl font-extrabold text-ink">Rewards 🎁</h2>
      <ul className="flex flex-col gap-2">
        {books.unpaid.map((reward) => (
          <li
            key={reward.id}
            className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200"
          >
            <p className="font-extrabold text-ink">Earned! {reward.title}</p>
            <p className="text-sm font-bold text-stone">Ask a grown-up for it.</p>
          </li>
        ))}
        {books.promised.map((reward) => (
          <li key={reward.id} className="rounded-2xl bg-quiet px-4 py-3">
            <p className="font-extrabold text-ink">Working toward: {reward.title}</p>
            <p className="text-sm font-bold text-stone">{CRITERION_LABEL[reward.criterion.type]}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
