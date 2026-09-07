// Today, on the learner's home screen.
//
// A learner who never opens the week view still gets the plan's benefit one
// day at a time: what is on today, in order, with Start on anything the app
// can run — and the plan-your-week prompt when one is due.

import { isoWeekday, weekStartOf, type PlannerItem } from '@whizzo/shared'
import { usePlannerWeek } from '../../hooks/usePlannerWeek'
import { routeForTarget } from '../../lib/planner/routing'
import type { Navigate } from '../../routes'
import { Button, Card } from '../ui'
import PlannerCard from './PlannerCard'

export default function TodayStrip({ navigate }: { navigate: Navigate }) {
  const planner = usePlannerWeek()
  const { data, today, courseById } = planner
  if (!planner.learnerId || !data) return null

  const items = data.items
    .filter((i) => i.onDay === today)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.sortOrder - b.sortOrder)
  const open = items.filter((i) => i.status === 'open')
  const weekday = isoWeekday(today)
  const planDue = !data.week.plannedAt && (weekday <= 2 || weekday === 7) && data.week.weekStart === weekStartOf(today)
  const nextTest = data.assessments.filter((a) => a.on >= today).sort((a, b) => a.on.localeCompare(b.on))[0]
  const review = data.reviewDue[today] ?? 0

  if (items.length === 0 && !planDue && !nextTest && review === 0) return null

  const start = (item: PlannerItem) => {
    const r = routeForTarget(item.target)
    if (r) navigate(r)
  }

  return (
    <Card className="mb-6 !p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold text-ink">
          🗓️ Today{open.length ? ` (${open.length})` : ''}
        </h2>
        <Button variant="ghost" onClick={() => navigate({ name: 'planner' })}>
          Open planner →
        </Button>
      </div>
      {planDue && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sun/30 px-3 py-2 text-sm font-extrabold text-ink">
          <span>Plan your week — five quick steps.</span>
          <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={() => navigate({ name: 'planner-plan' })}>
            Plan it
          </Button>
        </div>
      )}
      {review > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-pine/10 px-3 py-2 text-sm font-extrabold text-pine">
          <span>{review} due for review</span>
          <button type="button" className="rounded-lg bg-pine px-2.5 py-1 text-xs text-white" onClick={() => navigate({ name: 'quiz-play', mode: 'review' })}>
            ▶ Start
          </button>
        </div>
      )}
      <div className="space-y-1.5" role="list">
        {items.slice(0, 5).map((it) => (
          <PlannerCard
            key={it.id}
            item={it}
            course={courseById.get(it.courseId ?? '')}
            onTick={data.canWrite ? (i) => void planner.tick(i) : undefined}
            onOpen={() => navigate({ name: 'planner', view: 'today' })}
            onStart={start}
          />
        ))}
      </div>
      {items.length === 0 && nextTest && (
        <p className="text-sm font-bold text-muted">
          Nothing on today. Next up: {nextTest.title} on {nextTest.on.slice(5)}.
        </p>
      )}
      {items.length > 0 && open.length === 0 && <p className="mt-2 text-sm font-extrabold text-pine">That&apos;s today.</p>}
    </Card>
  )
}
