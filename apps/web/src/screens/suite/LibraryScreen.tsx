import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import ScreenHeader from '../../components/suite/ScreenHeader'
import SharedWork from '../../components/suite/SharedWork'
import { Button, Card, Pill } from '../../components/ui'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import {
  deleteLibraryDeck,
  deleteLibraryList,
  loadLibrary,
  saveLibraryDecks,
  saveLibraryLists,
} from '../../lib/assignments/library'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { useProgress } from '../../lib/progress/ProgressProvider'
import type { CustomWordList, QuizDeck } from '../../lib/progress/types'
import { allDecks, newId } from '../../lib/quiz/decks'
import type { Navigate } from '../../routes'
import AssignForm from './AssignForm'
import { groupBySource } from '../../lib/library/groups'

/**
 * Everything a grown-up owns, and the place to set it as work.
 *
 * Content used to belong to a learner, which is fine for a child making their
 * own flashcards and wrong for anyone teaching more than one person: material
 * ends up filed under whichever student was on screen, and reusing it means
 * copying it. A library is content that is *yours* — built once, set for as
 * many learners as you like, and readable by a student only once you have
 * actually given it to them.
 *
 * Assigning lives here as well as on a child's task list, because "set this for
 * three of them" starts from the material, not from a child.
 */
export default function LibraryScreen({ navigate }: { navigate: Navigate }) {
  const { status, user } = useAuth()
  const { learners } = useLearners()
  const { snapshot } = useProgress()

  const [decks, setDecks] = useState<QuizDeck[]>([])
  const [lists, setLists] = useState<CustomWordList[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<{
    kind: 'deck' | 'list'
    ids: string[]
    label?: string
  } | null>(null)

  const groups = useMemo(() => groupBySource(decks), [decks])

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const lib = await loadLibrary(signal)
      if (!signal?.aborted) {
        setDecks(lib.decks)
        setLists(lib.customLists)
      }
    } catch {
      /* an empty library reads the same as one that would not load */
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, status])

  /** Decks belonging to the learners this grown-up looks after, worth copying in. */
  const learnerDecks = useMemo(
    () => allDecks(snapshot, STARTER_DECKS).filter((d) => d.source === 'user'),
    [snapshot],
  )

  const assignable = learners.filter((l) => l.authUserId !== user?.id)

  if (status !== 'signed-in') {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader title="Library 📚" onBack={() => navigate({ name: 'home' })} />
        <Card>
          <p className="mb-3 font-bold text-muted">
            A library holds the decks and word lists that are yours rather than any one
            learner&apos;s, so it needs an account.
          </p>
          <Button onClick={() => navigate({ name: 'auth' })}>Sign in</Button>
        </Card>
      </div>
    )
  }

  const copyIn = async (deck: QuizDeck) => {
    setBusy(deck.id)
    try {
      // A new id: this is a copy in your library, not a move of the child's.
      await saveLibraryDecks([{ ...deck, id: newId('d'), createdAt: Date.now(), updatedAt: Date.now() }])
      await load()
    } finally {
      setBusy(null)
    }
  }

  const copyListIn = async (list: CustomWordList) => {
    setBusy(list.id)
    try {
      await saveLibraryLists([{ ...list, id: newId('l') }])
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title="Library 📚"
        subtitle="Everything you have made, ready to set for any learner you look after."
        onBack={() => navigate({ name: 'home' })}
      />

      {/* The widest door into the library. Typing forty rows is the thing a
          grown-up will not do; handing over the chapter they already have is
          the thing they will. */}
      <Card className="mb-4">
        <p className="mb-1 font-extrabold text-ink">Have a document already?</p>
        <p className="mb-3 text-sm font-bold text-stone">
          A chapter, a study guide, a worksheet — hand it over and get cards back.
        </p>
        <Button onClick={() => navigate({ name: 'content-new' })}>Add a document</Button>
      </Card>

      {assigning && (
        <div className="mb-4">
          <AssignForm
            learners={assignable}
            defaultLearnerIds={[]}
            fixedTarget={assigning}
            onDone={() => setAssigning(null)}
            onCancel={() => setAssigning(null)}
          />
        </div>
      )}

      <Card className="mb-4">
        <h2 className="mb-1 text-xl font-extrabold text-ink">Your decks ({decks.length})</h2>
        <p className="mb-3 font-bold text-muted">
          Yours, not any one learner&apos;s. A student can only open one after you have set it for
          them.
        </p>
        {loading ? (
          <p className="font-bold text-stone">Loading…</p>
        ) : decks.length === 0 ? (
          <p className="font-bold text-stone">
            Nothing here yet. Copy one in from below, or make a deck and add it.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Grouped by the document each set came from. A chapter that came
                back as six sets is six rows under one heading with one button,
                rather than six rows the parent has to recognize and set one at
                a time. */}
            {groups.map((group) => (
              <section key={group.sourceId ?? 'loose'}>
                {group.sourceId && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-extrabold text-ink">{group.title}</h3>
                    <Pill className="bg-wash text-xs text-muted">
                      {group.decks.length} parts · {group.cards} cards
                    </Pill>
                    <Button
                      className="ml-auto"
                      onClick={() =>
                        setAssigning({
                          kind: 'deck',
                          ids: group.decks.map((d) => d.id),
                          label: group.title,
                        })
                      }
                    >
                      Set the whole thing
                    </Button>
                  </div>
                )}
                {/* The heading above is what makes this a document; a numbered
                    list under it is what makes it an order. */}
                <ol className="space-y-2">
                  {group.decks.map((deck, i) => (
                    <li
                      key={deck.id}
                      className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-hair"
                    >
                      {group.sourceId && (
                        <span className="font-mono text-xs font-bold text-faint">{i + 1}</span>
                      )}
                      <span className="font-extrabold text-ink">{deck.title}</span>
                      <Pill className="bg-wash text-xs text-muted">
                        {deck.cards.length} cards
                      </Pill>
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            setAssigning({ kind: 'deck', ids: [deck.id], label: deck.title })
                          }
                        >
                          Set as work
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy === deck.id}
                          onClick={async () => {
                            setBusy(deck.id)
                            try {
                              await deleteLibraryDeck(deck.id)
                              await load()
                            } finally {
                              setBusy(null)
                            }
                          }}
                        >
                          🗑️
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 text-xl font-extrabold text-ink">
          Your word lists ({lists.length})
        </h2>
        {loading ? (
          <p className="font-bold text-stone">Loading…</p>
        ) : lists.length === 0 ? (
          <p className="font-bold text-stone">No word lists of your own yet.</p>
        ) : (
          <ul className="space-y-2">
            {lists.map((list) => (
              <li
                key={list.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-hair"
              >
                <span className="font-extrabold text-ink">{list.title}</span>
                <Pill className="bg-wash text-xs text-muted">
                  {list.words.length} words
                </Pill>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy === list.id}
                    onClick={async () => {
                      setBusy(list.id)
                      try {
                        await deleteLibraryList(list.id)
                        await load()
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    🗑️
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Work already set — the same panel the task list shows, because "what
          have I given out?" belongs next to "what have I made?". */}
      <SharedWork />

      {(learnerDecks.length > 0 || snapshot.customLists.length > 0) && (
        <Card>
          <h2 className="mb-1 text-xl font-extrabold text-ink">Copy into your library</h2>
          <p className="mb-3 font-bold text-muted">
            Material that belongs to a learner. Copying leaves theirs alone and gives you one you
            can set for anybody.
          </p>
          <div className="flex flex-wrap gap-2">
            {learnerDecks.map((deck) => (
              <Button
                key={deck.id}
                variant="secondary"
                disabled={busy === deck.id}
                onClick={() => copyIn(deck)}
              >
                🃏 {deck.title}
              </Button>
            ))}
            {snapshot.customLists.map((list) => (
              <Button
                key={list.id}
                variant="secondary"
                disabled={busy === list.id}
                onClick={() => copyListIn(list)}
              >
                ✏️ {list.title}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
