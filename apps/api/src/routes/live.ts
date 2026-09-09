// The live channel — one SSE endpoint, many consumers. See docs/realtime-spec.md.
//
// The whole point of this file is that it is the *only* file like it. A new
// realtime feature is an event kind published from the route that already does
// the write, plus a subscriber in the client; it is never another endpoint,
// another connection or another authorization rule.
//
// Three things here are load-bearing:
//
//   * **The gate is the one that already exists.** Subscribing to a learner is
//     authorized by selecting that learner under RLS — the same check every
//     other learner-scoped route makes. There is no channel ACL to drift.
//
//   * **The heartbeat is not optional.** It keeps intermediaries from closing
//     an idle stream, and it defeats proxy response buffering, which otherwise
//     holds events back and delivers a "realtime" feed in clumps.
//
//   * **Nothing is stored.** There is no history, no replay and no
//     Last-Event-ID backfill. A client that reconnects re-reads its own state.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  learnerChannel,
  userChannel,
  LIVE_CONNECTION_MS,
  LIVE_HEARTBEAT_MS,
  LIVE_MAX_CONNECTIONS_PER_CALLER,
  type LiveEvent,
  type LiveWatcher,
  type WatchPayload,
} from '@whizzo/shared'
import { callerOf, requireCaller } from '../auth.js'
import { withAdmin, withUser } from '../db.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { bus } from '../live/bus.js'
import { publishLearner, publishUser } from '../live/publish.js'

const uuid = z.string().uuid('That is not a valid id')

/**
 * Who is on each channel.
 *
 * Presence deliberately lives here in memory rather than in a table: it is
 * true only as long as a socket is open, and a row that outlives the socket is
 * a lie. It follows the same fate as the bus when the process is alone — and
 * moves with it, to the same place, if there is ever more than one.
 */
const present = new Map<string, Map<number, LiveWatcher>>()

/** Open connections per caller, so one script cannot hold every socket. */
const openPerCaller = new Map<string, number>()

/**
 * Every open stream's "end it now" function.
 *
 * A hijacked response is an in-flight request, and Fastify's close waits for
 * those — so without this a SIGTERM would sit behind a watcher for up to
 * LIVE_CONNECTION_MS while App Platform counted down to SIGKILL. Deploys are
 * frequent and connections are cheap to re-establish; ending them is right.
 */
const openStreams = new Set<() => void>()

let nextConnectionId = 1

function watchersOn(channel: string): LiveWatcher[] {
  const here = present.get(channel)
  if (!here) return []
  // One entry per person, not per tab: two tabs is one "Mom is watching".
  const byUser = new Map<string, LiveWatcher>()
  for (const w of here.values()) if (!byUser.has(w.userId)) byUser.set(w.userId, w)
  return [...byUser.values()]
}

function join(channel: string, id: number, watcher: LiveWatcher): void {
  let here = present.get(channel)
  if (!here) {
    here = new Map()
    present.set(channel, here)
  }
  here.set(id, watcher)
}

function leave(channel: string, id: number): void {
  const here = present.get(channel)
  if (!here) return
  here.delete(id)
  if (!here.size) present.delete(channel)
}

function frame(event: LiveEvent): string {
  // `event:` lets a client dispatch without parsing, `data:` carries the
  // envelope. One line of JSON, because a newline inside data would end the
  // frame — JSON.stringify escapes them, which is why this is safe.
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Hold `reply` open as an event stream on `channel`.
 *
 * Returns nothing and never resolves before the client goes away: Fastify is
 * told to stop managing the response, and everything after that is raw socket
 * writes and cleanup.
 */
function stream(
  request: FastifyRequest,
  reply: FastifyReply,
  channel: string,
  watcher: LiveWatcher,
  announce: boolean,
): void {
  const callerId = watcher.userId

  // The caller was gated by an awaited query, and clients do go away during it
  // — React's development double-mount aborts its first connection almost
  // immediately. Nothing below is safe to set up for a socket that has already
  // gone, and its 'close' has fired by now and will not fire again.
  if (request.raw.destroyed || reply.raw.destroyed) return

  const open = openPerCaller.get(callerId) ?? 0
  if (open >= LIVE_MAX_CONNECTIONS_PER_CALLER) {
    throw badRequest('Too many open connections. Close a tab and try again.', 'too_many_streams')
  }

  const id = nextConnectionId++
  openPerCaller.set(callerId, open + 1)
  const subjectId = channel.slice(channel.indexOf(':') + 1)

  // Declared before cleanup so it can run at any point after this line, and
  // filled in as each is set up. Everything cleanup touches tolerates never
  // having been started.
  let heartbeat: NodeJS.Timeout | null = null
  let expiry: NodeJS.Timeout | null = null
  let unsubscribe: (() => void) | null = null
  let closed = false

  const endStream = () => {
    try {
      reply.raw.end()
    } catch {
      /* already gone; cleanup runs either way */
    }
    // Ending the response is not enough to let go of the connection: a finished
    // response goes back into the keep-alive pool, and a pooled connection
    // still counts as open to server.close(). Release the socket once the last
    // chunk has flushed — a truncated stream and a dropped one look the same to
    // the client, and it reconnects from both.
    setImmediate(() => {
      try {
        reply.raw.socket?.destroy()
      } catch {
        /* already gone */
      }
    })
  }

  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    if (expiry) clearTimeout(expiry)
    openStreams.delete(endStream)
    unsubscribe?.()
    leave(channel, id)
    const count = (openPerCaller.get(callerId) ?? 1) - 1
    if (count > 0) openPerCaller.set(callerId, count)
    else openPerCaller.delete(callerId)

    if (announce) {
      const remaining = watchersOn(channel)
      // Only announce a departure when the person is fully gone — closing one
      // of two tabs is not leaving.
      if (!remaining.some((w) => w.userId === watcher.userId)) {
        bus.publish(channel, {
          kind: 'watch.end',
          subjectId,
          at: Date.now(),
          actorId: watcher.userId,
          actorName: watcher.name,
          originId: null,
          payload: { watcher, watchers: remaining } satisfies WatchPayload,
        })
      }
    }
    // Release the socket too, whatever ended this.
    //
    // A watcher that navigates away aborts the request: cleanup runs, but the
    // response was hijacked and never finished, so without this the connection
    // sits in limbo until a keep-alive timeout — holding a server socket for a
    // client that has gone, and making the next graceful shutdown wait several
    // seconds behind it. endStream is safe to call twice.
    endStream()
    request.log.debug({ channel }, 'live stream closed')
  }

  // Before any of the setup below, so a disconnect at any point from here on is
  // heard. Registering late is how a stream leaks its presence entry, its bus
  // listener and its slot in openPerCaller all at once.
  request.raw.on('close', cleanup)
  reply.raw.on('close', cleanup)
  reply.raw.on('error', cleanup)
  openStreams.add(endStream)
  if (request.raw.destroyed || reply.raw.destroyed) {
    cleanup()
    return
  }

  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // `no-transform` matters as much as `no-cache`: a proxy that gzips this
    // buffers it, and a buffered event stream is not an event stream.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // nginx-family proxies read this and stop buffering. Harmless elsewhere.
    'x-accel-buffering': 'no',
  })
  // Flush the headers immediately so the client's fetch resolves and it can
  // start reading rather than waiting for the first event.
  reply.raw.write(': open\n\n')

  const send = (event: LiveEvent) => {
    // A socket that has gone away throws on write; the close handler is on its
    // way, so swallowing here is right.
    try {
      reply.raw.write(frame(event))
    } catch {
      /* the close handler will clean up */
    }
  }

  // Presence is opt-in, and the reason is that holding a subscription is not
  // the same as being somewhere: the home screen's Today strip watches this
  // channel too, and "Ada is here" said about a week Ada is not looking at is
  // simply false — on the one surface the consent rule rests on.
  //
  // For those that do announce, order matters and these steps are not
  // interchangeable: present *before* announcing, so the announcement counts
  // the arrival; announce *before* subscribing, so the arriver is not told
  // about their own arrival on top of the snapshot they are about to get.
  if (announce) {
    join(channel, id, watcher)
    // This reaches the learner's own device too, which is how a child knows
    // they are being watched — and how a round knows there is now somebody to
    // emit to.
    bus.publish(channel, {
      kind: 'watch.begin',
      subjectId,
      at: Date.now(),
      actorId: watcher.userId,
      actorName: watcher.name,
      originId: null,
      payload: { watcher, watchers: watchersOn(channel) } satisfies WatchPayload,
    })
  }

  unsubscribe = bus.subscribe(channel, send)

  // The arriver's own snapshot of who is here. `watcher: null` marks it as a
  // snapshot rather than an arrival, so a client can tell "Mom is here" from
  // "Mom just arrived" and only chime for the second. Sent to silent listeners
  // as well: they do not appear in it, but they may still show it.
  send({
    kind: 'watch.begin',
    subjectId,
    at: Date.now(),
    actorId: null,
    actorName: null,
    originId: null,
    payload: { watcher: null, watchers: watchersOn(channel) } satisfies WatchPayload,
  })

  // Unref'd: a pending timer must not be the thing keeping the process alive
  // when everything else has shut down. The socket holds the loop open for as
  // long as it should.
  heartbeat = setInterval(() => {
    try {
      reply.raw.write(`: ping ${Date.now()}\n\n`)
    } catch {
      /* as above */
    }
  }, LIVE_HEARTBEAT_MS)
  heartbeat.unref?.()

  // Every stream is finite. The subscription was authorized once, at connect,
  // so this is also the ceiling on how long a revoked grown-up keeps hearing:
  // the reconnect is re-gated.
  expiry = setTimeout(endStream, LIVE_CONNECTION_MS)
  expiry.unref?.()
}

/**
 * Tell this learner's grown-ups that a round has started.
 *
 * Read with admin rights on purpose: a child cannot select their own learner's
 * guardian links (guardian_links_select is for the guardian or the owner), and
 * the answer never reaches the caller — it only decides which channels get a
 * "practicing now" ping. The owner counts as a grown-up alongside the links.
 */
async function announceToGrownUps(
  learnerId: string,
  learnerName: string | null,
  kind: 'round.begin' | 'round.end',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const ids = await withAdmin(async (db) => {
      const { rows } = await db.query(
        `select owner_id as id from public.learners where id = $1
         union
         select guardian_id as id from public.guardian_links where learner_id = $1`,
        [learnerId],
      )
      return rows.map((r) => r.id as string)
    })
    for (const id of ids) {
      publishUser(null, id, kind, { ...payload, learnerId, learnerName })
    }
  } catch (err) {
    // Discovery is a convenience. A round must not fail because we could not
    // work out whom to tell about it.
    console.error('[live] could not announce a round', err)
  }
}

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireCaller)

  /**
   * Presence is opt-in: `?announce=1` from the screen that is actually showing
   * the thing, and absent from anything that merely wants the events.
   */
  const query = z.object({ announce: z.enum(['0', '1']).optional() })
  const announces = (raw: unknown): boolean => {
    const parsed = query.safeParse(raw)
    return parsed.success && parsed.data.announce === '1'
  }

  /**
   * Everything about one learner. The gate is `withUser` plus RLS: if the
   * caller cannot select the learner, there is no such learner as far as they
   * are concerned — the same 404 every other learner-scoped route gives.
   */
  app.get('/live/learners/:id', async (request, reply) => {
    const caller = callerOf(request)
    const parsed = z.object({ id: uuid }).safeParse(request.params)
    if (!parsed.success) throw badRequest('That is not a valid id')
    const learnerId = parsed.data.id

    const who = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select l.auth_user_id, p.display_name
           from public.learners l
           left join public.profiles p on p.id = $2
          where l.id = $1`,
        [learnerId, caller.id],
      )
      if (!rows.length) return null
      return {
        userId: caller.id,
        name: (rows[0].display_name as string | null) ?? null,
        isLearner: rows[0].auth_user_id === caller.id,
      } satisfies LiveWatcher
    })
    if (!who) throw notFound('No such learner')

    stream(request, reply, learnerChannel(learnerId), who, announces(request.query))
  })

  /**
   * A running round, saying where it has got to. Stores nothing, ever.
   *
   * Two rules hold this together. The first is Rule 1 of the spec: a live event
   * is never the record. Attempts are still written once, at the end of the
   * round, and nothing here may be read back as evidence — which is why this
   * endpoint has no reader and no table behind it.
   *
   * The second is that an unwatched round costs nothing. The client only sends
   * between a `watch.begin` and a `watch.end`, and the ticks it does send are
   * dropped here if the last watcher left in the meantime.
   */
  app.post(
    '/live/learners/:id',
    {
      // Its own bucket, and not the scope's. That ceiling is sized for
      // *opening connections*, which are rare; this is a handful of messages
      // per card, and sharing one counter meant a single watched round could
      // spend a learner's whole allowance and then be unable to reconnect.
      // The floor under drafts (DRAFT_MIN_GAP_MS) puts the honest worst case
      // at around 600 in this window, so this bounds abuse without ever
      // catching a real round.
      config: { rateLimit: { max: 900, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const caller = callerOf(request)
      const parsed = z.object({ id: uuid }).safeParse(request.params)
      if (!parsed.success) throw badRequest('That is not a valid id')
      const learnerId = parsed.data.id

      const event = roundEventSchema.safeParse(request.body)
      if (!event.success) {
        const issue = event.error.issues[0]
        throw badRequest(issue?.message ?? 'That was not a round event')
      }
      const { kind, ...payload } = event.data

      // Reading a learner's channel and speaking as one are different rights.
      // RLS still decides visibility — no row, no such learner — but emitting is
      // narrower than that on purpose: everything sent here is rendered on a
      // grown-up's screen as their child's work, and the surface is worth nothing
      // if it can be dressed up. So it is the learner's own session, or the
      // owner's device the learner is borrowing. A tutor or a second guardian can
      // watch a round; they cannot stage one.
      const who = await withUser(caller.id, async (db) => {
        const { rows } = await db.query(
          'select display_name, auth_user_id, owner_id from public.learners where id = $1',
          [learnerId],
        )
        return rows.length ? rows[0] : null
      })
      if (!who) throw notFound('No such learner')
      if (who.auth_user_id !== caller.id && who.owner_id !== caller.id) {
        throw forbidden('Only this learner can report their own round')
      }
      const learnerName = (who.display_name as string | null) ?? null

      // A round starting is the one thing that goes out whether or not anybody is
      // already looking: it is how a grown-up finds out there is something to
      // join. Everything after it is only worth sending to somebody present.
      if (kind === 'round.begin' || kind === 'round.end') {
        publishLearner(request, learnerId, kind, payload)
        // Both ends go to the grown-ups, not just the start: `begin` is how they
        // find out there is something to join, and `end` is what takes the
        // invitation away again. Without the second, a chip offers to follow a
        // round that finished half an hour ago.
        await announceToGrownUps(learnerId, learnerName, kind, payload)
        // Presence, not subscribers. Counting listeners would count the learner's
        // own silent subscription — the one this round is using to find out
        // whether anybody is here — and every round would look watched.
      } else if (watchersOn(learnerChannel(learnerId)).length > 0) {
        publishLearner(request, learnerId, kind, payload)
      }

      reply.code(204)
      return null
    },
  )

  /** Addressed to one grown-up: job progress, an invite accepted, billing. */
  app.get('/live/me', async (request, reply) => {
    const caller = callerOf(request)
    const name = await withUser(caller.id, async (db) => {
      const { rows } = await db.query('select display_name from public.profiles where id = $1', [
        caller.id,
      ])
      return (rows[0]?.display_name as string | null) ?? null
    })
    stream(
      request,
      reply,
      userChannel(caller.id),
      { userId: caller.id, name, isLearner: false },
      announces(request.query),
    )
  })
}

/**
 * End every open stream. Call this *before* `app.close()`.
 *
 * Fastify waits for in-flight requests on close, and a hijacked stream is one
 * until it ends — so a SIGTERM would otherwise sit behind whoever happens to be
 * watching until App Platform gave up and killed the process, skipping the pool
 * close on the way out. An `onClose` hook cannot do this job: it runs *after*
 * the wait it is meant to prevent.
 */
export function closeLiveStreams(): void {
  for (const end of [...openStreams]) end()
}

/**
 * What a running round may say about itself.
 *
 * Deliberately a closed set with bounded strings. Nothing here is stored, but
 * it is rendered on somebody else's screen, and "not persisted" is not a reason
 * to accept an unbounded blob from a client.
 */
const roundEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('round.begin'),
    roundId: z.string().min(1).max(64),
    activity: z.string().min(1).max(40),
    subject: z.string().min(1).max(40),
    title: z.string().max(120),
    cards: z.number().int().min(0).max(500),
  }),
  z.object({
    kind: z.literal('round.tick'),
    roundId: z.string().min(1).max(64),
    at: z.number().int().min(0).max(2000),
    cards: z.number().int().min(0).max(500),
    prompt: z.string().max(400),
    outcome: z.enum(['right', 'close', 'wrong']).nullable(),
    answer: z.string().max(400).nullable(),
    selfGraded: z.boolean(),
    responseMs: z.number().int().min(0).max(3_600_000).nullable(),
  }),
  z.object({
    kind: z.literal('round.draft'),
    roundId: z.string().min(1).max(64),
    at: z.number().int().min(0).max(2000),
    text: z.string().max(400),
  }),
  z.object({
    kind: z.literal('round.end'),
    roundId: z.string().min(1).max(64),
    cards: z.number().int().min(0).max(500),
    correct: z.number().int().min(0).max(500),
  }),
])

/** Test seam: forget every connection's presence between cases. */
export function resetPresence(): void {
  present.clear()
  openPerCaller.clear()
  openStreams.clear()
}
