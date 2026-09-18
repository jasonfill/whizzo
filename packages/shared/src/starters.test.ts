// The starter catalog's one promise: ids never move.
//
// A learner's mastery is stored against `deckId:cardId`, and the deck ids sit
// on the learner row. If either drifted, every child who added a starter
// would wake up to a blank slate.

import { describe, expect, it } from 'vitest'
import { isStarterDeck, STARTER_DECKS, starterDecksFor } from './starters.js'
import { cardKey } from './progress.js'

describe('the starter catalog', () => {
  it('keeps the ids the app has already stored on learner rows', () => {
    expect(STARTER_DECKS.map((d) => d.id)).toEqual([
      'starter-capitals',
      'starter-times-tables',
      'starter-spanish',
      'starter-body',
      'starter-space',
    ])
  })

  it('derives every card id from the deck id and the row position', () => {
    for (const deck of STARTER_DECKS) {
      expect(deck.cards.length).toBeGreaterThan(0)
      deck.cards.forEach((card, i) => {
        expect(card.id).toBe(`${deck.id}-${i}`)
        expect(cardKey(deck.id, card.id)).toBe(`${deck.id}:${deck.id}-${i}`)
      })
    }
  })

  it('rates every card on the shared 1-5 scale and marks it as shipped', () => {
    for (const deck of STARTER_DECKS) {
      expect(deck.source).toBe('starter')
      for (const card of deck.cards) {
        expect(card.difficulty).toBeGreaterThanOrEqual(1)
        expect(card.difficulty).toBeLessThanOrEqual(5)
      }
    }
  })

  it('knows its own ids and nothing else', () => {
    expect(isStarterDeck('starter-capitals')).toBe(true)
    expect(isStarterDeck('gen-math-add-0-10')).toBe(false)
    expect(isStarterDeck('')).toBe(false)
  })
})

describe('starterDecksFor', () => {
  it('returns nothing for a learner who added nothing', () => {
    expect(starterDecksFor([])).toEqual([])
  })

  it('ignores ids that are not in the catalog', () => {
    expect(starterDecksFor(['starter-retired', 'not-a-deck']).map((d) => d.id)).toEqual([])
    expect(starterDecksFor(['nope', 'starter-spanish']).map((d) => d.id)).toEqual(['starter-spanish'])
  })

  it('keeps catalog order however the learner added them', () => {
    const ids = starterDecksFor(['starter-space', 'starter-capitals', 'starter-body']).map((d) => d.id)
    expect(ids).toEqual(['starter-capitals', 'starter-body', 'starter-space'])
  })

  it('hands back the same deck objects the catalog holds', () => {
    const [capitals] = starterDecksFor(['starter-capitals'])
    expect(capitals).toBe(STARTER_DECKS[0])
    expect(capitals.title).toBe('US State Capitals')
    expect(capitals.cards).toHaveLength(50)
  })
})
