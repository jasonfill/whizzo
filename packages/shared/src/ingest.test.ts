// Landing generated content.
//
// Every test here is about the same thing: a model wrote this and a child will
// read it. Validation is total, and anything dropped is *counted*, because
// silence about dropped content is how a parent ends up with a deck missing
// the word the test is on.

import { describe, expect, it } from 'vitest'
import {
  isNumericAnswer,
  landingSummary,
  MAX_CARDS_PER_SET,
  validateGeneratedCards,
  type RawGeneratedCard,
} from './ingest.js'
import type { QuizCard } from './progress.js'

let n = 0
const makeCard = (term: string, definition: string): QuizCard => ({
  id: `ours-${n++}`,
  term,
  definition,
  hint: null,
  difficulty: 2,
})

function landed(raw: RawGeneratedCard[]) {
  n = 0
  return validateGeneratedCards(raw, makeCard)
}

const ok = { term: 'What is the powerhouse of the cell?', definition: 'The mitochondrion' }

describe('what gets through', () => {
  it('keeps a well-formed card', () => {
    const { cards, dropped } = landed([ok])
    expect(cards).toHaveLength(1)
    expect(dropped).toEqual([])
  })

  it('gives every card an id of ours', () => {
    // A model does not get to pick the key a learner's mastery is stored
    // against.
    expect(landed([ok]).cards[0].id).toMatch(/^ours-/)
  })

  it('carries the enrichment through', () => {
    const [card] = landed([
      { ...ok, category: 'organelles', example: 'It makes ATP.', explanation: 'It releases energy.' },
    ]).cards
    expect(card).toMatchObject({
      category: 'organelles',
      example: 'It makes ATP.',
      explanation: 'It releases energy.',
    })
  })

  it('marks everything a model wrote as generated', () => {
    const [card] = landed([{ ...ok, category: 'organelles' }]).cards
    expect(card.generated).toEqual(expect.arrayContaining(['term', 'definition', 'category']))
  })

  it('accepts math and figures written in the grammar', () => {
    const { cards, dropped } = landed([
      { term: 'What is $\\frac{3}{4}$ as a decimal?', definition: '0.75' },
      {
        term: 'Which day sold most? [[figure {"kind":"bar","data":[{"label":"Mon","value":4}]}]]',
        definition: 'Monday',
      },
    ])
    expect(cards).toHaveLength(2)
    expect(dropped).toEqual([])
  })
})

describe('what gets dropped, and why', () => {
  it('refuses a card with no answer', () => {
    const { cards, dropped } = landed([{ term: 'Something', definition: '' }])
    expect(cards).toEqual([])
    expect(dropped[0].reason).toMatch(/question and an answer/)
  })

  it('refuses a card with no question', () => {
    expect(landed([{ term: '', definition: 'An answer' }]).dropped).toHaveLength(1)
  })

  it('refuses a figure that does not parse, rather than letting it into a quiz', () => {
    const { cards, dropped } = landed([
      { term: 'Read the chart [[figure {"kind":"nonsense"}]]', definition: 'Monday' },
    ])
    expect(cards).toEqual([])
    expect(dropped).toHaveLength(1)
  })

  it('refuses broken JSON in a figure', () => {
    expect(
      landed([{ term: 'Look [[figure {not json}]]', definition: 'x' }]).dropped,
    ).toHaveLength(1)
  })

  it('keeps the first of two cards that ask the same thing', () => {
    const { cards, dropped } = landed([ok, { ...ok, definition: 'Something else' }])
    expect(cards).toHaveLength(1)
    expect(cards[0].definition).toBe('The mitochondrion')
    expect(dropped[0].reason).toMatch(/already asks/)
  })

  it('treats two spellings of the same question as one card', () => {
    // Compared on the readable projection, so notation does not create a
    // duplicate the learner would meet twice.
    const { cards } = landed([
      { term: 'What is  $\\frac{1}{2}$?', definition: 'a half' },
      { term: 'What is $\\frac{1}{2}$ ?', definition: 'one half' },
    ])
    expect(cards).toHaveLength(1)
  })

  it('stops at the set ceiling and says how many it turned away', () => {
    const many = Array.from({ length: MAX_CARDS_PER_SET + 5 }, (_, i) => ({
      term: `Question ${i}`,
      definition: `Answer ${i}`,
    }))
    const { cards, dropped } = landed(many)
    expect(cards).toHaveLength(MAX_CARDS_PER_SET)
    expect(dropped).toHaveLength(5)
  })

  it('reports every drop rather than quietly discarding it', () => {
    const { dropped } = landed([ok, { term: 'x', definition: '' }, { term: '', definition: 'y' }])
    expect(dropped).toHaveLength(2)
    for (const d of dropped) expect(d.reason.length).toBeGreaterThan(8)
  })
})

describe('what gets corrected rather than refused', () => {
  it('downgrades a numeric claim the answer cannot support', () => {
    // The card is fine; the label was wrong. Grading it as text is the safe
    // reading, and refusing it would lose a good card over a bad annotation.
    const [card] = landed([
      { term: 'Who discovered it?', definition: 'Ada Lovelace', answerKind: 'numeric' },
    ]).cards
    expect(card.answerKind).toBeUndefined()
  })

  it('keeps a numeric claim the answer does support', () => {
    const [card] = landed([
      { term: 'How many?', definition: '42', answerKind: 'numeric', tolerance: 0.5 },
    ]).cards
    expect(card).toMatchObject({ answerKind: 'numeric', tolerance: 0.5 })
  })

  it('never accepts a negative tolerance, which would accept nothing', () => {
    const [card] = landed([
      { term: 'How many?', definition: '42', answerKind: 'numeric', tolerance: -3 },
    ]).cards
    expect(card.tolerance).toBe(3)
  })

  it('drops blank alternatives rather than offering empty answers', () => {
    const [card] = landed([{ ...ok, altAnswers: ['mitochondria', '', '   '] }]).cards
    expect(card.altAnswers).toEqual(['mitochondria'])
  })

  it('keeps the pages a card came from, and refuses nonsense ones', () => {
    const [card] = landed([{ ...ok, sourcePages: [4, 5, -1, 2.5, 'six'] }]).cards
    expect(card.sourcePages).toEqual([4, 5])
  })

  it('ignores a field of the wrong type instead of throwing', () => {
    const [card] = landed([{ ...ok, category: 42, example: null, altAnswers: 'nope' }]).cards
    expect(card.category).toBeUndefined()
    expect(card.altAnswers).toBeUndefined()
  })
})

describe('recognizing a number', () => {
  it('accepts the shapes a math answer actually takes', () => {
    for (const value of ['42', '-7', '0.75', '3/4', '45°', '50%', '12 cm', '$\\frac{3}{4}$']) {
      expect(isNumericAnswer(value), value).toBe(true)
    }
  })

  it('refuses prose', () => {
    for (const value of ['Ada Lovelace', '', 'about forty', 'the mitochondrion']) {
      expect(isNumericAnswer(value), value).toBe(false)
    }
  })
})

describe('the line a parent reads', () => {
  it('says what came back and what did not', () => {
    const result = landed([ok, { term: 'x', definition: '' }, { term: '', definition: 'y' }])
    expect(landingSummary(result, 6)).toBe('1 card from 6 pages; 2 skipped.')
  })

  it('says nothing about skipping when nothing was skipped', () => {
    expect(landingSummary(landed([ok]), 3)).toBe('1 card from 3 pages.')
  })

  it('leaves the page count out when there is none', () => {
    expect(landingSummary(landed([ok]), 0)).toBe('1 card.')
  })
})
