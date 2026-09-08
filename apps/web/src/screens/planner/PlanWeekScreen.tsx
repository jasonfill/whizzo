// Plan your week: five steps, each one screen, under five minutes.
//
// A learner who does nothing but tap through gets a real, sensible week. That
// is the bar. Everything the app can see is pulled in first; the learner adds
// what it cannot know, picks up to three priorities, accepts the study
// sessions, and is done.

import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  DAY_NAMES,
  daysBetween,
  daysOfWeek,
  defaultMinutes,
  isoWeekday,
  MAX_PRIORITIES,
  PURPOSE_COPY,
  weekStartOf,
  type Assessment,
  type ProposedSession,
  type QuickAdd as ParsedQuickAdd,
  type WeekPriority,
} from '@whizzo/shared'
import { CourseChip, CoursePicker } from '../../components/planner/CourseChip'
import PlannerCard from '../../components/planner/PlannerCard'
import QuickAdd from '../../components/planner/QuickAdd'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import { usePlannerWeek } from '../../hooks/usePlannerWeek'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { acceptSessions, loadWeek, proposeSessions } from '../../lib/planner/api'
import type { Navigate } from '../../routes'

type Step = 0 | 1 | 2 | 3 | 4

export default function PlanWeekScreen({ navigate }: { navigate: Navigate }) {
  const { active } = useLearners()
  const planner = usePlannerWeek(undefined, { announce: true })
  const { data, today, load, courseById } = planner
  const [step, setStep] = useState<Step>(0)
  const [lastGoals, setLastGoals] = useState<WeekPriority[]>([])
  const [priorities, setPriorities] = useState<WeekPriority[]>([])
  const [custom, setCustom] = useState('')
  const [customCourse, setCustomCourse] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Record<string, { sessions: ProposedSession[]; message: string | null; accepted: boolean }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const band = data?.band ?? 'growing'

  // Last week's goals seed this week's priorities.
  useEffect(() => {
    if (!planner.learnerId) return
    const controller = new AbortController()
    loadWeek(planner.learnerId, addDays(planner.weekStart, -7), today, controller.signal)
      .then((w) => setLastGoals(w.week.goals))
      .catch(() => setLastGoals([]))
    return () => controller.abort()
  }, [planner.learnerId, planner.weekStart])

  useEffect(() => {
    if (data && priorities.length === 0 && data.week.priorities.length) setPriorities(data.week.priorities)
  }, [data, priorities.length])

  const upcoming = useMemo(
    () =>
      (data?.assessments ?? []).filter(
        (a) => a.on >= today && daysBetween(today, a.on) <= 21 && a.kind !== 'project',
      ),
    [data?.assessments, today],
  )
  const dueAssignments = useMemo(() => (data?.assignments ?? []).filter((a) => a.status === 'open'), [data?.assignments])

  const candidates = useMemo<WeekPriority[]>(() => {
    const out: WeekPriority[] = []
    for (const a of upcoming.slice(0, 2)) out.push({ text: `Be ready for ${a.title}`, courseId: a.courseId })
    for (const a of dueAssignments.slice(0, 2)) out.push({ text: a.title, courseId: a.courseId ?? null })
    for (const g of lastGoals) out.push(g)
    const seen = new Set<string>()
    return out.filter((p) => (seen.has(p.text) ? false : (seen.add(p.text), true)))
  }, [upcoming, dueAssignments, lastGoals])

  const sessionsFor = (a: Assessment) => data?.sessionCounts?.[a.id]?.total ?? 0

  const propose = async (a: Assessment) => {
    setBusy(a.id)
    try {
      const r = await proposeSessions(a.id, today)
      setProposals((p) => ({ ...p, [a.id]: { sessions: r.sessions, message: r.message, accepted: false } }))
    } finally {
      setBusy(null)
    }
  }

  const accept = async (a: Assessment) => {
    const p = proposals[a.id]
    if (!p) return
    setBusy(a.id)
    try {
      await acceptSessions(a.id, p.sessions)
      setProposals((prev) => ({ ...prev, [a.id]: { ...p, accepted: true } }))
      await planner.refresh()
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    // Propose for every upcoming test with no sessions yet, as soon as the step opens.
    if (step !== 3) return
    for (const a of upcoming) {
      if (sessionsFor(a) === 0 && !proposals[a.id] && busy !== a.id) void propose(a)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, upcoming])

  const togglePriority = (p: WeekPriority) => {
    setPriorities((cur) => {
      if (cur.some((x) => x.text === p.text)) return cur.filter((x) => x.text !== p.text)
      if (cur.length >= MAX_PRIORITIES) return cur
      return [...cur, p]
    })
  }

  const finish = async () => {
    await planner.saveWeek({ priorities, planned: true })
    navigate({ name: 'planner' })
  }

  const addFromQuick = (parsed: ParsedQuickAdd & { courseId: string | null }) => {
    void planner.add({
      onDay: parsed.onDay,
      title: parsed.title,
      courseId: parsed.courseId,
      minutes: parsed.minutes ?? defaultMinutes('task', band),
    })
  }

  if (!active || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl py-4">
        <ScreenHeader title="Plan your week" onBack={() => navigate({ name: 'planner' })} />
        <p className="font-bold text-muted">{planner.loading ? 'Loading…' : 'Sign in with a learner to plan.'}</p>
      </div>
    )
  }

  const heavy = load.filter((l) => l.heavy)
  const days = daysOfWeek(planner.weekStart)
  const isThisWeek = planner.weekStart === weekStartOf(today)

  return (
    // Somebody else's edit to the week waits while a field here has focus.
    <div className="mx-auto w-full max-w-2xl py-4" data-live-key="week">
      <ScreenHeader
        title="Plan your week"
        subtitle={`Step ${step + 1} of 5`}
        onBack={() => navigate({ name: 'planner' })}
        backLabel="Later"
      />
      <div className="mb-4 flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-tray'}`} />
        ))}
      </div>

      {step === 0 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Here&apos;s what&apos;s coming</h2>
          <p className="mb-4 font-bold text-muted">Everything the app already knows. Mark any days you&apos;re busy.</p>

          <Section title="Tests">
            {upcoming.length === 0 && <Empty>No tests on the horizon. Add one on the planner if you hear of one.</Empty>}
            <ul className="space-y-1">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
                  📝 {a.title} <span className="text-sm font-bold text-muted">{whenLabel(a.on, today)}</span>
                  {courseById.get(a.courseId ?? '') && <CourseChip course={courseById.get(a.courseId ?? '')!} small />}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Set for you">
            {dueAssignments.length === 0 && <Empty>Nothing due from a grown-up this week.</Empty>}
            <ul className="space-y-1">
              {dueAssignments.map((a) => (
                <li key={a.id} className="text-[15px] font-extrabold text-ink">
                  ✓ {a.title}{' '}
                  {a.dueOn && <span className="text-sm font-bold text-muted">{whenLabel(a.dueOn, today)}</span>}
                </li>
              ))}
            </ul>
          </Section>

          {lastGoals.length > 0 && (
            <Section title="Last week you said">
              <ul className="space-y-1">
                {lastGoals.map((g, i) => (
                  <li key={i} className="text-[15px] font-extrabold text-ink">
                    → {g.text}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Busy days">
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => {
                const on = data.week.busyDays.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      void planner.saveWeek({ busyDays: on ? data.week.busyDays.filter((x) => x !== d) : [...data.week.busyDays, d] })
                    }
                    className={`rounded-full px-3 py-1.5 text-sm font-extrabold ${on ? 'bg-ink text-white' : 'bg-white text-ink ring-1 ring-edge'}`}
                  >
                    {DAY_NAMES[isoWeekday(d) - 1]}
                  </button>
                )
              })}
            </div>
          </Section>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Anything else?</h2>
          <p className="mb-4 font-bold text-muted">Homework, things to bring, things you promised. One line each.</p>
          <QuickAdd
            courses={data.courses}
            today={today}
            defaultDay={isThisWeek ? today : planner.weekStart}
            lastCourseId={null}
            onAdd={addFromQuick}
            autoFocus
          />
          <div className="mt-4 space-y-1.5" role="list">
            {[...data.items]
              .filter((i) => i.kind === 'task')
              .sort((a, b) => (a.onDay ?? '').localeCompare(b.onDay ?? '') || a.sortOrder - b.sortOrder)
              .map((it) => (
                <div key={it.id} className="flex items-center gap-2">
                  <span className="w-8 font-mono text-[10px] font-bold text-faint">{it.onDay ? DAY_NAMES[isoWeekday(it.onDay) - 1] : '—'}</span>
                  <div className="min-w-0 flex-1">
                    <PlannerCard item={it} course={courseById.get(it.courseId ?? '')} compact onTick={(i) => void planner.tick(i)} />
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Pick up to three priorities</h2>
          <p className="mb-4 font-bold text-muted">Three, not eleven. Choosing is the skill.</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {candidates.map((p) => {
              const on = priorities.some((x) => x.text === p.text)
              return (
                <button
                  key={p.text}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePriority(p)}
                  disabled={!on && priorities.length >= MAX_PRIORITIES}
                  className={`rounded-full px-3 py-1.5 text-sm font-extrabold disabled:opacity-40 ${on ? 'bg-ink text-white' : 'bg-white text-ink ring-1 ring-edge'}`}
                >
                  {p.text}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  togglePriority({ text: custom.trim(), courseId: customCourse })
                  setCustom('')
                }
              }}
              placeholder="Or write your own"
              aria-label="Write a priority"
              disabled={priorities.length >= MAX_PRIORITIES}
              className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink focus:border-ink focus:outline-none"
            />
            <Button
              variant="ghost"
              disabled={!custom.trim() || priorities.length >= MAX_PRIORITIES}
              onClick={() => {
                togglePriority({ text: custom.trim(), courseId: customCourse })
                setCustom('')
              }}
            >
              Add
            </Button>
          </div>
          {data.courses.length > 0 && (
            <div className="mt-2">
              <CoursePicker courses={data.courses} value={customCourse} onChange={setCustomCourse} />
            </div>
          )}
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-[15px] font-extrabold text-ink">
            {priorities.map((p) => (
              <li key={p.text}>
                {p.text}{' '}
                <button type="button" className="text-xs font-bold text-muted underline" onClick={() => togglePriority(p)}>
                  remove
                </button>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Study sessions</h2>
          <p className="mb-4 font-bold text-muted">For each test coming up, a plan that works backwards from the day. Keep it, or change it on the planner later.</p>
          {upcoming.length === 0 && <Empty>No tests to plan for. Nice.</Empty>}
          <div className="space-y-3">
            {upcoming.map((a) => {
              const p = proposals[a.id]
              const have = sessionsFor(a)
              return (
                <div key={a.id} className="rounded-2xl border border-hair bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[15px] font-extrabold text-ink">
                      📝 {a.title} <span className="text-sm font-bold text-muted">{whenLabel(a.on, today)}</span>
                    </div>
                    {have > 0 && <span className="text-xs font-extrabold text-pine">{have} sessions planned</span>}
                  </div>
                  {!a.target && (
                    <p className="mt-1 text-xs font-bold text-muted">
                      Nothing linked yet. Link a deck on the planner and each session becomes a real round.
                    </p>
                  )}
                  {have === 0 && p && !p.accepted && (
                    <>
                      {p.message && <p className="mt-2 text-sm font-bold text-muted">{p.message}</p>}
                      <ul className="mt-2 space-y-1">
                        {p.sessions.map((s, i) => (
                          <li key={i} className="rounded-xl border border-dashed border-edge px-3 py-1.5 text-sm">
                            <span className="font-extrabold text-ink">
                              {DAY_NAMES[isoWeekday(s.onDay) - 1]} {s.onDay.slice(5)} · {PURPOSE_COPY[s.purpose].name}
                            </span>
                            <span className="block text-xs font-bold text-muted">{PURPOSE_COPY[s.purpose].line}</span>
                          </li>
                        ))}
                      </ul>
                      {p.sessions.length > 0 && (
                        <Button className="mt-2" onClick={() => accept(a)} disabled={busy === a.id}>
                          Add all {p.sessions.length}
                        </Button>
                      )}
                    </>
                  )}
                  {have === 0 && !p && <p className="mt-2 text-sm font-bold text-muted">Working it out…</p>}
                  {p?.accepted && <p className="mt-2 text-sm font-extrabold text-pine">Added.</p>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Done.</h2>
          <p className="mb-4 font-bold text-muted">
            {heavy.length === 0
              ? 'This looks manageable.'
              : `Looks like a full week — ${heavy.map((l) => DAY_NAMES[isoWeekday(l.day) - 1]).join(' and ')} ${heavy.length === 1 ? 'is' : 'are'} heavy.`}
          </p>
          <div className="grid grid-cols-7 gap-1">
            {load.map((l) => (
              <div key={l.day} className="rounded-xl bg-wash p-2 text-center">
                <div className="text-[11px] font-extrabold text-ink">{DAY_NAMES[isoWeekday(l.day) - 1]}</div>
                <div className={`font-mono text-[10px] font-bold ${l.heavy ? 'text-red-600' : 'text-muted'}`}>{l.minutes}m</div>
                <div className="text-[10px] font-bold text-faint">{l.openCount} {l.openCount === 1 ? 'thing' : 'things'}</div>
              </div>
            ))}
          </div>
          {priorities.length > 0 && (
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-[15px] font-extrabold text-ink">
              {priorities.map((p) => (
                <li key={p.text}>{p.text}</li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <div className="mt-4 flex justify-between">
        <Button variant="ghost" onClick={() => (step === 0 ? navigate({ name: 'planner' }) : setStep((s) => (s - 1) as Step))}>
          {step === 0 ? 'Later' : '← Back'}
        </Button>
        {step < 4 ? (
          <Button onClick={() => setStep((s) => (s + 1) as Step)}>Next →</Button>
        ) : (
          <Button onClick={finish}>Looks good</Button>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-stone">{title}</div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold text-faint">{children}</p>
}

function whenLabel(day: string, today: string): string {
  const n = daysBetween(today, day)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 7) return DAY_NAMES[isoWeekday(day) - 1]!
  return `in ${n} days`
}
