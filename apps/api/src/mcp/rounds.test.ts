// A round from the API's side: started, answered, closed, written.
//
// The pure parts — what a question payload may contain, how speech is graded —
// are pinned in the shared package and by `simulate:tutor`. What is pinned
// here is the plumbing around them: a round is held by the server, the answer
// side reaches the assistant only from `answer`, and closing writes one
// session and its attempts through the same path as the app, as mcp evidence.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)
const withAdmin = vi.hoisted(() => vi.fn(async (fn: (db: unknown) => Promise<unknown>) => fn({ query })))

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  withAdmin: (...a: Parameters<typeof withAdmin>) => withAdmin(...a),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    MCP_TOKEN_SECRET: 'an-mcp-secret-that-is-at-least-thirty-two-characters',
    APP_URL: 'https://whizzo.test',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false, webOrigins: [] }))

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const LEARNER2 = '11111111-2222-4333-8444-666666666666'
const GRANT = '22222222-3333-4444-8555-666666666666'
const DECK = '44444444-5555-4666-8777-888888888888'

const grant = {
  id: GRANT,
  userId: CALLER,
  clientId: 'c',
  clientLabel: 'claude' as const,
  learnerIds: [LEARNER],
  currentLearnerId: LEARNER as string | null,
  scope: 'tutor',
}

const learner = {
  learner: {
    id: LEARNER,
    ownerId: CALLER,
    displayName: 'Maya',
    avatarEmoji: '🐱',
    gradeHint: 4,
    birthYear: null,
    authKind: 'none' as const,
    authUserId: null,
    createdAt: 0,
    theme: null,
    covered: false,
  },
  band: 'growing' as const,
  firstName: 'Maya',
}

const deckRow = {
  id: DECK,
  title: 'Cells',
  description: '',
  tags: [],
  cards: [
    { id: 'c1', term: 'Powerhouse of the cell', definition: 'Mitochondria', hint: null, difficulty: 2, explanation: 'It makes ATP.', example: 'Mitochondria turn sugar into energy the cell can use.' },
    { id: 'c2', term: 'Controls the cell', definition: 'Nucleus', hint: null, difficulty: 2 },
    { id: 'c3', term: 'Makes proteins', definition: 'Ribosome', hint: null, difficulty: 2 },
    { id: 'c4', term: 'Site of photosynthesis', definition: 'Chloroplast', hint: null, difficulty: 2 },
  ],
  term_label: 'Term',
  definition_label: 'Definition',
  track: 'science.biology',
  objectives: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

/** An in-memory `mcp_rounds`, so the round survives between calls the way the table would. */
const rounds = new Map<string, Record<string, unknown>>()
/** What `item_mastery` answers with; tests that need history set it. */
let masteryRows: Array<Record<string, unknown>> = []
/** Session ids the database already holds, for the retry test. */
let existingSessions = new Set<string>()

const masteredRow = (cardId: string) => ({
  learner_id: LEARNER, subject: 'quiz', item_key: `${DECK}:${cardId}`, list_id: DECK, difficulty: 2,
  mastery: 0.9, reps: 5, lapses: 0, correct_streak: 3, total_attempts: 5, total_correct: 5,
  interval_days: 32, due_on: '2026-10-08', first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
})

const learnerRow = (id: string, name: string) => ({
  id, owner_id: CALLER, display_name: name, avatar_emoji: '🐱', grade_hint: 4, birth_year: null,
  auth_kind: 'none', auth_user_id: null, created_at: new Date().toISOString(), theme: null, covered: false,
})

function wire() {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from public.learners l')) {
      const ids = (params[0] as string[]) ?? []
      return { rows: [learnerRow(LEARNER, 'Maya'), learnerRow(LEARNER2, 'Theo')].filter((l) => ids.includes(l.id)), rowCount: 2 }
    }
    if (sql.includes('from public.decks')) return { rows: [deckRow], rowCount: 1 }
    if (sql.includes('from public.item_mastery')) return { rows: masteryRows, rowCount: masteryRows.length }
    if (sql.includes('select 1 from public.sessions where id')) {
      const hit = existingSessions.has(String(params[0]))
      return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 }
    }
    if (sql.includes('from public.skill_states')) return { rows: [], rowCount: 0 }
    if (sql.includes('insert into public.mcp_rounds')) {
      rounds.set(String(params[0]), {
        id: params[0], grant_id: params[1], learner_id: params[2], deck_id: params[3], mode: params[4],
        plan: JSON.parse(String(params[5])), answers: JSON.parse(String(params[6])),
        started_at: params[7], last_answer_at: params[8], ended_at: null, session_id: null,
      })
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('update public.mcp_rounds')) {
      const row = rounds.get(String(params[0]))
      if (row) Object.assign(row, { plan: JSON.parse(String(params[1])), answers: JSON.parse(String(params[2])), last_answer_at: params[3], ended_at: params[4], session_id: params[5] })
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('from public.mcp_rounds where id')) {
      const row = rounds.get(String(params[0]))
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
    }
    if (sql.includes('from public.mcp_rounds where grant_id')) {
      const open = [...rounds.values()].filter((r) => !r.ended_at)
      return { rows: open, rowCount: open.length }
    }
    return { rows: [], rowCount: 0 }
  })
}

beforeEach(() => {
  rounds.clear()
  masteryRows = []
  existingSessions = new Set()
  query.mockReset()
  wire()
})

/** The round and its learner, the way the `answer` tool loads them. */
async function open(roundId: string, g = grant) {
  const { loadRound, roundLearner } = await import('./rounds.js')
  const round = (await loadRound(roundId, g))!
  const who = (await roundLearner(g, round))!
  return { round, who }
}

const theo = { ...learner, learner: { ...learner.learner, id: LEARNER2, displayName: 'Theo' }, firstName: 'Theo' }

describe('a practice round', () => {
  it('asks without telling, records the answer as mcp evidence, and writes once at the end', async () => {
    const { startRound, answerRound } = await import('./rounds.js')

    const started = await startRound(grant, learner, 'claude-ai', { mode: 'test', deckId: DECK, size: 2 })
    expect(started.total).toBe(2)
    expect(started.instructions).toContain('Maya')
    // The payload says what to ask and never what the answer is.
    const q = started.question!
    expect(JSON.stringify(started).toLowerCase()).not.toContain(deckAnswer(q.cardId).toLowerCase())

    // A right answer, spoken with a filler.
    let o = await open(started.roundId)
    const first = await answerRound(grant, o.who, o.round, `um, ${deckAnswer(q.cardId)}`, false)
    expect(first.verdict).toBe('correct')
    expect(first.answer).toBe(deckAnswer(q.cardId))
    expect(first.question).toBeDefined()
    expect(first.summary).toBeUndefined()
    // Nothing has been written yet: the round is held, not committed.
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into public.attempts'))).toBe(false)

    // A miss on the last card closes the round.
    o = await open(started.roundId)
    const second = await answerRound(grant, o.who, o.round, 'no idea', false)
    expect(second.verdict).toBe('wrong')
    expect(second.summary).toBeDefined()
    expect(second.summary?.correct).toBe(1)
    expect(second.summary?.asked).toBe(2)

    // One session, its attempts as mcp evidence, and the three closers.
    const sql = query.mock.calls.map(([s]) => String(s))
    expect(sql.filter((s) => s.includes('insert into public.sessions')).length).toBe(1)
    const attemptsInsert = query.mock.calls.find(([s]) => String(s).includes('insert into public.attempts'))
    expect(attemptsInsert).toBeDefined()
    const values = attemptsInsert![1] as unknown[]
    // 16 columns per row, two rows; the channel is the last column of each.
    expect(values.length).toBe(32)
    expect(values[15]).toBe('mcp')
    expect(values[31]).toBe('mcp')
    expect(values[4]).toBe('tutor')
    expect(values[6]).toBe(true) // verified
    expect(sql.some((s) => s.includes('complete_matching_assignments'))).toBe(true)
    expect(sql.some((s) => s.includes('award_matching_rewards'))).toBe(true)

    // And the round row says it is over.
    expect(rounds.get(started.roundId)?.ended_at).toBeTruthy()
  })

  it('a hint lowers the rung the answer is recorded at, and a test refuses one', async () => {
    const { startRound, hintRound, answerRound } = await import('./rounds.js')
    const test = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 3 })
    let o = await open(test.roundId)
    await expect(hintRound(grant, o.who, o.round)).rejects.toThrow(/No hints/)

    const practice = await startRound(grant, learner, null, { mode: 'practice', deckId: DECK, size: 3 })
    // Fresh cards are asked as a choice; a clue still comes, the letters do not.
    o = await open(practice.roundId)
    const h = await hintRound(grant, o.who, o.round)
    const asked = practice.question!
    const card = deckRow.cards.find((c) => c.id === asked.cardId)!
    if (card.example || card.explanation) {
      expect(h.kind).toBe('clue')
      expect(h.clue?.toLowerCase()).not.toContain(card.definition.toLowerCase())
    } else {
      expect(h.kind).toBe('none')
      expect(h.say).toMatch(/one of the choices/)
    }
    o = await open(practice.roundId)
    const again = await hintRound(grant, o.who, o.round)
    expect(again.kind).toBe('none')
    expect(again.scaffold).toBeNull()
    o = await open(practice.roundId)
    const a = await answerRound(grant, o.who, o.round, 'nope', false)
    expect(a.verdict).toBe('wrong')
  })

  it('help comes as a clue first, then the letters, and lowers the rung either way', async () => {
    const { startRound, hintRound, answerRound, endRound } = await import('./rounds.js')
    // A card the learner has met enough to be asked at free recall, and due.
    masteryRows = [{ ...masteredRow('c1'), due_on: '2026-01-01' }]
    // Three cards, so the round has a review slot for the due one to fill first.
    const r = await startRound(grant, learner, null, { mode: 'practice', deckId: DECK, size: 3 })
    expect(r.question?.cardId).toBe('c1')
    expect(r.question?.kind).toBe('written')

    let o = await open(r.roundId)
    const first = await hintRound(grant, o.who, o.round)
    expect(first.kind).toBe('clue')
    expect(first.clue).toBe('Think of this: ___ turn sugar into energy the cell can use.')
    expect(first.say.toLowerCase()).not.toContain('mitochondria')

    o = await open(r.roundId)
    const second = await hintRound(grant, o.who, o.round)
    expect(second.kind).toBe('letters')
    expect(second.scaffold).toMatch(/^M_+$/)

    o = await open(r.roundId)
    const third = await hintRound(grant, o.who, o.round)
    expect(third.kind).toBe('none')

    o = await open(r.roundId)
    await answerRound(grant, o.who, o.round, 'mitochondria', false)
    o = await open(r.roundId)
    await endRound(grant, o.who, o.round)
    const attempts = query.mock.calls.find(([s]) => String(s).includes('insert into public.attempts'))
    const values = attempts![1] as unknown[]
    expect(values[3]).toBe(`${DECK}:c1`)
    expect(values[5]).toBe(false) // hinted: not a test
    expect(values[9]).toBe(2) // two hints
    expect(values[14]).toBe(2) // asked at rung 2
  })

  it('a skip is a miss, and the card comes back once before the round ends', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const started = await startRound(grant, learner, null, { mode: 'practice', deckId: DECK, size: 2 })
    const firstCard = started.question!.cardId
    let o = await open(started.roundId)
    const skipped = await answerRound(grant, o.who, o.round, null, true)
    expect(skipped.verdict).toBe('skipped')
    o = await open(started.roundId)
    const next = await answerRound(grant, o.who, o.round, 'wrong', false)
    // Two cards planned, both missed: both come back once.
    expect(next.question?.cardId).toBe(firstCard)
    expect(next.summary).toBeUndefined()
  })

  it('starting a new round closes the old one with what it has', async () => {
    const { startRound } = await import('./rounds.js')
    const a = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    expect(rounds.get(a.roundId)?.ended_at).toBeTruthy()
    // Nothing was answered, so nothing was written for it.
    expect(query.mock.calls.some(([s]) => String(s).includes('insert into public.sessions'))).toBe(false)
  })

  it('study hands over answers and writes exposure only: no session, no closers, no daily line', async () => {
    const { startRound } = await import('./rounds.js')
    const study = await startRound(grant, learner, null, { mode: 'study', deckId: DECK })
    expect(study.cards?.length).toBe(4)
    expect(study.cards?.[0]?.answer).toBeTruthy()
    const sql = query.mock.calls.map(([s]) => String(s))
    const attemptsInsert = query.mock.calls.find(([s]) => String(s).includes('insert into public.attempts'))
    const values = attemptsInsert![1] as unknown[]
    expect(values[5]).toBe(false) // not a test
    expect(values[6]).toBe(false) // unverified: a flashcard flip
    expect(values[7]).toBe(false) // and claims nothing
    expect(values[14]).toBe(0) // rung 0
    expect(sql.some((s) => s.includes('insert into public.sessions'))).toBe(false)
    expect(sql.some((s) => s.includes('complete_matching_assignments'))).toBe(false)
    expect(sql.some((s) => s.includes('award_matching_rewards'))).toBe(false)
    expect(sql.some((s) => s.includes('bump_daily_activity'))).toBe(false)
  })

  it('a round is closed under the child it started with, whoever starts the next one', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const two = { ...grant, learnerIds: [LEARNER, LEARNER2], currentLearnerId: null }
    const maya = await startRound(two, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    const o = await open(maya.roundId, two)
    await answerRound(two, o.who, o.round, deckAnswer(maya.question!.cardId), false)

    // Theo's turn. Maya's open round is written first — and under Maya.
    await startRound(two, theo, null, { mode: 'test', deckId: DECK, size: 2 })
    const sessions = query.mock.calls.filter(([s]) => String(s).includes('insert into public.sessions'))
    expect(sessions.length).toBe(1)
    expect((sessions[0]![1] as unknown[])[1]).toBe(LEARNER)
    const attempts = query.mock.calls.find(([s]) => String(s).includes('insert into public.attempts'))
    expect((attempts![1] as unknown[])[0]).toBe(LEARNER)
    expect(rounds.get(maya.roundId)?.ended_at).toBeTruthy()
  })

  it('writes the old round before planning the new one', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const a = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 1 })
    const o = await open(a.roundId)
    await answerRound(grant, o.who, o.round, 'x', false)
    query.mockClear()
    await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 1 })
    // The only thing left open was already written; the plan's mastery read
    // comes after any writes, never before.
    const sql = query.mock.calls.map(([s]) => String(s))
    const lastWrite = sql.map((s, i) => (s.includes('insert into public.attempts') ? i : -1)).filter((i) => i >= 0).pop() ?? -1
    const masteryRead = sql.findIndex((s) => s.includes('from public.item_mastery'))
    expect(masteryRead).toBeGreaterThan(lastWrite)
  })

  it('a stale round whose learner is out of reach is discarded, not a wall', async () => {
    const { startRound } = await import('./rounds.js')
    const two = { ...grant, learnerIds: [LEARNER, LEARNER2], currentLearnerId: null }
    const stale = await startRound(two, theo, null, { mode: 'test', deckId: DECK, size: 2 })
    // Theo is no longer reachable: the link was removed.
    const narrowed = { ...two, learnerIds: [LEARNER] }
    const next = await startRound(narrowed, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    expect(next.roundId).not.toBe(stale.roundId)
    expect(rounds.get(stale.roundId)?.ended_at).toBeTruthy()
    expect(query.mock.calls.some(([s]) => String(s).includes('insert into public.sessions'))).toBe(false)
  })

  it('a study round on mastered cards leaves their streaks and schedules alone', async () => {
    const { startRound } = await import('./rounds.js')
    masteryRows = ['c1', 'c2', 'c3', 'c4'].map(masteredRow)
    await startRound(grant, learner, null, { mode: 'study', deckId: DECK })
    const upsert = query.mock.calls.find(([s]) => String(s).includes('insert into public.item_mastery'))
    expect(upsert).toBeDefined()
    const values = upsert![1] as unknown[]
    // 15 columns per row: lapses at 7, correct_streak at 8, due_on at 12.
    for (let row = 0; row < values.length / 15; row++) {
      expect(values[row * 15 + 7]).toBe(0)
      expect(values[row * 15 + 8]).toBe(3)
      expect(values[row * 15 + 12]).toBe('2026-10-08')
    }
  })

  it('only a round seen through to the end is marked complete', async () => {
    const { startRound, answerRound, endRound } = await import('./rounds.js')
    const early = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 3 })
    let o = await open(early.roundId)
    await answerRound(grant, o.who, o.round, null, true)
    o = await open(early.roundId)
    await endRound(grant, o.who, o.round)
    const partial = query.mock.calls.find(([s]) => String(s).includes('insert into public.sessions'))
    expect(JSON.parse(String((partial![1] as unknown[])[14])).complete).toBe(false)

    query.mockClear()
    const full = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    o = await open(full.roundId)
    await answerRound(grant, o.who, o.round, 'x', false)
    o = await open(full.roundId)
    await answerRound(grant, o.who, o.round, 'y', false)
    const whole = query.mock.calls.find(([s]) => String(s).includes('insert into public.sessions'))
    expect(JSON.parse(String((whole![1] as unknown[])[14])).complete).toBe(true)
  })

  it('a refused start_round leaves the open round alone', async () => {
    const { startRound } = await import('./rounds.js')
    const a = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 2 })
    await expect(startRound(grant, learner, null, { mode: 'test', deckId: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/No deck/)
    expect(rounds.get(a.roundId)?.ended_at).toBeNull()
  })

  it('numbers the questions with the requeues counted in', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const r = await startRound(grant, learner, null, { mode: 'practice', deckId: DECK, size: 2 })
    expect(r.question?.say).toMatch(/^Question 1 of 2\./)
    let o = await open(r.roundId)
    const a1 = await answerRound(grant, o.who, o.round, 'wrong', false)
    expect(a1.question?.say).toMatch(/^Question 2 of 3\./)
    o = await open(r.roundId)
    const a2 = await answerRound(grant, o.who, o.round, 'wrong', false)
    expect(a2.question?.say).toMatch(/^Question 3 of 4\./)
  })

  it('closing a round whose session already exists writes nothing twice', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const r = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 1 })
    existingSessions.add(r.roundId)
    const o = await open(r.roundId)
    await answerRound(grant, o.who, o.round, 'x', false)
    expect(query.mock.calls.some(([s]) => String(s).includes('insert into public.attempts'))).toBe(false)
    expect(rounds.get(r.roundId)?.ended_at).toBeTruthy()
  })

  it('draws wrong answers only from cards that can be said', async () => {
    const { startRound } = await import('./rounds.js')
    const withFigure = { ...deckRow, cards: [...deckRow.cards, { id: 'c5', term: 'Draw it', definition: '[[figure {"kind":"bar","data":[{"label":"a","value":1}]}]]', hint: null, difficulty: 2 }] }
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('from public.decks')) return { rows: [withFigure], rowCount: 1 }
      return (await (wire(), query.getMockImplementation()!)(sql, params))
    })
    const r = await startRound(grant, learner, null, { mode: 'practice', deckId: DECK, size: 4 })
    const pools = (rounds.get(r.roundId)!.plan as { pools: Record<string, Array<{ id: string }>> }).pools
    expect(pools[DECK]!.map((c) => c.id)).not.toContain('c5')
    expect(JSON.stringify(r).toLowerCase()).not.toContain('figure')
  })

  it('in a test, a near miss is said as a miss', async () => {
    const { startRound, answerRound } = await import('./rounds.js')
    const t = await startRound(grant, learner, null, { mode: 'test', deckId: DECK, size: 4 })
    const o = await open(t.roundId)
    const answer = deckAnswer(t.question!.cardId)
    const nearly = answer.slice(0, -1) + (answer.endsWith('a') ? 'e' : 'a')
    const r = await answerRound(grant, o.who, o.round, nearly, false)
    expect(r.verdict).toBe('close')
    expect(r.say).not.toMatch(/Close enough/)
    expect(r.say).toMatch(/has to be exact/)
    expect(r.progress.correct).toBe(0)
  })
})

function deckAnswer(cardId: string): string {
  return deckRow.cards.find((c) => c.id === cardId)!.definition
}
