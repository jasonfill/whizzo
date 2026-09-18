import { useMemo, useState } from 'react'
import { useCoverage } from '../../lib/billing/coverage'
import type { Navigate } from '../../routes'
import { useProgress } from '../../lib/progress/ProgressProvider'
import {
  activityLabel,
  formatDuration,
  partlyChecked,
} from '../../lib/progress/roundLabels'
import { addDays, todayString } from '../../lib/progress/types'
import type { SessionRecord } from '../../lib/progress/types'
import { Button } from '../ui'
import SessionDetail from './SessionDetail'

/** How many rounds show before the list asks whether you want the rest. */
const FIRST_PAGE = 10

/**
 * Every round played on one deck, newest first, each one openable to the
 * answers behind it.
 *
 * This is the deck's own slice of the Progress log — the same rows, the same
 * labels — so a grown-up standing on a deck can see what has been done with
 * it without going to the report and finding the deck in a longer list. A
 * tutor round shows here too, practice-only when nothing was checked.
 */
export default function DeckHistory({
  deckId,
  learnerName,
  navigate,
}: {
  deckId: string
  learnerName?: string
  /** For the coverage link; absent means the link is not offered. */
  navigate?: Navigate
}) {
  const { snapshot } = useProgress()
  const coverage = useCoverage()
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const rounds = useMemo(
    () =>
      snapshot.sessions
        .filter((s) => s.subject === 'quiz' && s.listId === deckId)
        .sort((a, b) => b.endedAt - a.endedAt),
    [snapshot.sessions, deckId],
  )

  // The same window Progress draws: an uncovered learner sees the recent
  // rounds and is told how many are older, never shown fewer in silence.
  const horizon = Number.isFinite(coverage.historyDays)
    ? addDays(todayString(), -coverage.historyDays)
    : '0000-00-00'
  const visible = rounds.filter((s) => new Date(s.endedAt).toISOString().slice(0, 10) >= horizon)
  const hidden = rounds.length - visible.length
  const shown = showAll ? visible : visible.slice(0, FIRST_PAGE)
  const more = visible.length - shown.length

  return (
    <section className="rounded-[20px] border border-hair bg-chalk p-5">
      <h2 className="mb-1 font-display text-xl font-extrabold text-ink">Rounds on this deck</h2>
      <p className="mb-3 text-sm font-bold text-muted">
        {learnerName ? `Every round ${learnerName} has played here.` : 'Every round played here.'}{' '}
        Open one to see each answer.
      </p>

      {visible.length === 0 ? (
        <p className="font-bold text-stone">No rounds on this deck yet.</p>
      ) : (
        <ul className="divide-y divide-hair">
          {shown.map((s) => (
            <Row key={s.id} session={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        </ul>
      )}

      {more > 0 && (
        <div className="mt-3">
          <Button variant="ghost" onClick={() => setShowAll(true)}>
            Show {more} more
          </Button>
        </div>
      )}

      {hidden > 0 && (
        <p className="mt-3 rounded-xl bg-spark/10 px-4 py-3 text-[14px] font-bold text-[#7C4A22]">
          {hidden} older {hidden === 1 ? 'round is' : 'rounds are'} outside the{' '}
          {coverage.historyDays}-day window.{' '}
          <button className="underline" onClick={() => navigate?.({ name: 'upgrade' })}>
            Covering this learner
          </button>{' '}
          keeps the full history.
        </p>
      )}
    </section>
  )
}

function Row({
  session: s,
  open,
  onToggle,
}: {
  session: SessionRecord
  open: boolean
  onToggle: () => void
}) {
  const when = new Date(s.endedAt)
  return (
    <li className="py-1">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 rounded-xl px-1 py-2 text-left hover:bg-quiet"
      >
        <span className="text-xs font-bold text-stone">{open ? '▾' : '▸'}</span>
        <span className="text-xs font-bold text-stone">
          {when.toLocaleDateString()}{' '}
          {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
        <span className="font-extrabold text-ink">{activityLabel(s.activity, s.subject)}</span>
        <span className="font-bold text-muted">
          {s.itemsCorrect}/{s.itemsTotal} · {Math.round(s.accuracy)}%
        </span>
        <span className="text-xs font-bold text-stone">⏱️ {formatDuration(s.durationMs)}</span>
        {/* Load-bearing: a practice round says so, in the words the learner
            saw when they played it. */}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
            s.isTest ? 'bg-pine/10 text-pine' : 'bg-wash text-muted'
          }`}
        >
          {s.isTest ? 'Graded' : 'Practice only'}
        </span>
        {partlyChecked(s) && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-700"
            title={`${s.verifiedItemsTotal} of ${s.itemsTotal} answers were checked by the app; the rest were self-graded.`}
          >
            {s.verifiedItemsTotal}/{s.itemsTotal} checked
          </span>
        )}
      </button>
      {open && <SessionDetail session={s} />}
    </li>
  )
}
