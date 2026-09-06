// The rest of the progress routes: the grown-up library, a learner's own word
// lists and decks, and the assignment sets a task belongs to.
//
// The shape running through all of them is the same one the plan limits
// describe: material belongs to somebody, and reaching it is scoped by the
// path rather than by anything in the body.

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
const SET = '22222222-3333-4444-8555-666666666666'
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

function deck(over: Record<string, unknown> = {}) {
  return {
    id: '99999999-8888-4777-8666-555555555555',
    title: 'Capitals',
    description: '',
    subject: null,
    cards: [
      { id: 'c1', term: 'Paris', definition: 'France', difficulty: 3, hint: null },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...over,
  }
}

function wordList(over: Record<string, unknown> = {}) {
  return {
    id: '88888888-7777-4666-8555-444444444444',
    title: 'Week 1',
    subject: 'spelling',
    grade: 4,
    words: [{ w: 'cat', s: 'A cat sat.' }],
    updatedAt: 1700000000000,
    ...over,
  }
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

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ id: LEARNER }], rowCount: 1 })
  withUser.mockClear()
})

describe('the grown-up library', () => {
  it('saves decks', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/decks',
      headers: await auth(),
      payload: { decks: [deck()] },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('saves word lists', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/word-lists',
      headers: await auth(),
      payload: { customLists: [wordList()] },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects a list with no title', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/word-lists',
      headers: await auth(),
      payload: { customLists: [wordList({ title: '' })] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('deletes a deck', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/library/decks/${deck().id}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('deletes a word list', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/library/word-lists/${wordList().id}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('needs authentication for every one of them', async () => {
    const app = await buildApp()
    for (const [method, url] of [
      ['POST', '/api/library/decks'],
      ['POST', '/api/library/word-lists'],
      ['DELETE', `/api/library/decks/${deck().id}`],
      ['DELETE', `/api/library/word-lists/${wordList().id}`],
    ] as const) {
      const res = await app.inject({ method, url, payload: {} })
      expect(res.statusCode, `${method} ${url}`).toBe(401)
    }
  })
})

describe('a learner’s own material', () => {
  it('saves their word lists under their own path', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/word-lists`,
      headers: await auth(),
      payload: { customLists: [wordList()] },
    })
    expect(res.statusCode).toBeLessThan(400)
    const values = query.mock.calls.flatMap(([, v]) => (v ?? []) as unknown[])
    expect(values).toContain(LEARNER)
  })

  it('saves their decks', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/decks`,
      headers: await auth(),
      payload: { decks: [deck()] },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('deletes one of their lists', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/word-lists/${wordList().id}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('deletes one of their decks', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/decks/${deck().id}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects a malformed learner id on every one of them', async () => {
    const app = await buildApp()
    for (const url of [
      '/api/learners/not-a-uuid/word-lists',
      '/api/learners/not-a-uuid/decks',
    ]) {
      const res = await app.inject({ method: 'POST', url, headers: await auth(), payload: {} })
      expect(res.statusCode, url).toBe(400)
    }
  })
})

describe('assignment sets', () => {
  it('lists them', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/assignments/sets',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
  })

  it('edits the work itself, which every learner given it will see', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/assignments/sets/${SET}`,
      headers: await auth(),
      payload: { title: 'Friday spelling, take two' },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects an edit that would leave it untitled', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/assignments/sets/${SET}`,
      headers: await auth(),
      payload: { title: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('withdraws a whole set', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assignments/sets/${SET}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('creates a set for the learners named', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: await auth(),
      payload: {
        learnerIds: [LEARNER],
        assignments: [{ subject: 'spelling', activity: 'test', title: 'Friday spelling' }],
      },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('refuses to set work for nobody', async () => {
    // A task with no learner is a task that can never be completed.
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: await auth(),
      payload: {
        learnerIds: [],
        assignments: [{ subject: 'spelling', activity: 'test', title: 'Friday spelling' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a minimum accuracy that is not a percentage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: await auth(),
      payload: {
        learnerIds: [LEARNER],
        assignments: [{ subject: 'spelling', activity: 'test', title: 'x', minAccuracy: 500 }],
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// The free-tier ceiling, enforced on the server for the first time.
//
// It lived only in the browser, which made it a suggestion: the same request
// sent twice went straight past it. What matters as much as the refusal is the
// two things it must never do — refuse an edit, or take anything away.
describe('the deck ceiling', () => {
  /** How the count query answers, in order: visibility, then the counts. */
  function library({
    covered,
    held,
    updating = 0,
  }: {
    covered: boolean
    held: number
    updating?: number
  }) {
    query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: LEARNER }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ covered, held: String(held), updating: String(updating) }] })
      .mockResolvedValue({ rows: [{ id: LEARNER }], rowCount: 1 })
  }

  async function save(decks: unknown[]) {
    const app = await buildApp()
    return app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/decks`,
      headers: await auth(),
      payload: { decks },
    })
  }

  it('refuses one past the line for an uncovered learner', async () => {
    library({ covered: false, held: 3 })
    const res = await save([deck()])
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('over_limit')
  })

  it('says what to do about it', async () => {
    // A refusal a parent cannot act on is just a wall.
    library({ covered: false, held: 3 })
    const res = await save([deck()])
    expect(res.json().error.message).toMatch(/Cover them|delete one/)
  })

  it('allows the last one under the line', async () => {
    library({ covered: false, held: 2 })
    expect((await save([deck()])).statusCode).toBeLessThan(400)
  })

  it('counts the whole batch, not one at a time', async () => {
    // Two at once from a learner holding two is four, and four is over.
    library({ covered: false, held: 2 })
    expect((await save([deck(), deck()])).statusCode).toBe(403)
  })

  it('never refuses an edit to something already saved', async () => {
    // Forty decks made while covered stay editable after a lapse. Nothing is
    // deleted and nothing becomes read-only for non-payment.
    library({ covered: false, held: 40, updating: 1 })
    expect((await save([deck()])).statusCode).toBeLessThan(400)
  })

  it('does not limit a covered learner at all', async () => {
    library({ covered: true, held: 400 })
    expect((await save([deck()])).statusCode).toBeLessThan(400)
  })

  it('lets the save through when the count cannot be read', async () => {
    // Failing closed here would mean a query returning an unexpected shape
    // costs a paying family their child's work. Failing open costs a fourth
    // deck.
    query.mockReset().mockResolvedValue({ rows: [{ id: LEARNER }], rowCount: 1 })
    expect((await save([deck()])).statusCode).toBeLessThan(400)
  })
})
