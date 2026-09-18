// Route-level tests for the learner endpoints.
//
// The database is stubbed; everything above it is real. Tokens are minted and
// genuinely verified, so these cover authentication, parameter and body
// validation, the sparse-update construction, and how a database refusal
// becomes a status.
//
// What they deliberately do NOT cover is Row Level Security, which is the
// actual security boundary. RLS only exists inside Postgres, so asserting it
// needs a real one — that is scripts/smoke.mjs, against a scratch database.
// Nothing here is evidence that one family cannot see another's rows.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const withUser = vi.fn(async (_userId: string, fn: (db: unknown) => Promise<unknown>) =>
  fn({ query }),
)

vi.mock('../db.js', () => ({
  withUser: (...args: Parameters<typeof withUser>) => withUser(...args),
  withAdmin: (...args: Parameters<typeof withUser>) => withUser(...args),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const SECRET_TEXT = 'a-test-secret-long-enough-for-hs256-signing'

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
const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const SECRET = new TextEncoder().encode(SECRET_TEXT)
const ISSUER = 'https://test.supabase.co/auth/v1'

/**
 * A real token, signed the way the project signs them.
 *
 * Minting rather than stubbing the auth hook means the verification path is
 * exercised too: issuer, audience, expiry and subject are genuinely checked
 * rather than assumed.
 */
async function token(
  over: { sub?: string; iss?: string; aud?: string; exp?: string; secret?: Uint8Array } = {},
): Promise<string> {
  const jwt = new SignJWT({ email: 'grown-up@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(over.iss ?? ISSUER)
    .setAudience(over.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(over.exp ?? '10m')
  if (over.sub !== null) jwt.setSubject(over.sub ?? CALLER)
  return jwt.sign(over.secret ?? SECRET)
}

async function auth(over = {}) {
  return { authorization: `Bearer ${await token(over)}` }
}

function learnerRow(over: Record<string, unknown> = {}) {
  return {
    id: LEARNER,
    owner_id: CALLER,
    display_name: 'Ada',
    avatar_emoji: '🦊',
    grade_hint: 4,
    birth_year: 2016,
    auth_kind: 'none',
    auth_user_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    theme: 'cats',
    ...over,
  }
}

async function buildApp() {
  const Fastify = (await import('fastify')).default
  const { learnerRoutes } = await import('./learners.js')
  const { HttpError, fromDatabaseError } = await import('../errors.js')

  const app = Fastify()
  // The real handler from server.ts, so status mapping is under test too.
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
  await app.register(learnerRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

describe('learner routes', () => {
  beforeEach(() => {
    query.mockReset()
    withUser.mockClear()
  })

  describe('who is allowed in', () => {
    it('refuses a request with no token', async () => {
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/api/learners' })
      expect(res.statusCode).toBe(401)
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses a token signed with the wrong secret', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: await auth({ secret: new TextEncoder().encode('a-different-secret-of-good-length') }),
      })
      expect(res.statusCode).toBe(401)
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses a token from another issuer', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: await auth({ iss: 'https://evil.example.com/auth/v1' }),
      })
      expect(res.statusCode).toBe(401)
    })

    it('refuses a token minted for a different audience', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: await auth({ aud: 'service_role' }),
      })
      expect(res.statusCode).toBe(401)
    })

    it('refuses an expired token', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: await auth({ exp: '-1h' }),
      })
      expect(res.statusCode).toBe(401)
    })

    it('refuses a bare token with no Bearer scheme', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: { authorization: await token() },
      })
      expect(res.statusCode).toBe(401)
    })

    it('runs every query as the calling user, never as the connecting role', async () => {
      // This is what keeps RLS in force. A route reaching the pool directly
      // would stop the policies applying at all.
      query.mockResolvedValue({ rows: [learnerRow()] })
      const app = await buildApp()
      await app.inject({ method: 'GET', url: '/api/learners', headers: await auth() })
      expect(withUser).toHaveBeenCalledWith(CALLER, expect.any(Function))
    })

    it('scopes queries to the subject in the token, not to anything in the body', async () => {
      query.mockResolvedValue({ rows: [] })
      const other = 'bbbbbbbb-0000-0000-0000-000000000009'
      const app = await buildApp()
      await app.inject({
        method: 'GET',
        url: '/api/learners',
        headers: await auth({ sub: other }),
      })
      expect(withUser).toHaveBeenCalledWith(other, expect.any(Function))
    })
  })

  describe('GET /learners', () => {
    it('returns the mapped learners', async () => {
      query.mockResolvedValue({ rows: [learnerRow(), learnerRow({ id: 'l2', theme: 'ocean' })] })
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/api/learners', headers: await auth() })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.learners).toHaveLength(2)
      expect(body.learners[0]).toMatchObject({ displayName: 'Ada', theme: 'cats' })
      expect(body.learners[1].theme).toBe('ocean')
    })

    it('returns an empty list rather than an error when nothing is visible', async () => {
      // RLS hiding every row looks exactly like owning none, and should.
      query.mockResolvedValue({ rows: [] })
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/api/learners', headers: await auth() })
      expect(res.statusCode).toBe(200)
      expect(res.json().learners).toEqual([])
    })
  })

  describe('PATCH /learners/:id', () => {
    it('updates the theme and returns the learner', async () => {
      query.mockResolvedValue({ rows: [learnerRow({ theme: 'robots' })] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'robots' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().learner.theme).toBe('robots')
    })

    it('writes only the fields that were sent', async () => {
      // A sparse update: an absent key means "leave it alone", so setting a
      // theme must not blank a display name.
      query.mockResolvedValue({ rows: [learnerRow()] })
      const app = await buildApp()
      await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'ocean' },
        headers: await auth(),
      })
      const [sql, values] = query.mock.calls.at(-1)!
      expect(sql).toContain('theme = $1')
      expect(sql).not.toContain('display_name')
      expect(sql).not.toContain('grade_hint')
      expect(values).toEqual(['ocean', LEARNER])
    })

    it('treats an explicit null as "clear it" rather than "leave it"', async () => {
      query.mockResolvedValue({ rows: [learnerRow({ theme: null })] })
      const app = await buildApp()
      await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: null },
        headers: await auth(),
      })
      const [sql, values] = query.mock.calls.at(-1)!
      expect(sql).toContain('theme = $1')
      expect(values[0]).toBeNull()
    })

    it('parameterises the update rather than interpolating the value', async () => {
      query.mockResolvedValue({ rows: [learnerRow()] })
      const app = await buildApp()
      await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { displayName: "Bobby'); drop table learners;--" },
        headers: await auth(),
      })
      const [sql, values] = query.mock.calls.at(-1)!
      expect(sql).not.toContain('drop table')
      expect(values[0]).toBe("Bobby'); drop table learners;--")
    })

    it('rejects a malformed learner id before touching the database', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/learners/not-a-uuid',
        payload: { theme: 'cats' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('writes the starter decks a learner has added, whole and de-duplicated', async () => {
      query.mockResolvedValue({ rows: [learnerRow({ starter_decks: ['starter-capitals'] })] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { starterDecks: ['starter-capitals', 'starter-capitals'] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().learner.starterDecks).toEqual(['starter-capitals'])
      const [sql, values] = query.mock.calls.at(-1)!
      expect(sql).toContain('starter_decks = $1')
      expect(values[0]).toEqual(['starter-capitals'])
    })

    it('rejects a starter deck id longer than the column allows', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { starterDecks: ['x'.repeat(65)] },
      })
      expect(res.statusCode).toBe(400)
    })

    it('merges a settings patch into the stored object rather than replacing it', async () => {
      query.mockResolvedValue({ rows: [learnerRow({ settings: { sound: false, showHands: true } })] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { settings: { sound: false } },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().learner.settings).toEqual({ sound: false, showHands: true })
      const [sql, values] = query.mock.calls.at(-1)!
      expect(sql).toContain('settings = settings || $1::jsonb')
      expect(JSON.parse(values[0])).toEqual({ sound: false })
    })

    it('refuses a settings key it does not know', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { settings: { favouriteColour: 'blue' } },
      })
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('accepts the strike-out switch for multiple choice', async () => {
      query.mockResolvedValue({ rows: [learnerRow({ settings: { strikeOutChoices: false } })] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { settings: { strikeOutChoices: false } },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().learner.settings).toEqual({ strikeOutChoices: false })
    })

    it('refuses a flashcard layout it does not ship', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
        payload: { settings: { flashcardLayout: 'spin' } },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects an empty patch rather than issuing a no-op update', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: {},
        headers: await auth(),
      })
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('rejects a theme string longer than the column allows', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'x'.repeat(33) },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses to let a patch change ownership or sign-in mode', async () => {
      // Owner-only concerns enforced in the database; the schema not accepting
      // them means a typo cannot even become an attempt.
      query.mockResolvedValue({ rows: [learnerRow()] })
      const app = await buildApp()
      await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'cats', ownerId: 'someone-else', authKind: 'self' },
        headers: await auth(),
      })
      const [sql] = query.mock.calls.at(-1)!
      expect(sql).not.toContain('owner_id')
      expect(sql).not.toContain('auth_kind')
    })

    it('returns 404 when the update matched no visible row', async () => {
      // What another family's learner looks like: RLS filters it out, the
      // update returns nothing, and the route says not found rather than
      // confirming the row exists.
      query.mockResolvedValue({ rows: [] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'cats' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(404)
    })

    it('turns a policy refusal into 403 rather than 500', async () => {
      query.mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' }))
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'cats' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('forbidden')
    })

    it('turns a check violation into 400', async () => {
      query.mockRejectedValue(Object.assign(new Error('bad theme'), { code: '23514' }))
      const app = await buildApp()
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/learners/${LEARNER}`,
        payload: { theme: 'cats' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /learners', () => {
    it('creates a learner and answers 201', async () => {
      query.mockResolvedValue({ rows: [learnerRow()] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/learners',
        payload: { displayName: 'Ada' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().learner.displayName).toBe('Ada')
    })

    it('rejects a nameless learner', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/learners',
        payload: { displayName: '   ' },
        headers: await auth(),
      })
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('rejects a birth year that cannot be real', async () => {
      const app = await buildApp()
      for (const birthYear of [1800, new Date().getFullYear() + 5]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/learners',
          payload: { displayName: 'Ada', birthYear },
          headers: await auth(),
        })
        expect(res.statusCode).toBe(400)
      }
    })
  })

  describe('DELETE /learners/:id', () => {
    it('answers 404 when nothing was deleted', async () => {
      query.mockResolvedValue({ rowCount: 0, rows: [] })
      const app = await buildApp()
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/learners/${LEARNER}`,
        headers: await auth(),
      })
      expect(res.statusCode).toBe(404)
    })
  })
})
