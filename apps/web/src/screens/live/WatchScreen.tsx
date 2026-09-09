// Following a learner's round from another screen.
//
// This is a mirror, not a dashboard: the same card, the same position, no
// navigation of its own. The point is two people working through one set
// without huddling round a single screen — so what belongs here is whatever
// makes it possible to talk about the card, and nothing that makes it possible
// to grade the person.
//
// It follows the *learner*, not a round: they finish flashcards and start
// multiple choice, and this comes along. Re-joining to keep up would rather
// defeat the object.

import { useCallback, useState } from 'react'
import type {
  LiveEvent,
  RoundBeginPayload,
  RoundDraftPayload,
  RoundEndPayload,
  RoundTickPayload,
} from '@whizzo/shared'
import { useLiveLearner } from '../../hooks/useLiveChannel'
import { useLearners } from '../../lib/learners/LearnerProvider'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import type { Route } from '../../routes'

interface Props {
  learnerId: string
  navigate: (route: Route) => void
}

interface Watching {
  round: RoundBeginPayload | null
  card: RoundTickPayload | null
  draft: string
  answered: RoundTickPayload[]
  ended: RoundEndPayload | null
}

const NOTHING: Watching = { round: null, card: null, draft: '', answered: [], ended: null }

export default function WatchScreen({ learnerId, navigate }: Props) {
  const { learners } = useLearners()
  const learner = learners.find((l) => l.id === learnerId) ?? null
  const [seen, setSeen] = useState<Watching>(NOTHING)

  const onEvent = useCallback((event: LiveEvent) => {
    switch (event.kind) {
      case 'round.begin':
        setSeen({ ...NOTHING, round: event.payload as RoundBeginPayload })
        break
      case 'round.tick': {
        const card = event.payload as RoundTickPayload
        setSeen((prev) => ({
          ...prev,
          card,
          // A new card, or this one resolved: either way what they had typed is
          // no longer what they are typing.
          draft: '',
          answered: card.outcome
            ? [...prev.answered.filter((a) => a.at !== card.at), card]
            : prev.answered,
        }))
        break
      }
      case 'round.draft': {
        const draft = event.payload as RoundDraftPayload
        setSeen((prev) => ({ ...prev, draft: draft.text }))
        break
      }
      case 'round.end':
        setSeen((prev) => ({
          ...prev,
          ended: event.payload as RoundEndPayload,
          card: null,
          draft: '',
        }))
        break
      default:
        break
    }
  }, [])

  // Announcing, always: this screen exists to be seen from the other end.
  const live = useLiveLearner(learnerId, { onEvent, announce: true })

  const name = learner?.displayName ?? 'Your learner'
  const right =
    live.status === 'open' ? null : (
      <span className="text-[12px] font-extrabold text-muted">Reconnecting…</span>
    )

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <ScreenHeader
        title={`Following ${name}`}
        subtitle={seen.round ? `${seen.round.title} · ${seen.round.activity}` : 'Nothing running'}
        onBack={() => navigate({ name: 'family' })}
        right={right}
      />

      {!seen.round && (
        <Card>
          <p className="font-bold text-muted">
            {name} is not practising right now. Leave this open — it fills in the moment they start.
          </p>
        </Card>
      )}

      {seen.round && !seen.ended && seen.card && (
        <Card>
          <div className="mb-2 flex items-center justify-between text-[12px] font-extrabold uppercase tracking-wide text-stone">
            <span>
              Card {seen.card.at} of {seen.card.cards}
            </span>
            <span>
              {seen.answered.filter((a) => a.outcome !== 'wrong').length} right of {seen.answered.length}
            </span>
          </div>

          <p className="mb-3 text-[22px] font-extrabold leading-tight text-ink">{seen.card.prompt}</p>

          {/* Sent when their typing pauses, never per keystroke — so this is
              what they have settled on, not a live transcription. */}
          {seen.draft && !seen.card.outcome && (
            <p className="mb-3 rounded-xl bg-wash p-3 font-bold text-ink">
              <span className="text-[11px] uppercase tracking-wide text-stone">Typing</span>
              <br />
              {seen.draft}
            </p>
          )}

          {seen.card.outcome && (
            <p
              className={`rounded-xl p-3 font-extrabold ${
                seen.card.outcome === 'wrong'
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {seen.card.outcome === 'right'
                ? 'Right'
                : seen.card.outcome === 'close'
                  ? 'Nearly'
                  : 'Missed'}
              {seen.card.answer ? ` — ${seen.card.answer}` : ''}
              {/* Flashcards is the one activity where the learner marks their
                  own work, and that is worth saying out loud: it is the
                  difference between getting it right and saying you did. */}
              {seen.card.selfGraded && (
                <span className="ml-1 font-bold opacity-70">(their own marking)</span>
              )}
            </p>
          )}
        </Card>
      )}

      {seen.ended && (
        <Card>
          <p className="text-[18px] font-extrabold text-ink">
            Round finished — {seen.ended.correct} of {seen.ended.cards}.
          </p>
          <p className="mt-1 font-bold text-muted">
            Stay here and this follows them into whatever they do next.
          </p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => navigate({ name: 'family' })}>
              Back to Family
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
