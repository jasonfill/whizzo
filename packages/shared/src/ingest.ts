// Landing generated content.
//
// Validation is total and it happens here, on the way in. Nothing reaches
// `decks.cards` unchecked — and "unchecked" now means something stronger than
// it used to, because the thing being checked is no longer a person's typing
// but a model's output, and the reader is a child.
//
// This lives in `shared` because it is the reason the rich module moved: the
// API is where generated content arrives, and a server that cannot tell a
// valid figure from a hallucinated one cannot accept content from a model.
//
// The rule running through all of it: **a dropped card is counted and
// reported, never silently discarded.** Silence about dropped content is how a
// parent ends up with a deck missing the word the test is on.

import { richProblems, richToPlain } from './rich/index.js'
import type { QuizCard } from './progress.js'

export const MAX_CARDS_PER_SET = 300
export const MAX_CARD_TEXT = 4000

/** What a model is asked to produce, before anything has been checked. */
export interface RawGeneratedCard {
  term?: unknown
  definition?: unknown
  hint?: unknown
  category?: unknown
  example?: unknown
  explanation?: unknown
  answerKind?: unknown
  tolerance?: unknown
  altAnswers?: unknown
  sourcePages?: unknown
}

export interface DroppedCard {
  /** Whatever there was of it, for the "2 skipped" line. */
  text: string
  reason: string
}

export interface ValidatedSet {
  cards: QuizCard[]
  dropped: DroppedCard[]
}

/**
 * What makes two questions the same question. Exported so a tool that edits
 * a deck by term matches cards the way ingestion dedupes them — anything
 * looser lets a trailing question mark turn a correction into a duplicate.
 */
export function dedupeKey(term: string): string {
  return richToPlain(term)
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown, limit = MAX_CARD_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function pages(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
    .slice(0, 8)
  return out.length ? out : undefined
}

/**
 * Whether a card's text is written in the grammar the app can render.
 *
 * `richProblems` is the same check the editor runs while an author is still
 * looking at the card. A model writes `$\frac{3}{4}$` and `[[figure {…}]]`
 * fluently and also, occasionally, writes something that nearly parses — and a
 * figure that fails to parse must never reach a quiz.
 */
export function cardTextProblems(term: string, definition: string): string[] {
  return [...richProblems(term), ...richProblems(definition)].map((p) =>
    typeof p === 'string' ? p : String((p as { message?: string }).message ?? p),
  )
}

/**
 * Turn whatever came back into cards, or say why each one could not be used.
 *
 * `makeCard` is injected rather than imported because id generation and
 * difficulty estimation live in the web app's deck module, and this has to run
 * on the server too. The ids are always ours: a model does not get to pick the
 * key a learner's mastery is stored against.
 */
export function validateGeneratedCards(
  raw: readonly RawGeneratedCard[],
  makeCard: (term: string, definition: string) => QuizCard,
): ValidatedSet {
  const cards: QuizCard[] = []
  const dropped: DroppedCard[] = []
  const seen = new Set<string>()

  for (const row of raw) {
    if (cards.length >= MAX_CARDS_PER_SET) {
      dropped.push({ text: text(row.term, 80), reason: 'This set is already full.' })
      continue
    }

    const term = text(row.term)
    const definition = text(row.definition)

    if (!term || !definition) {
      dropped.push({
        text: term || definition || '(empty)',
        reason: 'A card needs both a question and an answer.',
      })
      continue
    }

    // Compared on the readable projection with punctuation and spacing taken
    // out, so two cards asking the same thing in different notation are one
    // card. A model asked for six topics from one document will write the same
    // question twice more often than a person ever would.
    const key = dedupeKey(term)
    if (seen.has(key)) {
      dropped.push({ text: term, reason: 'Another card already asks this.' })
      continue
    }

    const problems = cardTextProblems(term, definition)
    if (problems.length) {
      dropped.push({ text: term, reason: problems[0] })
      continue
    }

    seen.add(key)
    const card = makeCard(term, definition)

    const hint = text(row.hint, 1000)
    const category = text(row.category, 60)
    const example = text(row.example, 600)
    const explanation = text(row.explanation, 600)
    const sourcePages = pages(row.sourcePages)

    // `answerKind: 'numeric'` where the answer is not a number is downgraded
    // rather than refused: the card is fine, the label was wrong, and grading
    // it as text is the safe reading.
    const claimsNumeric = row.answerKind === 'numeric'
    const numeric = claimsNumeric && isNumericAnswer(definition)

    cards.push({
      ...card,
      hint: hint || null,
      ...(category ? { category } : {}),
      ...(example ? { example } : {}),
      ...(explanation ? { explanation } : {}),
      ...(numeric ? { answerKind: 'numeric' as const } : {}),
      ...(numeric && typeof row.tolerance === 'number' && Number.isFinite(row.tolerance)
        ? { tolerance: Math.abs(row.tolerance) }
        : {}),
      ...(Array.isArray(row.altAnswers)
        ? {
            altAnswers: row.altAnswers
              .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
              .map((a) => a.trim().slice(0, 200))
              .slice(0, 8),
          }
        : {}),
      ...(sourcePages ? { sourcePages } : {}),
      // Everything a model wrote is marked as such, and the mark does not come
      // off on acceptance: accepting changes what the content is allowed to do,
      // not where it came from.
      generated: [
        'term',
        'definition',
        ...(hint ? ['hint'] : []),
        ...(category ? ['category'] : []),
        ...(example ? ['example'] : []),
        ...(explanation ? ['explanation'] : []),
      ],
    })
  }

  return { cards, dropped }
}

/** Whether an answer is a number a `solve` question could be graded against. */
export function isNumericAnswer(answer: string): boolean {
  const plain = richToPlain(answer).trim()
  if (!plain) return false
  // A bare number, a fraction, or either with a unit after it.
  return /^-?\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?(\s*[%°]|\s+\S{1,12})?$/.test(plain)
}

/** The line a parent reads after a run: "38 cards from 6 pages; 2 skipped." */
export function landingSummary(result: ValidatedSet, pagesRead: number): string {
  const cards = `${result.cards.length} card${result.cards.length === 1 ? '' : 's'}`
  const from = pagesRead > 0 ? ` from ${pagesRead} page${pagesRead === 1 ? '' : 's'}` : ''
  const skipped = result.dropped.length ? `; ${result.dropped.length} skipped` : ''
  return `${cards}${from}${skipped}.`
}
