// The tutor round: a round of practice run from outside the app.
//
// An assistant connected over MCP (docs/mcp-tutor-spec.md) does the talking;
// this module decides what it is allowed to say. Two rules carry it, and both
// are enforced here by construction rather than by trusting anybody:
//
//   1. **The answer is withheld until graded.** `questionFor` builds the
//      payload the assistant sees, and its result type has no answer field.
//      The answer side reaches the assistant only from `gradeSpoken`'s caller,
//      after the learner has tried. `simulate:tutor` pins this.
//   2. **Grading is deterministic and ours.** The assistant relays what the
//      learner said; `gradeSpoken` decides, with the same grader the app
//      uses plus a layer for the ways speech differs from typing.
//
// Everything here is pure. The API holds the round and writes the rows.

import { applyAttemptToMastery, isDue as isDueOn, masteryBand } from './adaptive.js'
import { BAND_STYLE, type MaturityBand } from './band.js'
import { isSpeakable } from './capability.js'
import {
  acceptableAnswers,
  answerSide,
  buildChoices,
  gradeWritten,
  isPass,
  normalize,
  promptSide,
  shuffle,
  type Direction,
  type Grade,
} from './grading.js'
import { supportLevelFromMastery, type SupportLevel } from './ladder.js'
import { BATCH_SIZE, planPath, type ItemRole } from './path.js'
import { cardKey, type Attempt, type ItemMastery, type QuizCard, type QuizDeck } from './progress.js'
import { buildLetterHint } from './puzzles.js'
import { richToPlain } from './rich/index.js'

export type TutorMode = 'practise' | 'study' | 'test' | 'review'

export const TUTOR_MODES: readonly TutorMode[] = ['practise', 'study', 'test', 'review']

/** How a question is put, by rung. Rung 0 is study and asks nothing. */
export type TutorKind = 'multiple-choice' | 'letter-hint' | 'written'

export interface PlannedTutorCard {
  card: QuizCard
  deckId: string
  deckTitle: string
  role: ItemRole | 'due' | 'test' | 'study'
  /** The rung this card is asked at. 0 only in study mode. */
  rung: SupportLevel
  direction: Direction
}

/**
 * What the assistant is given to ask. Deliberately not a superset of
 * `Question` from the grader: that type carries `answer`, and the whole point
 * of this one is that it cannot.
 */
export interface TutorQuestion {
  cardId: string
  deckId: string
  itemKey: string
  index: number
  total: number
  rung: SupportLevel
  kind: TutorKind
  prompt: string
  /** Rung 1: the options, shuffled, the right one not marked. */
  choices?: string[]
  /** Rung 2: the answer's first letter and shape, e.g. `m________`. */
  scaffold?: string
  /** Read this aloud, as written. */
  say: string
}

/** Study mode is the one payload that carries answers, on purpose. */
export interface TutorStudyCard {
  cardId: string
  deckId: string
  itemKey: string
  prompt: string
  answer: string
  hint: string | null
  example: string | null
  explanation: string | null
  say: string
}

export interface RoundSummary {
  asked: number
  total: number
  correct: number
  accuracy: number
  /** Prompt sides of the cards still wrong at the end. */
  missed: string[]
  /** Cards whose mastery crossed into the mastered band this round. */
  newlyMastered: string[]
  say: string
}

// --- Planning ---------------------------------------------------------------

export interface TutorPlanInput {
  mode: TutorMode
  decks: readonly QuizDeck[]
  /** Which deck; absent only in review mode, which draws from all of them. */
  deckId?: string
  band: MaturityBand
  size?: number
  direction?: Direction
  masteryOf: (deckId: string, cardId: string) => ItemMastery | undefined
  today: string
  rng?: () => number
}

/** Rung 0 has nothing to ask; a card the learner has never met is asked as a choice. */
function askableRung(level: SupportLevel): SupportLevel {
  return level === 0 ? 1 : level
}

function kindFor(rung: SupportLevel): TutorKind {
  if (rung <= 1) return 'multiple-choice'
  if (rung === 2) return 'letter-hint'
  return 'written'
}

function speakableCards(deck: QuizDeck): QuizCard[] {
  return deck.cards.filter(isSpeakable)
}

/**
 * Build one round.
 *
 * Practise is the Mastery Path's own plan — the batch being worked, the review
 * that is due, a little maintenance — asked at the rung each card is on. Test
 * is every card at free recall. Review is what is due across every deck. Study
 * is the next batch of unmet cards, with answers. Cards that cannot be said
 * aloud are never in any of them.
 */
export function planTutorRound(input: TutorPlanInput): PlannedTutorCard[] {
  const rng = input.rng ?? Math.random
  const direction = input.direction ?? 'term-first'
  const size = input.size ?? BAND_STYLE[input.band].roundSize

  const decks = input.deckId ? input.decks.filter((d) => d.id === input.deckId) : [...input.decks]
  if (!decks.length) return []

  const planned: PlannedTutorCard[] = []
  const add = (deck: QuizDeck, card: QuizCard, role: PlannedTutorCard['role'], rung: SupportLevel) =>
    planned.push({ card, deckId: deck.id, deckTitle: deck.title, role, rung, direction })

  const pathInput = (deck: QuizDeck) => ({
    cards: speakableCards(deck),
    masteryOf: (cardId: string) => input.masteryOf(deck.id, cardId),
    isDue: (item: ItemMastery) => isDueOn(item, input.today),
  })

  switch (input.mode) {
    case 'practise': {
      const deck = decks[0]
      for (const item of planPath(pathInput(deck), size)) {
        add(deck, item.card, item.role, askableRung(item.level))
      }
      break
    }

    case 'test': {
      const deck = decks[0]
      for (const card of shuffle(speakableCards(deck), rng).slice(0, size)) add(deck, card, 'test', 3)
      break
    }

    case 'review': {
      // Most overdue first, so a short round spends itself on what is closest
      // to being forgotten.
      const due: Array<{ deck: QuizDeck; card: QuizCard; item: ItemMastery }> = []
      for (const deck of decks) {
        for (const card of speakableCards(deck)) {
          const item = input.masteryOf(deck.id, card.id)
          if (item && item.totalAttempts > 0 && isDueOn(item, input.today)) due.push({ deck, card, item })
        }
      }
      due.sort((a, b) => (a.item.dueOn ?? '').localeCompare(b.item.dueOn ?? ''))
      for (const { deck, card, item } of due.slice(0, size)) {
        add(deck, card, 'due', askableRung(supportLevelFromMastery(item)))
      }
      break
    }

    case 'study': {
      const deck = decks[0]
      const unmet = speakableCards(deck).filter((c) => {
        const item = input.masteryOf(deck.id, c.id)
        return !item || item.totalAttempts === 0
      })
      // Nothing left to meet: revisit what is weakest instead of saying no.
      const pool = unmet.length
        ? unmet
        : [...speakableCards(deck)].sort(
            (a, b) =>
              (input.masteryOf(deck.id, a.id)?.mastery ?? 0) -
              (input.masteryOf(deck.id, b.id)?.mastery ?? 0),
          )
      for (const card of pool.slice(0, Math.min(size, BATCH_SIZE))) add(deck, card, 'study', 0)
      break
    }
  }

  return planned
}

// --- The payloads -------------------------------------------------------------

function plainPrompt(card: QuizCard, direction: Direction): string {
  return richToPlain(promptSide(card, direction)).trim()
}

function plainAnswer(card: QuizCard, direction: Direction): string {
  return richToPlain(answerSide(card, direction)).trim()
}

function letters(n: number): string {
  return n === 1 ? 'one letter' : `${n} letters`
}

/**
 * The question, and only the question.
 *
 * The one function that decides what the assistant sees before an answer is
 * graded. It is written so the answer cannot be in the result by accident: the
 * result is assembled field by field from things derived *from* the answer —
 * a shuffled set of options, a first letter — and never from the answer itself.
 */
export function questionFor(
  planned: PlannedTutorCard,
  pool: readonly QuizCard[],
  index: number,
  total: number,
  rng: () => number = Math.random,
): TutorQuestion {
  const { card, direction } = planned
  const rung = planned.rung === 0 ? 1 : planned.rung
  const prompt = plainPrompt(card, direction)
  const base = {
    cardId: card.id,
    deckId: planned.deckId,
    itemKey: cardKey(planned.deckId, card.id),
    index,
    total,
    prompt,
  }
  const lead = `Question ${index} of ${total}. ${prompt}`

  let kind = kindFor(rung)

  if (kind === 'multiple-choice') {
    const choices = buildChoices(card, [...pool], direction, 4, rng).map((c) => richToPlain(c).trim())
    if (choices.length >= 3) {
      return {
        ...base,
        rung: 1,
        kind,
        choices,
        say: `${lead} Is it ${choices.slice(0, -1).join(', ')}, or ${choices[choices.length - 1]}?`,
      }
    }
    // A deck too small for a choice asks for the answer with a scaffold, the
    // same degradation the app makes.
    kind = 'letter-hint'
  }

  if (kind === 'letter-hint') {
    // The first acceptable answer only: a scaffold of "Golgi apparatus / Golgi
    // body" would give away that there are two, and the slash between them.
    const answer = richToPlain(acceptableAnswers(answerSide(card, direction))[0] ?? '').trim()
    const hint = buildLetterHint(answer)
    const first = [...answer.trim()][0]?.toUpperCase() ?? ''
    // A number has no first letter worth giving: "starts with 3" is either
    // the answer or nonsense. Numbers are asked outright, and recorded as such.
    if (hint.masked && first && /\p{L}/u.test(answer)) {
      const count = [...answer.replace(/[^\p{L}\p{N}]/gu, '')].length
      return {
        ...base,
        rung: 2,
        kind,
        scaffold: hint.masked,
        say: `${lead} It starts with ${first} and has ${letters(count)}.`,
      }
    }
    kind = 'written'
  }

  return { ...base, rung: 3, kind: 'written', say: lead }
}

export function studyCardFor(planned: PlannedTutorCard): TutorStudyCard {
  const { card, direction } = planned
  const prompt = plainPrompt(card, direction)
  const answer = plainAnswer(card, direction)
  const example = card.example?.trim() || null
  const explanation = card.explanation?.trim() || null
  const parts = [`${prompt}: ${answer}.`]
  if (explanation) parts.push(explanation)
  else if (example) parts.push(`For example: ${example}`)
  return {
    cardId: card.id,
    deckId: planned.deckId,
    itemKey: cardKey(planned.deckId, card.id),
    prompt,
    answer,
    hint: card.hint?.trim() || null,
    example,
    explanation,
    say: parts.join(' '),
  }
}

// --- Spoken answers -----------------------------------------------------------

const FILLERS = [
  /^(um+|uh+|er+|hmm+|well|so|okay|ok)[,\s]+/i,
  /^(i think|i think it's|i think it is|maybe|probably|is it|isn't it|it's|it is|its|that's|that is|the answer is|the answer's|answer)[,:\s]+/i,
]

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4,
  fifth: 5, fifths: 5, sixth: 6, sixths: 6, eighth: 8, eighths: 8, tenth: 10, tenths: 10,
}

/**
 * "twenty three" → 23, "a hundred" → 100, "seven five" → 75. Null when the
 * words are not a number.
 *
 * Two single digits in a row are read as digits, not added: nobody says
 * "seven five" to mean twelve, and a transcript of "zero point seven five"
 * has to come out as 0.75.
 */
function wordsToNumber(words: string[]): number | null {
  let total = 0
  let current = 0
  let any = false
  let lastWasDigit = false
  for (const raw of words) {
    const w = raw.toLowerCase()
    if (w === 'and') continue
    if (w === 'a' || w === 'an') {
      current = 1
      any = true
      continue
    }
    if (w in SMALL) {
      const digit = SMALL[w] < 10
      current = lastWasDigit && digit ? current * 10 + SMALL[w] : current + SMALL[w]
      lastWasDigit = digit
      any = true
      continue
    }
    lastWasDigit = false
    if (w in TENS) {
      current += TENS[w]
      any = true
    } else if (w === 'hundred') {
      current = (current || 1) * 100
      any = true
    } else if (w === 'thousand') {
      total += (current || 1) * 1000
      current = 0
      any = true
    } else if (w === 'million') {
      total += (current || 1) * 1_000_000
      current = 0
      any = true
    } else {
      return null
    }
  }
  return any ? total + current : null
}

const NUMBER_WORD = /^(a|an|and|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)$/i

/**
 * What a transcript of a spoken answer needs before the typed-answer grader
 * can see it fairly. Fillers and lead-ins go; number words become digits;
 * spoken fractions and percentages become the forms a learner would type.
 * Idempotent, and it never turns a correct typed answer into a wrong one —
 * both pinned by the tests.
 */
export function normalizeSpoken(given: string): string {
  let s = given.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const f of FILLERS) {
      const next = s.replace(f, '')
      if (next !== s) {
        s = next.trim()
        changed = true
      }
    }
  }
  s = s.replace(/[?!.]+$/g, '').trim()

  // Spoken fractions: "three quarters", "a half", "two and a half". The
  // numerator may be one or two words; when two do not parse ("the three
  // quarters") the first is given back and the second tried alone.
  s = s.replace(
    /\b(?:([a-z]+)[ -])?([a-z]+)[ -](half|halves|third|thirds|quarter|quarters|fourth|fourths|fifth|fifths|sixth|sixths|eighth|eighths|tenth|tenths)\b/gi,
    (m, lead: string | undefined, num: string, den: string) => {
      const d = DENOMINATORS[den.toLowerCase()]
      if (!d) return m
      const both = lead ? wordsToNumber([lead, num]) : null
      if (both !== null) return `${both}/${d}`
      const one = wordsToNumber([num])
      if (one === null) return m
      return `${lead ? `${lead} ` : ''}${one}/${d}`
    },
  )
  s = s.replace(/\b(\d+)\s+and\s+(\d+)\/(\d+)\b/g, (_m, w, n, d) => `${w} ${n}/${d}`)

  // Runs of number words become one number.
  const tokens = s.split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < tokens.length; ) {
    // "a hundred", "an eighth of a thousand": the article starts the number
    // only when a scale word follows it; "a bird" is left alone.
    const startsScaled = /^(a|an)$/i.test(tokens[i]) && /^(hundred|thousand|million)$/i.test(tokens[i + 1] ?? '')
    if (!startsScaled && (!NUMBER_WORD.test(tokens[i]) || /^(a|an|and)$/i.test(tokens[i]))) {
      out.push(tokens[i])
      i += 1
      continue
    }
    let j = i
    while (j < tokens.length && NUMBER_WORD.test(tokens[j])) j += 1
    // Trailing "and"/"a" belong to what follows, not to the number.
    while (j > i && /^(a|an|and)$/i.test(tokens[j - 1])) j -= 1
    const n = wordsToNumber(tokens.slice(i, j))
    if (n === null) {
      out.push(tokens[i])
      i += 1
    } else {
      out.push(String(n))
      i = j
    }
  }
  s = out.join(' ')

  s = s
    .replace(/\b(\d+)\s+point\s+(\d+)\b/gi, '$1.$2')
    .replace(/\b(negative|minus)\s+(\d)/gi, '-$2')
    .replace(/\b(\d+(?:\.\d+)?)\s*(percent|per cent)\b/gi, '$1%')
    .replace(/\b(\d+)\s+(?:over|out of|divided by)\s+(\d+)\b/gi, '$1/$2')
    .replace(/\s+/g, ' ')
    .trim()

  return s
}

/** "3/4", "0.75", "75%", "-2.5" → a number; anything else → null. */
export function parseNumeric(text: string): number | null {
  const s = normalizeSpoken(text)
    .replace(/,/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
  const mixed = /^(-?)(\d+)\s+(\d+)\/(\d+)$/.exec(s)
  if (mixed) {
    const sign = mixed[1] === '-' ? -1 : 1
    const d = Number(mixed[4])
    return d ? sign * (Number(mixed[2]) + Number(mixed[3]) / d) : null
  }
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s)
  if (frac) {
    const d = Number(frac[2])
    return d ? Number(frac[1]) / d : null
  }
  const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(s)
  if (pct) return Number(pct[1]) / 100
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s)
  return null
}

export interface SpokenGrade {
  verdict: Grade
  /** What the grader actually compared, for the history row. */
  normalized: string
}

/**
 * Grade what the learner said.
 *
 * The typed grader runs first on the raw transcript, then on the normalised
 * one, and then both sides are compared as numbers when both are numbers —
 * so "three quarters" matches `$\frac{3}{4}$`, "seventy five percent" matches
 * "0.75", and "mitochondria" is still one typo away from "mitochondrion".
 * Numeric cards skip the edit-distance tolerance, as the card model says.
 */
export function gradeSpoken(given: string, card: QuizCard, direction: Direction): SpokenGrade {
  const answer = answerSide(card, direction)
  const raw = given.trim()
  const normalized = normalizeSpoken(raw)
  const alternatives = [answer, ...(card.altAnswers ?? [])]
  const numericCard = card.answerKind === 'numeric'

  const exactOrClose = (text: string): Grade => {
    let best: Grade = 'wrong'
    for (const alt of alternatives) {
      const g = gradeWritten(text, alt)
      if (g === 'correct') return 'correct'
      if (g === 'close') best = 'close'
    }
    return best
  }

  if (!numericCard) {
    const first = exactOrClose(raw)
    if (first === 'correct') return { verdict: 'correct', normalized: raw }
    const second = exactOrClose(normalized)
    if (second === 'correct') return { verdict: 'correct', normalized }
    if (first === 'close' || second === 'close') {
      return { verdict: 'close', normalized: second === 'close' ? normalized : raw }
    }
  }

  // Both numbers: compare as numbers, within the card's tolerance.
  const givenN = parseNumeric(normalized)
  if (givenN !== null) {
    for (const alt of alternatives) {
      const answerN = parseNumeric(richToPlain(alt))
      if (answerN === null) continue
      const tolerance = card.tolerance ?? 0
      if (Math.abs(givenN - answerN) <= tolerance + 1e-9) return { verdict: 'correct', normalized }
    }
  }

  if (numericCard) {
    // No edit distance on numbers — but an exact string match still counts,
    // so an answer like "x = 4" is not refused for not being a number.
    for (const alt of alternatives) {
      if (normalize(normalized) === normalize(richToPlain(alt))) return { verdict: 'correct', normalized }
    }
  }

  return { verdict: 'wrong', normalized }
}

/** Whether a verdict passes in this mode: a near miss is a pass everywhere but a test. */
export function passes(verdict: Grade, mode: TutorMode): boolean {
  return isPass(verdict, mode === 'test')
}

// --- Recording ----------------------------------------------------------------

export interface TutorAnswer {
  question: TutorQuestion
  given: string | null
  correct: boolean
  hintsUsed: number
  at: number
  /** `studied`: the card was shown with its answer and nothing was asked. */
  kind?: 'asked' | 'studied'
}

/**
 * The row a tutor answer becomes. `askedAt` is the rung the question was put
 * at — after a hint, one lower than planned — and `isTest` follows the app's
 * rule that only an unhinted answer moves anything but the item's own record.
 *
 * A study exposure is a flashcard flip: rung 0, unverified, not a test. It
 * records that the card was met and claims nothing else.
 */
export function attemptFor(
  answer: TutorAnswer,
  card: QuizCard,
  track: string | null,
): Attempt {
  const studied = answer.kind === 'studied'
  const rung = studied
    ? 0
    : ((answer.hintsUsed > 0 ? Math.min(answer.question.rung, 2) : answer.question.rung) as SupportLevel)
  return {
    subject: 'quiz',
    itemKey: answer.question.itemKey,
    activity: 'tutor',
    askedAt: rung,
    isTest: !studied && answer.hintsUsed === 0,
    verified: !studied,
    correct: answer.correct,
    responseMs: null,
    hintsUsed: answer.hintsUsed,
    difficulty: card.difficulty,
    given: answer.given,
    at: answer.at,
    track,
    channel: 'mcp',
  }
}

/**
 * Fold a round's attempts into mastery, first sight of each card scoring the
 * headline — the same rule the app's round uses, so a learner who missed one
 * and then got it on the requeue reads as one miss, not as a worse learner.
 */
export function summarizeRound(
  planned: readonly PlannedTutorCard[],
  attempts: readonly Attempt[],
  masteryOf: (itemKey: string) => ItemMastery | undefined,
  today: string,
  band: MaturityBand,
  /**
   * The learner's ability as it stood when each attempt was folded — the
   * app's round passes its running estimate the same way, and the schedule
   * stretch depends on it. Absent, the card's difficulty stands in.
   */
  abilityAt?: (index: number, attempt: Attempt) => number,
): RoundSummary & { mastery: ItemMastery[] } {
  const first = new Map<string, Attempt>()
  const last = new Map<string, Attempt>()
  for (const a of attempts) {
    if (!first.has(a.itemKey)) first.set(a.itemKey, a)
    last.set(a.itemKey, a)
  }

  const asked = first.size
  const correct = [...first.values()].filter((a) => a.correct).length
  const promptOf = new Map(
    planned.map((p) => [cardKey(p.deckId, p.card.id), plainPrompt(p.card, p.direction)]),
  )
  const missed = [...last.values()].filter((a) => !a.correct).map((a) => promptOf.get(a.itemKey) ?? a.itemKey)

  const updated = new Map<string, ItemMastery>()
  const newlyMastered: string[] = []
  const deckOf = new Map(planned.map((p) => [cardKey(p.deckId, p.card.id), p.deckId]))
  attempts.forEach((a, i) => {
    const previous = updated.get(a.itemKey) ?? masteryOf(a.itemKey)
    const next = applyAttemptToMastery(previous, a, { today, ability: abilityAt?.(i, a) })
    updated.set(a.itemKey, { ...next, listId: deckOf.get(a.itemKey) ?? next.listId })
    if (masteryBand(previous) !== 'mastered' && masteryBand(next) === 'mastered') {
      newlyMastered.push(promptOf.get(a.itemKey) ?? a.itemKey)
    }
  })

  const accuracy = asked ? Math.round((correct / asked) * 100) : 0
  const total = planned.length
  const parts: string[] = []
  if (asked === 0) parts.push('No questions were answered.')
  else parts.push(`${correct} out of ${asked}.`)
  if (newlyMastered.length) {
    parts.push(
      newlyMastered.length === 1
        ? `One new one mastered: ${newlyMastered[0]}.`
        : `${newlyMastered.length} newly mastered.`,
    )
  }
  if (missed.length) {
    parts.push(
      missed.length === 1
        ? `The one to look at again is ${missed[0]}.`
        : `Ones to look at again: ${missed.slice(0, 3).join(', ')}${missed.length > 3 ? ' and more' : ''}.`,
    )
  }
  if (band === 'early' && asked > 0 && correct === asked) parts.push('Every single one! 🌟')

  return {
    asked,
    total,
    correct,
    accuracy,
    missed,
    newlyMastered,
    say: parts.join(' '),
    mastery: [...updated.values()],
  }
}

// --- What the assistant is told -------------------------------------------------

/**
 * The tutoring rules, sent with every round rather than only offered as a
 * prompt, because neither client reliably surfaces prompts and there must be
 * no way into a round that skips them.
 *
 * Built from sentence parts with a tool-flavoured and a plain-flavoured
 * wording for each, so the copyable packet (no tools) says the same things
 * without anything being rewritten after the fact.
 */
export function tutorInstructions(
  band: MaturityBand,
  name: string,
  grade: number | null,
  options: { tools?: boolean } = {},
): string {
  const tools = options.tools ?? true
  const who = grade === null ? name : `${name}, who is in grade ${grade}`
  const register =
    band === 'early'
      ? 'Keep sentences very short and warm. One idea at a time. Celebrate a right answer briefly.'
      : band === 'growing'
        ? 'Keep it light and encouraging. Short turns.'
        : band === 'middle'
          ? 'Be friendly and direct. No baby talk.'
          : 'Be direct and treat them as capable. No exclamation marks, no decoration.'
  const parts = [
    `You are a patient tutor working with ${who}.`,
    tools ? 'Ask the question in `say` as written, then wait for the answer.' : 'Ask one question at a time, then wait for the answer.',
    tools
      ? "Send exactly what the learner said to `answer`, without correcting, completing or improving it. Never guess an answer on the learner's behalf."
      : "Take the learner's answer as given, without completing or improving it. Never guess an answer on the learner's behalf.",
    tools
      ? 'Never tell the learner an answer before `answer` has returned it. You do not have the answer until then.'
      : 'Never tell the learner an answer before they have tried.',
    tools ? 'If the learner asks for a hint, call `hint`; do not make one up.' : 'If the learner asks for a hint, give the first letter only.',
    tools
      ? 'After `answer`, use `praise` and, on a miss, the returned `answer` and `explanation` to teach in one or two sentences, then ask the next question from the result.'
      : 'After each answer, say whether it was right and, on a miss, teach in one or two sentences, then ask the next question.',
    tools
      ? 'Do not skip questions, reorder them, or stop before the round ends unless the learner asks to stop; then call `end_round`.'
      : 'Do not skip questions or stop before the round ends unless the learner asks to stop.',
    register,
  ]
  return parts.join(' ')
}

/**
 * The copyable packet for a voice conversation with no tools at all.
 * Records nothing, and says so — it exists for the ChatGPT family and the
 * car this afternoon, not as the product.
 */
export function tutorPacket(deck: QuizDeck, band: MaturityBand, name: string, grade: number | null): string {
  const cards = deck.cards.filter(isSpeakable)
  const lines = cards.map(
    (c) => `- ${richToPlain(c.term).trim()} → ${richToPlain(c.definition).trim()}`,
  )
  return [
    tutorInstructions(band, name, grade, { tools: false }),
    '',
    `Ask these ${cards.length} cards from "${deck.title}", one at a time, in a random order. Ask the first side; the second side is the answer.`,
    ...lines,
    '',
    'This practice is not recorded in Whizzo. To count it, connect Whizzo as an app (Account → Connected apps).',
  ].join('\n')
}
