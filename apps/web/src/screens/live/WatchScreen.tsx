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

import { useCallback, useEffect, useState } from 'react'
import type {
  LiveEvent,
  RoundBeginPayload,
  RoundDraftPayload,
  RoundEndPayload,
  RoundTickPayload,
} from '@whizzo/shared'
import { api } from '../../lib/api/client'
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
  /**
   * The tally, as counts rather than a list of cards.
   *
   * Counts because they have to be seeded: somebody joining half way through
   * should see "6 right of 8", not "0 of 0" until the next answer. The server
   * keeps the running total for exactly this, and every answered card produces
   * one tick, so adding to it as they arrive stays in step.
   */
  answered: number
  correct: number
  ended: RoundEndPayload | null
}

const NOTHING: Watching = { round: null, card: null, draft: '', answered: 0, correct: 0, ended: null }

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
          answered: card.outcome ? prev.answered + 1 : prev.answered,
          correct: card.outcome && card.outcome !== 'wrong' ? prev.correct + 1 : prev.correct,
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

  /**
   * The round as it already stands, read on arrival.
   *
   * Without this, following somebody shows an empty screen until they happen to
   * move to the next card — which, on a deck they are thinking hard about, can
   * be a long time to look at nothing. The learner's client also re-sends the
   * current card as soon as this screen announces itself, so the two arrive
   * about together and whichever is newer wins.
   */
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const { round } = await api.get<{ round: (RoundBeginPayload & {
          card?: RoundTickPayload
          draft?: string
          answered?: number
          correct?: number
        }) | null }>(`/live/learners/${learnerId}/now`, controller.signal)
        if (controller.signal.aborted || !round) return
        setSeen((prev) =>
          // Anything that arrived on the channel while this was in flight is
          // newer than this snapshot by definition.
          prev.round
            ? prev
            : {
                round,
                card: round.card ?? null,
                draft: round.draft ?? '',
                answered: round.answered ?? 0,
                correct: round.correct ?? 0,
                ended: null,
              },
        )
      } catch {
        // Nothing running, or nothing readable. The channel will fill it in.
      }
    })()
    return () => controller.abort()
  }, [learnerId])

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

      {/* A round that reports no cards: a typing lesson is keystrokes, and match
          and free recall are judged as a whole rather than card by card. There
          is nothing to mirror, so say what is happening and leave it at that
          rather than showing an empty frame that looks broken. */}
      {seen.round && !seen.ended && !seen.card && (
        <Card>
          <p className="text-[18px] font-extrabold text-ink">
            {name} is working on {seen.round.title || seen.round.activity}.
          </p>
          <p className="mt-1 font-bold text-muted">
            {seen.round.cards > 0
              ? 'Waiting for the first card…'
              : 'This one is judged as a whole, so there are no cards to follow — you will see how it went when they finish.'}
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
              {seen.correct} right of {seen.answered}
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
