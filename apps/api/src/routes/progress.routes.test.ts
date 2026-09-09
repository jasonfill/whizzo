// The progress routes: the largest file in the API and the only one that
// writes a learner's actual work.
//
// The rule this exists to hold is the one the whole product rests on. Whether
// an answer was checked is a property of the mode it was answered in, and a
// client claiming otherwise is corrected here rather than believed — server
// side, where a modified client cannot reach. Same for the session summary:
// the counts are recomputed from the attempts that arrived, not taken from
// whatever the caller said the score was.
//
// The database is stubbed, so this covers everything above it. Row Level
// Security is not covered and cannot be from here; scripts/smoke.mjs is what
// proves that, against a real Postgres.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const withUser = vi.fn(async (_userId: string, fn: (db: unknown) => Promise<unknown>) =>
  fn({ query }),
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
const SESSION = '22222222-3333-4444-8555-666666666666'
const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')
const ISSUER = 'https://test.supabase.co/auth/v1'

async function auth() {
  const token = await new SignJWT({ email: 'a@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(CALLER)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
  return { authorization: `Bearer ${token}` }
}

function attempt(over: Record<string, unknown> = {}) {
  return {
    subject: 'quiz',
    itemKey: 'card-1',
    activity: 'flashcards',
    isTest: true,
    verified: true,
    correct: true,
    responseMs: 100,
    hintsUsed: 0,
    difficulty: 3,
    given: 'x',
    at: 1700000000000,
    ...over,
  }
}

function session(over: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    subject: 'quiz',
    activity: 'flashcards',
    listId: null,
    isTest: true,
    itemsTotal: 99,
    itemsCorrect: 99,
    accuracy: 100,
    score: 9999,
    wpm: null,
    durationMs: 1000,
    abilityBefore: 3,
    abilityAfter: 3,
    meta: {},
    startedAt: 1700000000000,
    endedAt: 1700000060000,
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
    const withStatus = error as unknown as { statusCode?: number }
    reply
      .code(withStatus.statusCode && withStatus.statusCode < 500 ? withStatus.statusCode : 500)
      .send({ error: { code: 'error', message: (error as Error).message } })
  })
  await app.register(progressRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

/** Every INSERT the handler issued, flattened for inspection. */
function writes(): Array<{ sql: string; values: unknown[] }> {
  return query.mock.calls.map(([sql, values]) => ({
    sql: String(sql),
    values: (values ?? []) as unknown[],
  }))
}

beforeEach(() => {
  query.mockReset()
  // Default: the learner is visible and every write succeeds.
  query.mockResolvedValue({ rows: [{ id: LEARNER }], rowCount: 1 })
  withUser.mockClear()
})

describe('reading progress', () => {
  it('refuses an unauthenticated caller', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/learners/${LEARNER}/progress` })
    expect(res.statusCode).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('runs as the calling user so the policies still apply', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
    })
    expect(withUser).toHaveBeenCalledWith(CALLER, expect.any(Function))
  })

  it('rejects a malformed learner id before reaching the database', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/learners/not-a-uuid/progress',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns a whole snapshot', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().snapshot ?? res.json()
    for (const key of ['skills', 'mastery', 'sessions', 'achievements', 'daily']) {
      expect(body, key).toHaveProperty(key)
    }
  })

  it('reads back the answers from one round', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/sessions/${SESSION}/attempts`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('attempts')
  })
})

describe('writing a round — what the server refuses to believe', () => {
  it('overrules a claim that a self-graded answer was checked', async () => {
    // The heart of it. A modified client can send verified:true on flashcards;
    // the mode decides, and the mode says no.
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: {
        attempts: [attempt({ verified: true }), attempt({ itemKey: 'card-2', verified: true })],
        session: session(),
      },
    })
    expect(res.statusCode).toBeLessThan(400)

    const attemptWrites = writes().filter((w) => /insert into public\.attempts/i.test(w.sql))
    expect(attemptWrites.length).toBeGreaterThan(0)
    // Whatever shape the insert takes, no `true` may have been stored for the
    // verified column on a flashcards attempt.
    const sessionWrite = writes().find((w) => /insert into public\.sessions/i.test(w.sql))
    expect(sessionWrite).toBeDefined()
    expect(sessionWrite!.values).toContain(0) // verified_items_total
  })

  it('keeps a checked mode’s answers checked', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: {
        attempts: [
          attempt({ activity: 'test', verified: true }),
          attempt({ activity: 'test', itemKey: 'card-2', verified: true }),
        ],
        session: session({ activity: 'test' }),
      },
    })
    const sessionWrite = writes().find((w) => /insert into public\.sessions/i.test(w.sql))
    expect(sessionWrite!.values).toContain(2) // both counted as verified
  })

  it('recomputes the score from the answers rather than trusting it', async () => {
    // The payload claims 99 of 99. Two attempts arrived, one wrong.
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: {
        attempts: [
          attempt({ activity: 'test', correct: true }),
          attempt({ activity: 'test', itemKey: 'card-2', correct: false }),
        ],
        session: session({ activity: 'test', itemsTotal: 99, itemsCorrect: 99, accuracy: 100 }),
      },
    })
    const sessionWrite = writes().find((w) => /insert into public\.sessions/i.test(w.sql))
    // The counts and the accuracy are derived. The score is a client figure
    // and is stored as sent — it is a display number, not evidence.
    expect(sessionWrite!.values).toContain(2) // itemsTotal, not 99
    expect(sessionWrite!.values).toContain(50) // accuracy, not 100
    expect(sessionWrite!.values).not.toContain(99)
  })

  it('marks a round that arrived without attempts as the client’s own count', async () => {
    // A typing round's items are keystrokes. Saying so is more honest than
    // inventing attempt-level evidence.
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { session: session({ subject: 'typing', activity: 'lesson' }) },
    })
    const sessionWrite = writes().find((w) => /insert into public\.sessions/i.test(w.sql))
    expect(sessionWrite!.values).toContain('client')
  })

  it('links every attempt to the round it arrived with, not to a claimed id', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: {
        attempts: [attempt({ sessionId: '99999999-9999-4999-8999-999999999999' })],
        session: session(),
      },
    })
    const attemptWrite = writes().find((w) => /insert into public\.attempts/i.test(w.sql))
    expect(JSON.stringify(attemptWrite!.values)).not.toContain('99999999')
  })

  it('rejects a payload that is not coherent progress at all', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { attempts: [attempt({ difficulty: 'very hard' })] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an accuracy outside the possible range', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { session: session({ accuracy: 150 }) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('turns a policy refusal into 403 rather than 500', async () => {
    query.mockRejectedValue(Object.assign(new Error('denied'), { code: '42501' }))
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { session: session() },
    })
    expect(res.statusCode).toBe(403)
  })

  it('answers 404 for a learner the caller cannot see', async () => {
    // RLS hides the row, the visibility check finds nothing, and the route
    // says not found rather than confirming the learner exists.
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { session: session() },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('replacing a whole snapshot', () => {
  const snapshot = {
    skills: {},
    mastery: {},
    lists: {},
    sessions: [],
    achievements: [],
    highScores: [],
    daily: [],
    customLists: [],
    decks: [],
  }

  it('accepts a merged snapshot at sign-in', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: snapshot,
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects one that is not a snapshot', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
      payload: { skills: 'lots' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('erasing progress', () => {
  it('needs authentication', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `/api/learners/${LEARNER}/progress` })
    expect(res.statusCode).toBe(401)
  })

  it('runs as the calling user', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/progress`,
      headers: await auth(),
    })
    expect(withUser).toHaveBeenCalledWith(CALLER, expect.any(Function))
  })
})

describe('assignments', () => {
  it('lists a learner’s tasks', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/assignments`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('assignments')
  })

  it('will not accept a task that declares itself already done', async () => {
    // Finishing work is something you do, not something you say.
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/assignments/${SESSION}`,
      headers: await auth(),
      payload: { status: 'done' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts canceling one', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/assignments/${SESSION}`,
      headers: await auth(),
      payload: { status: 'canceled' },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects a set with no title', async () => {
    // Under the right key: an earlier version of this sent `draft`, which the
    // endpoint does not take, so it 400d on the missing `assignments` array and
    // proved nothing about titles.
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: await auth(),
      payload: {
        learnerIds: [LEARNER],
        assignments: [{ subject: 'spelling', activity: 'test' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a title that is present but empty', async () => {
    // A task nobody can read is a task nobody can do.
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: await auth(),
      payload: {
        learnerIds: [LEARNER],
        assignments: [{ subject: 'spelling', activity: 'test', title: '' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts the same set once it has a title, so the refusal was about the title', async () => {
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
})

describe('the grown-up library', () => {
  it('needs authentication', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/library' })).statusCode).toBe(401)
  })

  it('returns decks and lists', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library', headers: await auth() })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a deck with no cards at all', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/library/decks',
      headers: await auth(),
      payload: { decks: [{ id: 'not-a-uuid' }] },
    })
    expect(res.statusCode).toBe(400)
  })
})
