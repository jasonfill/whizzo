// Deck construction, import parsing, and the small derived numbers the UI needs.
//
// Nothing in here touches progress. A deck is content; what the learner knows
// about it lives in `mastery` under `deckId:cardId`, so editing a deck never
// costs anyone their streak.

import { LEARNING_THRESHOLD, MASTERED_THRESHOLD } from '../adaptive'
import { richToPlain, splitOutsideRich, withoutRich } from '../rich/parse'
import {
  cardKey,
  masteryKey,
  type ItemMastery,
  type ProgressSnapshot,
  type QuizCard,
  type QuizDeck,
} from '../progress/types'

export const MAX_CARDS_PER_DECK = 300
export const MAX_TITLE_LENGTH = 80
/** Matches the API's ceiling. A figure is JSON inside the text, so it is not small. */
export const MAX_CARD_TEXT = 4000

export function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * How hard a card is to recall, on the same 1-5 scale as the learner's quiz
 * ability. There is no author-supplied rating because asking someone to grade
 * forty cards by hand guarantees they will not do it, so the estimate leans on
 * the two things that reliably predict difficulty for recall: how much has to
 * be produced, and how much of it is unfamiliar vocabulary.
 */
export function estimateDifficulty(term: string, definition: string): number {
  // Measured on the readable text, not the source: a card carrying a figure is
  // a few hundred characters of JSON, and rating it by that would make every
  // geometry question the hardest card in the deck.
  const answer = richToPlain(definition).trim()
  const words = answer.split(/\s+/).filter(Boolean).length
  const chars = answer.length

  let score = 1.6
  if (words >= 2) score += 0.35
  if (words >= 5) score += 0.5
  if (words >= 12) score += 0.6
  if (chars >= 40) score += 0.35
  if (chars >= 90) score += 0.4
  // A long prompt is a long thing to hold in mind before answering at all.
  if (richToPlain(term).trim().length >= 30) score += 0.3
  // Numerals and symbols are recalled precisely or not at all — no partial credit.
  if (/[0-9]/.test(answer)) score += 0.2

  return Math.min(5, Math.max(1, Math.round(score * 10) / 10))
}

export function makeCard(term: string, definition: string, hint: string | null = null): QuizCard {
  return {
    id: newId('c'),
    term: term.trim(),
    definition: definition.trim(),
    hint: hint?.trim() || null,
    difficulty: estimateDifficulty(term, definition),
  }
}

export function emptyDeck(): QuizDeck {
  const now = Date.now()
  return {
    id: newId('d'),
    title: '',
    description: '',
    tags: [],
    cards: [],
    source: 'user',
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: now,
    updatedAt: now,
  }
}

/** Recompute the derived fields so an edited deck stays internally consistent. */
export function normalizeDeck(deck: QuizDeck): QuizDeck {
  return {
    ...deck,
    title: deck.title.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled deck',
    description: deck.description.trim().slice(0, 300),
    tags: [...new Set(deck.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
    cards: deck.cards
      .filter((c) => c.term.trim() && c.definition.trim())
      .slice(0, MAX_CARDS_PER_DECK)
      .map((c) => ({
        ...c,
        term: c.term.trim().slice(0, MAX_CARD_TEXT),
        definition: c.definition.trim().slice(0, MAX_CARD_TEXT),
        hint: c.hint?.trim().slice(0, 1000) || null,
        difficulty: estimateDifficulty(c.term, c.definition),
        // Enrichment survives a normalize. `...c` already carries it; these
        // two are trimmed because an empty string is not a category, and a
        // card claiming a blank one would light up Sort with nothing in it.
        category: c.category?.trim() || null,
        example: c.example?.trim() || null,
      })),
    updatedAt: Date.now(),
  }
}

/**
 * Copy a starter deck into the learner's own collection. Starter decks are
 * read-only so that "edit" on one never silently forks everyone's shared copy;
 * taking a copy gives the learner something they own outright, with fresh ids
 * so their progress on the copy is tracked separately.
 */
export function copyDeck(deck: QuizDeck, title?: string): QuizDeck {
  const now = Date.now()
  return {
    ...deck,
    id: newId('d'),
    title: (title ?? `${deck.title} (my copy)`).slice(0, MAX_TITLE_LENGTH),
    source: 'user',
    cards: deck.cards.map((c) => ({ ...c, id: newId('c') })),
    createdAt: now,
    updatedAt: now,
  }
}

// --- Import ---------------------------------------------------------------

export type TermSeparator = 'tab' | 'comma' | 'dash' | 'colon' | 'auto'
export type CardSeparator = 'newline' | 'blank-line' | 'semicolon' | 'auto'

export interface ImportOptions {
  between?: TermSeparator
  rows?: CardSeparator
}

const TERM_PATTERNS: Record<Exclude<TermSeparator, 'auto'>, RegExp> = {
  tab: /\t+/,
  comma: /\s*,\s*/,
  dash: /\s+[-–—]\s+/,
  colon: /\s*:\s*/,
}

/**
 * Guess how the pasted text separates a term from its definition. Order is by
 * how unambiguous the separator is: a tab is never accidental, whereas a comma
 * shows up inside plenty of legitimate definitions, so it is tried last.
 */
function detectTermSeparator(rows: string[]): Exclude<TermSeparator, 'auto'> {
  // Counted on the prose only. A row carrying a figure contains a dozen colons
  // and commas inside the figure's JSON, and counting those picks a separator
  // that appears nowhere in the actual text — which then splits nothing, and
  // every row in the paste is reported as unparseable.
  const sample = rows.slice(0, 25).map(withoutRich)
  const hits = (re: RegExp) => sample.filter((r) => re.test(r)).length
  const order: Array<Exclude<TermSeparator, 'auto'>> = ['tab', 'dash', 'colon', 'comma']
  for (const key of order) {
    // Require the separator on most rows, not just one, so a single stray
    // hyphen in a definition cannot redefine the whole import.
    if (hits(TERM_PATTERNS[key]) >= Math.max(1, Math.ceil(sample.length * 0.6))) return key
  }
  return 'tab'
}

/**
 * Cut the paste into rows, never inside a figure or an equation. A figure is
 * JSON living in the card text, and JSON is made of the same commas, colons and
 * semicolons the importer splits on.
 */
function splitOn(text: string, rows: Exclude<CardSeparator, 'auto'>): string[] {
  if (rows === 'semicolon') return splitOutsideRich(text, /\s*;\s*/)
  if (rows === 'blank-line') return splitOutsideRich(text, /\n\s*\n/)
  return splitOutsideRich(text, /\n/)
}

function clean(rows: string[]): string[] {
  return rows.map((r) => r.trim()).filter(Boolean)
}

export interface ImportResult {
  cards: QuizCard[]
  /** Rows that had no recognizable answer side, surfaced rather than dropped. */
  skipped: string[]
  separator: Exclude<TermSeparator, 'auto'>
}

function buildCards(rows: string[], separator: Exclude<TermSeparator, 'auto'>): ImportResult {
  const pattern = TERM_PATTERNS[separator]
  const cards: QuizCard[] = []
  const skipped: string[] = []

  for (const row of rows) {
    if (cards.length >= MAX_CARDS_PER_DECK) break
    // A row may legitimately span several lines when entries are separated by
    // blank lines, so newlines inside one row collapse to spaces.
    const flat = row.replace(/\s*\n\s*/g, ' ').trim()
    const parts = splitOutsideRich(flat, pattern)
    const term = parts[0]?.trim() ?? ''
    // Everything after the first separator is the definition, so a definition
    // containing the separator survives intact.
    const definition = parts.slice(1).join(separator === 'comma' ? ', ' : ' ').trim()
    if (!term || !definition) {
      skipped.push(flat)
      continue
    }
    cards.push(makeCard(term, definition))
  }

  return { cards, skipped, separator }
}

/**
 * Turn pasted text into cards. Deliberately forgiving: the common case is a
 * teacher pasting a table out of a document, and rejecting the whole paste
 * because line 12 is malformed helps nobody. Bad rows come back in `skipped`
 * so the editor can show them instead of losing them.
 */
export function parseImport(text: string, opts: ImportOptions = {}): ImportResult {
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return { cards: [], skipped: [], separator: 'tab' }

  const parseWith = (rowMode: Exclude<CardSeparator, 'auto'>): ImportResult => {
    const rows = clean(splitOn(trimmed, rowMode))
    const separator =
      opts.between && opts.between !== 'auto' ? opts.between : detectTermSeparator(rows)
    return buildCards(rows, separator)
  }

  if (opts.rows && opts.rows !== 'auto') return parseWith(opts.rows)

  const byLine = parseWith('newline')
  if (!/\n\s*\n/.test(trimmed)) return byLine

  // Auto mode has to decide whether blank lines separate cards (with
  // definitions running over several lines) or are just stray empty lines in a
  // one-card-per-line list. Counting successful parses cannot tell them apart:
  // welding a malformed row onto the card below it *looks* like a cleaner
  // result precisely because it hides the bad row.
  //
  // The structural tell is where the separator sits. In a genuine multi-line
  // layout every block opens with its term, so the separator is on the block's
  // first line and the rest are continuations. A stray blank line instead
  // leaves a block whose first line has no separator at all — which is a
  // malformed row to report, not a card to invent.
  const blocks = clean(splitOn(trimmed, 'blank-line'))
  const multiLineLayout =
    blocks.length > 1 &&
    blocks.some((b) => b.includes('\n')) &&
    blocks.every((b) => TERM_PATTERNS[byLine.separator].test(b.split('\n')[0]))

  return multiLineLayout ? parseWith('blank-line') : byLine
}

/** Round-trip the other way, for the editor's bulk-edit box and for export. */
export function serializeCards(cards: QuizCard[]): string {
  return cards.map((c) => `${c.term}\t${c.definition}`).join('\n')
}

// --- Derived stats --------------------------------------------------------

export interface DeckStats {
  total: number
  seen: number
  mastered: number
  /** Getting there — right more often than not, but not yet reliable. */
  practiced: number
  learning: number
  due: number
  /** 0..1 average mastery across every card, counting unseen cards as zero. */
  progress: number
  lastStudiedAt: number | null
}

export function masteryForCard(
  snapshot: ProgressSnapshot,
  deckId: string,
  cardId: string,
): ItemMastery | undefined {
  return snapshot.mastery[masteryKey('quiz', cardKey(deckId, cardId))]
}

export function deckStats(
  snapshot: ProgressSnapshot,
  deck: QuizDeck,
  today: string,
): DeckStats {
  let seen = 0
  let mastered = 0
  let practiced = 0
  let learning = 0
  let due = 0
  let sum = 0
  let lastStudiedAt: number | null = null

  for (const card of deck.cards) {
    const m = masteryForCard(snapshot, deck.id, card.id)
    if (!m) continue
    seen += 1
    sum += m.mastery
    if (m.mastery >= MASTERED_THRESHOLD) mastered += 1
    else if (m.mastery >= LEARNING_THRESHOLD) practiced += 1
    else learning += 1
    if (m.dueOn && m.dueOn <= today) due += 1
    if (!lastStudiedAt || m.lastSeenAt > lastStudiedAt) lastStudiedAt = m.lastSeenAt
  }

  return {
    total: deck.cards.length,
    seen,
    mastered,
    practiced,
    learning,
    due,
    progress: deck.cards.length ? sum / deck.cards.length : 0,
    lastStudiedAt,
  }
}

export function findDeck(decks: QuizDeck[], id: string): QuizDeck | undefined {
  return decks.find((d) => d.id === id)
}

/**
 * Everything the learner can study: their own decks first, then the ones that
 * ship with the app. Starter decks are not stored in the snapshot — they are
 * constants — so they are folded in here rather than seeded on first run,
 * which keeps them updatable without a migration.
 */
export function allDecks(snapshot: ProgressSnapshot, starters: QuizDeck[]): QuizDeck[] {
  const mine = [...snapshot.decks].sort((a, b) => b.updatedAt - a.updatedAt)
  return [...mine, ...starters]
}
