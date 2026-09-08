// The week, and Today.
//
// Everything is a card and one gesture moves it: quick-add is a line and
// Enter, a move is a drag, finishing is a tap on the box. Alongside the stored
// cards the week pulls in what the app already knows for those days —
// assignments due, review falling due, tests — read-only and never duplicated.
//
// The same screen serves the learner and the grown-up. Every write is
// attributed; a grown-up sees the learner's name in the header and gets the
// week timeline and notes; the learner sees exactly the same timeline. A
// history the child cannot read would be a monitoring feature.

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  addDays,
  canDrop,
  DAY_NAMES,
  dayOrder,
  daysBetween,
  daysOfWeek,
  defaultMinutes,
  isoWeekday,
  PLANNER_BAND,
  weekStartOf,
  type Assessment,
  type AssessmentKind,
  type Assignment,
  type Course,
  type PlannerComment,
  type PlannerEvent,
  type PlannerItem,
  type QuickAdd as ParsedQuickAdd,
} from '@whizzo/shared'
import { useAuth } from '../../auth/AuthProvider'
import AssessmentSheet from '../../components/planner/AssessmentSheet'
import CardSheet from '../../components/planner/CardSheet'
import { CourseChip } from '../../components/planner/CourseChip'
import PlannerCard from '../../components/planner/PlannerCard'
import QuickAdd from '../../components/planner/QuickAdd'
import Timeline from '../../components/planner/Timeline'
import ScreenHeader from '../../components/suite/ScreenHeader'
import HereNow from '../../components/planner/HereNow'
import { Button, Card } from '../../components/ui'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { usePlannerWeek } from '../../hooks/usePlannerWeek'
import { routeForAssignment } from '../../lib/assignments/routing'
import { useCoverage } from '../../lib/billing/coverage'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { addComment, weekHistory } from '../../lib/planner/api'
import { useCardDrag, type DropTarget } from '../../lib/planner/drag'
import { routeForTarget } from '../../lib/planner/routing'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { allDecks } from '../../lib/quiz/decks'
import type { Navigate } from '../../routes'

const LAST_COURSE_KEY = 'whizzo:planner:last-course'

export default function PlannerScreen({
  navigate,
  weekStart,
  view: initialView,
}: {
  navigate: Navigate
  weekStart?: string
  view?: 'today' | 'week'
}) {
  const { user } = useAuth()
  const { active } = useLearners()
  const { snapshot } = useProgress()
  const coverage = useCoverage()
  const planner = usePlannerWeek(weekStart, { announce: true })
  const { data, today, load, courseById } = planner

  const band = data?.band ?? 'growing'
  const shape = PLANNER_BAND[band].shape
  const [view, setView] = useState<'today' | 'week'>(initialView ?? (shape === 'today' ? 'today' : 'week'))
  const [open, setOpen] = useState<PlannerItem | null>(null)
  const [openTest, setOpenTest] = useState<{ assessment: Assessment | null; initial?: Partial<{ title: string; on: string; kind: AssessmentKind; courseId: string | null }> } | null>(null)
  const [timeline, setTimeline] = useState<PlannerEvent[] | null>(null)
  const [weekNote, setWeekNote] = useState('')
  const [lastCourse, setLastCourse] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`${LAST_COURSE_KEY}:${active?.id}`)
    } catch {
      return null
    }
  })

  const isGrownUp = !!user && user.id !== active?.authUserId
  // From the week response: the learner, the owner, or a managing guardian.
  // A view-only tutor reads and leaves notes; nothing here moves for them.
  const canWrite = data?.canWrite ?? false

  const rememberCourse = useCallback(
    (courseId: string | null) => {
      setLastCourse(courseId)
      try {
        if (courseId) localStorage.setItem(`${LAST_COURSE_KEY}:${active?.id}`, courseId)
        else localStorage.removeItem(`${LAST_COURSE_KEY}:${active?.id}`)
      } catch {
        /* fine */
      }
    },
    [active?.id],
  )

  const days = useMemo(() => daysOfWeek(planner.weekStart), [planner.weekStart])
  const decks = useMemo(() => allDecks(snapshot, STARTER_DECKS), [snapshot])
  const masteries = useMemo(() => Object.values(snapshot.mastery), [snapshot.mastery])
  const isThisWeek = planner.weekStart === weekStartOf(today)
  const weekdayToday = isoWeekday(today)
  const planDue = isThisWeek && data && !data.week.plannedAt && (weekdayToday <= 2 || weekdayToday === 7)
  const wrapDue = isThisWeek && data && !data.week.wrappedAt && weekdayToday >= 5
  const gatedWeek = !coverage.can('fullHistory') && daysBetween(planner.weekStart, weekStartOf(today)) > 14

  const itemsByDay = useMemo(() => {
    const map = new Map<string | null, PlannerItem[]>()
    for (const it of data?.items ?? []) {
      const key = it.onDay
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    for (const [key, list] of map) map.set(key, dayOrder(list))
    return map
  }, [data?.items])

  const assignmentsByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const a of data?.assignments ?? []) {
      if (!a.dueOn) continue
      if (!map.has(a.dueOn)) map.set(a.dueOn, [])
      map.get(a.dueOn)!.push(a)
    }
    return map
  }, [data?.assignments])

  const assessmentsByDay = useMemo(() => {
    const map = new Map<string, Assessment[]>()
    for (const a of data?.assessments ?? []) {
      if (!map.has(a.on)) map.set(a.on, [])
      map.get(a.on)!.push(a)
    }
    return map
  }, [data?.assessments])

  const sessionsFor = useCallback(
    (assessmentId: string) => data?.sessionCounts?.[assessmentId] ?? { done: 0, total: 0 },
    [data?.sessionCounts],
  )

  // --- drop -----------------------------------------------------------------

  const onDrop = useCallback(
    (dragId: string, target: DropTarget) => {
      if (!data) return
      if (dragId.startsWith('assignment:')) {
        // Dragging a grown-up's assignment drops a linked study session on that
        // day. Its due date stays where whoever set it put it.
        const a = data.assignments.find((x) => x.id === dragId.slice('assignment:'.length))
        if (!a || !target.day) return
        void planner.add({
          onDay: target.day,
          kind: 'study',
          title: a.title,
          courseId: a.courseId ?? null,
          minutes: defaultMinutes('study', band),
          purpose: 'practise',
          target: a.targetId ? { subject: a.subject, activity: a.activity, targetId: a.targetId } : null,
        })
        return
      }
      const item = data.items.find((i) => i.id === dragId) ?? data.carryOver.find((i) => i.id === dragId)
      if (!item) return
      const verdict = canDrop(item, target.day, {
        assessments: data.assessments,
        busyDays: data.week.busyDays,
        weekStart: data.week.weekStart,
      })
      if (!verdict.ok) {
        if (!verdict.ask || !window.confirm(verdict.reason)) {
          planner.dismissToast()
          return
        }
      }
      if (target.copy) void planner.copy(item, target.day)
      else void planner.move(item, target.day, target.beforeId)
    },
    [data, planner, band],
  )

  const { drag, onPointerDown: liftCard } = useCardDrag(onDrop)
  // A viewer's press is a press, never a lift.
  const onPointerDown = canWrite ? liftCard : () => () => undefined
  const dragItem = drag ? (data?.items.find((i) => i.id === drag.itemId) ?? null) : null

  // --- keyboard ---------------------------------------------------------------

  const onCardKey = (item: PlannerItem) => (e: KeyboardEvent<HTMLElement>) => {
    if (!data || !canWrite) return
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      const next = item.onDay ? addDays(item.onDay, e.key === 'ArrowRight' ? 1 : -1) : days[0]!
      const verdict = canDrop(item, next, { assessments: data.assessments, busyDays: data.week.busyDays, weekStart: data.week.weekStart })
      if (verdict.ok || verdict.ask) void planner.move(item, next)
      return
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      // In the order the column shows them. The card sits before
      // siblings[at]; down means before the next one, up before the previous.
      const ordered = itemsByDay.get(item.onDay) ?? []
      const at = ordered.findIndex((i) => i.id === item.id)
      const siblings = ordered.filter((i) => i.id !== item.id)
      const to = Math.max(0, Math.min(siblings.length, at + (e.key === 'ArrowDown' ? 1 : -1)))
      void planner.move(item, item.onDay, siblings[to]?.id ?? null)
      return
    }
    if (e.key === ' ' && !item.target && item.kind !== 'event') {
      e.preventDefault()
      void planner.tick(item)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      setOpen(item)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      void planner.remove(item)
      return
    }
  }

  // --- actions ----------------------------------------------------------------

  const start = (item: PlannerItem) => {
    const route = routeForTarget(item.target)
    if (route) navigate(route)
  }

  const addFromQuick = (parsed: ParsedQuickAdd & { courseId: string | null }) => {
    rememberCourse(parsed.courseId)
    void planner.add({
      onDay: parsed.onDay,
      kind: 'task',
      title: parsed.title,
      courseId: parsed.courseId,
      minutes: parsed.minutes ?? defaultMinutes('task', band),
    })
  }

  const planFromQuick = (parsed: ParsedQuickAdd, kind: AssessmentKind) => {
    setOpenTest({
      assessment: null,
      initial: { title: parsed.title, on: parsed.onDay ?? '', kind, courseId: parsed.courseId ?? lastCourse },
    })
  }

  const openTimeline = async () => {
    if (!planner.learnerId) return
    if (timeline) {
      setTimeline(null)
      return
    }
    try {
      setTimeline(await weekHistory(planner.learnerId, planner.weekStart))
    } catch {
      setTimeline([])
    }
  }

  const postWeekNote = async () => {
    if (!planner.learnerId || !weekNote.trim()) return
    const c = await addComment(planner.learnerId, planner.weekStart, weekNote.trim(), null)
    planner.setData((d) => (d ? { ...d, comments: [...d.comments, c] } : d))
    setWeekNote('')
  }

  useEffect(() => {
    if (initialView) setView(initialView)
  }, [initialView])

  // --- render -----------------------------------------------------------------

  if (!active || !planner.learnerId) {
    return (
      <div className="mx-auto w-full max-w-5xl py-4">
        <ScreenHeader title="Planner 🗓️" onBack={() => navigate({ name: 'home' })} />
        <Card>
          <p className="mb-3 font-bold text-muted">The planner belongs to a learner, so it needs one signed in.</p>
          <Button onClick={() => navigate({ name: 'auth' })}>Sign in</Button>
        </Card>
      </div>
    )
  }

  if (gatedWeek) {
    return (
      <div className="mx-auto w-full max-w-5xl py-4">
        <ScreenHeader title="Planner 🗓️" onBack={() => navigate({ name: 'planner' })} />
        <Card>
          <h2 className="mb-1 text-xl font-extrabold text-ink">Earlier weeks</h2>
          <p className="mb-3 font-bold text-muted">
            The current and next week are always here. Weeks before that, and every card&apos;s
            history, come with covering {active.displayName}. Nothing is deleted — it is waiting.
          </p>
          <Button onClick={() => navigate({ name: 'upgrade' })}>See what covering adds</Button>
        </Card>
      </div>
    )
  }

  const weekLabel = `${fmt(planner.weekStart)} – ${fmt(addDays(planner.weekStart, 6))}`
  const shelf = itemsByDay.get(null) ?? []
  const todayItems = itemsByDay.get(today) ?? []
  const todayDone = todayItems.length > 0 && todayItems.every((i) => i.status !== 'open')

  return (
    <div className="mx-auto w-full max-w-6xl py-4">
      <ScreenHeader
        title={isGrownUp ? `${active.displayName}'s planner` : 'Planner 🗓️'}
        subtitle={weekLabel}
        onBack={() => navigate({ name: 'home' })}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <HereNow watchers={planner.watchers} />
            <Button variant="ghost" onClick={() => navigate({ name: 'planner', weekStart: addDays(planner.weekStart, -7) })} aria-label="Previous week">
              ‹
            </Button>
            {!isThisWeek && (
              <Button variant="ghost" onClick={() => navigate({ name: 'planner' })}>
                This week
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate({ name: 'planner', weekStart: addDays(planner.weekStart, 7) })} aria-label="Next week">
              ›
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {shape !== 'today' && (
          <div className="flex rounded-xl bg-tray p-1 text-sm font-extrabold">
            <button type="button" onClick={() => setView('today')} className={`rounded-lg px-3 py-1.5 ${view === 'today' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>
              Today
            </button>
            <button type="button" onClick={() => setView('week')} className={`rounded-lg px-3 py-1.5 ${view === 'week' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>
              Week
            </button>
          </div>
        )}
        {canWrite && (
          <Button variant="ghost" onClick={() => setOpenTest({ assessment: null, initial: { courseId: lastCourse } })}>
            📝 Add a test
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate({ name: 'planner-courses' })}>
          🎒 Courses
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'planner-print', weekStart: planner.weekStart })}>
          🖨️ Print
        </Button>
        <Button variant="ghost" onClick={openTimeline}>
          🕘 {timeline ? 'Hide history' : 'Week history'}
        </Button>
      </div>

      {planner.error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600" role="alert">
          {planner.error}{' '}
          <button type="button" className="underline" onClick={planner.clearError}>
            ok
          </button>
        </p>
      )}

      {canWrite && (planDue || wrapDue) && (
        <Card className="mb-4 !p-4 ring-2 ring-sun">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-extrabold text-ink">
                {planDue ? 'Plan your week' : 'Wrap up the week'}
              </div>
              <div className="text-sm font-bold text-muted">
                {planDue ? 'Five quick steps. The lazy path makes a good plan.' : 'What went well, and what next week is for.'}
              </div>
            </div>
            <Button onClick={() => navigate({ name: planDue ? 'planner-plan' : 'planner-wrap' })}>
              {planDue ? 'Plan it →' : 'Wrap up →'}
            </Button>
          </div>
        </Card>
      )}

      {timeline && (
        <Card className="mb-4 !p-4">
          <div className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">This week&apos;s history</div>
          <Timeline events={timeline} learnerName={active.displayName} emptyText="Nothing has happened yet this week." />
        </Card>
      )}

      {/* The "still?" strip. Nothing silently accumulates. */}
      {data && canWrite && data.carryOver.length > 0 && isThisWeek && (
        <div className="mb-4 rounded-2xl border border-hair bg-wash p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-extrabold text-ink">Still? {data.carryOver.length} from before today</span>
            <div className="flex gap-2 text-xs font-extrabold">
              <button type="button" className="underline" onClick={() => data.carryOver.forEach((i) => void planner.keep(i))}>
                Keep all
              </button>
              <button type="button" className="underline text-muted" onClick={() => data.carryOver.forEach((i) => void planner.letGo(i))}>
                Let all go
              </button>
            </div>
          </div>
          <ul className="space-y-1.5">
            {data.carryOver.map((it) => (
              <li key={it.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <PlannerCard item={it} course={courseById.get(it.courseId ?? '')} compact onOpen={setOpen} />
                </div>
                <button type="button" className="rounded-lg bg-ink px-2 py-1 text-xs font-extrabold text-white" onClick={() => planner.keep(it)}>
                  Today
                </button>
                <button type="button" className="rounded-lg border-2 border-edge px-2 py-1 text-xs font-extrabold text-muted" onClick={() => planner.letGo(it)}>
                  Let go
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && canWrite && (
        <div className="mb-4">
          <QuickAdd
            courses={data.courses}
            today={today}
            defaultDay={view === 'today' ? today : isThisWeek ? today : planner.weekStart}
            lastCourseId={lastCourse}
            onAdd={addFromQuick}
            onPlanTest={planFromQuick}
          />
        </div>
      )}

      {/* Tests coming up. */}
      {data && data.assessments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.assessments
            .filter((a) => a.on >= addDays(planner.weekStart, -7))
            .map((a) => {
              const s = sessionsFor(a.id)
              const past = a.on < today
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setOpenTest({ assessment: a })}
                  className={`flex items-center gap-2 rounded-2xl border border-hair bg-chalk px-3 py-2 text-left text-sm font-extrabold text-ink hover:bg-wash ${past ? 'opacity-70' : ''}`}
                >
                  <span aria-hidden>{a.kind === 'project' ? '📦' : '📝'}</span>
                  <span>
                    {a.title}
                    <span className="block text-[11px] font-bold text-muted">
                      {past ? (a.outcome ? 'recorded' : 'How did it go?') : `${dayLabel(a.on, today)} · ${s.done} of ${s.total} sessions`}
                    </span>
                  </span>
                  {courseById.get(a.courseId ?? '') && <CourseChip course={courseById.get(a.courseId ?? '')!} small />}
                </button>
              )
            })}
        </div>
      )}

      {planner.loading && !data && <p className="font-bold text-muted">Loading the week…</p>}

      {data && view === 'today' && (
        <DayColumn
          day={today}
          items={todayItems}
          assignments={assignmentsByDay.get(today) ?? []}
          assessments={assessmentsByDay.get(today) ?? []}
          reviewDue={data.reviewDue[today] ?? 0}
          load={load.find((l) => l.day === today)}
          busy={data.week.busyDays.includes(today)}
          today={today}
          wide
          done={todayDone}
          courseById={courseById}
          dragging={drag?.itemId ?? null}
          isGrownUp={isGrownUp}
          userId={user?.id}
          learnerAuthId={active.authUserId}
          onPointerDown={onPointerDown}
          onCardKey={onCardKey}
          onTick={canWrite ? (i) => void planner.tick(i) : undefined}
          onOpen={setOpen}
          onStart={start}
          onStartAssignment={(a) => {
            const r = routeForAssignment(a)
            if (r) navigate(r)
          }}
          onStartReview={() => navigate({ name: 'quiz-play', mode: 'review' })}
          onOpenTest={(a) => setOpenTest({ assessment: a })}
          canWrite={canWrite}
          onAddHere={() => undefined}
          onToggleBusy={() => undefined}
        />
      )}

      {data && view === 'week' && (
        <>
          {/* The shelf: this week, no day yet. */}
          <div
            data-drop="shelf"
            className={`mb-3 rounded-2xl border-2 border-dashed p-2 transition-colors ${
              drag?.over?.day === null && drag.over ? 'border-ink bg-wash' : 'border-edge'
            }`}
          >
            <div className="mb-1 px-1 text-[11px] font-extrabold uppercase tracking-wide text-stone">
              Sometime this week{shelf.length ? ` · ${shelf.length}` : ''}
            </div>
            {shelf.length === 0 && <p className="px-1 pb-1 text-xs font-bold text-faint">Drop things here when you know about them but not when.</p>}
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="list">
              {shelf.map((it, idx) => (
                <PlannerCard
                  key={it.id}
                  item={it}
                  index={idx}
                  course={courseById.get(it.courseId ?? '')}
                  addedBy={addedByName(it, user?.id, active.authUserId, isGrownUp)}
                  dragging={drag?.itemId === it.id}
                  onPointerDown={onPointerDown(it.id)}
                  onKeyDown={onCardKey(it)}
                  onTick={(i) => void planner.tick(i)}
                  onOpen={setOpen}
                  onStart={start}
                  compact
                />
              ))}
            </div>
          </div>

          <div data-planner-grid className="-mx-3 overflow-x-auto px-3 pb-2 xl:mx-0 xl:px-0">
            <div className="grid min-w-[1120px] grid-cols-7 gap-2 xl:min-w-0">
              {days.map((d) => (
                <DayColumn
                  key={d}
                  day={d}
                  items={itemsByDay.get(d) ?? []}
                  assignments={assignmentsByDay.get(d) ?? []}
                  assessments={assessmentsByDay.get(d) ?? []}
                  reviewDue={data.reviewDue[d] ?? 0}
                  load={load.find((l) => l.day === d)}
                  busy={data.week.busyDays.includes(d)}
                  today={today}
                  over={drag?.over?.day === d}
                  done={d === today && todayDone}
                  courseById={courseById}
                  dragging={drag?.itemId ?? null}
                  isGrownUp={isGrownUp}
                  userId={user?.id}
                  learnerAuthId={active.authUserId}
                  onPointerDown={onPointerDown}
                  onCardKey={onCardKey}
                  onTick={canWrite ? (i) => void planner.tick(i) : undefined}
                  onOpen={setOpen}
                  onStart={start}
                  onStartAssignment={(a) => {
                    const r = routeForAssignment(a)
                    if (r) navigate(r)
                  }}
                  onStartReview={() => navigate({ name: 'quiz-play', mode: 'review' })}
                  onOpenTest={(a) => setOpenTest({ assessment: a })}
                  canWrite={canWrite}
                  onAddHere={(day) => {
                    const title = window.prompt(`Add to ${DAY_NAMES[isoWeekday(day) - 1]}`)
                    if (title?.trim()) void planner.add({ onDay: day, title: title.trim(), courseId: lastCourse, minutes: defaultMinutes('task', band) })
                  }}
                  onToggleBusy={(day) => {
                    const next = data.week.busyDays.includes(day)
                      ? data.week.busyDays.filter((x) => x !== day)
                      : [...data.week.busyDays, day]
                    void planner.saveWeek({ busyDays: next })
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Priorities, for the week view, under the grid. */}
      {data && view === 'week' && (data.week.priorities.length > 0 || data.week.plannedAt) && (
        <Card className="mt-4 !p-4">
          <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-stone">Priorities this week</div>
          {data.week.priorities.length === 0 ? (
            <p className="text-sm font-bold text-faint">None picked yet.</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-[15px] font-extrabold text-ink">
              {data.week.priorities.map((p, i) => (
                <li key={i}>
                  {p.text}{' '}
                  {p.courseId && courseById.get(p.courseId) && <CourseChip course={courseById.get(p.courseId)!} small />}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {/* Sticky notes on the week. */}
      {data && (
        <div className="mt-4 rounded-2xl border border-hair bg-chalk p-3">
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-stone">Notes</div>
          {data.comments.filter((c) => !c.itemId).length === 0 && (
            <p className="mb-2 text-xs font-bold text-faint">A sticky note on the fridge. No threads.</p>
          )}
          <ul className="mb-2 space-y-1.5">
            {data.comments
              .filter((c: PlannerComment) => !c.itemId)
              .map((c) => (
                <li key={c.id} className="rounded-xl bg-sun/30 px-3 py-2 text-sm">
                  <span className="font-extrabold text-ink">{c.body}</span>
                  <span className="ml-2 text-[11px] font-bold text-muted">— {c.authorName ?? 'Someone'}</span>
                </li>
              ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={weekNote}
              onChange={(e) => setWeekNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && postWeekNote()}
              placeholder="Leave a note on the week"
              aria-label="Leave a note on the week"
              className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink focus:border-ink focus:outline-none"
            />
            <Button variant="ghost" onClick={postWeekNote} disabled={!weekNote.trim()}>
              Post
            </Button>
          </div>
        </div>
      )}

      {/* The drag ghost. */}
      {drag && dragItem && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rotate-1 opacity-90"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
        >
          <PlannerCard item={dragItem} course={courseById.get(dragItem.courseId ?? '')} compact />
          {drag.over?.day && load.find((l) => l.day === drag.over?.day) && (
            <div className="mt-1 inline-block rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] font-bold text-white">
              {DAY_NAMES[isoWeekday(drag.over.day) - 1]} · {load.find((l) => l.day === drag.over?.day)!.minutes} →{' '}
              {load.find((l) => l.day === drag.over?.day)!.minutes + (dragItem.onDay === drag.over.day ? 0 : dragItem.minutes ?? 0)} min
            </div>
          )}
        </div>
      )}

      {planner.toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm font-extrabold text-white shadow-lg">
          {planner.toast.text}
          {planner.toast.undo && (
            <button
              type="button"
              className="rounded-full bg-white/15 px-2 py-0.5 underline"
              onClick={async () => {
                await planner.toast?.undo?.()
                planner.dismissToast()
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {open && data && (
        <CardSheet
          item={data.items.find((i) => i.id === open.id) ?? data.carryOver.find((i) => i.id === open.id) ?? open}
          courses={data.courses}
          comments={data.comments}
          learnerId={planner.learnerId}
          learnerName={active.displayName}
          userId={user?.id}
          weekStart={planner.weekStart}
          canWrite={canWrite}
          onPatch={planner.patch}
          onTick={(i) => void planner.tick(i)}
          onSkip={(i) => void planner.skip(i)}
          onRemove={(i) => void planner.remove(i)}
          onCopy={(i, d) => void planner.copy(i, d)}
          onStart={start}
          onCommentAdded={(c) => planner.setData((d) => (d ? { ...d, comments: [...d.comments, c] } : d))}
          onCommentRemoved={(id) => planner.setData((d) => (d ? { ...d, comments: d.comments.filter((c) => c.id !== id) } : d))}
          onClose={() => setOpen(null)}
        />
      )}

      {openTest && data && (
        <AssessmentSheet
          learnerId={planner.learnerId}
          learnerName={active.displayName}
          courses={data.courses}
          decks={decks}
          masteries={masteries}
          assessment={openTest.assessment}
          initial={openTest.initial}
          sessionsDone={openTest.assessment ? sessionsFor(openTest.assessment.id).done : 0}
          sessionsTotal={openTest.assessment ? sessionsFor(openTest.assessment.id).total : 0}
          showReadiness={coverage.can('retentionReport')}
          canWrite={canWrite}
          onSaved={(a) => {
            planner.setData((d) =>
              d
                ? { ...d, assessments: d.assessments.some((x) => x.id === a.id) ? d.assessments.map((x) => (x.id === a.id ? a : x)) : [...d.assessments, a] }
                : d,
            )
            setOpenTest((t) => (t ? { ...t, assessment: a } : t))
            rememberCourse(a.courseId)
          }}
          onDeleted={(id) => {
            planner.setData((d) => (d ? { ...d, assessments: d.assessments.filter((x) => x.id !== id), items: d.items.filter((i) => i.assessmentId !== id) } : d))
          }}
          onAccepted={() => void planner.refresh()}
          onClose={() => setOpenTest(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function DayColumn({
  day,
  items,
  assignments,
  assessments,
  reviewDue,
  load,
  busy,
  today,
  over,
  wide,
  done,
  courseById,
  dragging,
  isGrownUp,
  userId,
  learnerAuthId,
  onPointerDown,
  onCardKey,
  onTick,
  onOpen,
  onStart,
  onStartAssignment,
  onStartReview,
  onOpenTest,
  canWrite,
  onAddHere,
  onToggleBusy,
}: {
  day: string
  items: PlannerItem[]
  assignments: Assignment[]
  assessments: Assessment[]
  reviewDue: number
  load: { minutes: number; heavy: boolean } | undefined
  busy: boolean
  today: string
  over?: boolean
  wide?: boolean
  done: boolean
  courseById: Map<string, Course>
  dragging: string | null
  isGrownUp: boolean
  userId: string | undefined
  learnerAuthId: string | null
  onPointerDown: (id: string) => (e: React.PointerEvent<HTMLElement>) => void
  onCardKey: (item: PlannerItem) => (e: KeyboardEvent<HTMLElement>) => void
  onTick: ((item: PlannerItem) => void) | undefined
  onOpen: (item: PlannerItem) => void
  onStart: (item: PlannerItem) => void
  onStartAssignment: (a: Assignment) => void
  onStartReview: () => void
  onOpenTest: (a: Assessment) => void
  canWrite: boolean
  onAddHere: (day: string) => void
  onToggleBusy: (day: string) => void
}) {
  const isToday = day === today
  const past = day < today
  const name = DAY_NAMES[isoWeekday(day) - 1]
  const ordered = dayOrder(items)
  const openItems = ordered.filter((i) => i.status === 'open')
  const closed = ordered.filter((i) => i.status !== 'open')

  return (
    <section
      data-drop={day}
      aria-label={`${name} ${day}`}
      className={`flex min-h-[160px] flex-col rounded-2xl border p-2 transition-colors ${
        over ? 'border-ink bg-wash' : isToday ? 'border-spark/60 bg-chalk' : 'border-hair bg-chalk/70'
      } ${past && !wide ? 'opacity-80' : ''} ${busy ? 'bg-[repeating-linear-gradient(135deg,transparent_0_8px,#F2ECE1_8px_16px)]' : ''}`}
    >
      <header className="mb-1.5 flex items-center justify-between gap-1 px-1">
        <div className="min-w-0">
          <div className={`text-sm font-extrabold ${isToday ? 'text-spark' : 'text-ink'}`}>
            {wide ? `${DAY_NAMES[isoWeekday(day) - 1]}, today` : name}
            {!wide && <span className="ml-1 font-mono text-[10px] font-bold text-faint">{day.slice(8)}</span>}
          </div>
          {load && (
            <div className={`font-mono text-[10px] font-bold ${load.heavy ? 'text-red-600' : 'text-faint'}`}>
              {load.minutes > 0 ? `${load.minutes} min${load.heavy ? ' · heavy' : ''}` : busy ? 'busy' : ''}
            </div>
          )}
        </div>
        {!wide && canWrite && (
          <button
            type="button"
            title={busy ? 'Busy day. Tap to clear.' : 'Mark busy'}
            aria-label={busy ? `Unmark ${name} busy` : `Mark ${name} busy`}
            onClick={() => onToggleBusy(day)}
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${busy ? 'bg-ink text-white' : 'text-faint hover:bg-wash'}`}
          >
            {busy ? 'busy' : '·'}
          </button>
        )}
      </header>

      {assessments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpenTest(a)}
          className="mb-1.5 flex items-center gap-2 rounded-xl bg-ink px-2 py-1.5 text-left text-xs font-extrabold text-white"
        >
          <span aria-hidden>📌</span>
          <span className="truncate">{a.title}</span>
        </button>
      ))}

      {reviewDue > 0 && (
        <div className="mb-1.5 flex items-center justify-between gap-1 rounded-xl bg-pine/10 px-2 py-1 text-[11px] font-extrabold text-pine">
          <span>{reviewDue} due for review</span>
          <button type="button" onClick={onStartReview} className="rounded-md bg-pine px-1.5 py-0.5 text-white">
            Start
          </button>
        </div>
      )}

      {assignments.map((a) => (
        <div
          key={a.id}
          data-card-id={`assignment:${a.id}`}
          onPointerDown={onPointerDown(`assignment:${a.id}`)}
          className="mb-1.5 flex cursor-grab items-center gap-2 rounded-xl border border-pine/40 bg-white/90 py-1.5 pr-2"
          title="Set by a grown-up. Drag it onto a day to plan when to do it."
          style={{ touchAction: 'pan-y' }}
        >
          <span aria-hidden className="ml-1 h-7 w-1.5 shrink-0 rounded-full bg-pine" />
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-extrabold ${
              a.status === 'done' ? 'bg-pine text-white' : 'border-2 border-dashed border-pine/60 text-pine'
            }`}
            aria-label={a.status === 'done' ? 'Checked by the app' : 'Set by a grown-up'}
          >
            ✓
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={`block truncate ${wide ? 'text-[15px]' : 'text-[13px]'} font-extrabold text-ink ${a.status === 'done' ? 'line-through' : ''}`}>
              {a.title}
            </span>
            {a.status === 'open' && (
              <div className="flex flex-wrap items-center gap-1.5 pr-1">
                <span className="rounded-full bg-pine/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-pine">set for you</span>
                <button
                  type="button"
                  onClick={() => onStartAssignment(a)}
                  className="rounded-lg bg-spark px-2.5 py-1 text-xs font-extrabold text-white shadow-[0_2px_0_#E14E12]"
                >
                  ▶ Start
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-1 flex-col gap-1.5" role="list">
        {openItems.map((it, idx) => (
          <PlannerCard
            key={it.id}
            item={it}
            index={idx}
            course={courseById.get(it.courseId ?? '')}
            addedBy={addedByName(it, userId, learnerAuthId, isGrownUp)}
            dragging={dragging === it.id}
            onPointerDown={onPointerDown(it.id)}
            onKeyDown={onCardKey(it)}
            onTick={onTick}
            onOpen={onOpen}
            onStart={onStart}
            compact={!wide}
          />
        ))}
        {closed.map((it, idx) => (
          <PlannerCard
            key={it.id}
            item={it}
            index={openItems.length + idx}
            course={courseById.get(it.courseId ?? '')}
            onPointerDown={onPointerDown(it.id)}
            onKeyDown={onCardKey(it)}
            onTick={onTick}
            onOpen={onOpen}
            compact
          />
        ))}
        {done && <p className="px-1 pt-1 text-xs font-extrabold text-pine">That&apos;s today.</p>}
        {!wide && canWrite && (
          <button
            type="button"
            onClick={() => onAddHere(day)}
            aria-label={`Add to ${name}`}
            className="mt-auto rounded-xl border border-dashed border-edge py-1 text-xs font-extrabold text-faint hover:border-ink hover:text-ink"
          >
            +
          </button>
        )}
      </div>
    </section>
  )
}

function addedByName(item: PlannerItem, userId: string | undefined, learnerAuthId: string | null, isGrownUp: boolean): string | null {
  if (!item.createdBy) return null
  if (item.createdBy === learnerAuthId) return null
  if (item.createdBy === userId) return isGrownUp ? 'You' : null
  return 'Grown-up'
}

function fmt(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function dayLabel(day: string, today: string): string {
  const n = daysBetween(today, day)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 7) return DAY_NAMES[isoWeekday(day) - 1]!
  return `${fmt(day)} · in ${n} days`
}
