// The live channel's surface.
//
// What these protect, in order of how much they matter:
//
//   * a caller who cannot see a learner cannot subscribe to them — and is told
//     the same "no such learner" every other route tells them
//   * an event published for one learner never reaches a stream on another
//   * a stream is an event stream: unbuffered, uncached, and framed correctly
//   * presence tells the truth, including that somebody has gone

import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// These cases drive a real listening socket and real reconnect delays, so they
// are the only ones here that depend on wall-clock time. Vitest's default 5s
// budget per test was the same number as the waits inside them, which is fine on
// an idle laptop and a coin flip on a loaded CI container — and this suite gates
// the deploy. The ceiling is generous so a genuine hang still fails; the waits
// below are what should report first.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  // One argument, not two: withAdmin takes the callback alone. Standing it in
  // with withUser's shape passes the callback as the user id and `undefined`
  // as the callback, which fails inside a try/catch and looks like the feature
  // silently not working.
  withAdmin: (fn: (db: unknown) => Promise<unknown>) => fn({ query }),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false }))

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const OTHER = '22222222-3333-4444-8555-666666666666'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')

async function token(sub = CALLER): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
}

let app: FastifyInstance
let base: string
const openStreams: AbortController[] = []

beforeEach(async () => {
  query.mockReset()
  const Fastify = (await import('fastify')).default
  const { liveRoutes } = await import('./live.js')
  const { resetPresence } = await import('./live.js')
  const { HttpError } = await import('../errors.js')
  resetPresence()

  // forceCloseConnections, in the harness only: aborting a streaming fetch
  // leaves the client's socket in a state the server counts as a connection,
  // and close() then waits out a keep-alive timeout. That put one case at four
  // seconds against vitest's five-second default — fine here, a coin flip on a
  // loaded CI container, and this suite gates the deploy.
  app = Fastify({ logger: false, forceCloseConnections: true })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message } })
      return
    }
    reply.code(500).send({ error: { code: 'internal', message: 'boom' } })
  })
  await app.register(liveRoutes, { prefix: '/api' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterEach(async () => {
  // A failed assertion skips the stream.close() at the end of its test, and a
  // socket still held open makes app.close() wait rather than fail — which
  // turns one broken test into a slow suite.
  for (const controller of openStreams.splice(0)) controller.abort()
  const { closeLiveStreams } = await import('./live.js')
  closeLiveStreams()
  await app.close()
})

/**
 * Open a stream and collect frames until `want` of them have arrived.
 *
 * The connection is aborted by the caller; nothing here waits for the server to
 * finish, because by design it never does.
 */
function listen(path: string, auth: string) {
  const controller = new AbortController()
  openStreams.push(controller)
  const frames: string[] = []
  const started = fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${auth}`, accept: 'text/event-stream' },
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) return response
    void (async () => {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let at = buffer.indexOf('\n\n')
          while (at >= 0) {
            const frame = buffer.slice(0, at)
            // Comment frames — the stream's opener and its heartbeat — carry
            // no data. They matter (they are what keeps a proxy from
            // buffering) but they are not events, so counting them here would
            // make every index in these tests depend on timing.
            if (frame.includes('data:')) frames.push(frame)
            buffer = buffer.slice(at + 2)
            at = buffer.indexOf('\n\n')
          }
        }
      } catch {
        /* aborted */
      }
    })()
    return response
  })
  return { response: started, frames, close: () => controller.abort() }
}

function dataOf(frame: string): Record<string, unknown> {
  const line = frame.split('\n').find((l) => l.startsWith('data:'))!
  return JSON.parse(line.slice(5).trim())
}

describe('GET /api/live/learners/:id', () => {
  it('refuses a caller with no session', async () => {
    const response = await fetch(`${base}/api/live/learners/${LEARNER}`)
    expect(response.status).toBe(401)
  })

  // The gate is RLS: no row, no learner, as far as this caller is concerned.
  it('is a 404 when the caller cannot see the learner', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const response = await fetch(`${base}/api/live/learners/${LEARNER}`, {
      headers: { authorization: `Bearer ${await token()}` },
    })
    expect(response.status).toBe(404)
  })

  it('opens an unbuffered event stream and says who is here', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const stream = listen(`/api/live/learners/${LEARNER}?announce=1`, await token())
    const response = await stream.response

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    // Both halves matter: a proxy that gzips an event stream also buffers it.
    expect(response.headers.get('cache-control')).toContain('no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')

    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })
    const snapshot = dataOf(stream.frames[0]!)
    expect(snapshot.kind).toBe('watch.begin')
    // `watcher: null` marks a snapshot rather than an arrival, so a client can
    // tell "Mom is here" from "Mom just arrived".
    expect((snapshot.payload as { watcher: unknown }).watcher).toBeNull()
    expect((snapshot.payload as { watchers: unknown[] }).watchers).toHaveLength(1)

    stream.close()
  })

  it('delivers what a route publishes for that learner', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const { publishLearner } = await import('../live/publish.js')

    const stream = listen(`/api/live/learners/${LEARNER}`, await token())
    await stream.response
    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    publishLearner(null, LEARNER, 'planner.item', { id: 'card-1', title: 'Read' })

    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    const event = dataOf(stream.frames[1]!)
    expect(event.kind).toBe('planner.item')
    expect(event.payload).toEqual({ id: 'card-1', title: 'Read' })
    // The frame's event name is the kind, so a client can dispatch without
    // parsing the envelope.
    expect(stream.frames[1]).toContain('event: planner.item')

    stream.close()
  })

  // The whole point of the gate is that channels are separate.
  it('does not leak another learner’s events', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const { publishLearner } = await import('../live/publish.js')

    const stream = listen(`/api/live/learners/${LEARNER}`, await token())
    await stream.response
    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    publishLearner(null, OTHER, 'planner.item', { id: 'not-yours' })
    await new Promise((r) => setTimeout(r, 60))

    expect(stream.frames.filter((f) => f.includes('not-yours'))).toHaveLength(0)
    stream.close()
  })

  it('tells the channel when somebody leaves', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const watcher = listen(`/api/live/learners/${LEARNER}?announce=1`, await token())
    await watcher.response
    await vi.waitFor(() => expect(watcher.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    // The arriver hears only its own snapshot, never its own arrival.
    expect(watcher.frames).toHaveLength(1)

    // A second person on the same channel, so there is somebody left to be told.
    const second = listen(`/api/live/learners/${LEARNER}?announce=1`, await token(OTHER))
    await second.response
    await vi.waitFor(() => expect(watcher.frames.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    const arrival = dataOf(watcher.frames[1]!)
    expect(arrival.kind).toBe('watch.begin')
    expect((arrival.payload as { watcher: { userId: string } }).watcher.userId).toBe(OTHER)
    expect((arrival.payload as { watchers: unknown[] }).watchers).toHaveLength(2)

    second.close()
    await vi.waitFor(() => expect(watcher.frames.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 })
    const departure = dataOf(watcher.frames[2]!)
    expect(departure.kind).toBe('watch.end')
    expect((departure.payload as { watchers: unknown[] }).watchers).toHaveLength(1)

    watcher.close()
  })
})

describe('presence is opt-in', () => {
  // Holding a subscription is not the same as being somewhere: the home
  // screen's Today strip watches this channel without anybody being in the
  // week, and "Ada is here" said about a week Ada is not looking at is false.
  it('does not put a silent listener in the watcher list', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const silent = listen(`/api/live/learners/${LEARNER}`, await token())
    await silent.response
    await vi.waitFor(() => expect(silent.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    expect((dataOf(silent.frames[0]!).payload as { watchers: unknown[] }).watchers).toEqual([])
    silent.close()
  })

  it('still delivers events to a silent listener', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const { publishLearner } = await import('../live/publish.js')
    const silent = listen(`/api/live/learners/${LEARNER}`, await token())
    await silent.response
    await vi.waitFor(() => expect(silent.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    publishLearner(null, LEARNER, 'planner.item', { id: 'card-1' })
    await vi.waitFor(() => expect(silent.frames.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    expect(dataOf(silent.frames[1]!).kind).toBe('planner.item')
    silent.close()
  })

  // Otherwise a listener that never announced would publish a departure for
  // somebody who was never announced as arriving.
  it('announces no departure for a listener who never arrived', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const watching = listen(`/api/live/learners/${LEARNER}?announce=1`, await token())
    await watching.response
    await vi.waitFor(() => expect(watching.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    const silent = listen(`/api/live/learners/${LEARNER}`, await token(OTHER))
    await silent.response
    silent.close()
    await new Promise((r) => setTimeout(r, 80))

    expect(watching.frames.filter((f) => f.includes('watch.'))).toHaveLength(1)
    watching.close()
  })
})

describe('POST /api/live/learners/:id', () => {
  const begin = {
    kind: 'round.begin',
    roundId: 'r1',
    activity: 'flashcards',
    subject: 'quiz',
    title: 'Capital cities',
    cards: 10,
  }
  const tick = {
    kind: 'round.tick',
    roundId: 'r1',
    at: 3,
    cards: 10,
    prompt: 'Capital of Peru?',
    outcome: 'right',
    answer: 'Lima',
    selfGraded: true,
    responseMs: 2400,
  }

  async function post(body: unknown, sub?: string) {
    return fetch(`${base}/api/live/learners/${LEARNER}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token(sub)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  it('is a 404 when the caller cannot see the learner', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    expect((await post(begin)).status).toBe(404)
  })

  // Nothing here is stored, which is not a reason to accept an unbounded blob
  // that lands on somebody else's screen.
  it('refuses a body that is not a round event', async () => {
    query.mockResolvedValue({ rows: [{ display_name: 'Ada', auth_user_id: null, owner_id: CALLER }] })
    expect((await post({ kind: 'round.tick', roundId: 'r1' })).status).toBe(400)
    expect((await post({ kind: 'nonsense' })).status).toBe(400)
    expect((await post({ ...tick, prompt: 'x'.repeat(500) })).status).toBe(400)
  })

  // The one message that goes out whether or not anybody is already looking:
  // it is how a grown-up finds out there is something to join.
  it('tells the learner’s grown-ups that a round started', async () => {
    const { bus } = await import('../live/bus.js')
    const { learnerChannel, userChannel } = await import('@whizzo/shared')
    query
      .mockResolvedValueOnce({ rows: [{ display_name: 'Ada', auth_user_id: null, owner_id: CALLER }] })
      .mockResolvedValueOnce({ rows: [{ id: CALLER }, { id: OTHER }] })

    const onLearner: string[] = []
    const toCaller: Array<Record<string, unknown>> = []
    const offA = bus.subscribe(learnerChannel(LEARNER), (e) => onLearner.push(e.kind))
    const offB = bus.subscribe(userChannel(CALLER), (e) => toCaller.push(e.payload as Record<string, unknown>))

    expect((await post(begin)).status).toBe(204)
    offA()
    offB()

    expect(onLearner).toEqual(['round.begin'])
    expect(toCaller[0]).toMatchObject({ learnerId: LEARNER, learnerName: 'Ada', title: 'Capital cities' })
  })

  // An unwatched round is free. The client already knows not to send, and this
  // covers the gap between the last watcher leaving and it finding out.
  it('drops a tick when nobody is watching', async () => {
    const { bus } = await import('../live/bus.js')
    const { learnerChannel } = await import('@whizzo/shared')
    query.mockResolvedValue({ rows: [{ display_name: 'Ada', auth_user_id: null, owner_id: CALLER }] })

    const seen: string[] = []
    // Subscribing here is not the same as being present: presence is what
    // decides, and this listener never announced.
    const off = bus.subscribe(learnerChannel(LEARNER), (e) => seen.push(e.kind))
    expect((await post(tick)).status).toBe(204)
    off()

    expect(seen).toEqual([])
  })

  // Watching a round and staging one are different rights. Everything posted
  // here is rendered as the learner's own work.
  it('refuses a guardian who is neither the learner nor the owner', async () => {
    query.mockResolvedValue({ rows: [{ display_name: 'Ada', auth_user_id: null, owner_id: CALLER }] })
    const response = await post(begin, OTHER)
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('lets the learner speak for their own round', async () => {
    query.mockResolvedValue({ rows: [{ display_name: 'Ada', auth_user_id: OTHER, owner_id: CALLER }] })
    expect((await post(begin, OTHER)).status).toBe(204)
  })

  // Without this the "practicing now" chip outlives the round it advertises.
  it('tells the grown-ups when the round finishes too', async () => {
    const { bus } = await import('../live/bus.js')
    const { userChannel } = await import('@whizzo/shared')
    query
      .mockResolvedValueOnce({ rows: [{ display_name: 'Ada', auth_user_id: null, owner_id: CALLER }] })
      .mockResolvedValueOnce({ rows: [{ id: CALLER }] })

    const toCaller: string[] = []
    const off = bus.subscribe(userChannel(CALLER), (e) => toCaller.push(e.kind))
    expect((await post({ kind: 'round.end', roundId: 'r1', cards: 10, correct: 8 })).status).toBe(204)
    off()

    expect(toCaller).toEqual(['round.end'])
  })

  it('delivers a tick to somebody who is', async () => {
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const watching = listen(`/api/live/learners/${LEARNER}?announce=1`, await token())
    await watching.response
    await vi.waitFor(() => expect(watching.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    query.mockResolvedValue({ rows: [{ display_name: 'Ada', auth_user_id: OTHER, owner_id: CALLER }] })
    expect((await post(tick, OTHER)).status).toBe(204)

    await vi.waitFor(() => expect(watching.frames.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    const event = dataOf(watching.frames[1]!)
    expect(event.kind).toBe('round.tick')
    expect(event.payload).toMatchObject({ prompt: 'Capital of Peru?', outcome: 'right', selfGraded: true })

    watching.close()
  })
})

describe('shutdown', () => {
  // A hijacked stream is an in-flight request, and Fastify waits for those. A
  // SIGTERM that sits behind a watcher for half an hour is a deploy that ends
  // in SIGKILL instead of a clean close.
  it('ends open streams rather than holding the close open', async () => {
    const { closeLiveStreams } = await import('./live.js')
    query.mockResolvedValue({ rows: [{ auth_user_id: null, display_name: 'Mom' }] })
    const stream = listen(`/api/live/learners/${LEARNER}?announce=1`, await token())
    await stream.response
    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    // Exactly what server.ts's SIGTERM handler does, and in that order. An
    // onClose hook cannot stand in for this: it runs after the wait it is
    // meant to prevent, which is why this asserts on the clock.
    const startedAt = Date.now()
    closeLiveStreams()
    await app.close()
    expect(Date.now() - startedAt).toBeLessThan(2000)

    stream.close()
    // afterEach closes the app again; Fastify tolerates that.
  })
})

describe('GET /api/live/me', () => {
  it('needs no learner and streams the caller’s own channel', async () => {
    query.mockResolvedValue({ rows: [{ display_name: 'Mom' }] })
    const { publishUser } = await import('../live/publish.js')

    const stream = listen('/api/live/me', await token())
    const response = await stream.response
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 })

    publishUser(null, CALLER, 'planner.item', { ping: true })
    await vi.waitFor(() => expect(stream.frames.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    expect(dataOf(stream.frames[1]!).payload).toEqual({ ping: true })

    stream.close()
  })
})
