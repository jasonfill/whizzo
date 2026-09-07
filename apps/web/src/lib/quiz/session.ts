// Chooses what to study, and how to ask it.
//
// The "how" is the part that makes Learn mode work. A card the learner has
// never met is asked as multiple choice, because recognition is where recall
// starts; once they are getting it right, the same card is asked as free
// writing, which is the only format that proves they can produce the answer
// unaided. Escalating per card rather than per round means one deck can hold
// forty cards at forty different stages and every question still lands at the
// right level.

import { MIN_POOL, supportLevelFromMastery } from '@whizzo/shared'
import { isDue, MASTERED_THRESHOLD, overdueBy } from '../adaptive'
import {
  cardKey,
  masteryKey,
  todayString,
  type ItemMastery,
  type ProgressSnapshot,
  type QuizCard,
  type QuizDeck,
} from '../progress/types'
import type { Direction, QuestionKind } from './questions'

export type StudyMode = 'flashcards' | 'learn' | 'choice' | 'test' | 'match' | 'review' | 'recall'

/** 'mixed' alternates, which stops a learner memorising position rather than meaning. */
export type DirectionSetting = Direction | 'mixed'

export type CardReason = 'new' | 'learning' | 'due' | 'sharp' | 'list'

export interface PlannedCard {
  card: QuizCard
  deckId: string
  deckTitle: string
  reason: CardReason
  mastery: ItemMastery | undefined
  kind: QuestionKind
  direction: Direction
}

export interface PlanOptions {
  mode: StudyMode
  /** Every deck the plan may draw from. Review mode uses all of them. */
  decks: QuizDeck[]
  deckId?: string
  size?: number
  direction?: DirectionSetting
  today?: string
  shuffle?: <T>(items: T[]) => T[]
  rng?: () => number
}

export const DEFAULT_LEARN_SIZE = 12
export const DEFAULT_TEST_SIZE = 15
export const MATCH_PAIRS = 6

export const MODES: Array<{
  id: StudyMode
  name: string
  emoji: string
  blurb: string
  /** Graded modes move the ability estimate; the rest are practice. */
  isTest: boolean
}> = [
  {
    id: 'flashcards',
    name: 'Flashcards',
    emoji: '🃏',
    blurb: 'Flip through at your own pace and say how well you knew each one.',
    isTest: false,
  },
  {
    id: 'learn',
    name: 'Learn',
    emoji: '🧠',
    blurb: 'Starts with multiple choice and works up to writing it from memory.',
    isTest: true,
  },
  {
    id: 'match',
    name: 'Match',
    emoji: '⚡',
    blurb: 'Race the clock pairing every card with its answer.',
    isTest: false,
  },
  {
    id: 'choice',
    name: 'Multiple Choice',
    emoji: '🎯',
    blurb: 'Every card as a quick four-way pick. Fast, checked, and a missed one comes back.',
    // Checked, so every answer is honest evidence about the card — but it is
    // recognition only, so it moves mastery and the schedule, never the
    // learner's level. Learn is still the way up the ladder.
    isTest: false,
  },
  {
    id: 'test',
    name: 'Test',
    emoji: '📝',
    blurb: 'A mixed paper with no hints. This is the one that counts.',
    isTest: true,
  },
  {
    id: 'recall',
    name: 'Everything You Know',
    emoji: '🧾',
    blurb: 'One box. Write down as much of the set as you can remember.',
    // Unprompted free recall of a closed set is fully checkable, because we
    // hold the answer key — which is why this counts and most apps cannot
    // offer it at all.
    isTest: true,
  },
]

/**
 * What a mode does with a card the learner just missed.
 *
 * `gap` is how many cards later it comes back — far enough that the answer has
 * left short-term memory, near enough to still be the same sitting. `maxPasses`
 * stops a card the learner genuinely cannot do yet from becoming an unwinnable
 * loop: after that many tries it is parked, reported at the end, and picked up
 * by the review schedule instead.
 *
 * Test is the deliberate exception. It is a measurement, and a paper that keeps
 * handing your mistakes back until you fix them measures something else.
 */
export interface RequeuePolicy {
  gap: number
  maxPasses: number
}

export function requeuePolicy(mode: StudyMode): RequeuePolicy | null {
  switch (mode) {
    case 'flashcards':
      return { gap: 4, maxPasses: 3 }
    case 'learn':
    case 'choice':
    case 'review':
      return { gap: 4, maxPasses: 3 }
    default:
      return null
  }
}

export function modeDef(id: StudyMode) {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}

function defaultShuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function masteryOf(
  snapshot: ProgressSnapshot,
  deckId: string,
  cardId: string,
): ItemMastery | undefined {
  return snapshot.mastery[masteryKey('quiz', cardKey(deckId, cardId))]
}

function resolveDirection(setting: DirectionSetting, index: number): Direction {
  if (setting === 'mixed') return index % 2 === 0 ? 'term-first' : 'definition-first'
  return setting
}

/**
 * What format to ask this card in.
 *
 * Now a thin wrapper over the ladder: `supportLevelFromMastery` decides which
 * rung the item is on and this decides how to ask a question at that rung. One
 * place now knows what a rung means, instead of three.
 *
 * One behaviour did change, and it is an improvement. Reaching free recall now
 * needs a correct streak as well as a high mastery number — the same pair
 * `masteryBand` has always used to decide what "mastered" means. So a card the
 * learner just missed drops back to a scaffolded question instead of handing
 * them a blank page immediately after they got it wrong, which is both kinder
 * and better practice.
 *
 * `poolSize` still matters because multiple choice needs other cards to draw
 * wrong answers from; on a three-card deck everything is written from the
 * start, which is harder but honest.
 */
export function kindFor(
  mastery: ItemMastery | undefined,
  poolSize: number,
  rng: () => number = Math.random,
): QuestionKind {
  if (poolSize < 4) return 'written'

  switch (supportLevelFromMastery(mastery)) {
    case 0:
    case 1:
      // Encounter and recognition: pick it out from among others.
      return 'multiple-choice'
    case 2:
      // Cued recall — and this is the rung that used to be missing. It was
      // answered with multiple choice, which is *recognition*: the learner
      // never produced anything, so nothing bridged the gap to a blank page.
      // Both kinds here ask for the answer, with support.
      return rng() < 0.5 ? 'letter-hint' : 'word-bank'
    default:
      return 'written'
  }
}

/** Test papers mix formats regardless of mastery, the way a real one does. */
function testKind(index: number, poolSize: number): QuestionKind {
  if (poolSize < 4) return 'written'
  const cycle = index % 5
  if (cycle === 0 || cycle === 1) return 'multiple-choice'
  if (cycle === 2) return 'true-false'
  return 'written'
}

interface Candidate {
  card: QuizCard
  deck: QuizDeck
  mastery: ItemMastery | undefined
  reason: CardReason
}

function classify(
  card: QuizCard,
  deck: QuizDeck,
  snapshot: ProgressSnapshot,
  today: string,
): Candidate {
  const mastery = masteryOf(snapshot, deck.id, card.id)
  let reason: CardReason = 'new'
  if (mastery) {
    if (isDue(mastery, today)) reason = 'due'
    else if (mastery.mastery >= MASTERED_THRESHOLD) reason = 'sharp'
    else reason = 'learning'
  }
  return { card, deck, mastery, reason }
}

/**
 * Order for Learn: anything overdue, then what is half-known, then new
 * material, and only then cards already sharp. Within the overdue group the
 * most overdue goes first, and cards the learner has actually lapsed on jump
 * ahead of ones that merely aged out.
 */
function learnOrder(candidates: Candidate[], today: string): Candidate[] {
  const rank: Record<CardReason, number> = { due: 0, learning: 1, new: 2, sharp: 3, list: 4 }
  return [...candidates].sort((a, b) => {
    const byReason = rank[a.reason] - rank[b.reason]
    if (byReason !== 0) return byReason
    if (a.reason === 'due' && b.reason === 'due') {
      const lapses = (b.mastery?.lapses ?? 0) - (a.mastery?.lapses ?? 0)
      if (lapses !== 0) return lapses
      return overdueBy(b.mastery!, today) - overdueBy(a.mastery!, today)
    }
    if (a.reason === 'learning' && b.reason === 'learning') {
      return (a.mastery?.mastery ?? 0) - (b.mastery?.mastery ?? 0)
    }
    return 0
  })
}

export function planStudy(snapshot: ProgressSnapshot, opts: PlanOptions): PlannedCard[] {
  const today = opts.today ?? todayString()
  const mix = opts.shuffle ?? defaultShuffle
  const rng = opts.rng ?? Math.random
  const direction = opts.direction ?? 'term-first'

  const decks =
    opts.mode === 'review'
      ? opts.decks
      : opts.decks.filter((d) => !opts.deckId || d.id === opts.deckId)

  const candidates: Candidate[] = decks.flatMap((deck) =>
    deck.cards.map((card) => classify(card, deck, snapshot, today)),
  )
  if (!candidates.length) return []

  const build = (list: Candidate[], kindOf: (c: Candidate, i: number) => QuestionKind) =>
    list.map((c, i) => ({
      card: c.card,
      deckId: c.deck.id,
      deckTitle: c.deck.title,
      reason: c.reason,
      mastery: c.mastery,
      kind: kindOf(c, i),
      direction: resolveDirection(direction, i),
    }))

  // Flashcards and match are not graded, so they just need a good shuffle. The
  // weakest cards lead so a short session still hits what needs work.
  if (opts.mode === 'flashcards') {
    const ordered = learnOrder(candidates, today)
    const size = opts.size ?? ordered.length
    return build(ordered.slice(0, size), () => 'written')
  }

  // Free recall asks for the whole set at once, so there is nothing to plan
  // beyond handing over every card. Ordering is irrelevant — the learner is
  // not being shown them.
  if (opts.mode === 'recall') {
    return build(candidates, () => 'written')
  }

  if (opts.mode === 'match') {
    const ordered = learnOrder(candidates, today).slice(0, Math.max(MATCH_PAIRS * 3, 18))
    const size = Math.min(opts.size ?? MATCH_PAIRS, ordered.length)
    return build(mix(ordered).slice(0, size), () => 'written')
  }

  // All multiple choice, start to finish. The same cards Learn would pick,
  // asked the way Learn asks a card it has never met — a quick, checked
  // round with nothing to type. A deck too small to offer a real choice is
  // asked written instead, the same degradation `kindFor` makes, rather than
  // handing a learner a question with one option on it.
  if (opts.mode === 'choice') {
    const size = Math.min(opts.size ?? DEFAULT_LEARN_SIZE, candidates.length)
    const chosen = mix(learnOrder(candidates, today).slice(0, size))
    return build(chosen, (c) => (c.deck.cards.length < MIN_POOL ? 'written' : 'multiple-choice'))
  }

  if (opts.mode === 'test') {
    const size = Math.min(opts.size ?? DEFAULT_TEST_SIZE, candidates.length)
    // A test samples the whole deck rather than the weak end of it: the point
    // is to measure, and a paper made only of hard cards measures the wrong
    // thing.
    const paper = mix(candidates).slice(0, size)
    return build(paper, (c, i) => testKind(i, c.deck.cards.length))
  }

  // Learn and review.
  const size = Math.min(opts.size ?? DEFAULT_LEARN_SIZE, candidates.length)
  const ordered =
    opts.mode === 'review'
      ? learnOrder(
          candidates.filter((c) => c.reason === 'due'),
          today,
        )
      : learnOrder(candidates, today)

  // Shuffle the chosen set so the round does not open with six review cards in
  // a row, while still guaranteeing the round is made of the right cards.
  const chosen = mix(ordered.slice(0, size))
  return build(chosen, (c) => kindFor(c.mastery, c.deck.cards.length, rng))
}

/** Cards due for review today across every deck — the cross-deck home CTA. */
export function dueAcrossDecks(
  snapshot: ProgressSnapshot,
  decks: QuizDeck[],
  today = todayString(),
): PlannedCard[] {
  return planStudy(snapshot, { mode: 'review', decks, size: 500, today })
}

export const REASON_LABEL: Record<CardReason, { label: string; emoji: string }> = {
  new: { label: 'New card', emoji: '✨' },
  learning: { label: 'Still learning', emoji: '🌱' },
  due: { label: 'Time to review', emoji: '🔁' },
  sharp: { label: 'Keeping it sharp', emoji: '💎' },
  list: { label: 'From this deck', emoji: '📋' },
}
