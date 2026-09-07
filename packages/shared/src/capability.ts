// What a set can actually be practised with.
//
// This is the single mechanism behind "load content once, practise it many
// ways": rather than every screen keeping its own list of activities and
// hoping the content supports them, one function reads what the cards carry
// and says what can run.
//
// Two rules run through it.
//
// **Degrade, never refuse.** An activity whose field is missing falls back to
// the nearest one that works. The adult never sees an error about their
// content, only a quieter version of the same lesson.
//
// **Capability is a function of the text, not only of the fields.** Card text
// is not plain text — `$…$`, `<math>` and `[[figure {…}]]` all mean something
// (docs/card-formatting.md) — and that changes what can be asked.

import { activityDef, ACTIVITY_CATALOG, type ActivityDef, type ActivitySubject } from './activities.js'
import type { QuizCard, QuizDeck } from './progress.js'
import { hasRich, parseRich, richToPlain } from './rich/index.js'

export type Availability = 'ready' | 'partial' | 'locked'

export interface ActivityAvailability {
  activity: string
  status: Availability
  /** How many of the set's cards this can run on. */
  usableCards: number
  /** Said in words, for the screen that shows it. */
  reason: string
  /** What to offer instead when this is not `ready`. */
  fallback: string | null
}

/**
 * Whether the answer side is plain enough to be chopped into characters.
 *
 * This is the rule that would otherwise put a broken question in front of a
 * child. `$\frac{3}{4}$` scrambled is not a puzzle, it is nonsense, and
 * `M______` on a card whose answer is a bar chart means nothing at all. Every
 * activity that manipulates the *characters* of an answer — Scramble, Starts
 * With, Missing Letters, letter tiles — declares `plain-answer` and is locked
 * out here.
 *
 * Note this asks about the *answer*, not the card: a geometry question whose
 * prompt carries a figure and whose answer is "12 cm" is perfectly scrambleable.
 */
export function hasPlainAnswer(card: Pick<QuizCard, 'definition'>): boolean {
  if (!hasRich(card.definition)) return true
  return parseRich(card.definition).every((node) => node.type === 'text')
}

/**
 * Whether both sides of a card can be said out loud.
 *
 * The tutor (docs/mcp-tutor-spec.md) asks the prompt and listens for the
 * answer, so a figure on either side is out, as is a photograph. Maths passes
 * when its plain-text projection is something a person would say — `3/4`
 * speaks, `\\frac{dy}{dx}` does not, and the projection is where that is
 * decided: anything still carrying a backslash after projection is not
 * speakable yet.
 */
export function isSpeakable(card: Pick<QuizCard, 'term' | 'definition' | 'media'>): boolean {
  if (card.media) return false
  for (const side of [card.term, card.definition]) {
    if (!side?.trim()) return false
    // A figure is unsayable whether or not it validates: a broken one reads
    // aloud as a paragraph of JSON, which is worse.
    if (/\[\[\s*figure\b/i.test(side)) return false
    if (!hasRich(side)) continue
    if (parseRich(side).some((node) => node.type === 'figure')) return false
    if (richToPlain(side).includes('\\')) return false
  }
  return true
}

function cardSupports(card: QuizCard, activity: ActivityDef, poolSize: number): boolean {
  for (const need of activity.requires) {
    switch (need) {
      case 'plain-answer':
        if (!hasPlainAnswer(card)) return false
        break
      case 'example':
        if (!card.example?.trim()) return false
        break
      case 'pool':
        // Multiple choice and matching need other cards to draw from. A
        // three-card deck cannot support them, which is why `buildQuestion`
        // already degrades to written rather than showing one option.
        if (poolSize < MIN_POOL) return false
        break
      case 'speakable':
        if (!isSpeakable(card)) return false
        break
    }
  }
  return true
}

/** Below this a set cannot offer a choice worth making. */
export const MIN_POOL = 4

/**
 * What each activity can do with this set.
 *
 * `partial` is the status that makes enrichment incremental rather than a
 * gate: a set where nineteen of forty cards have a category can still play
 * Sort, on nineteen of them.
 */
export function availableActivities(
  deck: Pick<QuizDeck, 'cards'>,
  subject: ActivitySubject = 'quiz',
): ActivityAvailability[] {
  const cards = deck.cards
  const pool = cards.length

  return ACTIVITY_CATALOG.filter((a) => a.subjects.includes(subject)).map((activity) => {
    const usableCards = cards.filter((c) => cardSupports(c, activity, pool)).length
    const status: Availability =
      pool === 0 ? 'locked' : usableCards === pool ? 'ready' : usableCards > 0 ? 'partial' : 'locked'

    return {
      activity: activity.id,
      status,
      usableCards,
      reason: reasonFor(activity, status, usableCards, pool),
      fallback: status === 'ready' ? null : resolveFallback(activity, deck, subject),
    }
  })
}

function reasonFor(
  activity: ActivityDef,
  status: Availability,
  usable: number,
  total: number,
): string {
  if (total === 0) return 'This set has no cards yet.'
  if (status === 'ready') return 'Ready.'
  const missing = activity.requires
  if (missing.includes('pool') && total < MIN_POOL) {
    return `Needs at least ${MIN_POOL} cards to draw wrong answers from.`
  }
  if (missing.includes('plain-answer')) {
    return status === 'locked'
      ? 'These answers are equations or figures, which cannot be taken apart letter by letter.'
      : `Works on ${usable} of ${total} — the rest are equations or figures.`
  }
  if (missing.includes('example')) return `${usable} of ${total} cards have an example sentence.`
  if (missing.includes('speakable')) {
    return status === 'locked'
      ? 'These cards carry figures or photographs, which cannot be read aloud.'
      : `Works on ${usable} of ${total} — the rest carry figures or photographs.`
  }
  return `Works on ${usable} of ${total} cards.`
}

/**
 * Walk the fallback chain until something this set can actually run, so the
 * answer is never "try this other thing that also does not work". Cycles and
 * dead ends both come back as null rather than looping.
 */
function resolveFallback(
  activity: ActivityDef,
  deck: Pick<QuizDeck, 'cards'>,
  subject: ActivitySubject,
): string | null {
  const seen = new Set<string>([activity.id])
  let next = activity.fallback

  while (next && !seen.has(next)) {
    seen.add(next)
    const candidate = activityDef(next)
    if (!candidate) return null
    const usable = deck.cards.filter((c) => cardSupports(c, candidate, deck.cards.length)).length
    if (usable > 0 && candidate.subjects.includes(subject)) return candidate.id
    next = candidate.fallback
  }
  return null
}
