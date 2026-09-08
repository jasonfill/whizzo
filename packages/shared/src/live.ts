// The live channel's wire contract — see docs/realtime-spec.md.
//
// Two rules govern everything in this file, and they are worth restating where
// somebody adding an event kind will read them:
//
//   * **A live event is never the record.** Nothing here is stored, replayed or
//     used as evidence. Attempts are still written once at the end of a round;
//     a planner row is still the row. If a watcher misses an event it is gone,
//     and nothing downstream may care. So: never derive a reward, a mastery
//     update or a state change from one of these.
//
//   * **A channel is a subject somebody has authorization rules about**, not a
//     feature. Everything about one learner rides that learner's channel and
//     consumers filter by `kind`. A new feature is a new `kind`; only a new
//     *subject* is a new channel family, and that costs a gate.

/** Channel families. A new one needs an authorization gate on the server. */
export type LiveFamily = 'learner' | 'user'

/** Everything about one learner: planner edits, live rounds, presence. */
export function learnerChannel(learnerId: string): string {
  return `learner:${learnerId}`
}

/** Addressed to one grown-up: job progress, an invite accepted, billing. */
export function userChannel(userId: string): string {
  return `user:${userId}`
}

export function parseChannel(channel: string): { family: LiveFamily; id: string } | null {
  const at = channel.indexOf(':')
  if (at < 1) return null
  const family = channel.slice(0, at)
  const id = channel.slice(at + 1)
  if (!id) return null
  if (family !== 'learner' && family !== 'user') return null
  return { family, id }
}

/**
 * The event kinds in use. A string union rather than an enum so adding one is
 * a single-line change here and a `case` where it is consumed.
 *
 * `watch.*` is the mechanism that keeps an unwatched round free: a client only
 * emits ticks between a `watch.begin` and a `watch.end`.
 */
export type LiveKind =
  | 'planner.item'
  | 'planner.item.removed'
  | 'planner.week'
  | 'planner.comment'
  | 'round.begin'
  | 'round.tick'
  | 'round.end'
  | 'watch.begin'
  | 'watch.end'

export interface LiveEvent<T = unknown> {
  kind: LiveKind
  /** The channel's subject id — the learner for `learner:`, the user for `user:`. */
  subjectId: string
  /** Server clock, milliseconds. Never trust a client's idea of the time. */
  at: number
  /** Who caused it. Null is the system — a round closing a card, say. */
  actorId: string | null
  /** Display name of the actor, when the server knows it cheaply. */
  actorName: string | null
  /**
   * The tab that caused it, so that tab can ignore the echo of its own
   * optimistic write. Two tabs of the same user still see each other, which is
   * correct — this identifies a connection, not a person.
   */
  originId: string | null
  payload: T
}

/** Who is on a channel. The payload of every `watch.begin` and `watch.end`. */
export interface WatchPayload {
  /** The person who just arrived or left. Null on the snapshot a client gets on connect. */
  watcher: LiveWatcher | null
  /** Everyone on the channel now, the arriving or leaving person included/excluded. */
  watchers: LiveWatcher[]
}

export interface LiveWatcher {
  userId: string
  name: string | null
  /** True when this is the learner's own device rather than a grown-up. */
  isLearner: boolean
}

/** The header a mutating request carries so its own echo can be filtered. */
export const ORIGIN_HEADER = 'x-live-origin'

/** Heartbeat interval. Also what defeats proxy response buffering. */
export const LIVE_HEARTBEAT_MS = 20_000

/**
 * How long one connection is held before the client is asked to reconnect.
 *
 * A subscription is authorized once, at subscribe time, so this doubles as the
 * ceiling on how long a revoked grown-up keeps receiving: they are re-gated on
 * every reconnect.
 */
export const LIVE_CONNECTION_MS = 30 * 60_000

/** Per caller, so one script cannot hold an instance's sockets open. */
export const LIVE_MAX_CONNECTIONS_PER_CALLER = 6
