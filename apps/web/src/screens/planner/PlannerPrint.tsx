// The week on paper: the grid, priorities, tests, sessions with their
// purposes, and empty boxes to tick by pen. Printed on Sunday and ticked with
// a pen it is the same plan; what the paper cannot carry is the verified mark,
// and the footer says so.

import { DAY_NAMES_LONG, daysOfWeek, isoWeekday, PURPOSE_COPY, weekStartOf, todayString } from '@whizzo/shared'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import { usePlannerWeek } from '../../hooks/usePlannerWeek'
import { useCoverage } from '../../lib/billing/coverage'
import { useLearners } from '../../lib/learners/LearnerProvider'
import type { Navigate } from '../../routes'

export default function PlannerPrint({ navigate, weekStart }: { navigate: Navigate; weekStart?: string }) {
  const { active } = useLearners()
  const coverage = useCoverage()
  const planner = usePlannerWeek(weekStart ?? weekStartOf(todayString()))
  const { data, courseById } = planner

  if (!coverage.can('printableReports')) {
    return (
      <div className="mx-auto w-full max-w-2xl py-10">
        <Card>
          <h1 className="mb-2 text-2xl font-extrabold text-ink">The week, on the fridge</h1>
          <p className="mb-4 font-bold text-muted">
            The grid, the priorities, the tests and the study sessions with what each one is for — with
            boxes to tick by hand. Covering {active?.displayName ?? 'this learner'} turns it on.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate({ name: 'upgrade' })}>See what covering adds</Button>
            <Button variant="ghost" onClick={() => navigate({ name: 'planner' })}>
              Back to the planner
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl py-6">
        <ScreenHeader title="Print the week" onBack={() => navigate({ name: 'planner' })} />
        <p className="font-bold text-muted">Loading…</p>
      </div>
    )
  }

  const days = daysOfWeek(data.week.weekStart)
  const tests = data.assessments.filter((a) => a.on >= data.week.weekStart && a.on < days[6]! + 'z')

  return (
    <div data-print-sheet className="mx-auto w-full max-w-3xl py-6">
      <div data-print-hide className="mb-6 flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>🖨️ Print this week</Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'planner' })}>
          ← Back to the planner
        </Button>
      </div>

      <header className="mb-4 border-b-2 border-ink pb-3">
        <h1 className="font-display text-3xl font-extrabold text-ink">{active?.displayName ?? 'Learner'} — the week</h1>
        <p className="mt-1 font-bold text-muted">
          {fmt(days[0]!)} to {fmt(days[6]!)}
        </p>
      </header>

      {data.week.priorities.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide">Priorities</h2>
          <ol className="list-decimal pl-5 text-[15px] font-extrabold">
            {data.week.priorities.map((p, i) => (
              <li key={i}>{p.text}</li>
            ))}
          </ol>
        </section>
      )}

      {tests.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide">Tests this week</h2>
          <ul className="text-[15px] font-extrabold">
            {tests.map((a) => (
              <li key={a.id}>
                {DAY_NAMES_LONG[isoWeekday(a.on) - 1]}: {a.title}
                {a.courseId && courseById.get(a.courseId) ? ` (${courseById.get(a.courseId)!.name})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-print-keep>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border border-ink px-2 py-1 text-left">Day</th>
              <th className="border border-ink px-2 py-1 text-left">To do</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const items = data.items.filter((i) => i.onDay === d && i.status !== 'skipped').sort((a, b) => a.sortOrder - b.sortOrder)
              const due = data.assignments.filter((a) => a.dueOn === d)
              const busy = data.week.busyDays.includes(d)
              return (
                <tr key={d}>
                  <td className="w-28 border border-ink px-2 py-2 align-top font-extrabold">
                    {DAY_NAMES_LONG[isoWeekday(d) - 1]}
                    <div className="font-mono text-[10px] font-bold">{d.slice(5)}</div>
                    {busy && <div className="text-[10px] font-bold">busy</div>}
                  </td>
                  <td className="border border-ink px-2 py-2 align-top">
                    {items.length === 0 && due.length === 0 && <span className="text-[12px]">—</span>}
                    <ul className="space-y-1">
                      {due.map((a) => (
                        <li key={a.id} className="flex items-start gap-2">
                          <span aria-hidden className="mt-0.5 inline-block h-3.5 w-3.5 rounded-full border-2 border-dashed border-ink" />
                          <span className="font-extrabold">{a.title}</span>
                          <span className="text-[11px]">(set for you — checked in the app)</span>
                        </li>
                      ))}
                      {items.map((i) => (
                        <li key={i.id} className="flex items-start gap-2">
                          <span
                            aria-hidden
                            className={`mt-0.5 inline-block h-3.5 w-3.5 border-2 border-ink ${i.target ? 'rounded-full border-dashed' : 'rounded-sm'}`}
                          />
                          <span>
                            <span className="font-extrabold">{i.title}</span>
                            {i.courseId && courseById.get(i.courseId) ? ` · ${courseById.get(i.courseId)!.name}` : ''}
                            {i.minutes ? ` · ${i.minutes}m` : ''}
                            {i.purpose && <span className="block text-[11px]">{PURPOSE_COPY[i.purpose].line}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <footer className="mt-4 text-[11px] font-bold">
        Square boxes are your word. Dashed circles are checked by the app when the round is done — the paper cannot
        carry that mark, so tick them in the app.
      </footer>
    </div>
  )
}

function fmt(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
