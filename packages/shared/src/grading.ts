// Question generation and answer checking for quiz decks.
//
// Moved here from apps/web/src/lib/quiz/questions.ts so the API can grade too:
// a tutor round run through an assistant (docs/mcp-tutor-spec.md) sends the
// server what the learner said, and the server has to decide. Two graders that
// drift apart is how a child is marked wrong in one place for an answer that
// was right in the other, so there is one, and it lives where both can reach it.
//
// The two things that decide whether a generated quiz is any good are here:
// how distractors are chosen (a wrong answer that is obviously wrong teaches
// nothing) and how typed answers are graded (marking "mitochondria" wrong
// because of one transposed letter teaches the wrong lesson entirely).

import { hasPlainAnswer } from './capability.js'
import type { QuizCard } from './progress.js'
import { buildLetterHint, buildWordBank } from './puzzles.js'
import { richToPlain, splitOutsideRich } from './rich/index.js'

/**
 * How a question is asked.
 *
 * The two scaffolded kinds are the rung that was missing. A card used to go
 * from a four-way choice straight to a blank page, and a learner who was not
 * ready for that failed at a *format* rather than at the content — which
 * teaches them the wrong thing about themselves. `letter-hint` and `word-bank`
 * both ask for the answer to be produced, with just enough support to make the
 * attempt worth making.
 */
export type QuestionKind =
  | 'multiple-choice'
  | 'true-false'
  | 'letter-hint'
  | 'word-bank'
  | 'written'

/** Kinds where the learner produces the answer rather than picking it. */
export const PRODUCED_KINDS: readonly QuestionKind[] = ['letter-hint', 'word-bank', 'written']

export function isProduced(kind: QuestionKind): boolean {
  return PRODUCED_KINDS.includes(kind)
}

/** Which side of the card the learner is shown. */
export type Direction = 'term-first' | 'definition-first'

export interface Question {
  card: QuizCard
  kind: QuestionKind
  direction: Direction
  /** What the learner reads. */
  prompt: string
  /** What counts as right. */
  answer: string
  /** Multiple choice only, already shuffled and including the answer. */
  choices?: string[]
  /** True/false only: the statement shown, and whether it is in fact true. */
  claim?: string
  claimIsTrue?: boolean
  /** letter-hint only: the answer's first letter and shape, e.g. `m____`. */
  masked?: string
  /** word-bank only: every candidate, shuffled, always including the answer. */
  bank?: string[]
}

export function promptSide(card: QuizCard, direction: Direction): string {
  return direction === 'term-first' ? card.term : card.definition
}

export function answerSide(card: QuizCard, direction: Direction): string {
  return direction === 'term-first' ? card.definition : card.term
}

// --- Answer checking ------------------------------------------------------

export type Grade = 'correct' | 'close' | 'wrong'

const ARTICLES = /^(a|an|the|to|el|la|los|las|le|les|un|una|der|die|das)\s+/i

/**
 * Strip everything that is not the substance of the answer: case, accents,
 * punctuation, and a leading article. Someone who typed "the mitochondrion"
 * knows the answer, and a quiz that says otherwise is testing typing.
 *
 * Math comes through here as what a learner would type, not as its source:
 * the answer `$\frac{3}{4}$` is graded as "3/4", because that is what is in
 * the box when they press enter. Nobody types a backslash.
 */
export function normalize(value: string): string {
  return richToPlain(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARTICLES, '')
}

/**
 * Answers written as "couch / sofa" or "couch; sofa" mean either is acceptable.
 * Splitting on the slash is worth the small risk of a genuine slash in an
 * answer, because alternatives are extremely common on vocabulary decks.
 *
 * Two slashes are not that, and both turn up constantly on a math deck: the
 * one inside an equation, and the one between two numbers. "3/4 cup" is one
 * answer, and splitting it would accept "3". Everything else still splits, so
 * `$\frac{1}{2}$ / a half` remains two ways of saying the same thing.
 */
export function acceptableAnswers(answer: string): string[] {
  return splitOutsideRich(answer, SEPARATORS, isFractionSlash)
    .map((a) => a.trim())
    .filter(Boolean)
}

const SEPARATORS = /\s*;\s*|\s+\bor\b\s+|\s*\/\s*/i

/** True when this separator is the bar of a fraction rather than "either/or". */
function isFractionSlash(match: string, index: number, text: string): boolean {
  if (!match.includes('/')) return false
  const before = text.slice(0, index).slice(-1)
  const after = text.slice(index + match.length).slice(0, 1)
  return /\d/.test(before) && /\d/.test(after)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * Grade a typed answer. `close` exists so a near miss can be shown as a near
 * miss — the learner sees the correct spelling and the round moves on without
 * a wrong mark, which is what Quizlet's "almost correct" does and the reason
 * written practice stays tolerable.
 *
 * The tolerance scales with answer length: one slip in a four-letter word is
 * probably a different word, one slip in a fifteen-letter word is a typo.
 */
export function gradeWritten(given: string, answer: string): Grade {
  const g = normalize(given)
  if (!g) return 'wrong'

  const options = acceptableAnswers(answer).map(normalize).filter(Boolean)
  if (options.some((o) => o === g)) return 'correct'

  for (const option of options) {
    const tolerance = option.length >= 12 ? 2 : option.length >= 6 ? 1 : 0
    if (tolerance > 0 && levenshtein(g, option) <= tolerance) return 'close'
    // A multi-word answer given without its qualifier ("photosynthesis" for
    // "photosynthesis in plants") is close, not wrong. Requiring half the
    // answer's length keeps this from crediting a one-word stab at a long
    // definition, while still accepting the head term on its own.
    if (
      option.includes(' ') &&
      option.startsWith(g) &&
      g.length >= Math.max(4, Math.ceil(option.length * 0.5))
    ) {
      return 'close'
    }
  }
  return 'wrong'
}

export function isPass(grade: Grade, strict: boolean): boolean {
  return strict ? grade === 'correct' : grade !== 'wrong'
}

// --- Distractors ----------------------------------------------------------

function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Pick wrong answers from the same deck, preferring ones that look like the
 * right answer. Length is the giveaway to defend against: if the true answer is
 * the only long option, the question can be answered without knowing anything.
 */
export function buildChoices(
  card: QuizCard,
  pool: QuizCard[],
  direction: Direction,
  count = 4,
  rng: () => number = Math.random,
): string[] {
  const answer = answerSide(card, direction)
  const target = normalize(answer)
  const plainAnswer = richToPlain(answer)
  const seen = new Set([target])

  const candidates = pool
    .filter((c) => c.id !== card.id)
    .map((c) => answerSide(c, direction))
    .filter((text) => {
      const key = normalize(text)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((text) => ({
      text,
      // Rank by similarity of shape, with a little noise so the same card does
      // not draw the same three distractors every single round. Length is
      // measured on the readable text: a card whose answer is a figure is a
      // paragraph of JSON long, and would otherwise never look like anything.
      gap: Math.abs(richToPlain(text).length - plainAnswer.length) + rng() * 6,
    }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, count - 1)
    .map((c) => c.text)

  return shuffle([answer, ...candidates], rng)
}

/**
 * A true/false statement. Half the time it pairs the card with its own answer,
 * half the time with another card's — and the false half draws its impostor the
 * same way multiple choice does, so "false" is never guessable from length.
 */
export function buildTrueFalse(
  card: QuizCard,
  pool: QuizCard[],
  direction: Direction,
  rng: () => number = Math.random,
): { claim: string; claimIsTrue: boolean } {
  const truthy = rng() < 0.5
  if (truthy) return { claim: answerSide(card, direction), claimIsTrue: true }

  const impostors = buildChoices(card, pool, direction, 4, rng).filter(
    (text) => normalize(text) !== normalize(answerSide(card, direction)),
  )
  if (!impostors.length) return { claim: answerSide(card, direction), claimIsTrue: true }
  return { claim: impostors[0], claimIsTrue: false }
}

export function buildQuestion(
  card: QuizCard,
  pool: QuizCard[],
  kind: QuestionKind,
  direction: Direction,
  rng: () => number = Math.random,
): Question {
  const base = {
    card,
    kind,
    direction,
    prompt: promptSide(card, direction),
    answer: answerSide(card, direction),
  }

  if (kind === 'multiple-choice') {
    // Multiple choice needs somewhere to draw wrong answers from. A two-card
    // deck cannot support it, so it degrades to written rather than showing a
    // question with one option.
    const choices = buildChoices(card, pool, direction, 4, rng)
    if (choices.length < 3) return { ...base, kind: 'written' }
    return { ...base, choices }
  }

  if (kind === 'true-false') {
    const { claim, claimIsTrue } = buildTrueFalse(card, pool, direction, rng)
    return { ...base, claim, claimIsTrue }
  }

  if (kind === 'letter-hint') {
    // An answer that is an equation or a figure has no letters to give away,
    // so the scaffold degrades to a word bank rather than showing nonsense.
    if (!hasPlainAnswer({ definition: base.answer })) {
      return buildQuestion(card, pool, 'word-bank', direction, rng)
    }
    return { ...base, masked: buildLetterHint(base.answer).masked }
  }

  if (kind === 'word-bank') {
    const others = pool.filter((c) => c.id !== card.id).map((c) => answerSide(c, direction))
    // Too few candidates and the bank is the answer with decoration. Better to
    // ask for it outright than to pretend there was a choice.
    if (others.length < 2) return { ...base, kind: 'written' }
    return { ...base, bank: buildWordBank(base.answer, shuffle(others, rng), 5, rng) }
  }

  return base
}

export { shuffle }
