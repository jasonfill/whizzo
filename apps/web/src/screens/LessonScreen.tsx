import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameApi, LessonOutcome } from '../hooks/useGameState'
import { CURRICULUM, getLesson } from '../data/lessons'
import { generateLessonText } from '../lib/content'
import { useTheme } from '../lib/theme/ThemeProvider'
import { useLiveRound } from '../hooks/useLiveRound'
import { typingWorldFor } from '../lib/themes'
import type { RoundResult } from '../lib/stats'
import GamePlay from '../components/GamePlay'
import ResultsCard from '../components/ResultsCard'
import { Button, Card } from '../components/ui'
import type { Route } from '../App'

interface Props {
  game: GameApi
  lessonId: string
  navigate: (r: Route) => void
}

export default function LessonScreen({ game, lessonId, navigate }: Props) {
  const { theme } = useTheme()
  const lesson = getLesson(lessonId)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<LessonOutcome | null>(null)

  // Anybody following along. A lesson has no cards to mirror, so this is only
  // ever discovery: "Ada is doing a typing lesson", and how it ended.
  const live = useLiveRound()
  const roundIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!lesson) return
    const roundId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    roundIdRef.current = roundId
    live.begin({
      roundId,
      activity: 'lesson',
      subject: 'typing',
      title: lesson.title,
      cards: 0,
    })
    // Keyed on the attempt as well as the lesson: a replay is a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, attempt])

  // Regenerate text each attempt so replays feel fresh (attempt bumps the memo).
  const text = useMemo(() => {
    void attempt
    return lesson ? generateLessonText(lesson) : ''
  }, [lesson, attempt])

  if (!lesson) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="mb-4 font-bold">Hmm, that lesson wandered off. 🐈</p>
        <Button onClick={() => navigate({ name: 'map' })}>Back to Levels</Button>
      </Card>
    )
  }

  const handleFinish = (result: RoundResult) => {
    const o = game.recordLesson(lesson.id, result, lesson.catSeed)
    if (roundIdRef.current) {
      // A typing lesson is keystrokes rather than cards, so it reports its two
      // ends and nothing in between — enough for a grown-up to know it is
      // happening and see how it went, which is all there is to follow here.
      live.end({
        roundId: roundIdRef.current,
        cards: result.totalTyped,
        correct: result.correct,
      })
      roundIdRef.current = null
    }
    setOutcome(o)
  }

  const nextLesson = CURRICULUM[lesson.index + 1]

  if (outcome) {
    return (
      <div className="py-6">
        <ResultsCard
          result={outcome}
          stars={outcome.stars}
          title={lesson.title}
          newAchievements={outcome.newAchievements}
          collectedCat={outcome.collectedCat}
          soundOn={game.state.settings.sound}
          onReplay={() => {
            setOutcome(null)
            setAttempt((a) => a + 1)
          }}
          onNext={
            nextLesson
              ? () => {
                  setOutcome(null)
                  setAttempt(0)
                  navigate({ name: 'lesson', id: nextLesson.id })
                }
              : undefined
          }
          onMenu={() => navigate({ name: 'map' })}
        />
      </div>
    )
  }

  return (
    <div className="py-4">
      <GamePlay
        key={attempt}
        text={text}
        title={`${typingWorldFor(theme, lesson.worldIndex).emoji} ${lesson.title}`}
        subtitle={lesson.blurb}
        showKeyboard={game.state.settings.showKeyboard}
        showHands={game.state.settings.showHands}
        sound={game.state.settings.sound}
        onFinish={handleFinish}
        onQuit={() => navigate({ name: 'map' })}
      />
    </div>
  )
}
