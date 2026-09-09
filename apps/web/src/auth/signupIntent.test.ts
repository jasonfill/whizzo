// What the app remembers between "I want an account" and coming back from the
// OAuth round trip.
//
// The age gate matters here: a learner under 13 cannot hold their own account,
// and this is the value that decides which flow they land in when they return.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ageFromBirthYear,
  clearSignupIntent,
  MIN_SIGNUP_AGE,
  readSignupIntent,
  rememberRefusal,
  saveSignupIntent,
  wasRefused,
} from './signupIntent'

beforeEach(() => {
  localStorage.clear()
})

describe('ageFromBirthYear', () => {
  it('counts whole years', () => {
    expect(ageFromBirthYear(2016, new Date('2026-06-01'))).toBe(10)
  })

  it('puts the gate at thirteen', () => {
    expect(MIN_SIGNUP_AGE).toBe(13)
    const now = new Date('2026-06-01')
    expect(ageFromBirthYear(2013, now)).toBeGreaterThanOrEqual(MIN_SIGNUP_AGE)
    expect(ageFromBirthYear(2014, now)).toBeLessThan(MIN_SIGNUP_AGE)
  })
})

describe('remembering an intent', () => {
  it('round-trips what was saved', () => {
    saveSignupIntent({ role: 'guardian' })
    expect(readSignupIntent()).toMatchObject({ role: 'guardian' })
  })

  it('reads nothing when nothing was saved', () => {
    expect(readSignupIntent()).toBeNull()
  })

  it('rejects a role that is not one of the three', () => {
    // The stored value survives a deploy and can be edited by hand; an
    // unrecognized role must not put somebody into a flow that does not exist.
    localStorage.setItem('cat-academy:signup-intent', JSON.stringify({ role: 'admin' }))
    expect(readSignupIntent()).toBeNull()
  })

  it('rejects corrupted storage rather than throwing', () => {
    localStorage.setItem('cat-academy:signup-intent', '{not json')
    expect(readSignupIntent()).toBeNull()
  })

  it('forgets on request', () => {
    saveSignupIntent({ role: 'learner' })
    clearSignupIntent()
    expect(readSignupIntent()).toBeNull()
  })

  it('accepts every role the app actually offers', () => {
    for (const role of ['guardian', 'tutor', 'learner'] as const) {
      saveSignupIntent({ role })
      expect(readSignupIntent()?.role).toBe(role)
    }
  })

  it('survives storage being unavailable', () => {
    // A private window throws. Not being able to remember the intent is a
    // worse experience, not a broken one.
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => saveSignupIntent({ role: 'guardian' })).not.toThrow()
    set.mockRestore()
  })
})

describe('remembering a refusal', () => {
  it('starts out having refused nothing', () => {
    expect(wasRefused()).toBe(false)
  })

  it('remembers that somebody declined to sign up', () => {
    // So the app stops asking, rather than nagging every visit.
    rememberRefusal()
    expect(wasRefused()).toBe(true)
  })

  it('survives storage being unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => rememberRefusal()).not.toThrow()
    spy.mockRestore()
  })
})
