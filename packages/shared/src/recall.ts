// Free recall of a whole set, and fluency.
//
// **Brain dump is the highest-value activity in the catalog per line of
// code**, and the reason is a property most flashcard apps do not have:
// unprompted free recall of a closed set is *fully machine-checkable*, because
// we hold the answer key. "List every state capital you can" is graded by
// matching what was written against the set — each match is a correct attempt,
// each unmatched card is a miss that drops straight back into the schedule.
//
// The second half is fluency. `responseMs` has been recorded on every attempt
// since the app was built and read by nothing. Knowing something and being able
// to use it are different, and the gap between them is measured in seconds.

import type { QuizCard } from './progress.js'

export interface RecallMatch {
  card: QuizCard
  /** What the learner wrote that matched it. */
  given: string
  exact: boolean
}

export interface RecallResult {
  matched: RecallMatch[]
  /** Cards nobody wrote down. These are misses, and go back in the queue. */
  missed: QuizCard[]
  /** Written but matching nothing. Reported, never counted against them. */
  unmatched: string[]
}

/**
 * Split what somebody typed into separate answers.
 *
 * Deliberately forgiving: a learner emptying their memory writes a list, and
 * whether they used commas, newlines or semicolons is not the thing being
 * tested. Trailing bullets and numbering come off too.
 */
export function splitRecall(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/**
 * Grade a brain dump against the set.
 *
 * `grade` is injected so this uses exactly the same tolerance as every other
 * written answer in the app — a near miss on a biology deck is a near miss
 * whether it was typed into a card or into a list.
 *
 * Each written answer may claim at most one card, and each card at most one
 * answer. Without that, writing "cell" six times would score six matches.
 */
export function gradeRecall(
  written: string,
  cards: readonly QuizCard[],
  grade: (given: string, answer: string) => 'correct' | 'close' | 'wrong',
): RecallResult {
  const answers = splitRecall(written)
  const claimed = new Set<string>()
  const used = new Set<number>()
  const matched: RecallMatch[] = []

  // Exact matches first, so a near miss never steals the card an exact answer
  // was going to claim.
  for (const pass of ['correct', 'close'] as const) {
    answers.forEach((answer, i) => {
      if (used.has(i)) return
      for (const card of cards) {
        if (claimed.has(card.id)) continue
        if (grade(answer, card.definition) !== pass) continue
        claimed.add(card.id)
        used.add(i)
        matched.push({ card, given: answer, exact: pass === 'correct' })
        return
      }
    })
  }

  return {
    matched,
    missed: cards.filter((c) => !claimed.has(c.id)),
    unmatched: answers.filter((_, i) => !used.has(i)),
  }
}

// --- Fluency ---------------------------------------------------------------

export interface FluencyReading {
  /** Middle of the distribution, in ms. Median, not mean: one long pause while
   *  somebody answered the door should not move it. */
  medianMs: number
  answers: number
}

export function fluency(responseTimes: readonly (number | null)[]): FluencyReading | null {
  const times = responseTimes.filter((t): t is number => typeof t === 'number' && t > 0).sort((a, b) => a - b)
  if (!times.length) return null
  const mid = Math.floor(times.length / 2)
  const medianMs =
    times.length % 2 === 0 ? Math.round((times[mid - 1]! + times[mid]!) / 2) : times[mid]!
  return { medianMs, answers: times.length }
}

/**
 * Whether an item is answered fast enough to count as automatic.
 *
 * Used as a **tiebreaker on promotion, never as a requirement.** Speed pressure
 * raises anxiety, and the effect falls hardest on learners who are already
 * struggling — the exact population this product exists for. A learner who
 * knows something and answers slowly still knows it.
 */
export const FLUENT_MS = 3000

export function isFluent(responseMs: number | null | undefined): boolean {
  return typeof responseMs === 'number' && responseMs > 0 && responseMs <= FLUENT_MS
}

/**
 * The line an older learner actually opens the app for.
 *
 * A high schooler will not come back for a fossil. They will come back for a
 * number that says they are getting faster — and every part of it is already
 * being recorded.
 */
export function fluencyLine(
  known: number,
  retainedPercent: number | null,
  now: FluencyReading | null,
  before: FluencyReading | null,
): string {
  const parts = [`${known} known cold`]
  if (retainedPercent !== null) parts.push(`${retainedPercent}% still right after 30 days`)
  if (now) {
    const seconds = (now.medianMs / 1000).toFixed(1)
    parts.push(
      before && before.medianMs > now.medianMs
        ? `median recall ${seconds}s, down from ${(before.medianMs / 1000).toFixed(1)}s`
        : `median recall ${seconds}s`,
    )
  }
  return parts.join(' · ')
}
