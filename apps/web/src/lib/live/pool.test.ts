// The pool's job is one connection per channel per tab. These cover the ways
// it could quietly end up with two.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquire, resetLivePool, snapshotOf, subscribeToSnapshot } from './pool'

const opened = vi.hoisted(() => ({ paths: [] as string[], closed: [] as string[] }))
vi.mock('./client', () => ({
  openLive: (path: string) => {
    opened.paths.push(path)
    return () => opened.closed.push(path)
  },
}))

afterEach(() => {
  resetLivePool()
  opened.paths = []
  opened.closed = []
})

describe('the connection pool', () => {
  it('opens once for many consumers and closes when the last one goes', () => {
    const a = acquire('/live/learners/l1')
    const b = acquire('/live/learners/l1')
    expect(opened.paths).toEqual(['/live/learners/l1'])

    a()
    expect(opened.closed).toEqual([])
    b()
    expect(opened.closed).toEqual(['/live/learners/l1'])
  })

  it('reopens when presence is added or taken away', () => {
    const silent = acquire('/live/learners/l1')
    const seen = acquire('/live/learners/l1', { announce: true })
    expect(opened.paths).toEqual(['/live/learners/l1', '/live/learners/l1?announce=1'])

    seen()
    expect(opened.paths.at(-1)).toBe('/live/learners/l1')
    silent()
  })

  it('releasing twice is not counted twice', () => {
    const a = acquire('/live/learners/l1')
    const b = acquire('/live/learners/l1')
    a()
    a()
    expect(opened.closed).toEqual([])
    b()
    expect(opened.closed).toEqual(['/live/learners/l1'])
  })

  // The interleaving that happens when one screen replaces another on the same
  // channel: the replacement is already in place when the old one's store
  // subscription finally tears down. Deleting by path alone would evict the
  // live entry, and the next lookup would open a second stream.
  it('a late teardown does not evict the entry that replaced it', () => {
    const stale = subscribeToSnapshot('/live/learners/l1', () => {})
    const first = acquire('/live/learners/l1')
    first()

    // The replacement screen takes the channel.
    const second = acquire('/live/learners/l1', { announce: true })
    expect(opened.paths).toEqual(['/live/learners/l1', '/live/learners/l1?announce=1'])

    // Now the old subscription unwinds.
    stale()

    // Still one live entry: asking again must not open a third stream.
    const third = acquire('/live/learners/l1', { announce: true })
    expect(opened.paths).toHaveLength(2)

    third()
    second()
  })

  it('reports an idle snapshot for a channel nobody holds', () => {
    expect(snapshotOf('/live/learners/nobody')).toMatchObject({ status: 'connecting', watchers: [] })
    // Referentially stable, because useSyncExternalStore compares by identity.
    expect(snapshotOf(null)).toBe(snapshotOf('/live/learners/nobody'))
  })
})
