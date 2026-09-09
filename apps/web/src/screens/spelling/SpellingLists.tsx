import { useState } from 'react'
import MasteryBar from '../../components/suite/MasteryBar'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill, StarRow } from '../../components/ui'
import { GRADES } from '../../data/spelling'
import { masteryBand } from '../../lib/adaptive'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { levelNameFor } from '../../lib/themes'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { ACTIVITIES } from '../../lib/spelling/activities'
import { listBreakdown } from '../../lib/spelling/stats'
import { listKey, masteryKey } from '../../lib/progress/types'
import type { Navigate } from '../../routes'

const BAND_STYLE: Record<string, string> = {
  mastered: 'bg-pine/10 text-pine',
  practiced: 'bg-pineSoft/30 text-pine',
  learning: 'bg-sun/30 text-ink',
  new: 'bg-wash text-stone',
}

export default function SpellingLists({ navigate }: { navigate: Navigate }) {
  const { theme } = useTheme()
  const { snapshot, skill } = useProgress()
  const state = skill('spelling')
  const [openGrade, setOpenGrade] = useState<number>(GRADES[state.levelIndex]?.grade ?? 2)
  const [openList, setOpenList] = useState<string | null>(null)

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ScreenHeader
        title="Word Lists 📚"
        subtitle="Pick any list to study — nothing here is locked."
        onBack={() => navigate({ name: 'spelling' })}
        right={
          <Button variant="secondary" onClick={() => navigate({ name: 'custom-lists' })}>
            ✏️ My lists
          </Button>
        }
      />

      <div className="space-y-4">
        {GRADES.map((g) => {
          const open = openGrade === g.grade
          return (
            <div key={g.grade} className="rounded-3xl bg-tintB p-1">
              <div className="rounded-[22px] bg-white/92">
                <button
                  onClick={() => setOpenGrade(open ? -1 : g.grade)}
                  className="flex w-full items-center gap-3 p-5 text-left"
                >
                  <span className="text-3xl">
                    {levelNameFor(theme, GRADES.indexOf(g), g.grade).emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl font-extrabold text-ink">
                      Grade {g.grade} · {levelNameFor(theme, GRADES.indexOf(g), g.grade).name}
                    </span>
                    <span className="block truncate font-bold text-muted">{g.blurb}</span>
                  </span>
                  {state.levelIndex === GRADES.indexOf(g) && (
                    <Pill className="bg-wash text-ink">You are here</Pill>
                  )}
                  <span className="text-2xl text-faint">{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div className="space-y-3 px-5 pb-5">
                    {g.lists.map((list) => {
                      const b = listBreakdown(snapshot, list.id)
                      const progress = snapshot.lists[listKey('spelling', list.id)]
                      const expanded = openList === list.id
                      return (
                        <div key={list.id} className="rounded-2xl bg-white p-4 ring-1 ring-hair">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-lg font-extrabold text-ink">{list.title}</h3>
                              <p className="text-sm font-bold text-muted">{list.focus}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {progress?.stars ? <StarRow stars={progress.stars} size={18} /> : null}
                              <button
                                onClick={() => setOpenList(expanded ? null : list.id)}
                                className="rounded-full bg-quiet px-3 py-1 text-xs font-extrabold text-ink"
                              >
                                {expanded ? 'Hide words' : `${b.total} words`}
                              </button>
                            </div>
                          </div>

                          <MasteryBar
                            className="mt-3"
                            total={b.total}
                            mastered={b.mastered}
                            practiced={b.practiced}
                            learning={b.learning}
                          />

                          {expanded && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {list.words.map((entry) => {
                                const band = masteryBand(
                                  snapshot.mastery[masteryKey('spelling', entry.w)],
                                )
                                return (
                                  <span
                                    key={entry.w}
                                    title={entry.s}
                                    className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold ${BAND_STYLE[band]}`}
                                  >
                                    {entry.w}
                                  </span>
                                )
                              })}
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap gap-2">
                            {ACTIVITIES.map((a) => (
                              <button
                                key={a.id}
                                onClick={() =>
                                  navigate({
                                    name: 'spell-play',
                                    activity: a.id,
                                    mode: 'list',
                                    listId: list.id,
                                  })
                                }
                                className="rounded-xl bg-quiet px-3 py-2 text-sm font-extrabold text-ink transition-colors hover:bg-wash"
                              >
                                {a.emoji} {a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {snapshot.customLists.length > 0 && (
        <Card className="mt-5">
          <h2 className="mb-3 text-xl font-extrabold text-ink">Your own lists ✏️</h2>
          <div className="space-y-2">
            {snapshot.customLists.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 ring-1 ring-hair"
              >
                <div>
                  <p className="font-extrabold text-ink">{l.title}</p>
                  <p className="text-sm font-bold text-stone">{l.words.length} words</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate({
                      name: 'spell-play',
                      activity: 'listen-spell',
                      mode: 'custom',
                      customListId: l.id,
                    })
                  }
                >
                  🎧 Practice
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
