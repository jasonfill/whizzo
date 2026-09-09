import { useMemo } from 'react'
import { forecast, retentionOf, retentionReading, todayString } from '@whizzo/shared'
import { useCoverage } from '../../lib/billing/coverage'
import { useLearners } from '../../lib/learners'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { Button, Card } from '../../components/ui'
import { breakdown, troubleWords } from '../../lib/spelling/stats'
import { ALL_WORDS } from '../../data/spelling'
import { bestStreak, gradedSessions, unaidedAccuracy } from '../../lib/progress/summary'
import type { Navigate } from '../../routes'

/**
 * The weekly sheet — a progress report on paper.
 *
 * This was on the pricing page for months with nothing behind it. What makes it
 * worth having is not that it is the dashboard in grayscale: a screen is
 * scanned and a sheet is *read*, often by somebody who was not there for any of
 * it — the other parent, a tutor at the start of a session, a teacher at a
 * conference. So it is ordered as an argument rather than as a dashboard: what
 * happened, whether it is sticking, and what to do about it, in that order.
 *
 * Print rules live in `print.css` and hang off `data-print-sheet`. Nothing here
 * uses a print-only stylesheet trick to hide the app chrome, because there is
 * no app chrome on this screen to hide — it is its own page, which is also what
 * makes the output predictable across browsers.
 */
export default function PrintableReport({ navigate }: { navigate: Navigate }) {
  const { snapshot } = useProgress()
  const { active } = useLearners()
  const coverage = useCoverage()

  const today = todayString()
  const items = useMemo(() => Object.values(snapshot.mastery), [snapshot.mastery])
  const retention = useMemo(() => retentionReading(items, today), [items, today])
  const week = useMemo(() => forecast(items, today), [items, today])

  const graded = gradedSessions(snapshot)
  const accuracy = unaidedAccuracy(snapshot)
  const spelling = breakdown(snapshot, ALL_WORDS)
  // Longer than the screen's four: a sheet is not scrolled, and the whole point
  // of printing one is to have the list in front of you.
  const trouble = troubleWords(snapshot, 20)

  /** The seven days this sheet covers. */
  const since = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d
  }, [])
  const weekSessions = graded.filter((s) => new Date(s.endedAt) >= since)

  if (!coverage.can('printableReports')) {
    return (
      <div className="mx-auto w-full max-w-2xl py-10">
        <Card>
          <h1 className="mb-2 text-2xl font-extrabold text-ink">A sheet to take away</h1>
          <p className="mb-4 font-bold text-muted">
            A one-page summary of the last week — what was practiced, what is sticking, and the
            words worth ten minutes together. Covering {active?.displayName ?? 'this learner'} turns
            it on.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate({ name: 'upgrade' })}>See what covering adds</Button>
            <Button variant="ghost" onClick={() => navigate({ name: 'progress' })}>
              Back to progress
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div data-print-sheet className="mx-auto w-full max-w-3xl py-6">
      {/* Everything in here is gone on paper — see print.css. A print button
          that prints itself is the classic bug in a page like this. */}
      <div data-print-hide className="mb-6 flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>🖨️ Print this sheet</Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'progress' })}>
          ← Back to progress
        </Button>
      </div>

      <header className="mb-6 border-b-2 border-ink pb-4">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          {active?.displayName ?? 'Learner'} — weekly progress
        </h1>
        <p className="mt-1 font-bold text-muted">
          The seven days to {formatDay(today)} · printed {formatDay(today)}
        </p>
      </header>

      <section className="mb-6">
        <SheetHeading>This week</SheetHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Rounds" value={String(weekSessions.length)} />
          <Figure
            label="Answered"
            value={String(weekSessions.reduce((n, s) => n + s.itemsTotal, 0))}
          />
          <Figure
            label="Unaided accuracy"
            value={accuracy === null ? '—' : `${accuracy}%`}
            note="Checked answers only"
          />
          <Figure label="Best streak" value={`${bestStreak(snapshot)} days`} />
        </div>
        {weekSessions.length === 0 && (
          <p className="mt-3 font-bold text-stone">
            No rounds in the last seven days. The figures below still describe everything before
            that.
          </p>
        )}
      </section>

      <section className="mb-6">
        <SheetHeading>Will it stick?</SheetHeading>
        {retention.tracked === 0 ? (
          <p className="font-bold text-stone">
            Nothing has been tested often enough to say yet.
          </p>
        ) : (
          <>
            <p className="mb-3 font-bold text-body">
              {retention.health}% of the {retention.tracked} things{' '}
              {active?.displayName ?? 'they'} {retention.tracked === 1 ? 'has' : 'have'} been tested
              on are on schedule or better.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Secure" value={String(retention.counts.secure)} note="Known for weeks" />
              <Figure label="Holding" value={String(retention.counts.holding)} note="On schedule" />
              <Figure label="Due" value={String(retention.counts.due)} note="Ready for a look" />
              <Figure
                label="Slipping"
                value={String(retention.counts.slipping + retention.counts.fragile)}
                note="Needs attention"
              />
            </div>
            <p className="mt-3 text-sm font-bold text-muted">
              Coming up:{' '}
              {week.map((d) => `${d.day.slice(8)} (${d.count})`).join(' · ')} — the day of the
              month, and how many things fall due on it.
            </p>
          </>
        )}
      </section>

      {/* The point of the sheet. Somebody sitting down with the learner should
          be able to work straight down this list. */}
      <section className="mb-6" data-print-keep>
        <SheetHeading>Worth ten minutes together</SheetHeading>
        {trouble.length === 0 ? (
          <p className="font-bold text-stone">Nothing is causing trouble at the moment.</p>
        ) : (
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-hair font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                <th className="py-1">Word</th>
                <th className="py-1">Unaided</th>
                <th className="py-1">Slipped</th>
                <th className="py-1">Standing</th>
              </tr>
            </thead>
            <tbody>
              {trouble.map((m) => (
                <tr key={m.itemKey} className="border-b border-hair/60">
                  <td className="py-1.5 font-extrabold text-ink">{m.itemKey}</td>
                  <td className="py-1.5 font-bold text-body">
                    {m.totalCorrect}/{m.totalAttempts}
                  </td>
                  <td className="py-1.5 font-bold text-body">{m.lapses}</td>
                  <td className="py-1.5 font-bold text-body">{STANDING[retentionOf(m, today)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-6">
        <SheetHeading>Spelling overall</SheetHeading>
        <p className="font-bold text-body">
          {spelling.mastered} of {spelling.total} words mastered · {spelling.learning} still being
          learned.
        </p>
      </section>

      <footer className="mt-8 border-t border-hair pt-3 text-[12px] font-bold text-stone">
        Every figure here counts only answers the app checked. Self-graded rounds are practice, and
        practice is not evidence.
      </footer>
    </div>
  )
}

/** How a retention band reads on paper, where there is no color to lean on. */
const STANDING: Record<string, string> = {
  slipping: 'Slipping',
  fragile: 'Keeps slipping',
  due: 'Due now',
  holding: 'On schedule',
  secure: 'Secure',
  new: 'Not tested yet',
}

function SheetHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
      {children}
    </h2>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-extrabold text-ink">{value}</div>
      <div className="text-[13px] font-extrabold text-body">{label}</div>
      {note && <div className="text-[11px] font-bold text-stone">{note}</div>}
    </div>
  )
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
