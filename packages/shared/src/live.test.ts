import { describe, expect, it } from 'vitest'
import { learnerChannel, parseChannel, userChannel } from './live.js'

describe('live channels', () => {
  it('round-trips a learner channel', () => {
    expect(parseChannel(learnerChannel('abc'))).toEqual({ family: 'learner', id: 'abc' })
  })

  it('round-trips a user channel', () => {
    expect(parseChannel(userChannel('u-1'))).toEqual({ family: 'user', id: 'u-1' })
  })

  // A family is an authorization rule, so an unknown one must not resolve to
  // something the subscribe route would then treat as gated.
  it('refuses a family nobody has written a gate for', () => {
    expect(parseChannel('household:1')).toBeNull()
  })

  it('refuses the malformed', () => {
    expect(parseChannel('learner:')).toBeNull()
    expect(parseChannel(':abc')).toBeNull()
    expect(parseChannel('learner')).toBeNull()
  })

  // Ids are uuids in practice, but a colon in one would silently re-point a
  // subscription at a different subject if the split were greedy.
  it('splits on the first colon only', () => {
    expect(parseChannel('learner:a:b')).toEqual({ family: 'learner', id: 'a:b' })
  })
})
