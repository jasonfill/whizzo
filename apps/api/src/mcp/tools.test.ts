// The tool surface's one backwards-compatibility promise.
//
// `start_round`'s mode was spelled the British way before the codebase moved to
// US spelling. An assistant holds the tool schema in its context from whenever
// it connected, so one that connected before the deploy will still send the old
// value — and the failure, if it were refused, would land in the middle of
// somebody's tutoring session.
//
// This file exists because that shim had no test, and a later spelling sweep
// converted the legacy string itself: the enum ended up with `practice` twice
// and a transform that could not fire, and the whole suite stayed green.

import { describe, expect, it } from 'vitest'
import { TUTOR_MODES } from '@whizzo/shared'
import { roundModeSchema } from './tools.js'

// Built the same way the shim builds it, so this test cannot be "fixed" into
// agreement by the same find-and-replace that would break the code.
const LEGACY = 'practi' + 'se'

describe('the round mode an assistant asks for', () => {
  it('accepts the current spelling', () => {
    expect(roundModeSchema.parse('practice')).toBe('practice')
  })

  it('still accepts the spelling it used to advertise', () => {
    expect(roundModeSchema.parse(LEGACY)).toBe('practice')
  })

  // The database only allows the current spelling, so normalizing on the way in
  // is what keeps the legacy value from reaching mcp_rounds_mode_check.
  it('normalizes the legacy value rather than passing it through', () => {
    expect(roundModeSchema.parse(LEGACY)).not.toBe(LEGACY)
  })

  it('leaves the other modes alone', () => {
    for (const mode of ['study', 'test', 'review'] as const) {
      expect(roundModeSchema.parse(mode)).toBe(mode)
    }
  })

  it('defaults to practice', () => {
    expect(roundModeSchema.parse(undefined)).toBe('practice')
  })

  it('refuses anything else', () => {
    expect(roundModeSchema.safeParse('practicing').success).toBe(false)
    expect(roundModeSchema.safeParse('').success).toBe(false)
  })

  // Deprecated means still accepted, not still offered.
  it('does not advertise the legacy value', () => {
    expect(TUTOR_MODES).not.toContain(LEGACY)
    expect(TUTOR_MODES).toContain('practice')
  })
})
