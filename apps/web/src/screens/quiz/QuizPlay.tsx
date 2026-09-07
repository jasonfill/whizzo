import { useEffect, useMemo, useRef, useState } from 'react'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { useQuizSession, type QuizItemResult, type QuizSummary } from '../../hooks/useQuizSession'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { useBand } from '../../lib/band/useBand'
import { allDecks, findDeck } from '../../lib/quiz/decks'
import {
  DEFAULT_TEST_SIZE,
  MATCH_PAIRS,
  modeDef,
  type DirectionSetting,
  type StudyMode,
} from '../../lib/quiz/session'
import type { Navigate } from '../../routes'
import Flashcards from './Flashcards'
import RecallRound from './RecallRound'
import MatchGame from './MatchGame'
import QuestionRunner from './QuestionRunner'
import QuizResults from './QuizResults'

interface Props {
  mode: StudyMode
  deckId?: string
  size?: number
  direction?: DirectionSetting
  navigate: Navigate
}

/**
 * How long a round is when nobody asked for a particular length.
 *
 * A six-year-old's attention runs out well before a sixth-former's, so the
 * band shortens the round rather than the app picking one length and hoping.
 * This is stamina, not difficulty: the cards are chosen the same way and the
 * ladder counts the same evidence — there are simply fewer of them in one
 * sitting. A length in the URL still wins, because that was a deliberate ask.
 */
function defaultSize(mode: StudyMode, roundSize: number): number | undefined {
  if (mode === 'match') return MATCH_PAIRS
  // A check is a check: it stays long enough to mean something at every age.
  if (mode === 'test') return DEFAULT_TEST_SIZE
  if (mode === 'learn' || mode === 'choice' || mode === 'review') return roundSize
  return undefined // flashcards run the whole deck
}

export default function QuizPlay({ mode, deckId, size, direction, navigate }: Props) {
  const { snapshot } = useProgress()
  const { roundSize } = useBand()
  const session = useQuizSession()
  const [summary, setSummary] = useState<QuizSummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [round, setRound] = useState(0)

  const decks = useMemo(() => allDecks(snapshot, STARTER_DECKS), [snapshot])
  const deck = deckId ? findDeck(decks, deckId) : undefined

  // The plan is built from the snapshot as it was when the round began. Starting
  // it in an effect keyed only on the round number means a progress write
  // landing mid-round cannot reshuffle the cards under the learner.
  const { start } = session
  const startedRef = useRef(-1)
  useEffect(() => {
    if (startedRef.current === round) return
    startedRef.current = round
    start({
      mode,
      decks,
      deckId,
      size: size ?? defaultSize(mode, roundSize),
      direction,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const def = modeDef(mode)
  const title = mode === 'review' ? 'Review' : (deck?.title ?? 'Study')

  const complete = async (results: QuizItemResult[]) => {
    if (!results.length) {
      // Nothing was answered — a stopped Match game with no pairs found. There
      // is no progress to record, so bow out rather than write an empty round.
      navigate(deckId ? { name: 'quiz-deck', deckId } : { name: 'quiz' })
      return
    }
    setSaving(true)
    try {
      const durationMs = results.reduce((n, r) => n + (r.responseMs ?? 0), 0)
      const built = await session.finish(
        results,
        mode === 'match'
          ? {
              highScore: {
                subject: 'quiz',
                mode: 'quiz-match',
                score: Math.max(
                  50,
                  1200 - Math.round(durationMs / 100) - results.filter((r) => !r.correct).length * 60,
                ),
                wpm: null,
                accuracy: Math.round(
                  (results.filter((r) => r.correct).length / results.length) * 100,
                ),
              },
            }
          : undefined,
      )
      setSummary(built)
    } finally {
      setSaving(false)
    }
  }

  const goAgain = () => {
    setSummary(null)
    session.reset()
    setRound((r) => r + 1)
  }

  if (summary) {
    return (
      <QuizResults
        summary={summary}
        onAgain={goAgain}
        onDeck={() => navigate(deckId ? { name: 'quiz-deck', deckId } : { name: 'quiz' })}
        onHome={() => navigate({ name: 'quiz' })}
      />
    )
  }

  if (saving) {
    return (
      <div className="mx-auto w-full max-w-2xl py-10 text-center">
        <p className="text-lg font-bold text-muted">Saving your round…</p>
      </div>
    )
  }

  if (session.plan.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl py-4">
        <ScreenHeader
          title={`${def.emoji} ${def.name}`}
          onBack={() => navigate(deckId ? { name: 'quiz-deck', deckId } : { name: 'quiz' })}
        />
        <Card>
          <p className="mb-3 font-bold text-muted">
            {mode === 'review'
              ? 'Nothing is due for review right now. That is the system working — come back when a card is about to slip.'
              : 'There are no cards to study here yet.'}
          </p>
          <Button onClick={() => navigate({ name: 'quiz' })}>Back to decks</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <ScreenHeader
        title={`${def.emoji} ${title}`}
        subtitle={def.name}
        onBack={() => navigate(deckId ? { name: 'quiz-deck', deckId } : { name: 'quiz' })}
        backLabel="← Quit"
      />

      {mode === 'flashcards' && <Flashcards session={session} onFinish={complete} />}
      {/* Free recall does not walk a queue: the learner writes what they can
          and the whole set is graded against it in one go, so it takes the
          plan rather than the session. */}
      {mode === 'recall' && (
        <RecallRound
          plan={session.plan}
          deckTitle={title}
          onFinish={(result) => {
            void session.submitRecall(result)
            complete([])
          }}
        />
      )}
      {mode === 'match' && <MatchGame session={session} onFinish={complete} />}
      {(mode === 'learn' || mode === 'choice' || mode === 'test' || mode === 'review') && (
        <QuestionRunner session={session} strict={mode === 'test'} onFinish={complete} />
      )}
    </div>
  )
}
