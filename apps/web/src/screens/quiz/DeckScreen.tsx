import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import ScreenHeader from '../../components/suite/ScreenHeader'
import RichText from '../../components/rich/RichText'
import { Button, Card, Pill, StarRow } from '../../components/ui'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { listKey, todayString, type QuizCard, type QuizDeck } from '../../lib/progress/types'
import {
  allDecks,
  copyDeck,
  deckStats,
  findDeck,
  isDraftDeck,
  masteryForCard,
} from '../../lib/quiz/decks'
import type { DeckScope } from '../../lib/quiz/scope'
import { MODES, type DirectionSetting } from '../../lib/quiz/session'
import type { Navigate } from '../../routes'
import { bandForGrade, tutorPacket } from '@whizzo/shared'
import { useLearners } from '../../lib/learners'
import {
  acceptLibraryDeck,
  deleteLibraryDeck,
  getLibraryDeck,
  saveLibraryDecks,
} from '../../lib/assignments/library'
import AssignForm from '../suite/AssignForm'

/**
 * One deck: what is in it, how it is going, and the ways to study it.
 *
 * In the library scope this is the grown-up's own deck. It is in no learner's
 * snapshot, so there is no mastery to show and no round to start — a round is
 * a learner practicing, and this deck reaches a learner only by being set as
 * work. What is left is what an owner needs: read it, change it, copy it, set
 * it, or delete it.
 */
export default function DeckScreen({
  deckId,
  scope = 'learner',
  navigate,
}: {
  deckId: string
  scope?: DeckScope
  navigate: Navigate
}) {
  const { snapshot, saveDeck, deleteDeck } = useProgress()
  const { user } = useAuth()
  const [direction, setDirection] = useState<DirectionSetting>('term-first')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [packetCopied, setPacketCopied] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { active, learners } = useLearners()
  const today = todayString()
  const inLibrary = scope === 'library'

  const decks = useMemo(() => allDecks(snapshot, STARTER_DECKS), [snapshot])

  // A library deck comes from the API rather than the snapshot. Three things
  // can come back and they read differently: still loading, not there, and
  // could not be fetched — the last is not "gone", and says so.
  type Load =
    | { status: 'loading' }
    | { status: 'missing' }
    | { status: 'failed' }
    | { status: 'ready'; deck: QuizDeck }
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!inLibrary) return
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    getLibraryDeck(deckId, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setLoad(d ? { status: 'ready', deck: d } : { status: 'missing' })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: 'failed' })
      })
    return () => controller.abort()
  }, [deckId, inLibrary, attempt])

  const deck = inLibrary ? (load.status === 'ready' ? load.deck : undefined) : findDeck(decks, deckId)
  const home = inLibrary ? ({ name: 'library' } as const) : ({ name: 'quiz' } as const)

  if (inLibrary && load.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader title="Opening…" onBack={() => navigate(home)} backLabel="← Library" />
        <Card>
          <p className="font-bold text-stone">Loading…</p>
        </Card>
      </div>
    )
  }

  if (inLibrary && load.status === 'failed') {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader title="Could not open that" onBack={() => navigate(home)} backLabel="← Library" />
        <Card>
          <p className="mb-3 font-bold text-muted">
            The deck is still there, but it could not be fetched. Check your connection.
          </p>
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </Card>
      </div>
    )
  }

  if (!deck) {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader
          title="Deck not found"
          onBack={() => navigate(home)}
          backLabel={inLibrary ? '← Library' : '← Back'}
        />
        <Card>
          <p className="font-bold text-muted">
            That deck is gone. It may have been deleted on another device.
          </p>
        </Card>
      </div>
    )
  }

  const stats = deckStats(snapshot, deck, today)
  const progress = snapshot.lists[listKey('quiz', deck.id)]
  const tooSmall = deck.cards.length < 2
  const assignable = learners.filter((l) => l.authUserId !== user?.id)

  const takeCopy = async () => {
    setBusy(true)
    try {
      const copy = copyDeck(deck)
      if (inLibrary) {
        await saveLibraryDecks([copy])
        navigate({ name: 'library-deck', deckId: copy.id })
      } else {
        await saveDeck(copy)
        navigate({ name: 'quiz-deck', deckId: copy.id })
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * A draft is a set somebody other than this grown-up wrote — an assistant
   * over the tutor connection, or ingestion from a document — in either
   * scope: an assistant can put a learner's own deck back into review as
   * easily as file a new one. Accepting is one action on the whole set: the
   * cards are right there to read, and editing exists for anyone who wants
   * to change one first. A learner's deck is accepted the way any hand-made
   * deck is, by the person saving it (docs/content-ingestion-spec.md).
   */
  const isDraft = isDraftDeck(deck)
  const accept = async () => {
    setAccepting(true)
    setAcceptError(null)
    try {
      if (inLibrary) {
        const acceptedAt = await acceptLibraryDeck(deck.id)
        setLoad({ status: 'ready', deck: { ...deck, acceptedAt } })
      } else {
        await saveDeck(deck)
      }
    } catch {
      setAcceptError('That did not save. Check your connection and try again.')
    } finally {
      setAccepting(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setDeleteError(null)
    try {
      if (inLibrary) await deleteLibraryDeck(deck.id)
      else await deleteDeck(deck.id)
      navigate(home)
    } catch {
      setDeleteError('That did not delete. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title={deck.title}
        subtitle={deck.description || `${deck.cards.length} cards`}
        onBack={() => navigate(home)}
        backLabel={inLibrary ? '← Library' : '← Decks'}
        right={
          // Stars are a learner's; a library deck shares its id with the copy
          // a student was set, so without this the header would show whoever
          // is on screen.
          !inLibrary && progress?.stars ? <StarRow stars={progress.stars} size={22} /> : undefined
        }
      />

      {isDraft && (
        /* The review. It cannot be set as work until accepted — the database
           refuses — so the way forward is here. Editing and saving counts as
           looking it over too, which the sentence says. */
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <Pill className="bg-sun/30 text-ink">Draft</Pill>
            <p className="flex-1 font-bold text-muted">
              {inLibrary
                ? 'Not looked over yet. Read the cards below and accept it to be able to set it as work — or edit and save, which counts.'
                : 'An assistant changed this deck. Read the cards below and accept it before it can be set as work — or edit and save, which counts.'}
            </p>
            <Button onClick={accept} disabled={accepting}>
              {accepting ? 'Accepting…' : '✓ Accept'}
            </Button>
          </div>
          {acceptError && <p className="mt-2 font-bold text-rose-600">{acceptError}</p>}
        </Card>
      )}

      {inLibrary && !isDraft ? (
        /* No progress here, and the reason why: a library deck is yours, and
           the learning happens on the copy a student sees once it is set. */
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-bold text-muted">
              Yours, not any one learner&apos;s. Progress shows up on a student&apos;s task list
              once you have set it for them.
            </p>
            <Button className="ml-auto" onClick={() => setAssigning(true)}>
              Set as work
            </Button>
          </div>
          {assigning && (
            <div className="mt-4">
              <AssignForm
                learners={assignable}
                defaultLearnerIds={[]}
                fixedTarget={{ kind: 'deck', ids: [deck.id], label: deck.title }}
                onDone={() => setAssigning(false)}
                onCancel={() => setAssigning(false)}
              />
            </div>
          )}
        </Card>
      ) : inLibrary ? null : (
        /* Progress summary */
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-4">
            <Stat label="Cards" value={String(stats.total)} />
            <Stat label="Mastered" value={String(stats.mastered)} />
            <Stat label="Still learning" value={String(stats.practiced + stats.learning)} />
            <Stat label="Not seen" value={String(stats.total - stats.seen)} />
            {stats.due > 0 && <Pill className="bg-sun/30 text-ink">🔁 {stats.due} due</Pill>}
          </div>
        </Card>
      )}

      {inLibrary ? null : tooSmall ? (
        <Card className="mb-5">
          <p className="font-bold text-amber-700">
            This deck needs at least two cards before you can study it.
          </p>
        </Card>
      ) : (
        <>
          {/* Which way round to ask */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold uppercase tracking-wide text-stone">
              Ask me with
            </span>
            <DirectionToggle
              value={direction}
              onChange={setDirection}
              termLabel={deck.termLabel}
              definitionLabel={deck.definitionLabel}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {MODES.map((mode) => {
              const play = (size?: number) =>
                navigate({ name: 'quiz-play', mode: mode.id, deckId: deck.id, direction, size })
              return (
                <div
                  key={mode.id}
                  className="flex flex-col rounded-3xl bg-white/85 shadow-xl ring-1 ring-hair backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-2xl"
                >
                  <button onClick={() => play()} className="flex-1 p-5 text-left">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-3xl">{mode.emoji}</span>
                      <h3 className="text-xl font-extrabold text-ink">{mode.name}</h3>
                      {mode.isTest && (
                        <Pill className="bg-rose-100 text-rose-600" title="Counts toward your score">
                          Graded
                        </Pill>
                      )}
                    </div>
                    <p className="font-bold text-muted">{mode.blurb}</p>
                  </button>
                  {/* A quick round is the default, but a four-way pick is fast
                      enough that the whole deck in one sitting is a reasonable
                      ask — and the way to make sure nothing was skipped. The
                      length rides in the route, so the link is shareable. */}
                  {mode.id === 'choice' && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-hair px-5 py-3">
                      <span className="text-xs font-extrabold uppercase tracking-wide text-stone">
                        Or
                      </span>
                      <button
                        onClick={() => play(deck.cards.length)}
                        className="rounded-xl bg-quiet px-3 py-1.5 text-sm font-extrabold text-ink transition-colors hover:bg-ink hover:text-white"
                      >
                        Run through all {deck.cards.length} cards
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* The tutor packet: a prompt plus the cards, for a voice conversation
          with no tools at all. It records nothing and says so — the real
          thing is a connected app (Account → Connected apps); this is for the
          car this afternoon. */}
      {!tooSmall && !inLibrary && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              const text = tutorPacket(
                deck,
                bandForGrade(active?.gradeHint),
                active?.displayName.split(/\s+/)[0] || 'the learner',
                active?.gradeHint ?? null,
              )
              try {
                await navigator.clipboard.writeText(text)
                setPacketCopied(true)
                setTimeout(() => setPacketCopied(false), 2500)
              } catch {
                /* nothing to do; the clipboard is unavailable here */
              }
            }}
          >
            {packetCopied ? 'Copied ✓' : '🗣️ Copy for a voice assistant'}
          </Button>
          <span className="text-sm font-bold text-stone">
            Paste into any assistant to practice out loud. Not recorded here — connect the app to
            count it.
          </span>
        </div>
      )}

      {/* Deck management */}
      <div className="mb-6 flex flex-wrap gap-2">
        {deck.source === 'starter' ? (
          <Button variant="ghost" onClick={takeCopy} disabled={busy}>
            {busy ? 'Copying…' : '📋 Make my own copy'}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() =>
                navigate(
                  inLibrary
                    ? { name: 'library-edit', deckId: deck.id }
                    : { name: 'quiz-edit', deckId: deck.id },
                )
              }
            >
              ✏️ Edit deck
            </Button>
            {/* A copy of a draft would come back accepted — the library insert
                stamps every new deck — so there is no copying until this one
                has been looked over. */}
            {!isDraft && (
              <Button variant="ghost" onClick={takeCopy} disabled={busy}>
                📋 Duplicate
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button variant="danger" onClick={remove} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete for good'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </>
        )}
      </div>

      {deleteError && <p className="mb-4 font-bold text-rose-600">{deleteError}</p>}

      {/* The cards themselves, weakest first so the list is useful to read */}
      <h3 className="mb-3 text-xl font-extrabold text-ink">
        Cards ({deck.cards.length})
      </h3>
      <div className="space-y-2">
        {deck.cards.map((card) => (
          <CardRow key={card.id} card={card} deckId={deck.id} showMastery={!inLibrary} />
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      <div className="text-xs font-bold uppercase tracking-wide text-stone">{label}</div>
    </div>
  )
}

function DirectionToggle({
  value,
  onChange,
  termLabel,
  definitionLabel,
}: {
  value: DirectionSetting
  onChange: (v: DirectionSetting) => void
  termLabel: string
  definitionLabel: string
}) {
  const options: Array<{ id: DirectionSetting; label: string }> = [
    { id: 'term-first', label: termLabel },
    { id: 'definition-first', label: definitionLabel },
    { id: 'mixed', label: 'Both ways' },
  ]
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-edge">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-xl px-3 py-1.5 text-sm font-extrabold transition-colors ${
            value === o.id ? 'bg-ink text-white' : 'text-ink hover:bg-quiet'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CardRow({
  card,
  deckId,
  showMastery,
}: {
  card: QuizCard
  deckId: string
  /** Off for a library deck: mastery is a learner's, and this deck is nobody's yet. */
  showMastery: boolean
}) {
  const { snapshot } = useProgress()
  const mastery = showMastery ? masteryForCard(snapshot, deckId, card.id) : undefined
  const score = mastery?.mastery ?? 0

  const band =
    !mastery || mastery.totalAttempts === 0
      ? { label: 'Not seen', className: 'bg-wash text-muted' }
      : score >= 0.8
        ? { label: 'Mastered', className: 'bg-pine/10 text-pine' }
        : score >= 0.45
          ? { label: 'Practiced', className: 'bg-pineSoft/30 text-pine' }
          : { label: 'Learning', className: 'bg-sun/30 text-ink' }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/80 px-4 py-3 ring-1 ring-hair">
      <RichText
        source={card.term}
        className="min-w-[9rem] flex-1 font-extrabold text-ink"
        figures="describe"
      />
      <RichText
        source={card.definition}
        className="flex-[2] font-bold text-muted"
        figures="describe"
      />
      {showMastery && <Pill className={`shrink-0 ${band.className}`}>{band.label}</Pill>}
    </div>
  )
}
