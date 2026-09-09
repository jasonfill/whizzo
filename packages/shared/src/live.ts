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
  | 'round.draft'
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

/**
 * A round, as somebody else's screen sees it.
 *
 * The point of these is co-presence, not oversight: two people working through
 * the same set without huddling round one screen. That decides what they carry.
 * The *question* travels, because a grown-up who cannot see the card cannot
 * talk about it. What does not travel is a running commentary on how the
 * learner is doing — there is no keystroke feed and no hesitation timing, and
 * a half-made multiple-choice decision is nobody's business until it is made.
 *
 * None of it is stored. The round's real record is still written once, at the
 * end, and these are gone the moment they are delivered.
 */
export interface RoundBeginPayload {
  /** Distinguishes one round from the next on the same channel. */
  roundId: string
  /** `flashcards`, `choice`, `listen-spell` … the activity registry's id. */
  activity: string
  subject: string
  /** The deck or list, as the learner sees it named. */
  title: string
  cards: number
}

export interface RoundTickPayload {
  roundId: string
  /** 1-based, and counts sightings — a requeued card is seen twice. */
  at: number
  cards: number
  /** The card as the learner sees it, so the watcher's screen mirrors theirs. */
  prompt: string
  /**
   * Filled in only once the card is answered. A card in progress carries a
   * null outcome, which is how a watcher knows to show it as still open.
   */
  outcome: 'right' | 'close' | 'wrong' | null
  /** The answer, revealed to the watcher only once the learner has answered. */
  answer: string | null
  /**
   * True when the learner marked their own work — flashcards, and only
   * flashcards. Worth showing: it is the difference between "got it right" and
   * "said they got it right".
   */
  selfGraded: boolean
  responseMs: number | null
}

/**
 * What is in the answer box, sent when typing pauses.
 *
 * Never per keystroke: a pause is the point at which a person is thinking and
 * a grown-up might usefully say something, and it is also the difference
 * between a handful of messages a card and a hundred.
 */
export interface RoundDraftPayload {
  roundId: string
  at: number
  text: string
}

export interface RoundEndPayload {
  roundId: string
  cards: number
  correct: number
}

/** Typing is considered paused after this long, and a draft goes out. */
export const DRAFT_IDLE_MS = 700

/** And never more often than this, however stop-start the typing. */
export const DRAFT_MIN_GAP_MS = 500

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
