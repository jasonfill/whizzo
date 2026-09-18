// The learner's list is exactly three things: their own decks, the ones set
// for them, and the starters they added. Nothing arrives uninvited.

import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { emptySnapshot, type QuizDeck } from '../progress/types'
import { addedStarters, isStarterId, learnerDecks } from './useLearnerDecks'

function deck(over: Partial<QuizDeck> = {}): QuizDeck {
  return {
    id: 'd1',
    title: 'Capitals',
    description: '',
    tags: [],
    cards: [],
    source: 'user',
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: 0,
    updatedAt: 1,
    ...over,
  }
}

describe('learnerDecks', () => {
  it('has no starters until one is added', () => {
    const snapshot = { ...emptySnapshot(), decks: [deck()] }
    expect(learnerDecks(snapshot, []).map((d) => d.id)).toEqual(['d1'])
    expect(learnerDecks(snapshot, undefined).map((d) => d.id)).toEqual(['d1'])
  })

  it('keeps the learner’s own and set decks first, then the added starters in catalog order', () => {
    const snapshot = {
      ...emptySnapshot(),
      decks: [deck({ id: 'mine', updatedAt: 5 }), deck({ id: 'set', source: 'assigned', updatedAt: 9 })],
    }
    const [second, first] = [STARTER_DECKS[1]!.id, STARTER_DECKS[0]!.id]
    expect(learnerDecks(snapshot, [second, first]).map((d) => d.id)).toEqual(['set', 'mine', first, second])
  })

  it('drops an id the catalog no longer ships rather than drawing a hole', () => {
    expect(addedStarters(['starter-retired', STARTER_DECKS[0]!.id]).map((d) => d.id)).toEqual([
      STARTER_DECKS[0]!.id,
    ])
  })

  it('knows which ids are starters', () => {
    expect(isStarterId(STARTER_DECKS[0]!.id)).toBe(true)
    expect(isStarterId('d1')).toBe(false)
  })
})
