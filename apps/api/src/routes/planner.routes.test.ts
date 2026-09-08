// The weekly planner's surface.
//
// The properties these protect, in order of how much they matter:
//
//   * a linked card cannot be ticked — it is closed by a round or not at all
//   * a hand tick is attributed to the caller, never to whoever the body names
//   * a grown-up ticks for a learner only in the two youngest bands
//   * proposing stores nothing; accepting creates the cards
//   * there is no route that writes history; the routes only read it

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
const TEEN = 'cccccccc-0000-0000-0000-000000000003'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const ITEM = '55555555-6666-4777-8888-999999999999'
const ASSESSMENT = '66666666-6666-4777-8888-999999999999'
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
  const { plannerRoutes } = await import('./planner.js')
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
  await app.register(plannerRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

const MON = '2026-09-07'

const itemRow = (over: Record<string, unknown> = {}) => ({
  id: ITEM,
  learner_id: LEARNER,
  week_start: MON,
  on_day: MON,
  kind: 'task',
  title: 'Bio worksheet',
  course_id: null,
  assessment_id: null,
  minutes: 25,
  purpose: null,
  proposed: false,
  target_subject: null,
  target_activity: null,
  target_id: null,
  status: 'open',
  done_at: null,
  done_by: null,
  session_id: null,
  deleted_at: null,
  sort_order: 1000,
  created_by: TEEN,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
})

const assessmentRow = (over: Record<string, unknown> = {}) => ({
  id: ASSESSMENT,
  learner_id: LEARNER,
  course_id: null,
  kind: 'test',
  title: 'Chapter 7',
  on_day: '2026-09-25',
  difficulty: 2,
  target_subject: 'quiz',
  target_id: 'deck-1',
  outcome: null,
  plan_generated_at: null,
  created_by: TEEN,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
})

/** Answer each query in turn by matching a fragment of its SQL. */
function answer(map: Array<[RegExp, unknown[]]>) {
  query.mockImplementation(async (sql: string) => {
    for (const [pattern, rows] of map) {
      if (pattern.test(sql)) return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  })
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  withUser.mockClear()
})

describe('two kinds of done', () => {
  it('refuses to tick a linked card', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_items i where i\.id/, [
        itemRow({ kind: 'study', target_subject: 'quiz', target_activity: 'learn', target_id: 'deck-1' }),
      ]],
    ])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(TEEN),
      payload: { status: 'done' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('linked_card')
    expect(query.mock.calls.some(([sql]) => /update public\.planner_items/.test(String(sql)))).toBe(false)
  })

  it('ticks a claim card as the caller, whatever the body says', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_items i where i\.id/, [itemRow()]],
      [/select grade_hint, auth_user_id/, [{ grade_hint: 8, auth_user_id: TEEN }]],
      [/update public\.planner_items set/, [itemRow({ status: 'done', done_by: TEEN, done_at: new Date().toISOString() })]],
    ])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(TEEN),
      payload: { status: 'done', doneBy: CALLER },
    })
    expect(res.statusCode).toBe(200)
    const update = query.mock.calls.find(([sql]) => /update public\.planner_items set/.test(String(sql)))!
    // The last parameter is done_by, and it is the caller.
    expect(update[1].at(-1)).toBe(TEEN)
  })

  it('lets a grown-up tick for a young learner, and not for an older one', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_items i where i\.id/, [itemRow()]],
      [/select grade_hint, auth_user_id/, [{ grade_hint: 10, auth_user_id: TEEN }]],
      [/update public\.planner_items set/, [itemRow({ status: 'done', done_by: CALLER })]],
    ])
    const older = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(CALLER),
      payload: { status: 'done' },
    })
    expect(older.statusCode).toBe(400)
    expect(older.json().error.code).toBe('learner_ticks')

    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_items i where i\.id/, [itemRow()]],
      [/select grade_hint, auth_user_id/, [{ grade_hint: 2, auth_user_id: null }]],
      [/update public\.planner_items set/, [itemRow({ status: 'done', done_by: CALLER })]],
    ])
    const young = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(CALLER),
      payload: { status: 'done' },
    })
    expect(young.statusCode).toBe(200)
  })

  it('will not shelve a study session', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_items i where i\.id/, [itemRow({ kind: 'study' })]],
    ])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(TEEN),
      payload: { onDay: null },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('shelf_kinds')
  })
})

describe('proposing and accepting', () => {
  it('proposes without writing anything', async () => {
    const app = await buildApp()
    answer([
      [/from public\.assessments where id = \$1$/, [assessmentRow()]],
      [/select grade_hint, auth_user_id/, [{ grade_hint: 8, auth_user_id: TEEN }]],
    ])
    const res = await app.inject({
      method: 'POST',
      url: `/api/assessments/${ASSESSMENT}/propose`,
      headers: await auth(TEEN),
      payload: { today: MON },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.wanted).toBe(5)
    expect(body.sessions).toHaveLength(5)
    expect(body.sessions.at(-1).onDay).toBe('2026-09-24')
    expect(body.sessions.at(-1).purpose).toBe('review')
    expect(query.mock.calls.some(([sql]) => /insert|update/i.test(String(sql)))).toBe(false)
  })

  it('accepts by creating linked study cards with the purpose\'s activity', async () => {
    const app = await buildApp()
    let inserted = 0
    query.mockImplementation(async (sql: string) => {
      if (/from public\.assessments where id = \$1$/.test(sql)) return { rows: [assessmentRow()], rowCount: 1 }
      if (/insert into public\.planner_weeks/.test(sql)) return { rows: [], rowCount: 1 }
      if (/select \* from public\.planner_weeks where/.test(sql)) {
        return { rows: [{ id: 'w', learner_id: LEARNER, week_start: MON, priorities: [], wins: [], goals: [], busy_days: [] }], rowCount: 1 }
      }
      if (/coalesce\(max\(sort_order\)/.test(sql)) return { rows: [{ next: 1000 }], rowCount: 1 }
      if (/insert into public\.planner_items/.test(sql)) {
        inserted += 1
        return { rows: [itemRow({ kind: 'study', target_subject: 'quiz', target_activity: 'test', target_id: 'deck-1' })], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/assessments/${ASSESSMENT}/accept`,
      headers: await auth(TEEN),
      payload: {
        sessions: [
          { onDay: '2026-09-22', purpose: 'prove', minutes: 20, title: 'Prove it · Chapter 7' },
          { onDay: '2026-09-24', purpose: 'review', minutes: 20, title: 'Quick review · Chapter 7' },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(inserted).toBe(2)
    const insert = query.mock.calls.find(([sql]) => /insert into public\.planner_items/.test(String(sql)))!
    // target_subject, target_activity, target_id sit at positions 11-13.
    expect(insert[1].slice(10, 13)).toEqual(['quiz', 'test', 'deck-1'])
  })
})

describe('history is read, never written', () => {
  it('offers no route that writes an event', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}/history`,
      headers: await auth(TEEN),
      payload: { kind: 'done' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('reads a card\'s timeline with the actor\'s name', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ "?column?": 1 }]],
      [/from public\.planner_events e/, [
        { id: 1, learner_id: LEARNER, entity: 'item', entity_id: ITEM, at: new Date().toISOString(), actor_id: TEEN, actor_name: 'Ava', kind: 'created', before: null, after: { onDay: MON }, session_id: null },
      ]],
    ])
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}/history`,
      headers: await auth(CALLER),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().events[0]).toMatchObject({ kind: 'created', actorName: 'Ava' })
  })
})

describe('the week', () => {
  it('insists on a Monday', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/learners/${LEARNER}/planner/weeks/2026-09-09`,
      headers: await auth(TEEN),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('not_monday')
  })

  it('caps priorities at three', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/weeks/${MON}`,
      headers: await auth(TEEN),
      payload: { priorities: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] },
    })
    expect(res.statusCode).toBe(400)
  })
})

// --- the live channel --------------------------------------------------------
//
// The planner is consumer one of docs/realtime-spec.md. What matters is not
// that events happen but *when*: after the write, never instead of it, and
// never for a write that did not land.
describe('planner writes announce themselves', () => {
  async function collect(learnerId: string) {
    const { bus } = await import('../live/bus.js')
    const { learnerChannel } = await import('@whizzo/shared')
    const seen: Array<{ kind: string; originId: string | null; payload: unknown }> = []
    const off = bus.subscribe(learnerChannel(learnerId), (e) =>
      seen.push({ kind: e.kind, originId: e.originId, payload: e.payload }),
    )
    return { seen, off }
  }

  it('publishes the saved card, tagged with the tab that wrote it', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ '?column?': 1 }]],
      [/from public\.planner_items i where i\.id/, [itemRow()]],
      [/update public\.planner_items set/, [itemRow({ title: 'Bio worksheet, done' })]],
    ])
    const { seen, off } = await collect(LEARNER)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: { ...(await auth()), 'x-live-origin': 'tab-abc' },
      payload: { title: 'Bio worksheet, done' },
    })
    off()

    expect(res.statusCode).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.kind).toBe('planner.item')
    // The row itself, so a watching client needs no follow-up read.
    expect((seen[0]!.payload as { id: string }).id).toBe(ITEM)
    // Echoed back so the tab that made the change can ignore its own event.
    expect(seen[0]!.originId).toBe('tab-abc')
  })

  it('says which card went, on a delete', async () => {
    const app = await buildApp()
    answer([[/update public\.planner_items set deleted_at/, [{}]]])
    const { seen, off } = await collect(LEARNER)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(),
    })
    off()

    expect(res.statusCode).toBe(204)
    expect(seen).toEqual([
      { kind: 'planner.item.removed', originId: null, payload: { itemId: ITEM } },
    ])
  })

  // The announcement is after the transaction, so a refused write announces
  // nothing — otherwise every watcher would apply a change that never happened.
  it('announces nothing when the write is refused', async () => {
    const app = await buildApp()
    answer([
      [/^select 1 from public\.learners/, [{ '?column?': 1 }]],
      [/from public\.planner_items i where i\.id/, [
        itemRow({ kind: 'study', target_subject: 'quiz', target_activity: 'learn', target_id: 'deck-1' }),
      ]],
    ])
    const { seen, off } = await collect(LEARNER)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: await auth(),
      payload: { status: 'done' },
    })
    off()

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('linked_card')
    expect(seen).toEqual([])
  })

  // An origin is only ever compared for equality against what the same client
  // sent, but it still ends up in a payload every watcher parses.
  it('ignores an origin header that is not a plain token', async () => {
    const app = await buildApp()
    answer([[/update public\.planner_items set deleted_at/, [{}]]])
    const { seen, off } = await collect(LEARNER)

    await app.inject({
      method: 'DELETE',
      url: `/api/learners/${LEARNER}/planner/items/${ITEM}`,
      headers: { ...(await auth()), 'x-live-origin': '<script>alert(1)</script>' },
    })
    off()

    expect(seen[0]!.originId).toBeNull()
  })
})
