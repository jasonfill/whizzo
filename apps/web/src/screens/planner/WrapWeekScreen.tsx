// Wrap up the week: facts, wins, next week's goals, one reflection.
//
// The facts have no adjectives. The wins are seeded from evidence — a chip the
// learner keeps carries its evidence and a verified mark — and anything they
// write themselves sits beside it in their own words. The goals become next
// week's priority candidates, so the loop closes without anybody retyping.

import { useEffect, useMemo, useState } from 'react'
import {
  bestStreakFrom,
  reflectionPrompt,
  suggestWins,
  type WeekGoal,
  type WeekWin,
} from '@whizzo/shared'
import { CoursePicker } from '../../components/planner/CourseChip'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill } from '../../components/ui'
import { usePlannerWeek } from '../../hooks/usePlannerWeek'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { useProgress } from '../../lib/progress/ProgressProvider'
import type { Navigate } from '../../routes'

type Step = 0 | 1 | 2 | 3

export default function WrapWeekScreen({ navigate }: { navigate: Navigate }) {
  const { active } = useLearners()
  const { snapshot } = useProgress()
  const planner = usePlannerWeek(undefined, { announce: true })
  const { data, today } = planner
  const [step, setStep] = useState<Step>(0)
  const [wins, setWins] = useState<WeekWin[]>([])
  const [ownWin, setOwnWin] = useState('')
  const [goals, setGoals] = useState<WeekGoal[]>([])
  const [goal, setGoal] = useState('')
  const [goalCourse, setGoalCourse] = useState<string | null>(null)
  const [reflection, setReflection] = useState('')

  useEffect(() => {
    if (!data) return
    if (wins.length === 0 && data.week.wins.length) setWins(data.week.wins)
    if (goals.length === 0 && data.week.goals.length) setGoals(data.week.goals)
    if (!reflection && data.week.reflection) setReflection(data.week.reflection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.week.weekStart])

  const facts = useMemo(() => {
    if (!data) return null
    const items = data.items
    const tasks = items.filter((i) => i.kind === 'task')
    const sessions = items.filter((i) => i.kind === 'study')
    return {
      tasksDone: tasks.filter((i) => i.status === 'done').length,
      tasksTotal: tasks.length,
      letGo: tasks.filter((i) => i.status === 'skipped').length,
      sessionsDone: sessions.filter((i) => i.status === 'done').length,
      sessionsTotal: sessions.filter((i) => i.status !== 'skipped').length,
      sessionsSkipped: sessions.filter((i) => i.status === 'skipped').length,
      verified: sessions.filter((i) => i.status === 'done' && i.sessionId).length,
      tickedByGrownUp: items.filter((i) => i.status === 'done' && i.doneBy && i.doneBy !== active?.authUserId && active?.authUserId).length,
      assignmentsDone: data.assignments.filter((a) => a.status === 'done').length,
      assessments: data.assessments.filter((a) => a.on >= data.week.weekStart && a.on <= today),
    }
  }, [data, today, active?.authUserId])

  const suggested = useMemo<WeekWin[]>(() => {
    if (!data || !facts) return []
    const weekStartMs = Date.parse(`${data.week.weekStart}T00:00:00`)
    const masteredThisWeek = Object.values(snapshot.mastery).filter(
      (m) => m.mastery >= 0.8 && m.correctStreak >= 2 && m.lastSeenAt >= weekStartMs,
    ).length
    const verifiedCorrectThisWeek = snapshot.sessions
      .filter((s) => s.endedAt >= weekStartMs)
      .reduce((n, s) => n + (s.verifiedItemsCorrect ?? 0), 0)
    // A check is a graded test round the app checked, not a Learn round that
    // happened to go well.
    const masteryChecksPassed = snapshot.sessions.filter(
      (s) =>
        s.endedAt >= weekStartMs &&
        s.activity === 'test' &&
        s.accuracy >= 90 &&
        (s.verifiedItemsTotal ?? 0) > 0,
    ).length
    return suggestWins({
      verifiedCorrectThisWeek,
      masteredThisWeek,
      streakDays: bestStreakFrom(snapshot.skills),
      masteryChecksPassed,
      levelUps: [],
      assignmentsDone: facts.assignmentsDone,
      studySessionsDone: facts.verified,
      assessmentsRecorded: facts.assessments
        .filter((a) => a.outcome)
        .map((a) => ({ title: a.title, feltLike: a.outcome!.feltLike })),
    })
  }, [data, facts, snapshot])

  const toggleWin = (w: WeekWin) =>
    setWins((cur) => (cur.some((x) => x.text === w.text) ? cur.filter((x) => x.text !== w.text) : [...cur, w]))

  const finish = async () => {
    await planner.saveWeek({ wins, goals, reflection: reflection.trim() || null, wrapped: true })
    navigate({ name: 'planner' })
  }

  if (!active || !data || !facts) {
    return (
      <div className="mx-auto w-full max-w-2xl py-4">
        <ScreenHeader title="Wrap up the week" onBack={() => navigate({ name: 'planner' })} />
        <p className="font-bold text-muted">{planner.loading ? 'Loading…' : 'Sign in with a learner first.'}</p>
      </div>
    )
  }

  const prompt = reflectionPrompt(data.band, data.week.weekStart)

  return (
    // Somebody else's edit to the week waits while a field here has focus.
    <div className="mx-auto w-full max-w-2xl py-4" data-live-key="week">
      <ScreenHeader title="Wrap up the week" subtitle={`Step ${step + 1} of 4`} onBack={() => navigate({ name: 'planner' })} backLabel="Later" />
      <div className="mb-4 flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-tray'}`} />
        ))}
      </div>

      {step === 0 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">How it went</h2>
          <p className="mb-4 font-bold text-muted">Facts. No adjectives.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Tasks done" value={`${facts.tasksDone} of ${facts.tasksTotal}`} />
            <Fact label="Study sessions" value={`${facts.sessionsDone} of ${facts.sessionsTotal}`} note={facts.verified ? `${facts.verified} checked by the app` : undefined} />
            <Fact label="Let go" value={String(facts.letGo)} />
            <Fact label="Skipped sessions" value={String(facts.sessionsSkipped)} />
            <Fact label="Set by a grown-up, done" value={String(facts.assignmentsDone)} />
            {facts.tickedByGrownUp > 0 && <Fact label="Ticked by a grown-up" value={String(facts.tickedByGrownUp)} />}
          </div>
          {facts.assessments.length > 0 && (
            <ul className="mt-4 space-y-1">
              {facts.assessments.map((a) => (
                <li key={a.id} className="text-[15px] font-extrabold text-ink">
                  📝 {a.title}{' '}
                  <span className="text-sm font-bold text-muted">
                    {a.outcome ? `felt ${['', 'easy', 'unsure', 'hard'][a.outcome.feltLike]}${a.outcome.score ? ` · ${a.outcome.score}` : ''}` : 'not recorded yet'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Wins</h2>
          <p className="mb-4 font-bold text-muted">The app can vouch for some. Write the rest in your own words.</p>
          {suggested.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {suggested.map((w) => {
                const on = wins.some((x) => x.text === w.text)
                return (
                  <button
                    key={w.text}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWin(w)}
                    className={`rounded-full px-3 py-1.5 text-sm font-extrabold ${on ? 'bg-pine text-white' : 'bg-white text-ink ring-1 ring-edge'}`}
                  >
                    {w.kind === 'verified' ? '✓ ' : ''}
                    {w.text}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={ownWin}
              onChange={(e) => setOwnWin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ownWin.trim()) {
                  toggleWin({ text: ownWin.trim(), kind: 'own' })
                  setOwnWin('')
                }
              }}
              placeholder="Something you're proud of"
              aria-label="Write a win"
              className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink focus:border-ink focus:outline-none"
            />
            <Button
              variant="ghost"
              disabled={!ownWin.trim()}
              onClick={() => {
                toggleWin({ text: ownWin.trim(), kind: 'own' })
                setOwnWin('')
              }}
            >
              Add
            </Button>
          </div>
          <ul className="mt-4 space-y-1">
            {wins.map((w) => (
              <li key={w.text} className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
                {w.kind === 'verified' ? <Pill className="bg-pine text-white">✓ verified</Pill> : <Pill className="bg-wash text-muted">own words</Pill>}
                {w.text}
                <button type="button" className="text-xs font-bold text-muted underline" onClick={() => toggleWin(w)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Next week&apos;s goals</h2>
          <p className="mb-4 font-bold text-muted">Two or three. They&apos;ll be waiting when you plan next week.</p>
          <div className="flex gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && goal.trim() && goals.length < 5) {
                  setGoals((g) => [...g, { text: goal.trim(), courseId: goalCourse }])
                  setGoal('')
                }
              }}
              placeholder="Start the essay before Thursday"
              aria-label="Write a goal"
              disabled={goals.length >= 5}
              className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink focus:border-ink focus:outline-none"
            />
            <Button
              variant="ghost"
              disabled={!goal.trim() || goals.length >= 5}
              onClick={() => {
                setGoals((g) => [...g, { text: goal.trim(), courseId: goalCourse }])
                setGoal('')
              }}
            >
              Add
            </Button>
          </div>
          {data.courses.length > 0 && (
            <div className="mt-2">
              <CoursePicker courses={data.courses} value={goalCourse} onChange={setGoalCourse} />
            </div>
          )}
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-[15px] font-extrabold text-ink">
            {goals.map((g, i) => (
              <li key={i}>
                {g.text}{' '}
                <button type="button" className="text-xs font-bold text-muted underline" onClick={() => setGoals((cur) => cur.filter((_, j) => j !== i))}>
                  remove
                </button>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">{prompt}</h2>
          <p className="mb-4 font-bold text-muted">A sentence is plenty. Skipping is fine too.</p>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            rows={3}
            aria-label="Reflection"
            className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-[15px] font-bold text-ink focus:border-ink focus:outline-none"
          />
        </Card>
      )}

      <div className="mt-4 flex justify-between">
        <Button variant="ghost" onClick={() => (step === 0 ? navigate({ name: 'planner' }) : setStep((s) => (s - 1) as Step))}>
          {step === 0 ? 'Later' : '← Back'}
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => (s + 1) as Step)}>Next →</Button>
        ) : (
          <Button onClick={finish}>Finish the week</Button>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-wash p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-stone">{label}</div>
      <div className="font-display text-2xl font-extrabold text-ink">{value}</div>
      {note && <div className="text-[11px] font-bold text-pine">{note}</div>}
    </div>
  )
}
