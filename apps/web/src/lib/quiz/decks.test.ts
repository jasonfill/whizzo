// Decks, and the paste box that fills them.
//
// The import is deliberately forgiving — the common case is a teacher pasting
// a table out of a document, and rejecting the whole paste because line 12 is
// malformed helps nobody. What matters is that a bad row comes back in
// `skipped` rather than being silently welded onto its neighbour, because a
// card invented that way is wrong in a way nobody will notice.

import { describe, expect, it } from 'vitest'
import {
  emptyDeck,
  estimateDifficulty,
  makeCard,
  MAX_CARDS_PER_DECK,
  newId,
  normalizeDeck,
  parseImport,
  serializeCards,
  copyDeck,
  isDraftDeck,
} from './decks'
import type { QuizDeck } from '../progress/types'
import { findFigure } from '../rich/figures'

describe('newId', () => {
  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('d')))
    expect(ids.size).toBe(500)
  })

  it('is a uuid where the platform has one', () => {
    // The prefix is only used by the fallback, for the rare environment with
    // no crypto.randomUUID.
    expect(newId('deck')).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('falls back to a prefixed id where it does not', () => {
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    try {
      expect(newId('deck')).toMatch(/^deck-/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
    }
  })
})

describe('makeCard', () => {
  it('keeps the term and definition and gives the card an id', () => {
    const card = makeCard('Paris', 'Capital of France')
    expect(card).toMatchObject({ term: 'Paris', definition: 'Capital of France' })
    expect(card.id).toBeTruthy()
  })

  it('estimates a difficulty on the shared scale', () => {
    const card = makeCard('a', 'b')
    expect(card.difficulty).toBeGreaterThan(0)
    expect(card.difficulty).toBeLessThanOrEqual(12)
  })
})

describe('estimateDifficulty', () => {
  it('rates a longer, wordier card harder than a short one', () => {
    expect(estimateDifficulty('mitochondrion', 'the powerhouse of the cell')).toBeGreaterThan(
      estimateDifficulty('cat', 'a pet'),
    )
  })

  it('stays on the 0-12 scale even for absurd input', () => {
    const d = estimateDifficulty('x'.repeat(500), 'y '.repeat(500))
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(12)
  })
})

describe('normalizeDeck', () => {
  function deck(over: Partial<QuizDeck> = {}): QuizDeck {
    return { ...emptyDeck(), title: 'Deck', ...over } as QuizDeck
  }

  it('drops cards with nothing on one side', () => {
    const cleaned = normalizeDeck(
      deck({ cards: [makeCard('a', 'b'), makeCard('', 'b'), makeCard('c', '')] }),
    )
    expect(cleaned.cards).toHaveLength(1)
  })

  it('caps a deck at the maximum rather than storing it unbounded', () => {
    const many = Array.from({ length: MAX_CARDS_PER_DECK + 50 }, (_, i) =>
      makeCard(`t${i}`, `d${i}`),
    )
    expect(normalizeDeck(deck({ cards: many })).cards).toHaveLength(MAX_CARDS_PER_DECK)
  })

  it('gives an untitled deck a title rather than leaving it blank', () => {
    expect(normalizeDeck(deck({ title: '   ' })).title).toBeTruthy()
  })
})

describe('isDraftDeck', () => {
  const base = { ...emptyDeck(), title: 'T' }

  it('is null and only null — absent is not a draft', () => {
    // A starter, a deck kept offline, and a deck saved before the field
    // existed all have no value; none of them was ever unreviewed.
    expect(isDraftDeck({ ...base, acceptedAt: null })).toBe(true)
    expect(isDraftDeck({ ...base, acceptedAt: 1 })).toBe(false)
    expect(isDraftDeck(base)).toBe(false)
  })
})

describe('copyDeck', () => {
  it('produces a new deck with new card ids', () => {
    const original = normalizeDeck({
      ...emptyDeck(),
      title: 'Original',
      cards: [makeCard('a', 'b')],
    } as QuizDeck)
    const copy = copyDeck(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.cards[0]!.id).not.toBe(original.cards[0]!.id)
    expect(copy.cards[0]!.term).toBe('a')
  })
})

describe('parseImport', () => {
  it('reads a tab-separated paste', () => {
    const { cards } = parseImport('Paris\tFrance\nRome\tItaly')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ term: 'Paris', definition: 'France' })
  })

  it('reads a comma-separated paste', () => {
    const { cards } = parseImport('Paris, France\nRome, Italy')
    expect(cards).toHaveLength(2)
    expect(cards[1]).toMatchObject({ term: 'Rome', definition: 'Italy' })
  })

  it('keeps a separator that appears inside the definition', () => {
    // "Rome, Italy, and its ruins" must not become three fields.
    const { cards } = parseImport('Rome, Italy, and its ruins')
    expect(cards[0]!.definition).toBe('Italy, and its ruins')
  })

  it('reports a malformed row rather than dropping it silently', () => {
    const { cards, skipped } = parseImport('Paris\tFrance\nnonsense-with-no-separator')
    expect(cards).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('nonsense')
  })

  it('reads a multi-line layout where blank lines separate cards', () => {
    const text = 'Paris\tThe capital of France,\nand its largest city\n\nRome\tItaly'
    const { cards } = parseImport(text)
    expect(cards).toHaveLength(2)
    expect(cards[0]!.definition).toContain('largest city')
  })

  it('does not weld a bad row onto the card below it', () => {
    // The failure this guards: treating a stray blank line as a multi-line
    // layout hides the malformed row by absorbing it, which looks like a
    // cleaner import precisely because it invented a card.
    const text = 'Paris\tFrance\n\nnonsense\n\nRome\tItaly'
    const { cards, skipped } = parseImport(text)
    expect(cards.map((c) => c.term)).toEqual(['Paris', 'Rome'])
    expect(skipped).toContain('nonsense')
  })

  it('returns nothing for an empty paste rather than one blank card', () => {
    expect(parseImport('')).toMatchObject({ cards: [], skipped: [] })
    expect(parseImport('   \n\n  ').cards).toHaveLength(0)
  })

  it('copes with Windows line endings', () => {
    const { cards } = parseImport('Paris\tFrance\r\nRome\tItaly')
    expect(cards).toHaveLength(2)
  })

  it('honors an explicit separator over the detected one', () => {
    const { cards } = parseImport('a,b\tc', { between: 'comma' })
    expect(cards[0]).toMatchObject({ term: 'a' })
  })
})

describe('serializeCards', () => {
  it('round-trips through parseImport', () => {
    const original = [makeCard('Paris', 'France'), makeCard('Rome', 'Italy')]
    const { cards } = parseImport(serializeCards(original))
    expect(cards.map((c) => [c.term, c.definition])).toEqual([
      ['Paris', 'France'],
      ['Rome', 'Italy'],
    ])
  })
})

describe('importing cards that carry math and figures', () => {
  // A figure is JSON inside the card text, and JSON is built out of exactly the
  // characters the importer splits on. Getting this wrong does not mangle one
  // row — it picks the wrong separator for the whole paste and every row,
  // figure or not, comes back unparseable.
  const rows = [
    'Find the area [[figure {"kind":"rect","width":"8 m","height":"5 m"}]], 40 square meters',
    'Biggest? [[figure {"kind":"bar","data":[{"label":"a","value":1},{"label":"b","value":2}]}]], b',
    'Area of a 3 by 4 rectangle, 12',
  ].join('\n')

  it('works out the separator from the prose, not from the figure JSON', () => {
    expect(parseImport(rows).separator).toBe('comma')
  })

  it('imports every row, with the figures still whole', () => {
    const result = parseImport(rows)
    expect(result.skipped).toEqual([])
    expect(result.cards.map((c) => c.definition)).toEqual(['40 square meters', 'b', '12'])
    expect(result.cards[0].term.endsWith(']]')).toBe(true)
    const figure = findFigure(result.cards[0].term)
    expect(JSON.parse(figure!.json).width).toBe('8 m')
  })

  it('does not cut a row in half inside an equation', () => {
    const result = parseImport('Simplify $f(x, y)$, the function', { between: 'comma' })
    expect(result.cards[0].term).toBe('Simplify $f(x, y)$')
    expect(result.cards[0].definition).toBe('the function')
  })

  it('rates a card by what it says, not by how long its figure JSON is', () => {
    const figure =
      '[[figure {"kind":"bar","data":[{"label":"Mon","value":4},{"label":"Tue","value":7}]}]]'
    // Hundreds of characters of JSON, two words of answer.
    expect(estimateDifficulty('Which day?', figure)).toBeLessThan(
      estimateDifficulty('Which day?', 'a very long spoken answer that runs on and on and on'),
    )
  })
})

// The fields that let one pasted list be practiced many ways. A normalize
// must not quietly lose them — editing a deck would otherwise cost the
// learner every activity the enrichment had unlocked.
describe('enrichment survives a normalize', () => {
  function deckWith(card: Partial<QuizDeck['cards'][number]>): QuizDeck {
    return {
      ...emptyDeck(),
      title: 'Cells',
      cards: [{ ...makeCard('mitochondrion', 'powerhouse of the cell'), ...card }],
    }
  }

  it('keeps every field it was given', () => {
    const [card] = normalizeDeck(
      deckWith({
        category: 'organelles',
        example: 'The mitochondrion makes ATP.',
        order: 2,
        answerKind: 'text',
        altAnswers: ['mitochondria'],
        explanation: 'It releases energy from glucose.',
        sourcePages: [4],
        generated: ['example'],
      }),
    ).cards
    expect(card).toMatchObject({
      category: 'organelles',
      example: 'The mitochondrion makes ATP.',
      order: 2,
      altAnswers: ['mitochondria'],
      explanation: 'It releases energy from glucose.',
      sourcePages: [4],
      generated: ['example'],
    })
  })

  it('turns a blank category into nothing, so Sort is not offered an empty bucket', () => {
    const [card] = normalizeDeck(deckWith({ category: '   ', example: '  ' })).cards
    expect(card.category).toBeNull()
    expect(card.example).toBeNull()
  })

  it('trims a category rather than treating two spellings as two buckets', () => {
    const [card] = normalizeDeck(deckWith({ category: '  organelles ' })).cards
    expect(card.category).toBe('organelles')
  })

  it('leaves a plain card with no enrichment at all', () => {
    const [card] = normalizeDeck(deckWith({})).cards
    expect(card.category).toBeNull()
    expect(card.example).toBeNull()
  })
})
