// The text a learner is asked to type.
//
// One rule matters above the rest: a lesson may only use keys the learner has
// been taught. Asking for a key nobody has shown them yet turns a typing
// lesson into a hunt-and-peck exercise, and it is the kind of regression that
// looks fine on the screens you happen to open.

import { describe, expect, it } from 'vitest'
import { generateLessonText, generatePracticeText, rainWords } from './content'
import { CURRICULUM } from '../data/lessons'

function usesOnly(text: string, allowed: string[]): boolean {
  const set = new Set(allowed)
  return [...text.toLowerCase()].every((c) => set.has(c) || c === ' ' || c === '\n')
}

describe('generateLessonText', () => {
  it('produces text for every lesson in the curriculum', () => {
    for (const lesson of CURRICULUM) {
      const text = generateLessonText(lesson)
      expect(text.trim().length, lesson.id).toBeGreaterThan(0)
    }
  })

  it('never asks for a key the lesson has not taught', () => {
    for (const lesson of CURRICULUM) {
      const text = generateLessonText(lesson)
      expect(usesOnly(text, lesson.allowedKeys), `${lesson.id}: ${text.slice(0, 60)}`).toBe(true)
    }
  })

  it('gives the very first lesson something to type with two keys', () => {
    // The hardest case for the generator: home-fj has only f and j.
    const first = CURRICULUM[0]!
    const text = generateLessonText(first)
    expect(text.length).toBeGreaterThan(5)
    expect(usesOnly(text, first.allowedKeys)).toBe(true)
  })

  it('produces a different drill each time, so a lesson is not memorized', () => {
    const lesson = CURRICULUM[0]!
    const runs = new Set(Array.from({ length: 12 }, () => generateLessonText(lesson)))
    expect(runs.size).toBeGreaterThan(1)
  })
})

describe('generatePracticeText', () => {
  it('uses the whole bank when everything is unlocked', () => {
    const text = generatePracticeText('all', 20)
    expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThan(5)
  })

  it('respects a restricted key set', () => {
    const allowed = [...'asdfghjkl;']
    expect(usesOnly(generatePracticeText(allowed, 20), allowed)).toBe(true)
  })

  it('still produces something when almost nothing is unlocked', () => {
    // The fallback exists so a practice round is never blank.
    const text = generatePracticeText([...'fj'], 10)
    expect(text.trim().length).toBeGreaterThan(0)
  })
})

describe('rainWords', () => {
  it('returns the pool of words short enough to fall and be typed', () => {
    // `max` is the longest word, not how many — a long word cannot be finished
    // before it lands.
    const words = rainWords('all', 6)
    expect(words.length).toBeGreaterThan(10)
    expect(words.every((w) => w.length <= 6)).toBe(true)
  })

  it('excludes words too short to be a target', () => {
    expect(rainWords('all', 6).every((w) => w.length >= 2)).toBe(true)
  })

  it('keeps every word inside the allowed keys', () => {
    const allowed = [...'asdfghjkl;']
    for (const word of rainWords(allowed, 6)) {
      expect(usesOnly(word, allowed), word).toBe(true)
    }
  })

  it('never returns an empty word, which would be uncatchable', () => {
    for (const word of rainWords('all', 10)) {
      expect(word.trim().length).toBeGreaterThan(0)
    }
  })

  it('still fills the screen when the key set is tiny', () => {
    expect(rainWords([...'fj'], 6).length).toBeGreaterThan(0)
  })
})
