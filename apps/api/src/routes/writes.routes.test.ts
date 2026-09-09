// The write paths: the incremental change a session posts, and the whole-
// snapshot upload a browser does when it first signs in.
//
// Every one of these writes touches a different table, and what is asserted is
// mostly that a change only reaches the tables it named. A PATCH carrying a
// skill must not silently rewrite mastery, because a client that sends a
// partial change and gets a full replacement loses everything it left out.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  withAdmin: (...a: Parameters<typeof withUser>) => withUser(...a),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

vi.mock('../env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  },
  isProduction: false,
}))

const LEARNER = '11111111-2222-4333-8444-555555555555'
const ASSIGNMENT = '44444444-5555-4666-8777-888888888888'
const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')

async function auth() {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(CALLER)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
  return { authorization: `Bearer ${token}` }
}

const skill = {
  subject: 'spelling',
  ability: 0.4,
  abilitySd: 0.3,
  levelIndex: 2,
  placed: true,
  totalAttempts: 40,
  totalCorrect: 33,
  streakDays: 3,
  bestStreakDays: 5,
  lastActiveOn: '2026-08-01',
  settings: { theme: 'space' },
}

const mastery = {
  subject: 'spelling',
  itemKey: 'because',
  listId: null,
  difficulty: 0.2,
  mastery: 0.6,
  reps: 4,
  lapses: 1,
  correctStreak: 2,
  totalAttempts: 6,
  totalCorrect: 4,
  intervalDays: 3,
  dueOn: '2026-08-05',
  firstSeenAt: 1700000000000,
  lastSeenAt: 1700000100000,
}

const list = {
  subject: 'spelling',
  listId: 'grade-4-week-1',
  plays: 3,
  testsTaken: 1,
  bestScore: 90,
  bestAccuracy: 90,
  stars: 2,
  masteredAt: null,
}

const achievement = { achievementId: 'first-test', subject: 'spelling', unlockedAt: 1700000000000 }

/** Every statement the handler issued, as one blob to search. */
function ran(): string {
  return query.mock.calls.map(([s]) => String(s)).join('\n')
}

async function buildApp() {
  const Fastify = (await import('fastify')).default
  const { progressRoutes } = await import('./progress.js')
  const { HttpError, fromDatabaseError } = await import('../errors.js')
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message } })
      return
    }
    const mapped = fromDatabaseError(error)
    if (mapped) {
      reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      return
    }
    const s = error as unknown as { statusCode?: number }
    reply
      .code(s.statusCode && s.statusCode < 500 ? s.statusCode : 500)
      .send({ error: { code: 'error', message: (error as Error).message } })
  })
  await app.register(progressRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

async function patch(change: Record<string, unknown>) {
  const app = await buildApp()
  return app.inject({
    method: 'POST',
    url: `/api/learners/${LEARNER}/progress`,
    headers: await auth(),
    payload: change,
  })
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ id: LEARNER }], rowCount: 1 })
  withUser.mockClear()
})

describe('an incremental change', () => {
  it('writes a skill state', async () => {
    expect((await patch({ skill })).statusCode).toBeLessThan(400)
    expect(ran()).toMatch(/insert into public\.skill_states/i)
  })

  it('writes item mastery', async () => {
    expect((await patch({ mastery: [mastery] })).statusCode).toBeLessThan(400)
    expect(ran()).toMatch(/public\.item_mastery/i)
  })

  it('writes list progress', async () => {
    expect((await patch({ list })).statusCode).toBeLessThan(400)
    expect(ran()).toMatch(/public\.list_progress/i)
  })

  it('writes achievements, and leaves an existing one alone', async () => {
    // An achievement is unlocked once. Re-posting it must not move the date it
    // was earned on.
    expect((await patch({ achievements: [achievement] })).statusCode).toBeLessThan(400)
    expect(ran()).toMatch(/public\.achievements/i)
    expect(ran()).toMatch(/do nothing/i)
  })

  it('touches only the tables the change named', async () => {
    await patch({ skill })
    expect(ran()).not.toMatch(/public\.item_mastery/i)
    expect(ran()).not.toMatch(/public\.list_progress/i)
    expect(ran()).not.toMatch(/public\.achievements/i)
  })

  it('writes an empty mastery array nowhere', async () => {
    await patch({ skill, mastery: [] })
    expect(ran()).not.toMatch(/public\.item_mastery/i)
  })

  it('refuses a change that says nothing', async () => {
    expect((await patch({})).statusCode).toBe(400)
  })

  it('refuses a mastery value outside nought to one', async () => {
    expect((await patch({ mastery: [{ ...mastery, mastery: 4 }] })).statusCode).toBe(400)
  })

  it('refuses an ability that is not a number', async () => {
    expect((await patch({ skill: { ...skill, ability: 'high' } })).statusCode).toBe(400)
  })

  it('needs a signed-in caller', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      payload: { skill },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('the whole-snapshot upload', () => {
  const snapshot = {
    skills: { spelling: skill },
    mastery: { 'spelling:because': mastery },
    lists: { 'grade-4-week-1': list },
    achievements: [achievement],
    highScores: [],
    daily: [{ subject: 'spelling', day: '2026-08-01', seconds: 300, items: 20, correct: 18, sessions: 2 }],
    sessions: [],
    customLists: [],
    decks: [],
  }

  it('writes every part of it', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: snapshot,
    })
    expect(res.statusCode).toBeLessThan(400)
    const sql = ran()
    expect(sql).toMatch(/public\.skill_states/i)
    expect(sql).toMatch(/public\.item_mastery/i)
    expect(sql).toMatch(/public\.list_progress/i)
    expect(sql).toMatch(/public\.achievements/i)
  })

  it('accepts an empty one, for a learner who has done nothing yet', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: {
        skills: {}, mastery: {}, lists: {}, achievements: [],
        highScores: [], daily: [], sessions: [], customLists: [], decks: [],
      },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('refuses a snapshot missing whole sections rather than writing half of one', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { skills: {} },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('one learner’s copy of a piece of work', () => {
  it('can be reordered', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/assignments/${ASSIGNMENT}`,
      headers: await auth(),
      payload: { sortOrder: 3 },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('can be canceled and put back', async () => {
    const app = await buildApp()
    for (const status of ['canceled', 'open']) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}/assignments/${ASSIGNMENT}`,
        headers: await auth(),
        payload: { status },
      })
      expect(res.statusCode, status).toBeLessThan(400)
    }
  })

  it('cannot be marked done from here', async () => {
    // Done only ever means the learner played it. A grown-up ticking a box
    // would make every completion number meaningless.
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/assignments/${ASSIGNMENT}`,
      headers: await auth(),
      payload: { status: 'completed' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('answers 404 when the update matched nothing', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/assignments/${ASSIGNMENT}`,
      headers: await auth(),
      payload: { sortOrder: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('can be taken off one learner, leaving it set for everyone else', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/assignments/${ASSIGNMENT}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(204)
    expect(ran()).not.toMatch(/delete from public\.assignment_sets/i)
  })

  it('rejects a malformed assignment id', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/assignments/not-a-uuid`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('deleting material that is not there', () => {
  // The two paths answer differently on purpose. A grown-up's own library
  // delete is idempotent — the row is gone either way, and a 404 would only
  // make a retry look like a failure. A learner-scoped delete says 404,
  // because there the id names something the caller believed existed.
  it('is idempotent for the grown-up’s own word list', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/library/word-lists/88888888-7777-4666-8555-444444444444',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(204)
  })

  it('is idempotent for the grown-up’s own deck', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/library/decks/99999999-8888-4777-8666-555555555555',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(204)
  })

  it('answers 404 for one of a learner’s own lists', async () => {
    query.mockImplementation(async (sql: string) =>
      /delete from public\.word_lists/i.test(String(sql))
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: LEARNER }], rowCount: 1 },
    )
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/word-lists/88888888-7777-4666-8555-444444444444`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('answers 404 for one of a learner’s own decks', async () => {
    query.mockImplementation(async (sql: string) =>
      /delete from public\.decks/i.test(String(sql))
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: LEARNER }], rowCount: 1 },
    )
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/decks/99999999-8888-4777-8666-555555555555`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })
})
