// What a route calls after it has written something.
//
// Deliberately fire-and-forget and deliberately impossible to get wrong in the
// direction that matters: nothing in here throws, so no route can fail a
// child's write because a watcher's socket had gone away. It is called after
// the transaction, never inside it — a rolled-back write must not have been
// announced.

import type { FastifyRequest } from 'fastify'
import { learnerChannel, ORIGIN_HEADER, userChannel, type LiveEvent, type LiveKind } from '@whizzo/shared'
import { bus } from './bus.js'

/**
 * The tab that made this request, if it said.
 *
 * Free-form and untrusted — it is only ever compared for equality against what
 * the same client sent, so a client that lies about it can confuse itself and
 * nobody else. Bounded and stripped of anything that would land oddly in JSON.
 */
export function originOf(request: FastifyRequest): string | null {
  const raw = request.headers[ORIGIN_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const clean = value.trim().slice(0, 64)
  return /^[A-Za-z0-9_-]+$/.test(clean) ? clean : null
}

interface PublishOptions {
  /** Overrides the caller — for the system closing a card, pass null explicitly. */
  actorId?: string | null
  actorName?: string | null
  originId?: string | null
}

function emit(channel: string, subjectId: string, kind: LiveKind, payload: unknown, o: PublishOptions): void {
  const event: LiveEvent = {
    kind,
    subjectId,
    at: Date.now(),
    actorId: o.actorId ?? null,
    actorName: o.actorName ?? null,
    originId: o.originId ?? null,
    payload,
  }
  try {
    bus.publish(channel, event)
  } catch (err) {
    console.error('[live] publish failed', err)
  }
}

/** Announce something about a learner to everyone watching that learner. */
export function publishLearner(
  request: FastifyRequest | null,
  learnerId: string,
  kind: LiveKind,
  payload: unknown,
  options: PublishOptions = {},
): void {
  emit(learnerChannel(learnerId), learnerId, kind, payload, {
    actorId: 'actorId' in options ? options.actorId : (request?.caller?.id ?? null),
    actorName: options.actorName ?? null,
    originId: 'originId' in options ? options.originId : (request ? originOf(request) : null),
  })
}

/** Announce something addressed to one grown-up. */
export function publishUser(
  request: FastifyRequest | null,
  userId: string,
  kind: LiveKind,
  payload: unknown,
  options: PublishOptions = {},
): void {
  emit(userChannel(userId), userId, kind, payload, {
    actorId: 'actorId' in options ? options.actorId : (request?.caller?.id ?? null),
    actorName: options.actorName ?? null,
    originId: 'originId' in options ? options.originId : (request ? originOf(request) : null),
  })
}

/** Is anyone watching this learner? What keeps an unwatched round free. */
export function watcherCount(learnerId: string): number {
  return bus.listenerCount(learnerChannel(learnerId))
}
