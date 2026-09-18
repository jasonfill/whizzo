// Promising something.
//
// The form is short on purpose: a title, what has to happen, and how much of
// it. Everything else — when it is earned, whether the evidence is good enough,
// whether it can be earned at all — is decided by the app, because those are
// the parts a parent should not have to think about and the parts that must not
// be negotiable.

import { useState } from 'react'
import {
  CRITERION_LABEL,
  OFFERABLE_CRITERIA,
  SUGGESTED_CRITERION,
  type RewardCriterionType,
  type QuizDeck,
} from '@whizzo/shared'
import { Button, Card } from '../ui'
import { offerReward } from '../../lib/rewards/api'

/** Criteria that need a set to point at. */
const NEEDS_SET: RewardCriterionType[] = ['set_mastered', 'checkpoint']

/** What "how much" means for each, and a sensible starting number. */
const AMOUNT: Partial<Record<RewardCriterionType, { label: string; value: number }>> = {
  mastery_count: { label: 'How many cards', value: 25 },
  streak: { label: 'How many days running', value: 7 },
  verified_items: { label: 'How many right answers', value: 100 },
}

export default function OfferReward({
  learnerId,
  learnerName,
  decks,
  onDone,
  onCancel,
}: {
  learnerId: string
  learnerName: string
  /** The learner's decks. The ones they made themselves are filtered out here. */
  decks: QuizDeck[]
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  // Decks the learner made themselves are not offered: three cards of
  // "cat / cat" would be ninety seconds of work and an ice cream. The API
  // refuses them too; filtering here means the form never starts on one.
  const offerable = decks.filter((deck) => deck.source !== 'user')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<RewardCriterionType>(SUGGESTED_CRITERION)
  const [targetId, setTargetId] = useState(offerable[0]?.id ?? '')
  const [amount, setAmount] = useState<number>(AMOUNT[SUGGESTED_CRITERION]?.value ?? 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsSet = NEEDS_SET.includes(type)
  const amountFor = AMOUNT[type]

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await offerReward({
        learnerId,
        title: title.trim(),
        criterion: {
          type,
          targetId: needsSet ? targetId : null,
          // A set is a share of it; everything else is a count.
          threshold: needsSet ? 0.9 : amount,
        },
      })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    } finally {
      setSaving(false)
    }
  }

  const blocked = !title.trim() || (needsSet && !targetId)

  return (
    <Card className="mb-4">
      <h3 className="mb-1 font-extrabold text-ink">Promise {learnerName} something</h3>
      <p className="mb-3 text-sm font-bold text-stone">
        You will be told when it is earned. It only counts work the app checked — never{' '}
        {learnerName} saying they did it.
      </p>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          What they get
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ice cream"
          maxLength={80}
          className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        />
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          For what
        </span>
        <select
          value={type}
          onChange={(e) => {
            const next = e.target.value as RewardCriterionType
            setType(next)
            setAmount(AMOUNT[next]?.value ?? 1)
          }}
          className="w-full rounded-2xl border-2 border-edge bg-white px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        >
          {/* Minutes are not offered (time is an input, not an outcome) and
              neither is a checkpoint (nothing awards one yet). The shared list
              is the one place that decides. */}
          {OFFERABLE_CRITERIA.map((t) => (
            <option key={t} value={t}>
              {CRITERION_LABEL[t]}
            </option>
          ))}
        </select>
        {type === SUGGESTED_CRITERION && (
          <span className="mt-1 block text-xs font-bold text-stone">
            A good one to pick: every card in the deck, checked by the app.
          </span>
        )}
      </label>

      {needsSet && (
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            Which deck
          </span>
          {offerable.length ? (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-2xl border-2 border-edge bg-white px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
            >
              {offerable.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.title}
                </option>
              ))}
            </select>
          ) : (
            // Only decks a grown-up set (or a starter deck) can carry a
            // reward — see `offerable` above for why the learner's own are out.
            <p className="font-bold text-stone">
              Set a deck from your library as a task first, then promise something for it.
            </p>
          )}
        </label>
      )}

      {amountFor && (
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            {amountFor.label}
          </span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
            className="w-32 rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
          />
        </label>
      )}

      {error && <p className="mb-2 font-bold text-rose-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={blocked || saving}>
          {saving ? 'Saving…' : 'Promise it'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}
