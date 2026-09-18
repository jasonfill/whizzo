import { useEffect } from 'react'
import type { RoundResult } from '../lib/stats'
import { feedbackLine } from '../lib/stats'
import { useBand } from '../lib/band/useBand'
import type { Achievement } from '../data/achievements'
import { randomTypingFact } from '../lib/facts'
import { sfx } from '../lib/sound'
import { Button, Card, StarRow } from './ui'
import Confetti from './Confetti'
import Collectible from './Collectible'
import { useTheme } from '../lib/theme/ThemeProvider'
import { useProgress } from '../lib/progress/ProgressProvider'
import { earnedFor } from '../lib/theme/rewards'

interface Props {
  result: RoundResult
  stars: number
  title: string
  newAchievements?: Achievement[]
  /**
   * Did this round earn one of the theme's collectibles? Decided upstream by
   * `earnsCollectible` on the recorded session — the same rule every other
   * results screen and the collection wall use.
   */
  earnedCollectible?: boolean
  soundOn: boolean
  onReplay: () => void
  onNext?: () => void
  onMenu: () => void
}

export default function ResultsCard({
  result,
  stars,
  title,
  newAchievements = [],
  earnedCollectible = false,
  soundOn,
  onReplay,
  onNext,
  onMenu,
}: Props) {
  const { band, celebrates } = useBand()
  const { theme } = useTheme()
  const { snapshot } = useProgress()
  // The round is already in the snapshot by the time this renders, so the
  // newest filled slot is this one — the same position the wall shows it in.
  const slot = Math.max(0, earnedFor(snapshot, theme).owned - 1)

  useEffect(() => {
    if (soundOn && stars >= 1) {
      const t = window.setTimeout(() => sfx.star(), 250)
      return () => window.clearTimeout(t)
    }
  }, [soundOn, stars])

  const fact = randomTypingFact()

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      {celebrates && stars >= 2 && <Confetti />}
      <Card className="text-center">
        <h2 className="text-3xl font-extrabold text-ink">{title} complete!</h2>
        <div className="my-4 flex justify-center">
          <StarRow stars={stars} size={52} />
        </div>
        <p className="mb-4 text-lg font-bold text-body">{feedbackLine(result.accuracy, band)}</p>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Score" value={result.score.toLocaleString()} color="text-ink" />
          <Stat label="WPM" value={String(result.wpm)} color="text-ink" />
          <Stat label="Accuracy" value={`${result.accuracy}%`} color="text-pine" />
          <Stat label="Best Combo" value={`x${result.maxCombo}`} color="text-accent" />
        </div>

        {earnedCollectible && (
          <div className="mt-5 rounded-2xl bg-tintA p-4">
            <p className="mb-2 font-extrabold text-ink">New {theme.unitOne}!</p>
            <Collectible slot={slot} className="mx-auto h-40 w-56" showLabel />
            <p className="mt-2 text-sm font-semibold text-body">{theme.because}</p>
          </div>
        )}

        {newAchievements.length > 0 && (
          <div className="mt-5 space-y-2">
            <p className="font-extrabold text-ink">
              {newAchievements.length === 1 ? 'New badge!' : 'New badges!'}
            </p>
            {newAchievements.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-center gap-2 rounded-2xl bg-quiet p-3 ring-2 ring-edge animate-pop"
              >
                <span className="text-2xl">{a.emoji}</span>
                <span className="font-extrabold text-ink">{a.name}</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-5 rounded-xl bg-quiet p-3 text-sm font-semibold text-body">
          ⌨️ Typing fact: {fact}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {onNext && (
            <Button variant="primary" onClick={onNext}>
              Next Lesson →
            </Button>
          )}
          <Button variant="secondary" onClick={onReplay}>
            Play Again
          </Button>
          <Button variant="ghost" onClick={onMenu}>
            Menu
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow ring-1 ring-hair">
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
      <div className="text-xs font-bold uppercase tracking-wide text-stone">{label}</div>
    </div>
  )
}
