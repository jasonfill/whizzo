// The live bus — see docs/realtime-spec.md §6.
//
// One interface, so the day `instance_count` in .do/app.yaml stops being 1 the
// change is an implementation of `LiveBus` backed by Postgres LISTEN/NOTIFY
// and nothing else moves. `pg` is already a dependency and the database is
// already there, so scaling out needs no new infrastructure — not Redis, not
// for this. (Two things to know when that day comes: a NOTIFY payload is
// capped at 8000 bytes, so publish identity and let each instance read the row
// if a payload ever grows; and the LISTEN connection must sit outside the
// pooled transaction path in db.ts.)
//
// Today the process is alone, so an in-memory fan-out is not a compromise —
// it is the correct implementation.

import type { LiveEvent } from '@whizzo/shared'

export type LiveListener = (event: LiveEvent) => void

export interface LiveBus {
  /**
   * Fan `event` out to everyone on `channel`.
   *
   * Never throws and never blocks: failing to notify a watcher must not fail a
   * child's write. Callers deliberately do not await this.
   */
  publish(channel: string, event: LiveEvent): void
  /** Returns the unsubscribe function. */
  subscribe(channel: string, listener: LiveListener): () => void
  /** How many connections are listening — what makes "emit only when watched" possible. */
  listenerCount(channel: string): number
}

export class InProcessBus implements LiveBus {
  private readonly channels = new Map<string, Set<LiveListener>>()

  publish(channel: string, event: LiveEvent): void {
    const listeners = this.channels.get(channel)
    if (!listeners?.size) return
    // A copy, because a listener may unsubscribe itself while being called —
    // a disconnected client does exactly that.
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (err) {
        console.error('[live] listener threw', err)
      }
    }
  }

  subscribe(channel: string, listener: LiveListener): () => void {
    let listeners = this.channels.get(channel)
    if (!listeners) {
      listeners = new Set()
      this.channels.set(channel, listeners)
    }
    listeners.add(listener)
    return () => {
      const set = this.channels.get(channel)
      if (!set) return
      set.delete(listener)
      // Drop the empty set rather than leaking a key per learner ever seen.
      if (!set.size) this.channels.delete(channel)
    }
  }

  listenerCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0
  }
}

export const bus: LiveBus = new InProcessBus()
