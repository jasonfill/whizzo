// Ordering a track.
//
// The graph is the part that goes wrong in ways nobody notices until a learner
// is stuck — a loop of prerequisites, or a track where every unit needs another
// one. That is why the validator exists and why it belongs in `npm test`.

import { describe, expect, it } from 'vitest'
import { availableUnits, suggestedOrder, validateCatalog, type Unit } from './units.js'

const unit = (id: string, requires: string[] = [], trackId = 'life.money'): Unit => ({
  id,
  trackId,
  title: id,
  requires,
})

/** Interest before compound interest before debt; insurance off to one side. */
const MONEY: Unit[] = [
  unit('interest'),
  unit('compound', ['interest']),
  unit('debt', ['compound']),
  unit('insurance'),
]

describe('a catalog that is sound', () => {
  it('has nothing to report', () => {
    expect(validateCatalog(MONEY)).toEqual([])
  })

  it('is fine with an empty one', () => {
    expect(validateCatalog([])).toEqual([])
  })
})

describe('what the validator catches', () => {
  it('a prerequisite that does not exist', () => {
    const problems = validateCatalog([unit('a', ['ghost'])])
    expect(problems[0]!.problem).toMatch(/does not exist/)
  })

  it('a prerequisite in another track, which nobody here will ever meet', () => {
    const problems = validateCatalog([
      unit('a', ['elsewhere']),
      unit('elsewhere', [], 'science.biology'),
    ])
    expect(problems.some((p) => /different track/.test(p.problem))).toBe(true)
  })

  it('a unit that requires itself', () => {
    expect(validateCatalog([unit('a', ['a'])]).some((p) => /require itself/.test(p.problem))).toBe(
      true,
    )
  })

  it('a loop, and names everything caught in it', () => {
    // Nothing in a loop can ever start, and a learner would simply find the
    // track empty forever.
    const problems = validateCatalog([unit('a', ['c']), unit('b', ['a']), unit('c', ['b'])])
    const looped = problems.filter((p) => /loop/.test(p.problem)).map((p) => p.unitId)
    expect(new Set(looped)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('a track nobody can begin', () => {
    const problems = validateCatalog([unit('a', ['b']), unit('b', ['a'])])
    expect(problems.some((p) => /can be started/.test(p.problem))).toBe(true)
  })

  it('two units sharing an id', () => {
    expect(validateCatalog([unit('a'), unit('a')]).some((p) => /share this id/.test(p.problem))).toBe(
      true,
    )
  })

  it('a unit with no title to offer', () => {
    const nameless = { ...unit('a'), title: '  ' }
    expect(validateCatalog([nameless]).some((p) => /no title/.test(p.problem))).toBe(true)
  })

  it('reports everything at once, not one thing at a time', () => {
    // Somebody fixing a catalog wants the list.
    const problems = validateCatalog([unit('a', ['ghost']), { ...unit('b'), title: '' }])
    expect(problems.length).toBeGreaterThanOrEqual(2)
  })
})

describe('what a learner may start', () => {
  it('offers the units with nothing standing in front of them', () => {
    expect(availableUnits(MONEY, new Set()).map((u) => u.id)).toEqual(['interest', 'insurance'])
  })

  it('opens the next one as each is mastered', () => {
    expect(availableUnits(MONEY, new Set(['interest'])).map((u) => u.id)).toContain('compound')
  })

  it('does not offer back what has been mastered', () => {
    expect(availableUnits(MONEY, new Set(['interest'])).map((u) => u.id)).not.toContain('interest')
  })

  it('needs every prerequisite, not just one', () => {
    const both = [unit('a'), unit('b'), unit('c', ['a', 'b'])]
    expect(availableUnits(both, new Set(['a'])).map((u) => u.id)).not.toContain('c')
    expect(availableUnits(both, new Set(['a', 'b'])).map((u) => u.id)).toContain('c')
  })

  it('offers nothing once everything is done', () => {
    expect(availableUnits(MONEY, new Set(MONEY.map((u) => u.id)))).toEqual([])
  })
})

describe('a sensible order to work through', () => {
  it('puts what has to come first, first', () => {
    const order = suggestedOrder(MONEY).map((u) => u.id)
    expect(order.indexOf('interest')).toBeLessThan(order.indexOf('compound'))
    expect(order.indexOf('compound')).toBeLessThan(order.indexOf('debt'))
  })

  it('includes every unit exactly once', () => {
    const order = suggestedOrder(MONEY)
    expect(order).toHaveLength(MONEY.length)
    expect(new Set(order.map((u) => u.id)).size).toBe(MONEY.length)
  })

  it('keeps the author\'s sequencing where nothing forces an order', () => {
    // A sort that reshuffled independent units would throw away real judgement.
    const flat = [unit('c'), unit('a'), unit('b')]
    expect(suggestedOrder(flat).map((u) => u.id)).toEqual(['c', 'a', 'b'])
  })

  it('terminates on a catalog that has a loop in it', () => {
    // The validator reports the loop; this must not hang while it is being
    // fixed.
    const looped = [unit('a', ['b']), unit('b', ['a'])]
    expect(suggestedOrder(looped)).toHaveLength(2)
  })
})
