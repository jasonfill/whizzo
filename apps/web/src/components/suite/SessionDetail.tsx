import { useEffect, useState } from 'react'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { allDecks } from '../../lib/quiz/decks'
import type { Attempt, SessionRecord } from '../../lib/progress/types'

/**
 * The answers behind one session.
 *
 * This is the oversight view: a grown-up opens a round and sees what the score
 * was actually made of. Every answer, in the order it was given, including a
 * card that came round twice — what was asked, what the child said, how long
 * they took, and whether the app checked the answer or the child graded
 * themselves.
 *
 * Attempts are fetched when the row is opened rather than held in the
 * snapshot: a year of practice is a lot of rows and nobody needs them until
 * they look.
 */
export default function SessionDetail({ session }: { session: SessionRecord }) {
  const { snapshot, attemptsForSession } = useProgress()
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    setError(null)
    attemptsForSession(session.id)
      .then((rows) => {
        if (!canceled) setAttempts(rows)
      })
      .catch(() => {
        if (!canceled) setError('Could not load the answers for this round.')
      })
    return () => {
      canceled = true
    }
  }, [attemptsForSession, session.id])

  const decks = allDecks(snapshot, STARTER_DECKS)

  // How long the round took and where its numbers came from are worth showing
  // whatever else is or is not available, so the header sits above every
  // branch below rather than inside the happy path.
  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold">
      <span className="rounded-full bg-wash px-2 py-0.5 text-muted">
        ⏱️ {formatDuration(session.durationMs)}
      </span>
      <span className="rounded-full bg-wash px-2 py-0.5 text-muted">
        {new Date(session.startedAt).toLocaleString()}
      </span>
      <EvidenceBadge session={session} />
    </div>
  )

  if (error) {
    return (
      <div className="py-2">
        {header}
        <p className="font-bold text-rose-500">{error}</p>
      </div>
    )
  }
  if (!attempts) {
    return (
      <div className="py-2">
        {header}
        <p className="font-bold text-stone">Loading the answers…</p>
      </div>
    )
  }
  if (attempts.length === 0) {
    return (
      <div className="py-2">
        {header}
        <p className="font-bold text-stone">
          {session.subject === 'typing'
            ? 'Typing rounds are recorded as a whole — there are no separate questions to show.'
            : 'No answers were kept for this round. Rounds played before this device started recording them show their score only.'}
        </p>
      </div>
    )
  }

  // How many times each item has been seen so far, so a card that came back
  // reads as a second go rather than as a duplicate row.
  const seen = new Map<string, number>()

  return (
    <div className="py-2">
      {header}

      <ol className="space-y-1.5">
        {attempts.map((a, i) => {
          const count = (seen.get(a.itemKey) ?? 0) + 1
          seen.set(a.itemKey, count)
          const label = itemLabel(a, decks)
          return (
            <li
              key={`${a.itemKey}-${i}`}
              className={`rounded-xl px-3 py-2 ${a.correct ? 'bg-emerald-50' : 'bg-rose-50'}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm">{a.correct ? '✅' : '❌'}</span>
                <span className="font-extrabold text-ink">{label.title}</span>
                {label.detail && (
                  <span className="text-sm font-bold text-muted">{label.detail}</span>
                )}
                {count > 1 && (
                  <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-extrabold text-ink">
                    try {count}
                  </span>
                )}
                {!a.verified && (
                  <span
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-700"
                    title="The learner graded this one themselves — the app did not check it."
                  >
                    self-graded
                  </span>
                )}
                {a.hintsUsed > 0 && (
                  <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-extrabold text-muted">
                    💡 {a.hintsUsed}
                  </span>
                )}
                <span className="ml-auto text-xs font-bold text-stone">
                  {formatMs(a.responseMs)}
                </span>
              </div>
              <p className="mt-0.5 text-sm font-bold text-muted">{answerLine(a)}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function EvidenceBadge({ session }: { session: SessionRecord }) {
  const evidence = session.evidence ?? 'legacy'
  if (evidence === 'attempts') {
    return (
      <span
        className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700"
        title="These totals were worked out from the answers below, not taken from the app's own summary."
      >
        ✓ counted from the answers
      </span>
    )
  }
  if (evidence === 'client') {
    return (
      <span
        className="rounded-full bg-wash px-2 py-0.5 text-muted"
        title="This kind of round is recorded as a whole rather than question by question."
      >
        whole-round score
      </span>
    )
  }
  return (
    <span
      className="rounded-full bg-wash px-2 py-0.5 text-muted"
      title="Recorded before rounds started carrying their own evidence."
    >
      recorded earlier
    </span>
  )
}

/**
 * What the learner was actually asked.
 *
 * Spelling stores the word itself, so it reads as-is. Quiz stores
 * `deckId:cardId`, which means nothing to a person — the deck is looked up so
 * a parent sees the card rather than an identifier.
 */
function itemLabel(
  attempt: Attempt,
  decks: ReturnType<typeof allDecks>,
): { title: string; detail?: string } {
  if (attempt.subject !== 'quiz') return { title: attempt.itemKey }

  for (const deck of decks) {
    for (const card of deck.cards) {
      if (`${deck.id}:${card.id}` === attempt.itemKey) {
        return { title: card.term, detail: card.definition }
      }
    }
  }
  // The deck was deleted after the round was played. The answer still stands
  // as a record; there is just nothing left to name it with.
  return { title: 'A card from a deleted deck' }
}

/** What they said. Flashcards have no typed answer — the grade *is* the answer. */
function answerLine(attempt: Attempt): string {
  if (!attempt.verified) {
    return attempt.correct ? 'Said they knew it' : 'Said they were still learning it'
  }
  if (!attempt.given) return attempt.correct ? 'Answered correctly' : 'No answer given'
  return `Answered "${attempt.given}"`
}

function formatMs(ms: number | null): string {
  if (ms === null || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
