import { useEffect, useMemo, useState } from 'react'
import { AREAS, tracksInArea } from '@whizzo/shared'
import RichField from '../../components/rich/RichField'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill } from '../../components/ui'
import { getLibraryDeck, saveLibraryDecks } from '../../lib/assignments/library'
import { useCoverage } from '../../lib/billing/coverage'
import { useProgress } from '../../lib/progress/ProgressProvider'
import type { QuizCard, QuizDeck } from '../../lib/progress/types'
import {
  MAX_CARDS_PER_DECK,
  emptyDeck,
  makeCard,
  normalizeDeck,
  parseImport,
  type CardSeparator,
  type TermSeparator,
} from '../../lib/quiz/decks'
import type { DeckScope } from '../../lib/quiz/scope'
import type { Navigate } from '../../routes'

/**
 * Deck editor. Two ways in, because there are two kinds of person making a
 * deck: the one pasting forty rows out of a study guide, and the one typing
 * six cards for tomorrow's test. Paste-import handles the first; the row
 * editor handles the second, and both write the same deck.
 *
 * The same editor serves a learner's deck and a library deck. Only where it
 * reads and writes differs: a library deck is fetched from and saved to the
 * grown-up's library, and the per-learner deck limit does not apply to it.
 */
export default function DeckEditor({
  deckId,
  scope = 'learner',
  navigate,
}: {
  deckId?: string
  scope?: DeckScope
  navigate: Navigate
}) {
  const { snapshot, saveDeck } = useProgress()
  const coverage = useCoverage()
  const inLibrary = scope === 'library'

  const existing = deckId && !inLibrary ? snapshot.decks.find((d) => d.id === deckId) : undefined
  const [draft, setDraft] = useState<QuizDeck>(() => existing ?? emptyDeck())
  const [showImport, setShowImport] = useState(!existing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A library deck being edited arrives from the API. Until it does there is
  // nothing to type into, and if it never does the screen says so rather than
  // offering to "edit" an empty deck under the old id.
  const [loading, setLoading] = useState(inLibrary && !!deckId)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!inLibrary || !deckId) return
    const controller = new AbortController()
    getLibraryDeck(deckId, controller.signal)
      .then((deck) => {
        if (controller.signal.aborted) return
        if (deck) {
          setDraft(deck)
          setShowImport(false)
        } else {
          setMissing(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMissing(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [deckId, inLibrary])

  const isNew = inLibrary ? !deckId : !existing
  const overDeckLimit = !inLibrary && isNew && snapshot.decks.length >= coverage.deckLimit

  /** Where leaving lands: the deck if there is one, else the list it came from. */
  const back = (): void =>
    navigate(
      inLibrary
        ? deckId
          ? { name: 'library-deck', deckId }
          : { name: 'library' }
        : deckId
          ? { name: 'quiz-deck', deckId }
          : { name: 'quiz' },
    )

  const update = (patch: Partial<QuizDeck>) => setDraft((d) => ({ ...d, ...patch }))

  const setCard = (id: string, patch: Partial<QuizCard>) =>
    setDraft((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))

  const addCard = () =>
    setDraft((d) => ({ ...d, cards: [...d.cards, makeCard('', '')] }))

  const removeCard = (id: string) =>
    setDraft((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))

  const moveCard = (id: string, delta: number) =>
    setDraft((d) => {
      const i = d.cards.findIndex((c) => c.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= d.cards.length) return d
      const cards = [...d.cards]
      ;[cards[i], cards[j]] = [cards[j], cards[i]]
      return { ...d, cards }
    })

  const ready = draft.title.trim().length > 0 && draft.cards.filter(isFilled).length >= 2

  const save = async () => {
    if (!ready || overDeckLimit) return
    setBusy(true)
    setError(null)
    try {
      const normalized = normalizeDeck(draft)
      if (inLibrary) {
        await saveLibraryDecks([normalized])
        navigate({ name: 'library-deck', deckId: normalized.id })
      } else {
        await saveDeck(normalized)
        navigate({ name: 'quiz-deck', deckId: normalized.id })
      }
    } catch (err) {
      console.warn('[cat-academy] deck save failed', err)
      setError('That did not save. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || missing) {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader
          title={loading ? 'Opening…' : 'Deck not found'}
          onBack={() => navigate({ name: 'library' })}
          backLabel="← Library"
        />
        <Card>
          <p className="font-bold text-muted">
            {loading ? 'Loading…' : 'That deck is not in your library any more.'}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title={isNew ? 'New deck 🃏' : 'Edit deck ✏️'}
        subtitle={
          inLibrary
            ? 'Yours to set for any learner you look after. Two sides to every card.'
            : 'Two sides to every card: what you are asked, and what you have to remember.'
        }
        onBack={back}
      />

      {overDeckLimit && (
        <Card className="mb-4">
          <p className="font-bold text-amber-700">
            All {coverage.deckLimit} decks for this learner are used.{' '}
            <button className="underline" onClick={() => navigate({ name: 'upgrade' })}>
              Covering them
            </button>{' '}
            removes the limit, or you can delete one you have finished with.
          </p>
        </Card>
      )}

      <Card className="mb-4">
        <label className="mb-1 block text-sm font-bold text-muted">Deck name</label>
        <input
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Chapter 7 — the Water Cycle"
          maxLength={80}
          className="mb-4 w-full rounded-xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        />

        <label className="mb-1 block text-sm font-bold text-muted">
          Description <span className="font-normal text-stone">(optional)</span>
        </label>
        <input
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Everything on Friday's test."
          maxLength={300}
          className="mb-4 w-full rounded-xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        />

        {/* Filing is an upgrade, never a gate: a deck with no subject is a
            working deck, it just shares one ability pool with everything else
            unfiled. Saying so out loud is the difference between an optional
            field and one people feel bad about skipping. */}
        <label className="mb-1 block text-sm font-bold text-muted" htmlFor="deck-track">
          Subject <span className="font-normal text-stone">(optional)</span>
        </label>
        <select
          id="deck-track"
          value={draft.track ?? ''}
          onChange={(e) => update({ track: e.target.value || null })}
          className="mb-1 w-full rounded-xl border-2 border-edge bg-white px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        >
          <option value="">Not sure yet</option>
          {AREAS.filter((area) => area.id !== 'general').map((area) => (
            <optgroup key={area.id} label={`${area.emoji} ${area.name}`}>
              {tracksInArea(area.id).map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mb-4 text-xs font-bold text-stone">
          Picking one keeps this set&rsquo;s progress separate, so a report can say how
          they are doing in <em>this</em> rather than an average of everything.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-bold text-muted">Call side one</label>
            <input
              value={draft.termLabel}
              onChange={(e) => update({ termLabel: e.target.value })}
              placeholder="Term"
              maxLength={24}
              className="w-full rounded-xl border-2 border-edge px-4 py-2.5 font-bold text-ink focus:border-ink focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-muted">Call side two</label>
            <input
              value={draft.definitionLabel}
              onChange={(e) => update({ definitionLabel: e.target.value })}
              placeholder="Definition"
              maxLength={24}
              className="w-full rounded-xl border-2 border-edge px-4 py-2.5 font-bold text-ink focus:border-ink focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {showImport ? (
        <ImportPanel
          onCancel={() => setShowImport(false)}
          onImport={(cards, replace) =>
            setDraft((d) => ({
              ...d,
              cards: replace ? cards : [...d.cards, ...cards],
            }))
          }
        />
      ) : (
        <Button variant="ghost" className="mb-4 w-full" onClick={() => setShowImport(true)}>
          📥 Paste a list instead
        </Button>
      )}

      <MathHelp />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-extrabold text-ink">
          Cards ({draft.cards.filter(isFilled).length})
        </h3>
        <Button variant="ghost" onClick={addCard} disabled={draft.cards.length >= MAX_CARDS_PER_DECK}>
          ➕ Add a card
        </Button>
      </div>

      <div className="mb-4 space-y-2">
        {draft.cards.length === 0 && (
          <Card>
            <p className="font-bold text-stone">
              No cards yet. Add one below, or paste a whole list at once.
            </p>
          </Card>
        )}
        {draft.cards.map((card, i) => (
          <div
            key={card.id}
            className="rounded-2xl bg-white/85 p-3 shadow ring-1 ring-hair"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-stone">
                Card {i + 1}
              </span>
              <div className="flex gap-1">
                <IconButton label="Move up" onClick={() => moveCard(card.id, -1)} disabled={i === 0}>
                  ↑
                </IconButton>
                <IconButton
                  label="Move down"
                  onClick={() => moveCard(card.id, 1)}
                  disabled={i === draft.cards.length - 1}
                >
                  ↓
                </IconButton>
                <IconButton label="Delete card" onClick={() => removeCard(card.id)}>
                  ✕
                </IconButton>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RichField
                value={card.term}
                onChange={(term) => setCard(card.id, { term })}
                placeholder={draft.termLabel}
                ariaLabel={`Card ${i + 1} ${draft.termLabel || 'term'}`}
              />
              <RichField
                value={card.definition}
                onChange={(definition) => setCard(card.id, { definition })}
                placeholder={draft.definitionLabel}
                ariaLabel={`Card ${i + 1} ${draft.definitionLabel || 'definition'}`}
                className="text-body"
              />
            </div>
          </div>
        ))}
      </div>

      {error && (
        <Card className="mb-4">
          <p className="font-bold text-rose-600">{error}</p>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={save} disabled={!ready || busy || overDeckLimit}>
          {busy ? 'Saving…' : `Save deck (${draft.cards.filter(isFilled).length} cards)`}
        </Button>
        <Button variant="ghost" onClick={back}>
          Cancel
        </Button>
      </div>
      {!ready && (
        <p className="mt-3 text-sm font-bold text-stone">
          A deck needs a name and at least two complete cards.
        </p>
      )}
    </div>
  )
}


/**
 * The one-paragraph version of the format, tucked away until asked for.
 *
 * Most decks never need it, so it does not get to take up room by default —
 * but somebody writing a geometry deck needs to know that `$` starts math
 * without going and finding documentation, so it is one click away rather than
 * one search away.
 */
function MathHelp() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-bold text-muted underline"
      >
        {open ? 'Hide' : 'Writing math and diagrams?'}
      </button>
      {open && (
        <Card className="mt-2">
          <ul className="space-y-2 text-sm font-bold text-body">
            <li>
              Put math between dollar signs: <Code>$\frac{'{3}'}{'{4}'}$</Code> draws three
              quarters, <Code>$x^2$</Code> draws x squared, <Code>$45^\circ$</Code> draws 45
              degrees.
            </li>
            <li>
              Two dollar signs — <Code>$$…$$</Code> — put the math on its own line, bigger.
            </li>
            <li>
              Equations copied out of Word or Google Docs can be pasted straight in; MathML is
              understood as it is.
            </li>
            <li>
              The <strong>Figure</strong> button drops in a shape or a chart you can edit. The
              preview under the box updates as you type.
            </li>
            <li>
              Typed answers are checked against what the math <em>says</em>, so an answer written
              as <Code>$\frac{'{3}'}{'{4}'}$</Code> is matched by typing <Code>3/4</Code>.
            </li>
          </ul>
        </Card>
      )}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-wash px-1 py-0.5 font-mono text-xs text-ink">{children}</code>
  )
}

function isFilled(card: QuizCard): boolean {
  return card.term.trim().length > 0 && card.definition.trim().length > 0
}

function IconButton({
  children,
  onClick,
  label,
  disabled,
}: {
  children: string
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-lg bg-quiet font-extrabold text-ink transition-colors hover:bg-wash disabled:opacity-30"
    >
      {children}
    </button>
  )
}

const TERM_OPTIONS: Array<{ id: TermSeparator; label: string }> = [
  { id: 'auto', label: 'Detect' },
  { id: 'tab', label: 'Tab' },
  { id: 'comma', label: 'Comma' },
  { id: 'dash', label: 'Dash' },
  { id: 'colon', label: 'Colon' },
]

const ROW_OPTIONS: Array<{ id: CardSeparator; label: string }> = [
  { id: 'auto', label: 'Detect' },
  { id: 'newline', label: 'New line' },
  { id: 'blank-line', label: 'Blank line' },
  { id: 'semicolon', label: 'Semicolon' },
]

function ImportPanel({
  onImport,
  onCancel,
}: {
  onImport: (cards: QuizCard[], replace: boolean) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [between, setBetween] = useState<TermSeparator>('auto')
  const [rows, setRows] = useState<CardSeparator>('auto')

  // Parsing on every keystroke is cheap and gives a live preview, which is the
  // only reliable way to tell someone their separator guess is wrong.
  const preview = useMemo(() => parseImport(text, { between, rows }), [text, between, rows])

  return (
    <Card className="mb-4">
      <h3 className="mb-1 text-xl font-extrabold text-ink">Paste a list 📥</h3>
      <p className="mb-3 font-bold text-muted">
        One card per line, with the two sides separated. Copying straight out of a spreadsheet or a
        table already works — that pastes as tabs.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'photosynthesis\tHow plants make food from sunlight\nmitochondria\tThe part of a cell that makes energy'}
        className="mb-3 w-full rounded-xl border-2 border-edge px-4 py-3 font-mono text-sm font-bold text-ink focus:border-ink focus:outline-none"
      />

      <div className="mb-3 flex flex-wrap gap-4">
        <SeparatorPicker
          label="Between the two sides"
          options={TERM_OPTIONS}
          value={between}
          onChange={setBetween}
        />
        <SeparatorPicker label="Between cards" options={ROW_OPTIONS} value={rows} onChange={setRows} />
      </div>

      {text.trim() && (
        <div className="mb-3 rounded-2xl bg-quiet p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill className="bg-pine/10 text-pine">
              {preview.cards.length} {preview.cards.length === 1 ? 'card' : 'cards'} found
            </Pill>
            {preview.skipped.length > 0 && (
              <Pill className="bg-sun/30 text-ink">
                {preview.skipped.length} {preview.skipped.length === 1 ? 'line' : 'lines'} skipped
              </Pill>
            )}
            <span className="text-xs font-bold text-stone">
              split on {preview.separator}
            </span>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {preview.cards.slice(0, 8).map((c) => (
              <div key={c.id} className="flex gap-2 text-sm">
                <span className="min-w-[8rem] font-extrabold text-ink">{c.term}</span>
                <span className="font-bold text-muted">{c.definition}</span>
              </div>
            ))}
            {preview.cards.length > 8 && (
              <p className="text-xs font-bold text-stone">
                …and {preview.cards.length - 8} more
              </p>
            )}
          </div>
          {preview.skipped.length > 0 && (
            <p className="mt-2 text-xs font-bold text-amber-700">
              Skipped because there was nothing on the far side of the separator:{' '}
              {preview.skipped.slice(0, 3).join(' · ')}
              {preview.skipped.length > 3 && ` · +${preview.skipped.length - 3} more`}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            onImport(preview.cards, true)
            onCancel()
          }}
          disabled={preview.cards.length === 0}
        >
          Use these {preview.cards.length || ''} cards
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onImport(preview.cards, false)
            onCancel()
          }}
          disabled={preview.cards.length === 0}
        >
          Add to what I have
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}

function SeparatorPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-edge">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`rounded-xl px-2.5 py-1 text-sm font-extrabold transition-colors ${
              value === o.id ? 'bg-ink text-white' : 'text-ink hover:bg-quiet'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
