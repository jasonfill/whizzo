// The tools an assistant gets.
//
// Twelve, with a name, a title, a description that says when to call it, a JSON
// schema, and safety annotations — the directory checklist, in code. Every
// result carries `say`, a sentence the assistant can read aloud as written,
// because in voice a tool result *is* the next thing the child hears.
//
// Read tools are annotated read-only so the clients can run them without a
// confirmation. `start_round` and `answer` are writes and say so; the Account
// screen tells families to allow those two to run unsupervised, because a
// confirmation dialog on every answer is not a tutor.

import {
  isFragile,
  isSpeakable,
  isDue,
  masteryBand,
  cardKey,
  todayString,
  validateGeneratedCards,
  dedupeKey,
  MAX_CARDS_PER_SET,
  type QuizCard,
  type QuizDeck,
  type RawGeneratedCard,
  type TutorMode,
  TUTOR_MODES,
  TRACKS,
  type TrackId,
} from '@whizzo/shared'
import { richToPlain } from '@whizzo/shared/rich'
import { z } from 'zod'
import { dayOf } from '../progressMappers.js'
import { deckFor, decksFor, editableDeckFor, libraryDeckFor, libraryDecksFor, masteryFor } from '../progressRead.js'
import { appUrl, newId } from './tokens.js'
import {
  asUser,
  grantedLearners,
  inContext,
  NeedsLearner,
  rememberLearner,
  resolveLearner,
  ToolRefused,
  type LearnerInContext,
  type ToolContext,
} from './context.js'
import { answerRound, endRound, hintRound, loadRound, roundLearner, startRound, type RoundRow } from './rounds.js'

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export interface ToolResult {
  /** The structured result; also rendered as text for clients without structured content. */
  data: Record<string, unknown>
  say: string
  isError?: boolean
}

type Handler = (ctx: ToolContext, input: unknown) => Promise<ToolResult>

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const learnerArg = {
  learner: {
    type: 'string',
    description:
      "Which learner this is for, by first name or id. Leave out when the connection has one learner or one was chosen with select_learner.",
  },
}

const uuid = z.string().uuid()

const trackArg = { type: 'string', description: `A subject track id, e.g. science.biology. One of: ${TRACKS.map((t) => t.id).join(', ')}.` }

/** One card as an assistant writes it: the ingestion build call's `GeneratedCard`, reused. */
const cardInput = {
  type: 'object',
  properties: {
    term: { type: 'string', minLength: 1 },
    definition: { type: 'string', minLength: 1 },
    hint: { type: 'string' },
    example: { type: 'string' },
    explanation: { type: 'string' },
    category: { type: 'string' },
  },
  required: ['term', 'definition'],
  additionalProperties: false,
}

// --- Definitions, in the order clients list them (deterministic, per the spec) ---------------

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who is connected',
    description:
      'Who this connection is for: the learners it may work with, which one is current, and the connecting account’s role. Call it first in a conversation, or whenever unsure which child you are talking to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: read,
  },
  {
    name: 'select_learner',
    title: 'Choose the learner',
    description:
      'Make one learner the default for every later call in this connection. Use when the parent names a child ("tutor Maya") and there is more than one.',
    inputSchema: {
      type: 'object',
      properties: { learner: { type: 'string', description: 'First name or id.' } },
      required: ['learner'],
      additionalProperties: false,
    },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: 'list_materials',
    title: 'List decks',
    description:
      'The decks available to a learner, with how many cards are due today and how many can be asked out loud, plus any task a grown-up set on them. Call before start_round to find the deck the parent means; pass a few words of its title as query. The deck ids are in the JSON after the spoken line — start_round needs one.',
    inputSchema: {
      type: 'object',
      properties: {
        ...learnerArg,
        query: { type: 'string', description: 'Words from the deck title or a card, to narrow the list.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: read,
  },
  {
    name: 'get_progress',
    title: 'How a learner is doing',
    description:
      'A learner’s picture on one deck or across all of them: cards mastered, learning and unseen, what is due, and the items that are slipping (by their question side, never the answer). For a grown-up asking "how is Maya doing".',
    inputSchema: {
      type: 'object',
      properties: {
        ...learnerArg,
        materialId: { type: 'string', description: 'A deck id from list_materials. Leave out for the whole picture.' },
      },
      additionalProperties: false,
    },
    annotations: read,
  },
  {
    name: 'start_round',
    title: 'Start a round',
    description:
      'Begin a round of practice and get the first question, plus the tutoring instructions to follow for the whole round. The result JSON carries roundId, which every answer, hint and end_round call needs. Modes: practice (default; each card asked at the level the learner is at), study (teach the cards first — the only mode whose result carries answers), test (every card from memory, no hints), review (whatever is due across all decks; no materialId needed). Starting a new round closes any round still open.',
    inputSchema: {
      type: 'object',
      properties: {
        ...learnerArg,
        materialId: { type: 'string', description: 'A deck id from list_materials. Required except in review mode.' },
        mode: { type: 'string', enum: [...TUTOR_MODES], default: 'practice' },
        size: { type: 'integer', minimum: 3, maximum: 30, description: 'How many cards. Defaults to a round length suited to the learner’s age.' },
        direction: {
          type: 'string',
          enum: ['term-first', 'definition-first'],
          description: 'Which side to ask. Default asks the term and expects the definition.',
        },
      },
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'answer',
    title: 'Submit the learner’s answer',
    description:
      'Send exactly what the learner said for the open question. Returns whether it was right, the correct answer (only now), an explanation when the card has one, a line of praise in the learner’s register, and the next question — or the round summary when the round is over. Use skip when the learner passes.',
    inputSchema: {
      type: 'object',
      properties: {
        roundId: { type: 'string' },
        given: { type: 'string', description: 'The learner’s words, verbatim. Do not correct or complete them.' },
        skip: { type: 'boolean', description: 'The learner passed on this one. Recorded as a miss.' },
      },
      required: ['roundId'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'hint',
    title: 'Give a hint',
    description:
      'Help with the open question, when the learner asks for a hint or how to work it out — on any kind of question. The first call returns a clue about the answer (put it in your own words, briefly); the second returns the first letter and shape, except on a choice question where the choices are the rest of the help. Either lowers the level the answer is recorded at. Not available in test rounds.',
    inputSchema: {
      type: 'object',
      properties: { roundId: { type: 'string' } },
      required: ['roundId'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'end_round',
    title: 'End the round early',
    description: 'Close the round now, keeping what was answered, and get the summary. Only when the learner asks to stop.',
    inputSchema: {
      type: 'object',
      properties: { roundId: { type: 'string' } },
      required: ['roundId'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'create_deck',
    title: 'Make a deck',
    description:
      'File a new deck, made from notes or a conversation, into the connecting grown-up’s Whizzo library as a draft marked as made by an assistant. It is not assigned to anyone: the grown-up reviews it in the app and sets it as work from there. Cards need a term and a definition; hint, example, explanation and category are optional and unlock more activities. To change a deck that already exists, use update_deck instead of making another.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 80 },
        track: trackArg,
        termLabel: { type: 'string', maxLength: 30, description: 'What to call the question side, e.g. "Spanish".' },
        definitionLabel: { type: 'string', maxLength: 30, description: 'What to call the answer side, e.g. "English".' },
        cards: { type: 'array', minItems: 1, maxItems: 200, items: cardInput },
      },
      required: ['title', 'cards'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'update_deck',
    title: 'Change a deck',
    description:
      'Change a deck that already exists: retitle it, set its track or side labels, add cards, correct cards, or take cards out. Find the deck first — search covers the connecting grown-up’s library, drafts made with create_deck included, and list_materials covers a learner’s decks — and pass its id. A card whose term matches one already in the deck (ignoring case and punctuation) is corrected in place: it keeps the learner’s progress and every field you do not send. Any other card is added. Terms in remove are matched the same way. Changing cards makes the deck a draft again if a grown-up had reviewed it. Reaches decks in the grown-up’s own library and a learner’s own decks on this connection, never a deck another child on the account is working on. Changes land at once in whatever the learner practices, so say back what will change before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        deckId: { type: 'string', description: 'A deck id from search, fetch or list_materials.' },
        title: { type: 'string', minLength: 1, maxLength: 80 },
        track: { ...trackArg, description: `${trackArg.description} Pass an empty string to clear it.` },
        termLabel: { type: 'string', maxLength: 30, description: 'What to call the question side, e.g. "Spanish".' },
        definitionLabel: { type: 'string', maxLength: 30, description: 'What to call the answer side, e.g. "English".' },
        cards: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: cardInput,
          description: 'Cards to add, or to replace the existing card with the same term.',
        },
        remove: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: { type: 'string', minLength: 1 },
          description: 'Terms of the cards to take out.',
        },
        replaceCards: {
          type: 'boolean',
          description: 'Make cards the whole deck: every card not in it is removed. Cards whose term is already in the deck keep their progress. Default false.',
        },
      },
      required: ['deckId'],
      additionalProperties: false,
    },
    annotations: { ...write, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'search',
    title: 'Search decks',
    description:
      'Search the learners’ decks and the connecting grown-up’s library by title and question side. Returns ids, titles and links for fetch or update_deck; library decks, drafts made with create_deck among them, are marked library.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: read,
  },
  {
    name: 'fetch',
    title: 'Fetch a deck',
    description:
      'One deck’s title, subject and question sides, by id from search or list_materials — a learner’s deck or one in the grown-up’s library. Answer sides are never included.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: read,
  },
]

// --- Handlers -----------------------------------------------------------------------------------

function needsLearnerResult(e: NeedsLearner): ToolResult {
  const names = e.options.map((o) => o.name)
  const list = names.length === 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`
  return {
    data: { needsLearner: true, learners: e.options },
    say: `Which child is this for — ${list}?`,
  }
}

/**
 * `practice`, as it used to be spelled.
 *
 * Assembled from parts rather than written out, because a spelling sweep across
 * the repository has already eaten this shim once — converting the one string
 * whose entire purpose is to still be the old one, leaving a duplicated enum
 * member and a transform that could not fire. A literal here is a magnet for
 * the next sweep; this is not.
 */
const LEGACY_PRACTICE_MODE = ('practi' + 'se') as 'practise'

/**
 * The round mode an assistant asks for.
 *
 * The British spelling was this value before the codebase moved to US spelling,
 * and an assistant that connected before that deploy still has the old schema
 * in its context. It is accepted on the way in and normalized here: never
 * written, never returned, and never advertised — TUTOR_MODES carries the
 * current spelling only, and `mcp_rounds_mode_check` only allows that.
 *
 * Exported so the compatibility path has a test of its own. It did not have one
 * the first time, which is how a spelling sweep was able to delete it without a
 * single case going red.
 */
export const roundModeSchema = z
  .enum(['practice', 'study', 'test', 'review', LEGACY_PRACTICE_MODE])
  .default('practice')
  .transform((m) => (m === LEGACY_PRACTICE_MODE ? ('practice' as const) : m))

const learnerParam = z.string().max(120).optional()

const cardParam = z.object({
  term: z.string().min(1).max(2000),
  definition: z.string().min(1).max(2000),
  hint: z.string().max(500).optional(),
  example: z.string().max(1000).optional(),
  explanation: z.string().max(1000).optional(),
  category: z.string().max(80).optional(),
})
type CardInput = z.infer<typeof cardParam>

/**
 * Cards as the assistant wrote them, checked the way ingestion checks a
 * model's output: a term and a definition each, no two asking the same thing,
 * nothing malformed. Each card carries what it was given, marked as generated.
 */
function buildCards(input: CardInput[]): { cards: QuizCard[]; problems: string[] } {
  const raw: RawGeneratedCard[] = input.map((c) => ({ ...c }))
  const validated = validateGeneratedCards(raw, (term, definition) => ({
    id: newId(),
    term,
    definition,
    hint: null,
    difficulty: 2,
  }))
  const cards: QuizCard[] = validated.cards.map((c) => ({
    ...c,
    generated: ['term', 'definition', ...(c.example ? ['example'] : []), ...(c.explanation ? ['explanation'] : [])],
  }))
  return { cards, problems: validated.dropped.map((d) => `${d.text}: ${d.reason}`) }
}

/**
 * How two terms are compared when a card is corrected or removed by term:
 * the same key ingestion dedupes on, so an assistant cannot make a pair of
 * cards a build would have refused.
 */
const termKey = dedupeKey

/** A track id as the assistant sent it: a known id, '' to clear, or a refusal. */
function parseTrack(value: string | undefined): TrackId | null | undefined {
  if (value === undefined) return undefined
  if (value === '') return null
  if (!TRACKS.some((t) => t.id === value)) {
    throw new ToolRefused(`No track called ${value}. One of: ${TRACKS.map((t) => t.id).join(', ')}.`)
  }
  return value as TrackId
}

const OPTIONAL_CARD_FIELDS = ['hint', 'example', 'explanation', 'category'] as const

/**
 * A correction keeps everything the assistant did not send. The fields that
 * unlock activities — media, answer kind and tolerance, alternates, order,
 * source pages — were set by someone who saw more of the card than its
 * question side, which is all fetch ever shows an assistant. A rich term
 * (math, a figure) is kept over the plain echo of it; a plain one takes the
 * new spelling.
 */
function correctCard(prior: QuizCard, fresh: QuizCard, given: CardInput | undefined): QuizCard {
  const plainTerm = richToPlain(prior.term) === prior.term
  const supplied = given ? OPTIONAL_CARD_FIELDS.filter((k) => given[k] !== undefined) : [...OPTIONAL_CARD_FIELDS]
  const out: QuizCard = { ...prior, term: plainTerm ? fresh.term : prior.term, definition: fresh.definition }
  for (const k of supplied) out[k] = fresh[k] ?? null
  out.generated = [...new Set([...(prior.generated ?? []), 'definition', ...supplied])]
  return out
}

interface Merge {
  cards: QuizCard[]
  added: number
  corrected: number
  /** Question sides of the cards no longer in the deck. */
  removed: string[]
  /** Terms in `remove` that matched nothing. */
  notFound: string[]
}

/**
 * The deck's cards after an edit. Pure, so the rules can be read in one
 * place: an incoming card whose term matches an existing one is a correction
 * and keeps its id; anything else is added; a term in `remove` takes its card
 * out unless the same call also sends that card, which is a correction, not
 * a removal-and-return with a fresh id. With `replace`, the incoming cards
 * are the whole deck and existing ones still lend their ids by term.
 */
function mergeCards(existing: QuizCard[], incoming: QuizCard[], given: Map<string, CardInput>, remove: string[], replace: boolean): Merge {
  const prior = new Map(existing.map((c) => [termKey(c.term), c] as const))
  const next = new Map(replace ? [] : prior)
  const sent = new Set<string>()
  let added = 0
  let corrected = 0
  for (const card of incoming) {
    const key = termKey(card.term)
    sent.add(key)
    const was = prior.get(key)
    if (was) corrected += 1
    else added += 1
    next.set(key, was ? correctCard(was, card, given.get(key)) : card)
  }
  const notFound: string[] = []
  for (const term of remove) {
    const key = termKey(term)
    if (!prior.has(key)) {
      if (!notFound.includes(term.trim())) notFound.push(term.trim())
      continue
    }
    if (!sent.has(key)) next.delete(key)
  }
  const kept = new Set([...next.values()].map((c) => c.id))
  const removed = existing.filter((c) => !kept.has(c.id)).map((c) => richToPlain(c.term).trim())
  return { cards: [...next.values()], added, corrected, removed, notFound }
}

/** The arguments to update_deck that change something; a call with none of them is refused. */
const DECK_CHANGES = ['title', 'track', 'termLabel', 'definitionLabel', 'cards', 'remove'] as const

const handlers: Record<string, Handler> = {
  async whoami(ctx) {
    const learners = await asUser(ctx.grant, (db) => grantedLearners(db, ctx.grant))
    const current = learners.find((l) => l.id === ctx.grant.currentLearnerId) ?? (learners.length === 1 ? learners[0] : null)
    const rows = learners.map((l) => ({
      id: l.id,
      name: l.displayName,
      grade: l.gradeHint,
      band: inContext(l).band,
      current: current?.id === l.id,
    }))
    const say = !learners.length
      ? 'This connection no longer reaches any learner.'
      : learners.length === 1
        ? `Connected to Whizzo for ${learners[0]?.displayName}.`
        : `Connected to Whizzo for ${learners.map((l) => l.displayName).join(', ')}.${current ? ` Currently working with ${current.displayName}.` : ' Say which one to work with.'}`
    return { data: { learners: rows, client: ctx.grant.clientLabel, scope: ctx.grant.scope }, say }
  },

  async select_learner(ctx, input) {
    const { learner } = z.object({ learner: z.string().min(1).max(120) }).parse(input)
    const chosen = await asUser(ctx.grant, (db) => resolveLearner(db, ctx.grant, learner))
    await rememberLearner(ctx.grant.id, chosen.learner.id)
    ctx.grant.currentLearnerId = chosen.learner.id
    return {
      data: { learner: { id: chosen.learner.id, name: chosen.learner.displayName, band: chosen.band } },
      say: `Working with ${chosen.firstName} now.`,
    }
  },

  async list_materials(ctx, input) {
    const args = z.object({ learner: learnerParam, query: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(10) }).parse(input)
    return asUser(ctx.grant, async (db) => {
      const who = await resolveLearner(db, ctx.grant, args.learner)
      const [decks, mastery, tasks] = await Promise.all([
        decksFor(db, who.learner.id),
        masteryFor(db, who.learner.id),
        db.query(
          `select a.id, t.activity, t.target_id, t.due_on
             from public.assignments a join public.assignment_sets t on t.id = a.set_id
            where a.learner_id = $1 and a.status = 'open' and t.subject = 'quiz'`,
          [who.learner.id],
        ),
      ])
      const taskFor = new Map<string, { id: string; activity: string; dueOn: string | null }>()
      for (const r of tasks.rows as Array<{ id: string; activity: string; target_id: string | null; due_on: Date | null }>) {
        if (r.target_id) taskFor.set(r.target_id, { id: r.id, activity: r.activity, dueOn: dayOf(r.due_on) })
      }
      const today = todayString()
      const needle = args.query?.trim().toLowerCase()
      const rows = decks
        .filter((d) => {
          if (!needle) return true
          if (d.title.toLowerCase().includes(needle)) return true
          return d.cards.some((c) => richToPlain(c.term).toLowerCase().includes(needle))
        })
        .map((d) => {
          let dueToday = 0
          let unseen = 0
          for (const c of d.cards) {
            const m = mastery.get(cardKey(d.id, c.id))
            if (!m || m.totalAttempts === 0) unseen += 1
            else if (isDue(m, today)) dueToday += 1
          }
          return {
            id: d.id,
            title: d.title,
            kind: 'deck' as const,
            track: d.track ?? null,
            cards: d.cards.length,
            dueToday,
            unseen,
            speakable: d.cards.filter(isSpeakable).length,
            task: taskFor.get(d.id) ?? null,
          }
        })
        .sort((a, b) => b.dueToday - a.dueToday || b.unseen - a.unseen)
      const total = rows.length
      const page = rows.slice(0, args.limit)

      const name = who.firstName
      let say: string
      const top = page[0]
      if (!top) say = needle ? `${name} has no deck matching "${args.query}".` : `${name} has no decks yet.`
      else {
        const detail = top.dueToday ? `${top.dueToday} due today` : top.unseen ? `${top.unseen} not yet met` : 'nothing due'
        const named = page.map((r) => `"${r.title}"`).join(', ')
        say =
          `${name} has ${total === 1 ? 'one deck' : `${total} decks`}` +
          (total > page.length ? `; the first ${page.length}: ${named}` : `: ${named}`) +
          `. "${top.title}" has ${detail}.`
        const silent = page.filter((r) => r.speakable === 0)
        if (silent.length) say += ` ${silent.map((r) => `"${r.title}"`).join(' and ')} can’t be asked out loud — figures or photographs.`
      }
      return { data: { learner: { id: who.learner.id, name: who.learner.displayName }, materials: page, total }, say }
    })
  },

  async get_progress(ctx, input) {
    const args = z.object({ learner: learnerParam, materialId: z.string().max(120).optional() }).parse(input)
    return asUser(ctx.grant, async (db) => {
      const who = await resolveLearner(db, ctx.grant, args.learner)
      const [decks, mastery] = await Promise.all([decksFor(db, who.learner.id), masteryFor(db, who.learner.id)])
      const chosen = args.materialId ? decks.filter((d) => d.id === args.materialId) : decks
      if (args.materialId && !chosen.length) throw new ToolRefused('No deck with that id is available to this learner.')
      const today = todayString()

      const perDeck = chosen.map((d) => {
        let mastered = 0
        let learning = 0
        let unseen = 0
        let due = 0
        const weak: Array<{ prompt: string; mastery: number }> = []
        // The same bands the app's screens use, so a parent hears from the
        // assistant what they would read on the Progress screen.
        for (const c of d.cards) {
          const m = mastery.get(cardKey(d.id, c.id))
          const band = masteryBand(m)
          if (band === 'new' || !m) {
            unseen += 1
            continue
          }
          if (band === 'mastered') mastered += 1
          else learning += 1
          if (isDue(m, today)) due += 1
          if (isFragile(m) || band === 'learning') weak.push({ prompt: richToPlain(c.term).trim(), mastery: Math.round(m.mastery * 100) })
        }
        weak.sort((a, b) => a.mastery - b.mastery)
        return { id: d.id, title: d.title, track: d.track ?? null, cards: d.cards.length, mastered, learning, unseen, due, slipping: weak.slice(0, 5).map((w) => w.prompt) }
      })

      const { rows: recent } = await db.query(
        `select count(*)::int as rounds, coalesce(sum(verified_items_correct),0)::int as correct, coalesce(sum(verified_items_total),0)::int as total
           from public.sessions where learner_id = $1 and subject = 'quiz' and ended_at > now() - interval '7 days'`,
        [who.learner.id],
      )
      const week = recent[0] as { rounds: number; correct: number; total: number }
      const totals = perDeck.reduce(
        (acc, d) => ({ mastered: acc.mastered + d.mastered, learning: acc.learning + d.learning, unseen: acc.unseen + d.unseen, due: acc.due + d.due }),
        { mastered: 0, learning: 0, unseen: 0, due: 0 },
      )
      const name = who.firstName
      const scope = args.materialId ? `on "${perDeck[0]?.title}"` : 'across all decks'
      const slipping = perDeck.flatMap((d) => d.slipping).slice(0, 3)
      const say =
        `${name}, ${scope}: ${totals.mastered} mastered, ${totals.learning} still learning, ${totals.unseen} not yet met, ${totals.due} due today. ` +
        `${week.rounds} ${week.rounds === 1 ? 'round' : 'rounds'} this week` +
        (week.total ? `, ${Math.round((week.correct / week.total) * 100)}% on checked answers.` : '.') +
        (slipping.length ? ` Slipping: ${slipping.join(', ')}.` : '')
      return { data: { learner: { id: who.learner.id, name: who.learner.displayName }, totals, thisWeek: week, decks: perDeck }, say }
    })
  },

  async start_round(ctx, input) {
    const args = z
      .object({
        learner: learnerParam,
        materialId: z.string().max(120).optional(),
        mode: roundModeSchema,
        size: z.number().int().min(3).max(30).optional(),
        direction: z.enum(['term-first', 'definition-first']).optional(),
      })
      .parse(input)
    const who = await asUser(ctx.grant, (db) => resolveLearner(db, ctx.grant, args.learner))
    const result = await startRound(
      ctx.grant,
      who,
      ctx.clientName,
      { mode: args.mode as TutorMode, deckId: args.materialId, size: args.size, direction: args.direction },
      ctx.log,
    )
    const { say, ...data } = result
    return { data: { learner: { id: who.learner.id, name: who.learner.displayName }, ...data }, say }
  },

  async answer(ctx, input) {
    const args = z.object({ roundId: uuid, given: z.string().max(2000).optional(), skip: z.boolean().optional() }).parse(input)
    const { round, learner } = await roundContext(ctx, args.roundId)
    const result = await answerRound(ctx.grant, learner, round, args.given ?? null, Boolean(args.skip))
    const { say, ...data } = result
    return { data, say }
  },

  async hint(ctx, input) {
    const args = z.object({ roundId: uuid }).parse(input)
    const { round, learner } = await roundContext(ctx, args.roundId)
    const result = await hintRound(ctx.grant, learner, round)
    return { data: { kind: result.kind, clue: result.clue, scaffold: result.scaffold }, say: result.say }
  },

  async end_round(ctx, input) {
    const args = z.object({ roundId: uuid }).parse(input)
    const { round, learner } = await roundContext(ctx, args.roundId)
    const summary = await endRound(ctx.grant, learner, round)
    const { say, ...data } = summary
    return { data, say }
  },

  async create_deck(ctx, input) {
    const args = z
      .object({
        title: z.string().min(1).max(80),
        track: z.string().max(60).optional(),
        termLabel: z.string().max(30).optional(),
        definitionLabel: z.string().max(30).optional(),
        cards: z.array(cardParam).min(1).max(200),
      })
      .parse(input)

    const track = parseTrack(args.track) ?? null
    const { cards, problems } = buildCards(args.cards)
    if (!cards.length) throw new ToolRefused(`None of those cards were usable: ${problems.slice(0, 3).join('; ')}`)

    const deckId = newId()
    await asUser(ctx.grant, async (db) => {
      // The same insert the Library screen makes: a grown-up's deck, owned by
      // the account, filed under nobody until it is set as work.
      await db.query(
        `insert into public.decks
           (id, owner_user_id, title, description, tags, cards, term_label, definition_label, track, objectives, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', now())`,
        [
          deckId,
          ctx.grant.userId,
          args.title,
          `Made by ${ctx.clientName ?? 'an assistant'} — review before setting as work.`,
          ['generated', ctx.grant.clientLabel],
          JSON.stringify(cards),
          args.termLabel ?? 'Term',
          args.definitionLabel ?? 'Definition',
          track,
        ],
      )
    })
    const dropped = problems.length
    return {
      data: { deck: { id: deckId, title: args.title, cards: cards.length, track }, dropped: problems.slice(0, 10), url: `${appUrl()}/library` },
      say:
        `Saved "${args.title}" with ${cards.length} cards to your Whizzo library as a draft.` +
        (dropped ? ` ${dropped} ${dropped === 1 ? 'card was' : 'cards were'} left out.` : '') +
        ' Review it in the app and set it as work from there.',
    }
  },

  async update_deck(ctx, input) {
    const args = z
      .object({
        deckId: uuid,
        title: z.string().min(1).max(80).optional(),
        track: z.string().max(60).optional(),
        termLabel: z.string().max(30).optional(),
        definitionLabel: z.string().max(30).optional(),
        cards: z.array(cardParam).min(1).max(200).optional(),
        remove: z.array(z.string().min(1).max(2000)).min(1).max(200).optional(),
        replaceCards: z.boolean().optional(),
      })
      .parse(input)

    if (args.replaceCards && !args.cards) throw new ToolRefused('replaceCards needs cards — the ones the deck should hold.')
    if (DECK_CHANGES.every((k) => args[k] === undefined)) {
      throw new ToolRefused('Nothing to change: give a new title, track or labels, cards to add or correct, or terms to remove.')
    }
    const track = parseTrack(args.track)
    const { deckId } = args

    return asUser(ctx.grant, async (db) => {
      const found = await editableDeckFor(db, ctx.grant.userId, ctx.grant.learnerIds, deckId)
      if (!found) {
        throw new ToolRefused(
          'No deck with that id can be changed on this connection. It may be shared with the learner rather than theirs or yours, or be one another child on this account is working on.',
        )
      }
      const { deck, learnerId, accepted } = found

      let merge: Merge | null = null
      const problems: string[] = []
      if (args.cards || args.remove || args.replaceCards) {
        let incoming: QuizCard[] = []
        const given = new Map<string, CardInput>()
        if (args.cards) {
          const built = buildCards(args.cards)
          problems.push(...built.problems)
          if (!built.cards.length) throw new ToolRefused(`None of those cards were usable: ${problems.slice(0, 3).join('; ')}`)
          incoming = built.cards
          for (const c of args.cards) given.set(termKey(c.term), c)
        }
        merge = mergeCards(deck.cards, incoming, given, args.remove ?? [], Boolean(args.replaceCards))
        if (!merge.cards.length) throw new ToolRefused('That would leave the deck with no cards. Remove fewer, or add some.')
        if (merge.cards.length > MAX_CARDS_PER_SET) {
          throw new ToolRefused(`That would make ${merge.cards.length} cards; a deck holds at most ${MAX_CARDS_PER_SET}.`)
        }
      }

      const title = args.title ?? deck.title
      const nextTrack: TrackId | null = track === undefined ? (deck.track ?? null) : track
      const sets = ['title = $2', 'track = $3', 'term_label = $4', 'definition_label = $5', 'updated_at = now()']
      const params: unknown[] = [deckId, title, nextTrack, args.termLabel ?? deck.termLabel, args.definitionLabel ?? deck.definitionLabel]
      if (merge) {
        // Cards an assistant wrote make the deck unreviewed again, whoever
        // made it: back to a draft, with the provenance create_deck stamps,
        // so the Library shows what happened and the review gate holds.
        params.push(JSON.stringify(merge.cards), [...new Set([...deck.tags, 'generated', ctx.grant.clientLabel])])
        sets.push('cards = $6', 'tags = $7', 'accepted_at = null')
      }
      const { rowCount } = await db.query(`update public.decks set ${sets.join(', ')} where id = $1`, params)
      // RLS decides who may write: an account that can see a learner's deck
      // without managing it gets the row above and no update here.
      if (!rowCount) throw new ToolRefused('This connection can see that deck but may not change it.')

      const parts: string[] = []
      if (args.title !== undefined && args.title !== deck.title) parts.push(`renamed it "${title}"`)
      if (track !== undefined && nextTrack !== (deck.track ?? null)) parts.push(nextTrack ? `filed it under ${nextTrack}` : 'took it off its track')
      if ((args.termLabel !== undefined && args.termLabel !== deck.termLabel) || (args.definitionLabel !== undefined && args.definitionLabel !== deck.definitionLabel)) {
        parts.push('relabeled the sides')
      }
      if (merge && args.replaceCards) parts.push(`replaced the cards, ${merge.corrected} of them keeping their progress`)
      else if (merge) {
        if (merge.added) parts.push(`added ${merge.added} ${merge.added === 1 ? 'card' : 'cards'}`)
        if (merge.corrected) parts.push(`corrected ${merge.corrected}`)
        if (merge.removed.length) parts.push(`removed ${merge.removed.length}`)
      }
      const count = merge ? merge.cards.length : deck.cards.length
      const notFound = merge?.notFound ?? []
      const say =
        `Updated "${title}"` +
        (parts.length ? `: ${parts.join(', ')}` : '') +
        `. It has ${count} ${count === 1 ? 'card' : 'cards'} now.` +
        (problems.length ? ` ${problems.length} ${problems.length === 1 ? 'card was' : 'cards were'} left out.` : '') +
        (notFound.length ? ` No card matched ${notFound.map((t) => `"${t}"`).join(', ')}.` : '') +
        (merge && accepted ? ' It is a draft again: look it over in the app before it is set as work.' : '')
      return {
        data: {
          deck: { id: deckId, title, cards: count, track: nextTrack },
          added: merge?.added ?? 0,
          corrected: merge?.corrected ?? 0,
          removed: merge?.removed ?? [],
          notFound,
          dropped: problems.slice(0, 10),
          draft: Boolean(merge),
          url: learnerId ? `${appUrl()}/quiz/deck/${deckId}` : `${appUrl()}/library`,
        },
        say,
      }
    })
  },

  async search(ctx, input) {
    const { query } = z.object({ query: z.string().max(200) }).parse(input)
    const needle = query.trim().toLowerCase()
    return asUser(ctx.grant, async (db) => {
      const learners = await grantedLearners(db, ctx.grant)
      const [library, ...perLearner] = await Promise.all([
        libraryDecksFor(db, ctx.grant.userId, ctx.grant.learnerIds),
        ...learners.map((l) => decksFor(db, l.id)),
      ])
      const hit = (d: QuizDeck) => !needle || d.title.toLowerCase().includes(needle) || d.cards.some((c) => richToPlain(c.term).toLowerCase().includes(needle))
      const inLibrary = new Set(library.map((d) => d.id))
      const results: Array<{ id: string; title: string; url: string; learner: string | null; library: boolean; cards: number }> = []
      const seen = new Set<string>()
      learners.forEach((l, i) => {
        for (const d of perLearner[i] ?? []) {
          if (!hit(d) || seen.has(d.id)) continue
          seen.add(d.id)
          results.push({ id: d.id, title: d.title, url: `${appUrl()}/quiz/deck/${d.id}`, learner: l.displayName, library: inLibrary.has(d.id), cards: d.cards.length })
        }
      })
      for (const d of library) {
        if (!hit(d) || seen.has(d.id)) continue
        seen.add(d.id)
        results.push({ id: d.id, title: d.title, url: `${appUrl()}/library`, learner: null, library: true, cards: d.cards.length })
      }
      // Decks no learner holds come first: a draft filed with create_deck is
      // reachable through nothing but this tool, so it must not be the row a
      // cap cuts off. Stable, so each group keeps its own order.
      results.sort((a, b) => Number(a.learner !== null) - Number(b.learner !== null))
      const page = results.slice(0, 20)
      const libraryHits = results.filter((r) => r.library).length
      const say = results.length
        ? `${results.length} matching ${results.length === 1 ? 'deck' : 'decks'}` +
          (libraryHits ? `, ${libraryHits} in your library` : '') +
          (results.length > page.length ? `; the first ${page.length} are listed` : '') +
          '.'
        : 'No matching decks.'
      return { data: { results: page, total: results.length }, say }
    })
  },

  async fetch(ctx, input) {
    const { id } = z.object({ id: z.string().max(120) }).parse(input)
    return asUser(ctx.grant, async (db) => {
      const learners = await grantedLearners(db, ctx.grant)
      const [inLibrary, ...perLearner] = await Promise.all([
        libraryDeckFor(db, ctx.grant.userId, ctx.grant.learnerIds, id),
        ...learners.map((l) => deckFor(db, l.id, id)),
      ])
      const held = perLearner.find((d) => d !== null) ?? null
      const deck = held ?? inLibrary
      if (!deck) throw new ToolRefused('No deck with that id is available on this connection.')
      const prompts = deck.cards.map((c) => richToPlain(c.term).trim())
      return {
        data: {
          id: deck.id,
          title: deck.title,
          text: `${deck.title}\n${deck.track ? `Track: ${deck.track}\n` : ''}${deck.cards.length} cards. Question sides:\n${prompts.map((p) => `- ${p}`).join('\n')}`,
          url: held ? `${appUrl()}/quiz/deck/${deck.id}` : `${appUrl()}/library`,
          metadata: { track: deck.track ?? null, cards: deck.cards.length, termLabel: deck.termLabel, definitionLabel: deck.definitionLabel, library: inLibrary !== null },
        },
        say: `"${deck.title}", ${deck.cards.length} cards${held ? '' : ', in your library'}.`,
      }
    })
  },
}

/**
 * The round and the learner it belongs to — loaded once per call, and the
 * learner taken from the round, so a round stays bound to the child it
 * started with whatever the connection's current learner is now.
 */
async function roundContext(ctx: ToolContext, roundId: string): Promise<{ round: RoundRow; learner: LearnerInContext }> {
  const round = await loadRound(roundId, ctx.grant)
  if (!round) throw new ToolRefused('No such round on this connection. Start a new one.')
  const learner = await roundLearner(ctx.grant, round)
  if (!learner) throw new ToolRefused('That learner is no longer on this connection. Start a new round.')
  return { round, learner }
}

export async function callTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const handler = handlers[name]
  if (!handler) throw new ToolRefused(`No tool called ${name}.`)
  try {
    return await handler(ctx, input ?? {})
  } catch (err) {
    if (err instanceof NeedsLearner) return needsLearnerResult(err)
    if (err instanceof ToolRefused) return { data: { error: err.message }, say: err.message, isError: true }
    if (err instanceof z.ZodError) {
      const issue = err.issues[0]
      const message = `${issue?.path.join('.') ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'Invalid arguments'}`
      return { data: { error: message }, say: message, isError: true }
    }
    throw err
  }
}
