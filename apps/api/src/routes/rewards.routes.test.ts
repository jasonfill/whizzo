// Promises a grown-up makes, and settling them.
//
// The property this surface exists to protect: **there is no way to mark a
// reward earned.** Earning is derived, in the same transaction as the round
// that caused it, from evidence the app checked. What a grown-up can do is
// offer, withdraw, and say they have handed it over — and that last one is
// recorded as a claim with their name on it.

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

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    ANTHROPIC_API_KEY: 'sk-test',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false }))


const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER = 'bbbbbbbb-0000-0000-0000-000000000002'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const REWARD = '55555555-6666-4777-8888-999999999999'
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

async function buildApp() {
  const Fastify = (await import('fastify')).default
  const { rewardRoutes } = await import('./rewards.js')
  const { HttpError, fromDatabaseError, fromValidationError } = await import('../errors.js')
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message } })
      return
    }
    const invalid = fromValidationError(error)
    if (invalid) {
      reply.code(invalid.status).send({ error: { code: invalid.code, message: invalid.message } })
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
  await app.register(rewardRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

const row = (over: Record<string, unknown> = {}) => ({
  id: REWARD,
  learner_id: LEARNER,
  created_by: CALLER,
  title: 'Ice cream',
  note: null,
  kind: 'direct',
  criterion: { type: 'checkpoint', targetId: 'deck-1', threshold: 0.9 },
  max_awards: 1,
  awards_made: 0,
  status: 'offered',
  offered_at: new Date().toISOString(),
  expires_on: null,
  earned_at: null,
  session_id: null,
  fulfilled_at: null,
  fulfilled_by: null,
  fulfilled_note: null,
  ...over,
})

const offer = (over: Record<string, unknown> = {}) => ({
  learnerId: LEARNER,
  title: 'Ice cream',
  criterion: { type: 'checkpoint', targetId: 'deck-1', threshold: 0.9 },
  ...over,
})

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  withUser.mockClear()
})

describe('there is no way to mark one earned', () => {
  it('offers no such route', async () => {
    // Earning is derived in the same transaction as the round that caused it,
    // from evidence the app checked. A route for it would be the whole point
    // of the feature, undone.
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/earn`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('offering one', () => {
  it('records it against the child and the person promising', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [row()] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      headers: await auth(),
      payload: offer(),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().reward).toMatchObject({ learnerId: LEARNER, createdBy: CALLER })
  })

  it('refuses a set the child made themselves', async () => {
    // Otherwise a three-card deck — "cat" / "cat" — is ninety seconds of work
    // and an ice cream.
    query.mockResolvedValueOnce({ rows: [{ learner_id: LEARNER, cards: 40 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      headers: await auth(),
      payload: offer({ criterion: { type: 'set_mastered', targetId: 'deck-1', threshold: 0.9 } }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/made themselves/)
  })

  it('refuses a set too small to be an achievement', async () => {
    query.mockResolvedValueOnce({ rows: [{ learner_id: null, cards: 4 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      headers: await auth(),
      payload: offer({ criterion: { type: 'set_mastered', targetId: 'deck-1' } }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses minutes, which a child can sit through', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      headers: await auth(),
      payload: offer({ criterion: { type: 'minutes', threshold: 30 } }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/input, not an outcome/)
  })

  it('refuses a criterion it cannot measure', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      headers: await auth(),
      payload: offer({ criterion: { type: 'vibes' } }),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('saying it has been handed over', () => {
  it('records who said so, and when', async () => {
    // The one place a grown-up asserts something the system cannot check. It is
    // recorded exactly like a learner's self-grade: with a name on it.
    const earned = row({ status: 'earned', earned_at: new Date().toISOString() })
    query
      .mockResolvedValueOnce({ rows: [earned] })
      .mockResolvedValueOnce({
        rows: [{ ...earned, status: 'fulfilled', fulfilled_at: new Date().toISOString(), fulfilled_by: CALLER }],
      })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/fulfill`,
      headers: await auth(),
      payload: { note: 'chocolate' },
    })
    expect(res.json().reward).toMatchObject({ status: 'fulfilled', fulfilledBy: CALLER })
  })

  it('lets only the person who promised it settle it', async () => {
    // A tutor cannot know whether a parent bought the ice cream.
    query.mockResolvedValueOnce({
      rows: [row({ created_by: OTHER, status: 'earned', earned_at: new Date().toISOString() })],
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/fulfill`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toMatch(/promised this/)
  })

  it('refuses to settle something that has not been earned', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/fulfill`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('not_earned')
  })

  it('404s one that is not the caller\'s to see', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/fulfill`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('withdrawing one', () => {
  it('takes back a promise that has not come due', async () => {
    query.mockResolvedValueOnce({ rows: [row({ status: 'canceled' })] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/cancel`,
      headers: await auth(),
      payload: {},
    })
    expect(res.json().reward.status).toBe('canceled')
  })

  it('cannot take back one that has already been earned', async () => {
    // A child who watched an ice cream disappear has learned something about
    // this app we do not want them to learn.
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'earned' }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/rewards/${REWARD}/cancel`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('already_earned')
  })
})

describe('reading the list', () => {
  it('puts what is owed at the top, because that is the action list', async () => {
    query.mockResolvedValueOnce({ rows: [row({ status: 'earned', earned_at: new Date().toISOString() })] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/rewards`,
      headers: await auth(),
    })
    expect(res.json().rewards[0].status).toBe('earned')
    expect(query.mock.calls[0]![0]).toMatch(/order by case status when 'earned' then 0/)
  })
})
