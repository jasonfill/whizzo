import { GRADES } from '../../data/spelling'
import Mascot from '../../components/Mascot'
import MasteryBar from '../../components/suite/MasteryBar'
import ScreenHeader from '../../components/suite/ScreenHeader'
import VoicePicker from '../../components/suite/VoicePicker'
import { Button, Card, Pill } from '../../components/ui'
import { expectedCorrect } from '../../lib/adaptive'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { ACTIVITIES } from '../../lib/spelling/activities'
import { dueWords, levelSnapshot, troubleWords } from '../../lib/spelling/stats'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { levelNameFor } from '../../lib/themes'
import type { Navigate } from '../../routes'

export default function SpellingHome({ navigate }: { navigate: Navigate }) {
  const { theme } = useTheme()
  const { snapshot, skill } = useProgress()
  const state = skill('spelling')
  const level = levelSnapshot(snapshot, state.levelIndex)
  const due = dueWords(snapshot)
  const trouble = troubleWords(snapshot, 6)
  const needsPlacement = !state.placed

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ScreenHeader
        title="Spelling"
        subtitle="Words picked for you, based on how you actually did."
        back={{ name: 'home' }}
        backLabel="← Home"
      />

      {/* Current level */}
      <div className="mb-5 rounded-3xl bg-tintB p-1">
        <div className="rounded-[22px] bg-white/92 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{levelNameFor(theme, state.levelIndex, level.grade).emoji}</span>
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-stone">
                  Grade {level.grade} level
                </p>
                <h2 className="text-2xl font-extrabold text-ink">
                  {levelNameFor(theme, state.levelIndex, level.grade).name}
                </h2>
                <p className="font-bold text-muted">{level.blurb}</p>
              </div>
            </div>
            <Mascot mood={level.progress > 0.5 ? 'cheer' : 'idle'} size={72} />
          </div>

          <MasteryBar
            className="mt-4"
            total={level.breakdown.total}
            mastered={level.breakdown.mastered}
            practiced={level.breakdown.practiced}
            learning={level.breakdown.learning}
          />
        </div>
      </div>

      {/* The main call to action */}
      <Card className="mb-5">
        {needsPlacement ? (
          <>
            <h3 className="mb-1 text-xl font-extrabold text-ink">Let us find your level 🧭</h3>
            <p className="mb-4 font-bold text-muted">
              Twelve words, easy to hard. Spell what you can and skip what you cannot — this is not
              a test you can fail, it just tells us where to start you.
            </p>
            <Button
              className="w-full"
              onClick={() =>
                navigate({ name: 'spell-play', activity: 'listen-spell', mode: 'placement', size: 12 })
              }
            >
              🧭 Start the placement check
            </Button>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-extrabold text-ink">Smart Practice</h3>
              {due.length > 0 && (
                <Pill className="bg-sun/30 text-ink">🔁 {due.length} due for review</Pill>
              )}
              <Pill className="bg-wash text-ink">
                📈 Level {level.grade} · ability {state.ability.toFixed(1)}
              </Pill>
              {state.streakDays > 0 && (
                <Pill className="bg-orange-100 text-orange-600">🔥 {state.streakDays} day streak</Pill>
              )}
            </div>
            <p className="mb-4 font-bold text-muted">
              Ten words chosen from your own history: what you missed, what is due for review, and a
              couple that stretch you.
            </p>
            <Button
              className="w-full"
              onClick={() => navigate({ name: 'spell-play', activity: 'listen-spell', mode: 'adaptive' })}
            >
              🎧 Start Smart Practice
            </Button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                onClick={() => navigate({ name: 'spell-play', activity: 'test', mode: 'adaptive' })}
              >
                📝 Take a test
              </Button>
              <Button variant="ghost" onClick={() => navigate({ name: 'spell-lists' })}>
                📚 Browse word lists
              </Button>
            </div>
          </>
        )}
        <VoicePicker className="mt-4 border-t border-hair pt-4" />
      </Card>

      {/* Activities */}
      <h3 className="mb-2 text-xl font-extrabold text-ink">Practice a different way</h3>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACTIVITIES.filter((a) => a.id !== 'study').map((a) => (
          <button
            key={a.id}
            onClick={() => navigate({ name: 'spell-play', activity: a.id, mode: 'adaptive' })}
            className="flex items-start gap-3 rounded-2xl bg-white/85 p-4 text-left shadow ring-1 ring-hair transition-transform hover:-translate-y-0.5 hover:shadow-lg"
          >
            <span className="text-3xl">{a.emoji}</span>
            <span>
              <span className="block text-lg font-extrabold text-ink">{a.name}</span>
              <span className="block text-sm font-bold text-muted">{a.blurb}</span>
              {a.isTest && (
                <span className="mt-1 inline-block text-xs font-extrabold uppercase tracking-wide text-emerald-600">
                  Counts toward your level
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Words to work on */}
      {trouble.length > 0 && (
        <Card className="mb-5">
          <h3 className="mb-1 text-xl font-extrabold text-ink">Words to work on 🎯</h3>
          <p className="mb-3 text-sm font-bold text-muted">
            Straight from your attempt history — these are the ones tripping you up.
          </p>
          <div className="flex flex-wrap gap-2">
            {trouble.map((m) => (
              <span
                key={m.itemKey}
                className="rounded-xl bg-amber-50 px-3 py-1.5 font-mono text-sm font-bold text-amber-700"
                title={`${m.totalCorrect} of ${m.totalAttempts} correct`}
              >
                {m.itemKey}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Where this sits in the whole curriculum */}
      <Card>
        <h3 className="mb-3 text-xl font-extrabold text-ink">The whole climb 🪜</h3>
        <div className="space-y-2">
          {GRADES.map((g, i) => {
            const snap = levelSnapshot(snapshot, i)
            const reachable = i <= state.levelIndex
            const chance = expectedCorrect(state.ability, g.grade)
            return (
              <div key={g.grade} className="flex items-center gap-3">
                <span className="w-8 text-xl">{levelNameFor(theme, i, g.grade).emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-sm font-extrabold ${reachable ? 'text-ink' : 'text-stone'}`}
                    >
                      Grade {g.grade} · {levelNameFor(theme, i, g.grade).name}
                    </span>
                    <span className="shrink-0 text-xs font-bold text-stone">
                      {snap.breakdown.mastered}/{snap.breakdown.total} mastered
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-tray">
                    <div
                      className="h-full bg-pine transition-all"
                      style={{ width: `${snap.progress * 100}%` }}
                    />
                  </div>
                </div>
                <span
                  className="w-12 shrink-0 text-right text-xs font-bold text-stone"
                  title="Predicted chance you spell a word from this grade correctly"
                >
                  {Math.round(chance * 100)}%
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs font-bold text-stone">
          The percentage is what the app predicts you would score on a fresh word from that grade,
          based on every word you have spelled so far.
        </p>
      </Card>
    </div>
  )
}
