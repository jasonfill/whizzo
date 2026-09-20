// Everything you know.
//
// One box, one prompt, and the whole set graded against what comes out of it.
// This is the strongest retrieval format there is, and most flashcard apps
// cannot offer it — it only works because we hold a *closed* answer key, so
// what a learner writes can actually be checked rather than admired.
//
// Two things are deliberate. Writing something that matches nothing is
// reported and never counted against them, because guessing widely should not
// be expensive. And the cards they did not write down are real misses that go
// straight back into the schedule — not remembering something is exactly the
// signal the review queue exists to catch.

import { useMemo, useState } from 'react'
import { gradeRecall, type RecallResult } from '@whizzo/shared'
import ReadAloud from '../../components/speech/ReadAloud'
import { Button, Card, Pill } from '../../components/ui'
import { gradeWritten } from '../../lib/quiz/questions'
import type { PlannedCard } from '../../lib/quiz/session'

export default function RecallRound({
  plan,
  deckTitle,
  onFinish,
}: {
  plan: PlannedCard[]
  deckTitle: string
  onFinish: (result: RecallResult) => void
}) {
  const [written, setWritten] = useState('')
  const [result, setResult] = useState<RecallResult | null>(null)
  const cards = useMemo(() => plan.map((p) => p.card), [plan])

  const check = () => {
    const graded = gradeRecall(written, cards, gradeWritten)
    setResult(graded)
  }

  if (result) {
    const got = result.matched.length
    return (
      <div>
        <Card className="mb-4">
          <p className="text-2xl font-extrabold text-ink">
            {got} of {cards.length} from memory
          </p>
          <p className="mt-1 text-sm font-bold text-stone">
            The ones you did not write down come back soon — that is the whole point of
            noticing them.
          </p>
        </Card>

        {result.matched.length > 0 && (
          <Card className="mb-4">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">
              You had these
            </p>
            <div className="flex flex-wrap gap-2">
              {result.matched.map((m) => (
                <Pill key={m.card.id} className="bg-emerald-100 text-emerald-800">
                  <ReadAloud source={m.card.definition} label="Read this out loud" />
                  {!m.exact && ' (close)'}
                </Pill>
              ))}
            </div>
          </Card>
        )}

        {result.missed.length > 0 && (
          <Card className="mb-4">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">
              Not this time
            </p>
            <div className="flex flex-wrap gap-2">
              {result.missed.map((card) => (
                <Pill key={card.id} className="bg-wash text-body">
                  {/* The ones they did not remember are exactly the ones worth
                      hearing said properly before they meet them again. */}
                  <ReadAloud source={card.definition} label="Read this out loud" />
                </Pill>
              ))}
            </div>
          </Card>
        )}

        {result.unmatched.length > 0 && (
          <Card className="mb-4">
            {/* Reported, never counted against them: writing a wrong answer is
                not the same as failing a card, and treating it as one would
                make thinking out loud expensive. */}
            <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-stone">
              These were not on the list
            </p>
            <p className="text-sm font-bold text-muted">{result.unmatched.join(', ')}</p>
          </Card>
        )}

        <Button onClick={() => onFinish(result)}>Done</Button>
      </div>
    )
  }

  return (
    <div>
      <Card className="mb-4">
        <p className="mb-1 text-xl font-extrabold text-ink">
          Write down everything you remember from {deckTitle}.
        </p>
        <p className="text-sm font-bold text-stone">
          One per line, or separated by commas. Order does not matter, and getting one wrong
          costs you nothing.
        </p>
      </Card>

      <textarea
        value={written}
        onChange={(e) => setWritten(e.target.value)}
        rows={10}
        aria-label="Everything you remember"
        placeholder={'photosynthesis\nmitochondrion\n…'}
        className="mb-3 w-full rounded-2xl border-2 border-edge px-4 py-3 text-lg font-bold text-ink focus:border-ink focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={check} disabled={!written.trim()}>
          Check what I got
        </Button>
        <span className="text-sm font-bold text-stone">
          {cards.length} to remember
        </span>
      </div>
    </div>
  )
}
