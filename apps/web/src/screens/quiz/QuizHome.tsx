import { useMemo, useState } from 'react'
import Mascot from '../../components/Mascot'
import MasteryBar from '../../components/suite/MasteryBar'
import ScreenHeader from '../../components/suite/ScreenHeader'
import SourcePill from '../../components/suite/SourcePill'
import { Button, Card, Pill, StarRow } from '../../components/ui'
import { useCoverage } from '../../lib/billing/coverage'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { listKey, todayString, type QuizDeck } from '../../lib/progress/types'
import { deckStats } from '../../lib/quiz/decks'
import { dueAcrossDecks } from '../../lib/quiz/session'
import { useLearnerDecks, useStarterCatalog } from '../../lib/quiz/useLearnerDecks'
import type { Navigate } from '../../routes'

/**
 * The learner's decks: the ones they made, the ones a grown-up set as a task,
 * and the starter decks they chose to add. Nothing else is here, and every
 * total counts only this list (docs/ux-coherence.md). The starters not yet
 * added wait below as a catalog.
 */
export default function QuizHome({ navigate }: { navigate: Navigate }) {
  const { snapshot, skill } = useProgress()
  const state = skill('quiz')
  const coverage = useCoverage()
  const today = todayString()

  const decks = useLearnerDecks()
  const catalog = useStarterCatalog()
  const due = useMemo(() => dueAcrossDecks(snapshot, decks, today), [snapshot, decks, today])

  const totals = useMemo(() => {
    let cards = 0
    let mastered = 0
    let practiced = 0
    let learning = 0
    for (const deck of decks) {
      const s = deckStats(snapshot, deck, today)
      cards += s.total
      mastered += s.mastered
      practiced += s.practiced
      learning += s.learning
    }
    return { cards, mastered, practiced, learning }
  }, [decks, snapshot, today])

  // The free tier counts what the learner made. A deck set by a grown-up is
  // the grown-up's, and a starter deck is nobody's, so neither is held
  // against them — the API counts the same way.
  const owned = useMemo(() => snapshot.decks.filter((d) => d.source === 'user').length, [snapshot.decks])
  const atLimit = owned >= coverage.deckLimit

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ScreenHeader
        title="Flashcards 🃏"
        subtitle="Decks for anything you need to know by heart."
        back={{ name: 'home' }}
        backLabel="← Home"
      />

      {/* Streak and totals */}
      <div className="mb-5 rounded-3xl bg-gradient-to-r from-emerald-300 to-teal-400 p-1 shadow-lg">
        <div className="rounded-[22px] bg-white/92 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide text-stone">
                Your cards
              </p>
              <h2 className="text-2xl font-extrabold text-ink">
                {totals.mastered} of {totals.cards} mastered
              </h2>
              <p className="font-bold text-muted">
                {state.streakDays > 0
                  ? `🔥 ${state.streakDays} day streak — keep it going.`
                  : 'Study any deck today to start a streak.'}
              </p>
            </div>
            <Mascot mood={totals.mastered > 0 ? 'cheer' : 'idle'} size={72} />
          </div>
          <MasteryBar
            className="mt-4"
            total={totals.cards}
            mastered={totals.mastered}
            practiced={totals.practiced}
            learning={totals.learning}
          />
        </div>
      </div>

      {/* The cross-deck review queue — the thing spaced repetition is for. */}
      {due.length > 0 && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-xl font-extrabold text-ink">Due for review</h3>
                <Pill className="bg-sun/30 text-ink">🔁 {due.length} cards</Pill>
              </div>
              <p className="font-bold text-muted">
                Cards from every deck that you are about to forget. Ten minutes here beats an hour
                the night before.
              </p>
            </div>
            <Button
              onClick={() =>
                navigate({ name: 'quiz-play', mode: 'review', size: Math.min(due.length, 20) })
              }
            >
              🔁 Review {Math.min(due.length, 20)} cards
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-2xl font-extrabold text-ink">My decks</h3>
        <Button onClick={() => navigate({ name: 'quiz-edit' })} disabled={atLimit}>
          ➕ New deck
        </Button>
      </div>

      {atLimit && (
        <Card className="mb-4">
          <p className="font-bold text-amber-700">
            An uncovered learner saves {coverage.deckLimit} decks of their own.{' '}
            <button className="underline" onClick={() => navigate({ name: 'upgrade' })}>
              Covering them
            </button>{' '}
            removes the limit. Starter decks and decks set by a grown-up do not count.
          </p>
        </Card>
      )}

      {decks.length === 0 ? (
        <Card className="mb-6">
          <p className="mb-3 font-bold text-muted">
            No decks yet. Make one by pasting a list — vocabulary, dates, formulas, anything with
            two sides to it — or add a starter deck below.
          </p>
          <Button onClick={() => navigate({ name: 'quiz-edit' })}>➕ Make my first deck</Button>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} navigate={navigate} />
          ))}
        </div>
      )}

      <h3 className="mb-1 text-2xl font-extrabold text-ink">Add a starter deck</h3>
      {catalog.available.length === 0 ? (
        <p className="mb-3 font-bold text-muted">
          Every starter deck is in your list. Remove one from its own page if you are done with
          it.
        </p>
      ) : (
        <>
          <p className="mb-3 font-bold text-muted">
            Decks that ship with Whizzo. Nothing is yours until you add it.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {catalog.available.map((deck) => (
              <StarterCard
                key={deck.id}
                deck={deck}
                disabled={catalog.busy || !catalog.canAdd}
                onAdd={() => catalog.add(deck.id)}
              />
            ))}
          </div>
          {!catalog.canAdd && (
            <p className="mt-3 text-sm font-bold text-stone">
              Sign in and pick a learner to add one.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function DeckCard({ deck, navigate }: { deck: QuizDeck; navigate: Navigate }) {
  const { snapshot } = useProgress()
  const today = todayString()
  const stats = deckStats(snapshot, deck, today)
  const progress = snapshot.lists[listKey('quiz', deck.id)]

  return (
    <button
      onClick={() => navigate({ name: 'quiz-deck', deckId: deck.id })}
      className="rounded-3xl bg-white/85 p-5 text-left shadow-xl ring-1 ring-hair backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-2xl"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-extrabold text-ink">{deck.title}</h4>
          <p className="text-sm font-bold text-stone">
            {deck.cards.length} cards
            {stats.seen > 0 && ` · ${stats.mastered} mastered`}
          </p>
        </div>
        <SourcePill source={deck.source} />
      </div>

      {deck.description && (
        <p className="mb-3 text-sm font-bold text-muted">{deck.description}</p>
      )}

      <div className="mb-3 h-2 overflow-hidden rounded-full bg-wash">
        <div
          className="h-full rounded-full bg-pine transition-all"
          style={{ width: `${Math.round(stats.progress * 100)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {stats.due > 0 && <Pill className="bg-sun/30 text-ink">🔁 {stats.due} due</Pill>}
        {progress?.stars ? <StarRow stars={progress.stars} size={18} /> : null}
        {stats.lastStudiedAt && (
          <span className="text-xs font-bold text-stone">
            Last studied {new Date(stats.lastStudiedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </button>
  )
}

/** A starter deck not yet added: what it is, how big, and one button. */
function StarterCard({
  deck,
  disabled,
  onAdd,
}: {
  deck: QuizDeck
  disabled: boolean
  onAdd: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      await onAdd()
    } catch {
      setError('That did not save. Check your connection and try again.')
    } finally {
      setAdding(false)
    }
  }
  return (
    <div className="flex flex-col rounded-3xl bg-white/70 p-5 ring-1 ring-hair">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-extrabold text-ink">{deck.title}</h4>
          <p className="text-sm font-bold text-stone">{deck.cards.length} cards</p>
        </div>
        <Pill className="shrink-0 bg-teal-100 text-teal-700">Starter</Pill>
      </div>
      {deck.description && <p className="mb-3 text-sm font-bold text-muted">{deck.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={add} disabled={disabled || adding} aria-label={`Add ${deck.title}`}>
          {adding ? 'Adding…' : '➕ Add'}
        </Button>
        {error && <span className="text-sm font-bold text-rose-600">{error}</span>}
      </div>
    </div>
  )
}
