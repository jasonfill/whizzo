import type { GameApi } from '../hooks/useGameState'
import { WORLDS, CURRICULUM } from '../data/lessons'
import { useTheme } from '../lib/theme/ThemeProvider'
import { typingWorldFor } from '../lib/themes'
import { StarRow } from '../components/ui'
import ScreenHeader from '../components/suite/ScreenHeader'
import Collectible from '../components/Collectible'
import type { Route } from '../App'

interface Props {
  game: GameApi
  navigate: (r: Route) => void
}

export default function WorldMap({ game, navigate }: Props) {
  const { theme } = useTheme()
  // Lesson progress follows the account, so this map is the same on every
  // device the learner signs in on.
  const { state } = game

  // A lesson is unlocked if it's the first, or the previous one has been
  // finished at least once. Stars are for pride, not for the door.
  const isUnlocked = (globalIndex: number): boolean => {
    if (globalIndex === 0) return true
    const prev = CURRICULUM[globalIndex - 1]
    return (state.lessons[prev.id]?.plays ?? 0) > 0
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ScreenHeader
        title="Typing lessons 🗺️"
        subtitle="One lesson at a time. Finish one to unlock the next."
        back={{ name: 'typing' }}
        backLabel="← Typing"
      />

      <div className="space-y-6">
        {WORLDS.map((world, wi) => (
          <div
            key={world.id}
            className="rounded-3xl bg-tintB p-1"
          >
            <div className="rounded-[22px] bg-white/90 p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-3xl">{typingWorldFor(theme, wi).emoji}</span>
                <div>
                  <h2 className="text-xl font-extrabold text-ink">{typingWorldFor(theme, wi).name}</h2>
                  <p className="text-sm text-muted">{world.blurb}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {world.lessons.map((lesson) => {
                  const c = CURRICULUM.find((x) => x.id === lesson.id)!
                  const unlocked = isUnlocked(c.index)
                  const progress = state.lessons[lesson.id]
                  return (
                    <button
                      key={lesson.id}
                      disabled={!unlocked}
                      onClick={() => navigate({ name: 'lesson', id: lesson.id })}
                      className={`group flex items-center gap-3 rounded-2xl p-3 text-left transition-all ${
                        unlocked
                          ? 'bg-white shadow ring-1 ring-hair hover:-translate-y-0.5 hover:shadow-md'
                          : 'cursor-not-allowed bg-wash opacity-70'
                      }`}
                    >
                      <div className="relative h-14 w-14 shrink-0">
                        {unlocked ? (
                          <Collectible seed={lesson.catSeed} className="h-14 w-14" rounded="rounded-xl" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-tray text-2xl">
                            🔒
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-extrabold text-ink">
                          {lesson.title}
                        </div>
                        <div className="truncate text-xs text-stone">{lesson.blurb}</div>
                        <div className="mt-1">
                          <StarRow stars={progress?.stars ?? 0} size={16} />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
