import Mascot, { MASCOT_MUTED } from '../components/Mascot'
import ScreenHeader from '../components/suite/ScreenHeader'
import { Button, Card } from '../components/ui'
import { TOTAL_LESSONS } from '../data/lessons'
import type { GameApi } from '../hooks/useGameState'
import type { Navigate } from '../routes'
import { useProgress } from '../lib/progress/ProgressProvider'
import { useTheme } from '../lib/theme/ThemeProvider'
import { earnedFor } from '../lib/theme/rewards'
import { lessonsDone } from '../lib/typing/progress'

interface Props {
  game: GameApi
  navigate: Navigate
}

export default function TypingHome({ game, navigate }: Props) {
  const { theme } = useTheme()
  const { snapshot } = useProgress()
  const { state } = game

  const done = lessonsDone(state.lessons)
  // The same number as home, the collection screen and every results card.
  const collected = earnedFor(snapshot, theme).owned

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-4">
      <div className="w-full">
        <ScreenHeader
          title="Typing ⌨️"
          subtitle={`Learn to type and collect ${theme.unit}.`}
          back={{ name: 'home' }}
          backLabel="← Home"
        />
      </div>

      <div className="flex items-end gap-2">
        <Mascot mood="cheer" size={120} className="animate-floaty" />
        <Mascot mood="idle" color={MASCOT_MUTED} size={84} className="animate-floaty" />
      </div>

      <Card className="w-full max-w-md">
        <div className="grid grid-cols-1 gap-3">
          <Button onClick={() => navigate({ name: 'map' })}>🎓 Lessons</Button>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => navigate({ name: 'rain' })}>
              🌧️ Word Rain
            </Button>
            <Button variant="secondary" onClick={() => navigate({ name: 'practice' })}>
              ⌨️ Practice
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="ghost" onClick={() => navigate({ name: 'trophies' })}>
              🏅 Badges
            </Button>
            <Button variant="ghost" onClick={() => navigate({ name: 'settings' })}>
              ⚙️ Settings
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex gap-6 text-center">
        <Stat big={`${state.totalStars}`} label="⭐ Stars" />
        <Stat big={`${done}/${TOTAL_LESSONS}`} label="Lessons done" />
        <Stat big={`${collected}`} label={theme.unit} />
      </div>
    </div>
  )
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold text-ink">{big}</div>
      <div className="text-sm font-bold text-stone">{label}</div>
    </div>
  )
}
