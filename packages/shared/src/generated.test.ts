// Content that is a rule, not a list.
//
// Nobody is ever going to paste four hundred multiplication facts, so asking
// them to is asking them not to bother. Two things are worth pinning: ids have
// to be stable, because a learner's mastery hangs off them, and difficulty has
// to reflect how children actually experience the facts.

import { describe, expect, it } from 'vitest'
import {
  FACT_BANKS,
  factDeck,
  factDeckId,
  factDifficulty,
  generateFacts,
  generatedDecks,
} from './generated.js'

describe('the facts themselves', () => {
  it('generates every combination in the range', () => {
    expect(generateFacts({ op: 'multiply', min: 0, max: 10 })).toHaveLength(121)
  })

  it('gets the arithmetic right', () => {
    const cards = generateFacts({ op: 'multiply', min: 0, max: 10 })
    expect(cards.find((c) => c.id === 'multiply-7-8')?.definition).toBe('56')
    expect(cards.find((c) => c.id === 'multiply-0-9')?.definition).toBe('0')
  })

  it('never asks a subtraction that goes below zero', () => {
    // Negatives are a different topic, and meeting one by accident at seven is
    // a bad way to meet it.
    for (const card of generateFacts({ op: 'subtract', min: 0, max: 10 })) {
      expect(Number(card.definition), card.term).toBeGreaterThanOrEqual(0)
    }
  })

  it('never asks a division that does not come out whole', () => {
    // There is no point asking a seven-year-old 7 ÷ 3.
    for (const card of generateFacts({ op: 'divide', min: 1, max: 10 })) {
      expect(Number.isInteger(Number(card.definition)), card.term).toBe(true)
    }
  })

  it('never divides by zero, whatever range it is handed', () => {
    const cards = generateFacts({ op: 'divide', min: 0, max: 5 })
    expect(cards.every((c) => !/÷ 0$/.test(c.term))).toBe(true)
    expect(cards.every((c) => Number.isFinite(Number(c.definition)))).toBe(true)
  })

  it('does not ask the same fact twice in one bank', () => {
    const cards = generateFacts({ op: 'add', min: 0, max: 10 })
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
  })

  it('grades the answers as numbers, not as words', () => {
    // Edit distance on a number is nonsense: a transposition is a wrong answer.
    for (const card of generateFacts({ op: 'add', min: 0, max: 3 })) {
      expect(card.answerKind).toBe('numeric')
    }
  })

  it('copes with a range given backwards', () => {
    expect(generateFacts({ op: 'add', min: 10, max: 0 })).toHaveLength(121)
  })
})

describe('ids are stable, because mastery hangs off them', () => {
  it('names a card after the fact it is', () => {
    // A random id on every page load would hand every learner a blank slate.
    expect(generateFacts({ op: 'multiply', min: 7, max: 7 })[0]!.id).toBe('multiply-7-7')
  })

  it('gives the same bank the same id every time', () => {
    expect(factDeckId({ op: 'multiply', min: 0, max: 12 })).toBe('gen-math-multiply-0-12')
  })

  it('produces an identical deck on a second call', () => {
    const spec = { op: 'multiply' as const, min: 0, max: 5 }
    expect(factDeck(spec).cards.map((c) => c.id)).toEqual(factDeck(spec).cards.map((c) => c.id))
  })
})

describe('difficulty, as children actually meet it', () => {
  it('knows the times tables are not uniformly hard', () => {
    // 7×8 is famously the last one anybody learns; 2×anything is nearly free.
    expect(factDifficulty('multiply', 7, 8)).toBeGreaterThan(factDifficulty('multiply', 2, 8))
  })

  it('treats the ones with a rule as easier than the ones you must recall', () => {
    for (const n of [0, 1, 2, 5, 10]) {
      expect(factDifficulty('multiply', n, 7), `${n}x7`).toBeLessThan(
        factDifficulty('multiply', 7, 8),
      )
    }
  })

  it('knows carrying is what makes an addition hard, not the size', () => {
    expect(factDifficulty('add', 7, 8)).toBeGreaterThan(factDifficulty('add', 7, 2))
  })

  it('knows borrowing is what makes a subtraction hard', () => {
    expect(factDifficulty('subtract', 13, 7)).toBeGreaterThan(factDifficulty('subtract', 17, 3))
  })

  it('stays on the same 1-5 scale as every other card in the app', () => {
    for (const spec of FACT_BANKS) {
      for (const card of generateFacts(spec)) {
        expect(card.difficulty, card.term).toBeGreaterThanOrEqual(1)
        expect(card.difficulty, card.term).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('the banks offered out of the box', () => {
  it('files them all under math facts, which is a skill track', () => {
    for (const deck of generatedDecks()) {
      expect(deck.track, deck.title).toBe('math.facts')
    }
  })

  it('names each one so a parent knows what it is', () => {
    const titles = generatedDecks().map((d) => d.title)
    expect(titles).toContain('Multiplication to 12')
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('gives every bank a distinct id', () => {
    const ids = generatedDecks().map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('needs no importer, no enrichment and no adult', () => {
    // The whole point: this is content that exists because it is a rule.
    for (const deck of generatedDecks()) {
      expect(deck.cards.length, deck.title).toBeGreaterThan(50)
    }
  })
})
