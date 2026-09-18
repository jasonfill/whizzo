// How hard a card is to recall.
//
// Shared because starter decks are built on both sides of the wire now: the
// web client shows them, and the API hands them to the tutor. One estimate,
// or the same card would carry two difficulties depending on who asked.

import { richToPlain } from './rich/index.js'

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
