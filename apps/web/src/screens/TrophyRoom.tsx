import { useState } from 'react'
import type { GameApi } from '../hooks/useGameState'
import { ACHIEVEMENTS } from '../data/achievements'
import { QUIZ_ACHIEVEMENTS } from '../data/quizAchievements'
import { SPELLING_ACHIEVEMENTS } from '../data/spellingAchievements'
import { useProgress } from '../lib/progress/ProgressProvider'
import { Card } from '../components/ui'
import ScreenHeader from '../components/suite/ScreenHeader'
import type { Route } from '../App'
import { useTheme } from '../lib/theme/ThemeProvider'
import { earnedFor } from '../lib/theme/rewards'

interface Props {
  game: GameApi
  navigate: (r: Route) => void
}

type Tab = 'scores' | 'badges'

/**
 * Badges and high scores. The theme's collectibles are not here: they have
 * their own screen, and this one links to it rather than keeping a second,
 * different count of the same thing (docs/ux-coherence.md, "One collectible
 * system").
 */
export default function TrophyRoom({ game, navigate }: Props) {
  const { theme } = useTheme()
  const [tab, setTab] = useState<Tab>('scores')
  // High scores and typing badges come through the game state, which reads
  // the same snapshot; the spelling and flashcard badges are read here. All
  // of it follows the account — nothing on this screen is this browser's own.
  const { state } = game
  const { snapshot } = useProgress()
  const unlockedIds = new Set(snapshot.achievements.map((a) => a.achievementId))
  const earned = earnedFor(snapshot, theme)

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader title="Badges 🏅" back={{ name: 'home' }} />

      {/* The collection is one tap away, with the same count home shows. */}
      <button
        type="button"
        onClick={() => navigate({ name: 'world' })}
        className="mb-4 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left ring-1 ring-hair transition-transform hover:-translate-y-px"
        style={{ background: theme.tintA }}
      >
        <span>
          <span className="block font-extrabold text-ink">See your {theme.worldNoun} →</span>
          <span className="block text-sm font-bold text-muted">
            {earned.owned} of {earned.total} {theme.unit}
          </span>
        </span>
      </button>

      <div className="mb-4 flex gap-2">
        <TabButton active={tab === 'scores'} onClick={() => setTab('scores')}>
          🥇 High scores
        </TabButton>
        <TabButton active={tab === 'badges'} onClick={() => setTab('badges')}>
          🎖️ Badges
        </TabButton>
      </div>

      {tab === 'scores' && (
        <Card>
          {state.highScores.length === 0 ? (
            <Empty text="No scores yet — play Word Rain or Practice to set a record!" />
          ) : (
            // The board is the learner's own, so no name column: every row is
            // theirs.
            <ol className="divide-y divide-hair">
              {state.highScores.map((h, i) => (
                <li key={`${h.date}-${i}`} className="flex items-center gap-3 py-2">
                  <span className="w-8 text-center text-xl font-extrabold text-stone">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-bold text-ink">
                    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-bold text-ink">
                      {h.mode}
                    </span>
                  </span>
                  {h.wpm > 0 && <span className="text-sm text-body">{h.wpm} wpm</span>}
                  <span className="text-sm text-pine">{h.accuracy}%</span>
                  <span className="w-20 text-right text-lg font-extrabold text-ink">
                    {h.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'badges' && (
        <div className="space-y-5">
          <BadgeGrid
            title="Typing ⌨️"
            badges={ACHIEVEMENTS}
            unlocked={(id) => state.achievements.includes(id)}
          />
          <BadgeGrid
            title="Spelling 🔤"
            badges={SPELLING_ACHIEVEMENTS}
            unlocked={(id) => unlockedIds.has(id)}
          />
          <BadgeGrid
            title="Flashcards 🃏"
            badges={QUIZ_ACHIEVEMENTS}
            unlocked={(id) => unlockedIds.has(id)}
          />
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 font-bold transition-all ${
        active ? 'bg-accent text-white shadow' : 'bg-white text-muted ring-1 ring-hair'
      }`}
    >
      {children}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center font-bold text-stone">{text}</p>
}

function BadgeGrid({
  title,
  badges,
  unlocked,
}: {
  title: string
  badges: Array<{ id: string; name: string; emoji: string; description: string }>
  unlocked: (id: string) => boolean
}) {
  const earned = badges.filter((b) => unlocked(b.id)).length
  return (
    <div>
      <h2 className="mb-2 flex items-baseline gap-2 text-xl font-extrabold text-ink">
        {title}
        <span className="text-sm font-bold text-stone">
          {earned}/{badges.length}
        </span>
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {badges.map((a) => {
          const got = unlocked(a.id)
          return (
            <div
              key={a.id}
              className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${
                got ? 'bg-white ring-edge' : 'bg-wash opacity-70 ring-edge'
              }`}
            >
              <span className={`text-3xl ${got ? '' : 'grayscale'}`}>{a.emoji}</span>
              <div>
                <div className="font-extrabold text-ink">{got ? a.name : '???'}</div>
                <div className="text-sm text-muted">{a.description}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
