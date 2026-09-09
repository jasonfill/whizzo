// Structural guarantees about the ten themes.
//
// Most of these are the kind of thing that is obviously true when the table is
// written and quietly stops being true when an eleventh theme is added. The
// screens assume every one of them, and mostly fail silently — a short `names`
// array renders a hole in the collection grid rather than throwing.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_ID,
  hexToRgbTriple,
  isThemeId,
  levelNameFor,
  placeholderStripe,
  progressLine,
  progressTitle,
  slotLabels,
  themeById,
  themesForGrade,
  THEMES,
  typingWorldFor,
} from './themes'
import { GRADES } from '../data/spelling'
import { WORLDS } from '../data/lessons'

describe('the set of themes', () => {
  it('has ten, with unique ids and names', () => {
    expect(THEMES).toHaveLength(10)
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(10)
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(10)
  })

  it('gives every theme a full set of copy strings', () => {
    for (const t of THEMES) {
      for (const key of [
        'verb',
        'unit',
        'unitOne',
        'worldNoun',
        'cheer',
        'cheerSub',
        'rewardTitle',
        'because',
        'bands',
      ] as const) {
        expect(t[key], `${t.id}.${key}`).toBeTruthy()
      }
    }
  })

  it('names one collectible per slot, with no gaps', () => {
    for (const t of THEMES) {
      const labels = slotLabels(t)
      expect(labels, t.id).toHaveLength(t.total)
      expect(labels.every((l) => l.length > 0), t.id).toBe(true)
      // A generated '#7' means the theme was short and the helper padded it.
      expect(labels.some((l) => /^#\d+$/.test(l)), `${t.id} was padded`).toBe(false)
    }
  })

  it('carries the shape-specific list its archetype needs', () => {
    for (const t of THEMES) {
      if (t.shape === 'collection') expect(t.names, t.id).toBeDefined()
      if (t.shape === 'journey') expect(t.stops, t.id).toBeDefined()
      if (t.shape === 'assembly') expect(t.parts, t.id).toBeDefined()
    }
  })

  it('names every rung of the spelling curriculum', () => {
    for (const t of THEMES) {
      expect(t.levels, t.id).toHaveLength(GRADES.length)
      expect(new Set(t.levels.map((l) => l.name)).size, t.id).toBe(GRADES.length)
      expect(t.levels.every((l) => l.name && l.emoji), t.id).toBe(true)
    }
  })

  it('names every typing world', () => {
    for (const t of THEMES) {
      expect(t.worlds, t.id).toHaveLength(WORLDS.length)
      expect(t.worlds.every((w) => w.name && w.emoji), t.id).toBe(true)
    }
  })

  it('states an accentRgb that agrees with its accent hex', () => {
    for (const t of THEMES) {
      expect(t.accentRgb, t.id).toBe(hexToRgbTriple(t.accent))
    }
  })
})

describe('themeById', () => {
  it('finds every real theme', () => {
    for (const t of THEMES) expect(themeById(t.id).id).toBe(t.id)
  })

  it('falls back rather than throwing on anything unknown', () => {
    // The stored value can be a stale id, a null column, or junk. None of
    // those should blank the app.
    for (const bad of ['unicorns', '', null, undefined, '../../etc']) {
      expect(themeById(bad).id).toBe(DEFAULT_THEME_ID)
    }
  })

  it('recognizes exactly the ten as valid ids', () => {
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true)
    for (const bad of ['unicorns', 1, null, {}]) expect(isThemeId(bad)).toBe(false)
  })
})

describe('grade bands are advisory, never a gate', () => {
  it('offers all ten at every grade', () => {
    for (const grade of [0, 2, 5, 8, 11, 12]) {
      expect(themesForGrade(grade)).toHaveLength(10)
    }
  })

  it('offers all ten when the grade is unknown', () => {
    expect(themesForGrade(null)).toHaveLength(10)
    expect(themesForGrade(undefined)).toHaveLength(10)
  })

  it('puts an in-band theme ahead of an out-of-band one', () => {
    // Dinosaurs is K-4 and Music is 4-12, so they should swap order between a
    // young learner and an older one.
    const young = themesForGrade(2).map((t) => t.id)
    const old = themesForGrade(11).map((t) => t.id)
    expect(young.indexOf('dinosaurs')).toBeLessThan(young.indexOf('music'))
    expect(old.indexOf('music')).toBeLessThan(old.indexOf('dinosaurs'))
  })

  it('keeps the declared order among themes that fit equally well', () => {
    // Cats and Dogs are both K-5; Cats is declared first and stays first.
    const ids = themesForGrade(3).map((t) => t.id)
    expect(ids.indexOf('cats')).toBeLessThan(ids.indexOf('dogs'))
  })
})

describe('copy that changes with the theme', () => {
  it('says "how far" for a journey and "next one" for the others', () => {
    for (const t of THEMES) {
      if (t.shape === 'journey') expect(progressTitle(t)).toBe('How far you have come')
      else expect(progressTitle(t)).toBe(`Next ${t.unitOne}`)
    }
  })

  it('always names the theme’s own noun in the progress line', () => {
    for (const t of THEMES) expect(progressLine(t)).toContain(t.unitOne)
  })

  it('always says practice does not earn one', () => {
    for (const t of THEMES) expect(progressLine(t)).toMatch(/practice/i)
  })

  it('names each spelling rung and typing world from the theme', () => {
    for (const t of THEMES) {
      GRADES.forEach((g, i) => expect(levelNameFor(t, i, g.grade).name).toBe(t.levels[i]!.name))
      WORLDS.forEach((_, i) => expect(typingWorldFor(t, i).name).toBe(t.worlds[i]!.name))
    }
  })

  it('falls back to a plain label rather than another world’s name', () => {
    const t = themeById('cats')
    expect(levelNameFor(t, 99, 9).name).toBe('Grade 9')
    expect(typingWorldFor(t, 99).name).toBe('World 100')
  })
})

describe('hexToRgbTriple', () => {
  it('converts six-digit hex', () => {
    expect(hexToRgbTriple('#7C5CFF')).toBe('124 92 255')
    expect(hexToRgbTriple('#000000')).toBe('0 0 0')
    expect(hexToRgbTriple('#FFFFFF')).toBe('255 255 255')
  })

  it('converts shorthand hex', () => {
    expect(hexToRgbTriple('#fff')).toBe('255 255 255')
    expect(hexToRgbTriple('#08f')).toBe('0 136 255')
  })

  it('works without the leading hash', () => {
    expect(hexToRgbTriple('7C5CFF')).toBe('124 92 255')
  })
})

describe('placeholderStripe', () => {
  it('uses both of the theme’s tints so art can be missing without a hole', () => {
    for (const t of THEMES) {
      const stripe = placeholderStripe(t)
      expect(stripe).toContain(t.tintA)
      expect(stripe).toContain(t.tintB)
    }
  })
})
