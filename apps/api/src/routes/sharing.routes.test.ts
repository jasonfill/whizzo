// Sharing a learner with another grown-up: guardians, invites, and the tutor
// connection codes.
//
// This is the consent machinery. A tutor gets access because a parent handed
// them a code and chose which children it covers — never because they knew a
// learner's id. The tests are mostly about what a code does *not* do on its
// own, and about a describe endpoint that has to be safe to call with a guess.

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
const GUARDIAN = '33333333-4444-4555-8666-777777777777'
const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')

async function auth(sub = CALLER) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
  return { authorization: `Bearer ${token}` }
}

async function buildApp() {
  const Fastify = (await import('fastify')).default
  const { learnerRoutes, inviteRoutes, codeRoutes } = await import('./learners.js')
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
  await app.register(learnerRoutes, { prefix: '/api' })
  await app.register(codeRoutes, { prefix: '/api' })
  if (inviteRoutes) await app.register(inviteRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ id: LEARNER, code: 'CODE1234' }], rowCount: 1 })
  withUser.mockClear()
})

describe('the family overview', () => {
  it('needs a signed-in grown-up', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/learners/overview' })).statusCode).toBe(401)
  })

  it('returns a row per learner the caller can see', async () => {
    query.mockResolvedValue({
      rows: [
        {
          learner_id: LEARNER,
          display_name: 'Ada',
          avatar_emoji: '🦊',
          open_assignments: 2,
          overdue_assignments: 1,
          done_this_week: 3,
          last_active_at: new Date(),
          seconds_this_week: 600,
          items_this_week: 40,
          verified_total: 40,
          verified_correct: 32,
          streak_days: 4,
        },
      ],
      rowCount: 1,
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/learners/overview',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
    const [row] = res.json().learners
    expect(row).toMatchObject({ displayName: 'Ada', openAssignments: 2, currentStreakDays: 4 })
    expect(row.verifiedAccuracyThisWeek).toBe(80)
  })

  it('reports no accuracy rather than zero when nothing was checked', async () => {
    query.mockResolvedValue({
      rows: [
        {
          learner_id: LEARNER,
          display_name: 'Ada',
          avatar_emoji: '🦊',
          open_assignments: 0,
          overdue_assignments: 0,
          done_this_week: 0,
          last_active_at: null,
          seconds_this_week: 0,
          items_this_week: 0,
          verified_total: 0,
          verified_correct: 0,
          streak_days: 0,
        },
      ],
      rowCount: 1,
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/learners/overview',
      headers: await auth(),
    })
    expect(res.json().learners[0].verifiedAccuracyThisWeek).toBeNull()
  })
})

describe('guardians', () => {
  it('lists who can see a learner', async () => {
    query.mockResolvedValue({
      rows: [
        {
          guardian_id: GUARDIAN,
          learner_id: LEARNER,
          role: 'teacher',
          can_manage_content: true,
          created_at: new Date(),
          display_name: 'A teacher',
        },
      ],
      rowCount: 1,
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/guardians`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().guardians[0]).toMatchObject({ role: 'teacher', canManageContent: true })
  })

  it('changes what a guardian may do', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/guardians/${GUARDIAN}`,
      headers: await auth(),
      payload: { canManageContent: false },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects a patch that is not about what they may do', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/guardians/${GUARDIAN}`,
      headers: await auth(),
      payload: { role: 'owner' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('removes a guardian', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/guardians/${GUARDIAN}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('answers 404 when there was no such link to remove', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/guardians/${GUARDIAN}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('connection codes', () => {
  it('needs authentication to list them', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/connection-codes' })).statusCode).toBe(401)
  })

  it('lists the codes a grown-up has made', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/connection-codes',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(200)
  })

  it('makes a code', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/connection-codes',
      headers: await auth(),
      payload: { role: 'teacher', label: 'Class 4B' },
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('rejects a role that is not one the product has', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/connection-codes',
      headers: await auth(),
      payload: { role: 'administrator' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('revokes one', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/connection-codes/CODE1234',
      headers: await auth(),
    })
    expect(res.statusCode).toBeLessThan(400)
  })

  it('describes a code without linking anything', async () => {
    // The preview a tutor sees before they accept. It must be safe to call
    // with a guessed code, so it answers rather than erroring.
    query.mockResolvedValue({
      rows: [{ kind: 'connection', valid: true, reason: null, owner_name: 'A parent', label: 'Class 4B', role: 'teacher', can_manage_content: true }],
      rowCount: 1,
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/codes/describe',
      headers: await auth(),
      payload: { code: 'CODE1234' },
    })
    expect(res.statusCode).toBe(200)
    const inserts = query.mock.calls
      .map(([s]) => String(s))
      .filter((s) => /insert into public\.guardian_links/i.test(s))
    expect(inserts).toHaveLength(0)
  })

  it('answers for a code that does not exist rather than erroring', async () => {
    query.mockResolvedValue({
      rows: [{ kind: 'unknown', valid: false, reason: 'That code does not exist', owner_name: null, label: null, role: null, can_manage_content: null }],
      rowCount: 1,
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/codes/describe',
      headers: await auth(),
      payload: { code: 'NOSUCHCO' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().valid ?? res.json().preview?.valid).toBe(false)
  })

  it('redeems a code only for the learners named', async () => {
    // Consent is per child. Redeeming must never mean "all of them".
    query.mockResolvedValue({ rows: [{ linked: 1 }], rowCount: 1 })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/codes/redeem',
      headers: await auth(),
      payload: { code: 'CODE1234', learnerIds: [LEARNER] },
    })
    expect(res.statusCode).toBeLessThan(400)
    const values = query.mock.calls.flatMap(([, v]) => (v ?? []) as unknown[])
    expect(JSON.stringify(values)).toContain(LEARNER)
  })

  it('rejects a redeem naming no learners at all', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/codes/redeem',
      headers: await auth(),
      payload: { code: 'CODE1234', learnerIds: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a redeem naming something that is not a learner id', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/codes/redeem',
      headers: await auth(),
      payload: { code: 'CODE1234', learnerIds: ['not-a-uuid'] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('invites', () => {
  it('creates one for a learner', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/invites`,
      headers: await auth(),
      payload: { role: 'parent', purpose: 'guardian' },
    })
    expect(res.statusCode).toBeLessThan(500)
  })

  it('rejects an invite for a purpose the product does not have', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/invites`,
      headers: await auth(),
      payload: { purpose: 'take_over' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('caps how long an invite can live', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/invites`,
      headers: await auth(),
      payload: { ttlHours: 100000 },
    })
    expect(res.statusCode).toBe(400)
  })
})
