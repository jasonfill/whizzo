// The fan-out, and the two ways it could leak: a channel that keeps listeners
// after they have gone, and a map that keeps a key per learner ever seen.

import { describe, expect, it, vi } from 'vitest'
import { InProcessBus } from './bus.js'
import type { LiveEvent } from '@whizzo/shared'

const event = (payload: unknown): LiveEvent => ({
  kind: 'planner.item',
  subjectId: 'l1',
  at: 1,
  actorId: null,
  actorName: null,
  originId: null,
  payload,
})

describe('InProcessBus', () => {
  it('delivers to everyone on the channel and nobody else', () => {
    const bus = new InProcessBus()
    const a = vi.fn()
    const b = vi.fn()
    const elsewhere = vi.fn()
    bus.subscribe('learner:1', a)
    bus.subscribe('learner:1', b)
    bus.subscribe('learner:2', elsewhere)

    bus.publish('learner:1', event({ n: 1 }))

    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
    expect(elsewhere).not.toHaveBeenCalled()
  })

  it('publishing into an empty channel is a no-op', () => {
    expect(() => new InProcessBus().publish('learner:nobody', event({}))).not.toThrow()
  })

  it('stops delivering once unsubscribed', () => {
    const bus = new InProcessBus()
    const listener = vi.fn()
    const off = bus.subscribe('learner:1', listener)
    off()
    bus.publish('learner:1', event({}))
    expect(listener).not.toHaveBeenCalled()
    expect(bus.listenerCount('learner:1')).toBe(0)
  })

  // A disconnecting client unsubscribes from inside its own listener, which
  // would otherwise mutate the set being iterated.
  it('survives a listener that unsubscribes itself mid-publish', () => {
    const bus = new InProcessBus()
    const after = vi.fn()
    const off = bus.subscribe('learner:1', () => off())
    bus.subscribe('learner:1', after)

    expect(() => bus.publish('learner:1', event({}))).not.toThrow()
    expect(after).toHaveBeenCalledOnce()
    expect(bus.listenerCount('learner:1')).toBe(1)
  })

  // One watcher's broken socket must not stop the next watcher being told.
  it('keeps going when a listener throws', () => {
    const bus = new InProcessBus()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    bus.subscribe('learner:1', () => {
      throw new Error('socket gone')
    })
    bus.subscribe('learner:1', after)

    expect(() => bus.publish('learner:1', event({}))).not.toThrow()
    expect(after).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  // Otherwise a long-running instance holds a key for every learner anyone has
  // ever opened.
  it('forgets a channel once the last listener leaves', () => {
    const bus = new InProcessBus()
    const off1 = bus.subscribe('learner:1', vi.fn())
    const off2 = bus.subscribe('learner:1', vi.fn())
    expect(bus.listenerCount('learner:1')).toBe(2)
    off1()
    off2()
    expect(bus.listenerCount('learner:1')).toBe(0)
    // Re-subscribing after the channel was dropped still works.
    bus.subscribe('learner:1', vi.fn())
    expect(bus.listenerCount('learner:1')).toBe(1)
  })
})
