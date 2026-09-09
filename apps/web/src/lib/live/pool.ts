// One connection per learner per tab, shared by everyone who wants it.
//
// Before this, every consumer opened its own stream: the planner screen, the
// home screen's Today strip, and — once rounds emit — the round itself. Three
// sockets for one learner, against a server cap of six, and three copies of
// the same events. A page should hold one connection and fan it out.
//
// Keyed by learner rather than bound to "the active learner", because a grown-
// up watching one child while another is selected is exactly the case that
// motivated live rounds in the first place.

import type { LiveEvent, LiveWatcher } from '@whizzo/shared'
import { openLive, type LiveStatus } from './client'

export type LiveHandler = (event: LiveEvent) => void

export interface LiveSnapshot {
  status: LiveStatus
  watchers: LiveWatcher[]
}

interface Entry {
  /** How many consumers hold this connection. At zero it closes. */
  refs: number
  /**
   * How many of them want to be seen.
   *
   * Presence is a property of the connection, so crossing zero in either
   * direction reopens it. That is deliberate: a POST-based "I am here" would
   * outlive a crashed tab, which is the ghost-watcher bug all over again.
   */
  announces: number
  close: (() => void) | null
  handlers: Set<LiveHandler>
  resyncs: Set<() => void>
  snapshot: LiveSnapshot
  /** React store subscribers, notified when the snapshot is replaced. */
  listeners: Set<() => void>
}

/** Keyed by the channel's base path — `/live/learners/<id>`, or `/live/me`. */
const entries = new Map<string, Entry>()

const IDLE: LiveSnapshot = { status: 'connecting', watchers: [] }

function entryFor(path: string): Entry {
  let entry = entries.get(path)
  if (!entry) {
    entry = {
      refs: 0,
      announces: 0,
      close: null,
      handlers: new Set(),
      resyncs: new Set(),
      snapshot: IDLE,
      listeners: new Set(),
    }
    entries.set(path, entry)
  }
  return entry
}

function publish(entry: Entry, next: LiveSnapshot): void {
  entry.snapshot = next
  for (const listener of [...entry.listeners]) listener()
}

function connect(path: string, entry: Entry): void {
  entry.close?.()
  const announce = entry.announces > 0
  entry.close = openLive(`${path}${announce ? '?announce=1' : ''}`, {
    onEvent: (event) => {
      if (event.kind === 'watch.begin' || event.kind === 'watch.end') {
        const watchers = (event.payload as { watchers?: LiveWatcher[] }).watchers ?? []
        publish(entry, { ...entry.snapshot, watchers })
      }
      for (const handler of [...entry.handlers]) handler(event)
    },
    onStatus: (status) => publish(entry, { ...entry.snapshot, status }),
    onResync: () => {
      for (const resync of [...entry.resyncs]) resync()
    },
  })
}

/**
 * Take a reference on a learner's channel, opening it if nobody had it.
 *
 * Returns the release function. Handlers are held by identity, so a caller
 * passing a fresh closure each render must go through the hook rather than
 * this directly.
 */
export function acquire(
  path: string,
  options: { onEvent?: LiveHandler; onResync?: () => void; announce?: boolean } = {},
): () => void {
  const entry = entryFor(path)
  const wasAnnouncing = entry.announces > 0

  entry.refs += 1
  if (options.announce) entry.announces += 1
  if (options.onEvent) entry.handlers.add(options.onEvent)
  if (options.onResync) entry.resyncs.add(options.onResync)

  // Open on the first reference; reopen if this consumer changed whether the
  // connection announces.
  if (entry.refs === 1 || wasAnnouncing !== entry.announces > 0) connect(path, entry)

  let released = false
  return () => {
    if (released) return
    released = true
    const announcedBefore = entry.announces > 0
    entry.refs -= 1
    if (options.announce) entry.announces -= 1
    if (options.onEvent) entry.handlers.delete(options.onEvent)
    if (options.onResync) entry.resyncs.delete(options.onResync)

    if (entry.refs <= 0) {
      entry.close?.()
      entry.close = null
      // By identity, never by path alone. Teardown and setup for the same
      // channel interleave when one screen replaces another, and deleting
      // whatever happens to be at this key would evict the replacement's live
      // entry — leaving it connected but unreachable, so the next lookup opens
      // a second stream for the channel this pool exists to keep to one.
      if (entries.get(path) === entry) entries.delete(path)
      return
    }
    if (announcedBefore !== entry.announces > 0) connect(path, entry)
  }
}

export function snapshotOf(path: string | null): LiveSnapshot {
  if (!path) return IDLE
  return entries.get(path)?.snapshot ?? IDLE
}

export function subscribeToSnapshot(path: string | null, listener: () => void): () => void {
  if (!path) return () => {}
  const entry = entryFor(path)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    // An entry that only ever held a listener holds no connection; drop it
    // rather than leak a key per learner the page has ever shown. By identity,
    // for the same reason as above.
    if (!entry.refs && !entry.listeners.size && entries.get(path) === entry) {
      entries.delete(path)
    }
  }
}

/** Test seam. */
export function resetLivePool(): void {
  for (const entry of entries.values()) entry.close?.()
  entries.clear()
}
