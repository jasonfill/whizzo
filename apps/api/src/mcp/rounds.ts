// A tutor round, held by the server.
//
// The assistant's context is not storage. A round lives in `mcp_rounds` from
// `start_round` until it closes — by finishing, by `end_round`, by a newer
// round starting, or by half an hour of silence — and when it closes it is
// written through the same code as a round the app sends. The answer sides
// sit in the plan, which is why only this module reads it.
//
// A round belongs to the learner it started with. Everything here takes the
// learner from the round row, never from whoever is calling now: the caller
// may have moved on to another child, and a round closed under the wrong
// child is a child's record falsified.

import {
  answerSide,
  attemptFor,
  defaultSkillState,
  gradeSpoken,
  isSpeakable,
  passes,
  planTutorRound,
  praise,
  questionFor,
  skillKey,
  studyCardFor,
  summarizeRound,
  todayString,
  tutorInstructions,
  updateAbility,
  updateStreak,
  type Attempt,
  type Direction,
  type PlannedTutorCard,
  type QuizCard,
  type SessionRecord,
  type SkillState,
  type TutorMode,
  type TutorQuestion,
  type TutorStudyCard,
} from '@whizzo/shared'
import { richToPlain } from '@whizzo/shared/rich'
import { withAdmin } from '../db.js'
import { decksFor, masteryFor, skillsFor } from '../progressRead.js'
import { writeProgressChange } from '../progressWrite.js'
import {
  asUser,
  grantedLearners,
  inContext,
  ToolRefused,
  type Grant,
  type LearnerInContext,
} from './context.js'
import { newId } from './tokens.js'

/** A round with no answer for this long is over. */
export const ROUND_IDLE_MS = 30 * 60 * 1000

interface RoundAnswer {
  question: TutorQuestion
  given: string | null
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong' | 'skipped' | 'studied'
  hintsUsed: number
  at: number
}

/** What `mcp_rounds.plan` holds. */
interface RoundPlan {
  planned: PlannedTutorCard[]
  /** Indices into `planned` still to ask, in order. */
  queue: number[]
  /** How many questions have been put so far, for "3 of 10". */
  asked: number
  current: TutorQuestion | null
  currentHints: number
  requeued: number[]
  /**
   * Each deck's cards, for drawing wrong answers. Kept with the plan so an
   * answer never has to read the decks table: the pool is fixed for the round.
   */
  pools: Record<string, QuizCard[]>
  clientName: string | null
}

export interface RoundRow {
  id: string
  grant_id: string
  learner_id: string
  deck_id: string | null
  mode: TutorMode
  plan: RoundPlan
  answers: RoundAnswer[]
  started_at: Date | string
  last_answer_at: Date | string | null
  ended_at: Date | string | null
  session_id: string | null
}

export interface StartRoundParams {
  mode: TutorMode
  deckId?: string
  size?: number
  direction?: Direction
}

export interface StartRoundResult {
  roundId: string
  mode: TutorMode
  total: number
  deck: { id: string; title: string } | null
  instructions: string
  question?: TutorQuestion
  cards?: TutorStudyCard[]
  say: string
}

export interface AnswerResult {
  verdict: 'correct' | 'close' | 'wrong' | 'skipped'
  answer: string
  explanation: string | null
  example: string | null
  praise: string
  progress: { asked: number; total: number; correct: number }
  question?: TutorQuestion
  summary?: RoundSummaryOut
  say: string
}

export interface RoundSummaryOut {
  asked: number
  total: number
  correct: number
  accuracy: number
  missed: string[]
  newlyMastered: string[]
  taskClosed: boolean
  say: string
}

// --- Round rows ---------------------------------------------------------------------------------

async function insertRound(round: RoundRow): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(
      `insert into public.mcp_rounds (id, grant_id, learner_id, deck_id, mode, plan, answers, started_at, last_answer_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        round.id,
        round.grant_id,
        round.learner_id,
        round.deck_id,
        round.mode,
        JSON.stringify(round.plan),
        JSON.stringify(round.answers),
        round.started_at,
        round.last_answer_at,
      ],
    )
  })
}

async function saveRound(round: RoundRow): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(
      `update public.mcp_rounds
          set plan = $2, answers = $3, last_answer_at = $4, ended_at = $5, session_id = $6
        where id = $1`,
      [
        round.id,
        JSON.stringify(round.plan),
        JSON.stringify(round.answers),
        round.last_answer_at,
        round.ended_at,
        round.session_id,
      ],
    )
  })
}

export async function loadRound(roundId: string, grant: Grant): Promise<RoundRow | null> {
  return withAdmin(async (db) => {
    const { rows } = await db.query(
      'select * from public.mcp_rounds where id = $1 and grant_id = $2',
      [roundId, grant.id],
    )
    return (rows[0] as RoundRow | undefined) ?? null
  })
}

async function openRounds(grant: Grant): Promise<RoundRow[]> {
  return withAdmin(async (db) => {
    const { rows } = await db.query(
      'select * from public.mcp_rounds where grant_id = $1 and ended_at is null',
      [grant.id],
    )
    return rows as RoundRow[]
  })
}

function idle(round: RoundRow): boolean {
  const last = round.last_answer_at ?? round.started_at
  return Date.now() - new Date(last).getTime() > ROUND_IDLE_MS
}

/**
 * The learner a round belongs to, as the grant's user can reach them today.
 * Null when they cannot — a child removed from a tutor's link — in which case
 * the round is over and nothing about it is written.
 */
export async function roundLearner(grant: Grant, round: RoundRow): Promise<LearnerInContext | null> {
  const learners = await asUser(grant, (db) => grantedLearners(db, grant))
  const learner = learners.find((l) => l.id === round.learner_id)
  return learner ? inContext(learner) : null
}

/**
 * Close every round still open on this grant, whichever learner it was for.
 * A round that cannot be written — its learner is out of reach, or the write
 * fails — is ended and discarded rather than left to block every later
 * `start_round` on the grant.
 */
async function closeOpenRounds(grant: Grant, log?: (msg: string, err?: unknown) => void): Promise<void> {
  for (const round of await openRounds(grant)) {
    try {
      const learner = await roundLearner(grant, round)
      if (learner) await closeRound(grant, learner, round)
      else await discardRound(round)
    } catch (err) {
      log?.(`could not close round ${round.id}; discarding it`, err)
      await discardRound(round)
    }
  }
}

async function discardRound(round: RoundRow): Promise<void> {
  round.ended_at = new Date()
  round.plan.current = null
  await saveRound(round)
}

// --- Starting ------------------------------------------------------------------------------------

export async function startRound(
  grant: Grant,
  learner: LearnerInContext,
  clientName: string | null,
  params: StartRoundParams,
  log?: (msg: string, err?: unknown) => void,
): Promise<StartRoundResult> {
  if (params.mode !== 'review' && !params.deckId) {
    throw new ToolRefused('Say which deck to use — list_materials shows what there is.')
  }

  // Everything that can be refused without touching mastery is refused
  // first, so a mistyped deck id does not cost the child the round they are
  // in the middle of.
  const decks = await asUser(grant, (db) => decksFor(db, learner.learner.id))
  const deck = params.deckId ? decks.find((d) => d.id === params.deckId) : null
  if (params.deckId && !deck) throw new ToolRefused('No deck with that id is available to this learner.')
  if (deck && !deck.cards.length) throw new ToolRefused(`"${deck.title}" has no cards yet.`)
  if (deck && !deck.cards.some(isSpeakable)) {
    throw new ToolRefused(
      `None of the cards in "${deck.title}" can be asked out loud — they carry figures or photographs. Use the app for that one.`,
    )
  }

  // The previous round is written before this one plans, so the plan comes
  // from the mastery that round produced rather than from the state before it.
  await closeOpenRounds(grant, log)
  const mastery = await asUser(grant, (db) => masteryFor(db, learner.learner.id))

  const today = todayString()
  const planned = planTutorRound({
    mode: params.mode,
    decks,
    deckId: deck?.id,
    band: learner.band,
    size: params.size,
    direction: params.direction,
    masteryOf: (deckId, cardId) => mastery.get(`${deckId}:${cardId}`),
    today,
  })

  const name = learner.firstName
  if (!planned.length) {
    throw new ToolRefused(
      params.mode === 'review'
        ? `Nothing is due for ${name} right now. Start a practise round on a deck instead.`
        : `There is nothing to ask in "${deck?.title}" right now.`,
    )
  }

  // Wrong answers are drawn from cards that could themselves be asked, and
  // only what drawing needs is kept: a figure is not a choice anyone can say,
  // and a deck's explanations have no business in a round's row.
  const pools: Record<string, QuizCard[]> = {}
  for (const p of planned) {
    if (pools[p.deckId]) continue
    pools[p.deckId] = (decks.find((d) => d.id === p.deckId)?.cards ?? [])
      .filter(isSpeakable)
      .map((c) => ({ id: c.id, term: c.term, definition: c.definition, hint: null, difficulty: c.difficulty }))
  }
  const plan: RoundPlan = {
    planned,
    queue: planned.map((_, i) => i),
    asked: 0,
    current: null,
    currentHints: 0,
    requeued: [],
    pools,
    clientName,
  }
  const instructions = tutorInstructions(learner.band, name, learner.learner.gradeHint)
  const roundId = newId()
  const now = Date.now()

  if (params.mode === 'study') {
    // Study is exposure, not evidence. The cards are recorded as met — a
    // flashcard flip — and nothing else: no session, no task closes, no
    // reward, no line on the daily strip.
    const cards = planned.map(studyCardFor)
    const answers: RoundAnswer[] = planned.map((p, i) => ({
      question: questionFor(p, [], i + 1, planned.length),
      given: null,
      correct: false,
      verdict: 'studied',
      hintsUsed: 0,
      at: now + i,
    }))
    const round: RoundRow = {
      id: roundId,
      grant_id: grant.id,
      learner_id: learner.learner.id,
      deck_id: deck?.id ?? null,
      mode: 'study',
      plan: { ...plan, queue: [], asked: planned.length },
      answers,
      started_at: new Date(now),
      last_answer_at: new Date(now),
      ended_at: null,
      session_id: null,
    }
    await insertRound(round)
    await closeRound(grant, learner, round)
    return {
      roundId,
      mode: 'study',
      total: cards.length,
      deck: deck ? { id: deck.id, title: deck.title } : null,
      instructions:
        `${instructions} This is a study round: teach each card below in your own words, one at a time, ` +
        `checking ${name} is following. When they are ready, start a practise round.`,
      cards,
      say: `${cards.length} cards from "${deck?.title}" to learn first. Here is the first: ${cards[0]?.say ?? ''}`,
    }
  }

  const firstPlanned = planned[0]!
  const first = questionFor(firstPlanned, pools[firstPlanned.deckId] ?? [], 1, planned.length)
  plan.current = first
  plan.asked = 1

  const round: RoundRow = {
    id: roundId,
    grant_id: grant.id,
    learner_id: learner.learner.id,
    deck_id: deck?.id ?? null,
    mode: params.mode,
    plan,
    answers: [],
    started_at: new Date(now),
    last_answer_at: null,
    ended_at: null,
    session_id: null,
  }
  await insertRound(round)

  const what = params.mode === 'review' ? 'cards that are due for review' : `cards from "${deck?.title}"`
  return {
    roundId,
    mode: params.mode,
    total: planned.length,
    deck: deck ? { id: deck.id, title: deck.title } : null,
    instructions,
    question: first,
    say: `${planned.length} ${what}. ${first.say}`,
  }
}

// --- Answering ------------------------------------------------------------------------------------

/** The round, checked to be open. An idle one is closed on the way. */
async function requireOpen(grant: Grant, learner: LearnerInContext, round: RoundRow): Promise<void> {
  if (round.ended_at) throw new ToolRefused('That round is over. Start a new one.')
  if (idle(round)) {
    await closeRound(grant, learner, round)
    throw new ToolRefused('That round went quiet for half an hour and was closed. Start a new one.')
  }
  if (!round.plan.current) throw new ToolRefused('That round has no open question.')
}

function cardOf(round: RoundRow, question: TutorQuestion): PlannedTutorCard {
  const planned = round.plan.planned.find((p) => p.card.id === question.cardId && p.deckId === question.deckId)
  if (!planned) throw new ToolRefused('That question is not in this round.')
  return planned
}

function plainAnswerOf(planned: PlannedTutorCard): string {
  return richToPlain(answerSide(planned.card, planned.direction)).trim()
}

export async function answerRound(
  grant: Grant,
  learner: LearnerInContext,
  round: RoundRow,
  given: string | null,
  skip: boolean,
): Promise<AnswerResult> {
  await requireOpen(grant, learner, round)
  const question = round.plan.current!
  const planned = cardOf(round, question)

  let verdict: AnswerResult['verdict']
  let correct: boolean
  let recorded: string | null
  if (skip || given === null || !given.trim()) {
    verdict = 'skipped'
    correct = false
    recorded = null
  } else {
    const graded = gradeSpoken(given, planned.card, planned.direction)
    verdict = graded.verdict
    correct = passes(graded.verdict, round.mode)
    recorded = given.trim().slice(0, 400)
  }

  const now = Date.now()
  round.answers.push({ question, given: recorded, correct, verdict, hintsUsed: round.plan.currentHints, at: now })
  round.last_answer_at = new Date(now)

  // Move on. A miss goes to the back of the queue once, in every mode but a
  // test — where the requeue can restore the item but never promote it.
  const queue = round.plan.queue.slice(1)
  const index = round.plan.queue[0]
  if (!correct && round.mode !== 'test' && index !== undefined && !round.plan.requeued.includes(index)) {
    round.plan.requeued.push(index)
    queue.push(index)
  }
  round.plan.queue = queue
  round.plan.currentHints = 0

  const firsts = new Map<string, RoundAnswer>()
  for (const a of round.answers) if (!firsts.has(a.question.itemKey)) firsts.set(a.question.itemKey, a)
  const progress = {
    asked: firsts.size,
    total: round.plan.planned.length,
    correct: [...firsts.values()].filter((a) => a.correct).length,
  }

  const answer = plainAnswerOf(planned)
  const explanation = planned.card.explanation?.trim() || null
  const example = planned.card.example?.trim() || null
  const line = praise(learner.band, correct)
  // What is said follows what was recorded. A near miss is "close enough"
  // only where it passed; in a test it is a miss and is said as one.
  const teach = correct
    ? verdict === 'close'
      ? `Close enough — it's ${answer}.`
      : `Yes — ${answer}.`
    : verdict === 'skipped'
      ? `No problem. It's ${answer}.`
      : verdict === 'close'
        ? `${line} Very close, but in a test it has to be exact: ${answer}.`
        : `${line} It's ${answer}.`
  const extra = !correct && explanation ? ` ${explanation}` : ''

  const nextIndex = queue[0]
  const nextPlanned = nextIndex === undefined ? undefined : round.plan.planned[nextIndex]
  if (nextPlanned) {
    round.plan.asked += 1
    // "4 of 12": a requeued miss is a question too, so the total is what has
    // been asked plus what is still to come, not the number of cards.
    const total = round.plan.asked + queue.length - 1
    const next = questionFor(nextPlanned, round.plan.pools[nextPlanned.deckId] ?? [], round.plan.asked, total)
    round.plan.current = next
    await saveRound(round)
    return {
      verdict,
      answer,
      explanation,
      example,
      praise: line,
      progress,
      question: next,
      say: `${teach}${extra} ${next.say}`,
    }
  }

  round.plan.current = null
  const summary = await closeRound(grant, learner, round)
  return {
    verdict,
    answer,
    explanation,
    example,
    praise: line,
    progress,
    summary,
    say: `${teach}${extra} That's the round. ${summary.say}`,
  }
}

export async function hintRound(
  grant: Grant,
  learner: LearnerInContext,
  round: RoundRow,
): Promise<{ scaffold: string | null; say: string }> {
  await requireOpen(grant, learner, round)
  if (round.mode === 'test') throw new ToolRefused('No hints in a test round.')
  const question = round.plan.current!
  if (question.rung < 3) {
    return { scaffold: question.scaffold ?? null, say: 'That question already has all the help it gets. Have a go.' }
  }
  const planned = cardOf(round, question)
  const scaffolded = questionFor({ ...planned, rung: 2 }, [], question.index, question.total)
  if (scaffolded.kind !== 'letter-hint') {
    return { scaffold: null, say: "There's no hint for this one — it's a number. Have a go." }
  }
  round.plan.current = scaffolded
  round.plan.currentHints = 1
  await saveRound(round)
  return { scaffold: scaffolded.scaffold ?? null, say: scaffolded.say.replace(/^Question \d+ of \d+\. /, '') }
}

export async function endRound(grant: Grant, learner: LearnerInContext, round: RoundRow): Promise<RoundSummaryOut> {
  if (round.ended_at) throw new ToolRefused('That round is already over.')
  return closeRound(grant, learner, round)
}

// --- Closing: the round becomes rows -----------------------------------------------------------

async function closeRound(grant: Grant, learner: LearnerInContext, round: RoundRow): Promise<RoundSummaryOut> {
  // The learner is the round's, whoever is calling. The context passed in is
  // only used once that is confirmed.
  if (learner.learner.id !== round.learner_id) {
    const own = await roundLearner(grant, round)
    if (!own) {
      await discardRound(round)
      throw new ToolRefused('That learner is no longer on this connection.')
    }
    learner = own
  }
  const learnerId = round.learner_id
  const today = todayString()
  const endedAt = Date.now()
  const startedAt = new Date(round.started_at).getTime()
  const study = round.mode === 'study'

  const { decks, mastery, skills } = await asUser(grant, async (db) => ({
    decks: await decksFor(db, learnerId),
    mastery: await masteryFor(db, learnerId),
    skills: await skillsFor(db, learnerId),
  }))
  const trackOf = new Map(decks.map((d) => [d.id, d.track ?? null]))

  const attempts: Attempt[] = round.answers.map((a) => {
    const planned = cardOf(round, a.question)
    return attemptFor(
      {
        question: a.question,
        given: a.given,
        correct: a.correct,
        hintsUsed: a.hintsUsed,
        at: a.at,
        kind: a.verdict === 'studied' ? 'studied' : 'asked',
      },
      planned.card,
      trackOf.get(planned.deckId) ?? null,
    )
  })

  // Ability: only an unhinted rung-3 answer moves it, per pool and overall —
  // the same two updates the app's round makes, from the same starting state.
  // The running estimate after each attempt is kept, because the mastery fold
  // below schedules each card against the ability the app's round would have
  // passed at that moment.
  let whole = skills.get(skillKey('quiz', null)) ?? defaultSkillState('quiz')
  const abilityBefore = whole.ability
  const abilityAfterEach: number[] = []
  const pools = new Map<string, SkillState>()
  for (const a of attempts) {
    if (!(a.isTest && a.verified && a.askedAt === 3)) {
      abilityAfterEach.push(whole.ability)
      continue
    }
    if (a.track) {
      const key = skillKey('quiz', a.track)
      // A pool nobody has worked in yet starts from the whole-subject estimate,
      // as the app's round and `seed_track_ability` both do.
      const pool = pools.get(key) ?? skills.get(key) ?? { ...whole, track: a.track }
      const u = updateAbility(pool, a.difficulty, a.correct)
      pools.set(key, {
        ...pool,
        track: a.track,
        ability: u.ability,
        abilitySd: u.abilitySd,
        totalAttempts: pool.totalAttempts + 1,
        totalCorrect: pool.totalCorrect + (a.correct ? 1 : 0),
      })
    }
    const u = updateAbility(whole, a.difficulty, a.correct)
    whole = {
      ...whole,
      ability: u.ability,
      abilitySd: u.abilitySd,
      totalAttempts: whole.totalAttempts + 1,
      totalCorrect: whole.totalCorrect + (a.correct ? 1 : 0),
    }
    abilityAfterEach.push(whole.ability)
  }
  const summary = summarizeRound(
    round.plan.planned,
    attempts,
    (k) => mastery.get(k),
    today,
    learner.band,
    (i) => abilityAfterEach[i] ?? whole.ability,
  )
  const graded = !study && attempts.some((a) => a.isTest)
  if (graded) {
    whole = updateStreak(whole, today)
    if (!whole.placed) whole = { ...whole, placed: true }
  }

  // Whether the round was seen through to its last card. An early end or an
  // idle close still writes the answers; it does not finish a task.
  const complete = round.plan.queue.length === 0 && round.answers.length > 0
  const durationMs = Math.max(0, Math.min(endedAt - startedAt, 3 * 60 * 60 * 1000))
  const session: SessionRecord = {
    // The round's own id, so closing the same round twice — a retry after a
    // failure between the write and the mark — finds its session already
    // there and writes nothing a second time.
    id: round.id,
    subject: 'quiz',
    activity: 'tutor',
    listId: round.deck_id,
    isTest: true,
    itemsTotal: summary.asked,
    itemsCorrect: summary.correct,
    accuracy: summary.accuracy,
    score: summary.correct * 10,
    wpm: null,
    durationMs,
    abilityBefore,
    abilityAfter: whole.ability,
    meta: { channel: 'mcp', client: grant.clientLabel, clientName: round.plan.clientName, roundId: round.id, mode: round.mode, complete },
    startedAt,
    endedAt,
    track: round.deck_id ? (trackOf.get(round.deck_id) ?? null) : null,
  }

  let taskClosed = false
  if (attempts.length) {
    await asUser(grant, async (db) => {
      if (!study) {
        const { rows: already } = await db.query('select 1 from public.sessions where id = $1', [session.id])
        if (already.length) return
      }
      await writeProgressChange(
        db,
        learnerId,
        study
          ? // Exposure only: the cards are met, and that is all that is claimed.
            { mastery: summary.mastery, attempts }
          : {
              skill: graded ? whole : undefined,
              skills: pools.size ? [...pools.values()] : undefined,
              mastery: summary.mastery,
              session,
              attempts,
              daily: { subject: 'quiz', seconds: Math.round(durationMs / 1000), items: summary.asked, correct: summary.correct },
            },
        'mcp',
      )
      if (!study) {
        const { rows } = await db.query(
          'select 1 from public.assignments where learner_id = $1 and session_id = $2 limit 1',
          [learnerId, session.id],
        )
        taskClosed = rows.length > 0
      }
    })
  }

  round.ended_at = new Date(endedAt)
  round.session_id = !study && attempts.length ? session.id : null
  round.plan.current = null
  await saveRound(round)

  const say = study
    ? `${attempts.length} cards met.`
    : taskClosed
      ? `${summary.say} That closes the task that was set.`
      : summary.say
  return {
    asked: study ? 0 : summary.asked,
    total: summary.total,
    correct: study ? 0 : summary.correct,
    accuracy: study ? 0 : summary.accuracy,
    missed: study ? [] : summary.missed,
    newlyMastered: study ? [] : summary.newlyMastered,
    taskClosed,
    say,
  }
}
