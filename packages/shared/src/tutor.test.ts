// The tutor round: what the assistant is allowed to see, and how a spoken
// answer is graded.
//
// The property worth the most here is the one that is easiest to break by
// adding a field: no question payload carries the answer. The rest is the
// spoken layer not marking a child wrong for the transcriber's habits.

import { describe, expect, it } from 'vitest'
import type { ItemMastery, QuizCard, QuizDeck } from './progress.js'
import {
  attemptFor,
  clueFor,
  maskAnswer,
  gradeSpoken,
  normalizeSpoken,
  parseNumeric,
  planTutorRound,
  questionFor,
  studyCardFor,
  summarizeRound,
  tutorInstructions,
  tutorPacket,
  type PlannedTutorCard,
} from './tutor.js'

function card(over: Partial<QuizCard> = {}): QuizCard {
  return { id: 'c1', term: 'Powerhouse of the cell', definition: 'Mitochondria', hint: null, difficulty: 2, ...over }
}

function deck(cards: QuizCard[], over: Partial<QuizDeck> = {}): QuizDeck {
  return {
    id: 'deck1',
    title: 'Cells',
    description: '',
    tags: [],
    cards,
    source: 'user',
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const CELLS = deck([
  card({ id: 'c1', term: 'Powerhouse of the cell', definition: 'Mitochondria' }),
  card({ id: 'c2', term: 'Packages proteins for transport', definition: 'Golgi apparatus / Golgi body' }),
  card({ id: 'c3', term: 'Controls the cell', definition: 'Nucleus' }),
  card({ id: 'c4', term: 'Makes proteins', definition: 'Ribosome' }),
  card({ id: 'c5', term: 'Site of photosynthesis', definition: 'Chloroplast' }),
  card({ id: 'c6', term: 'Holds the cell together', definition: 'Cell membrane' }),
  card({ id: 'c7', term: 'Area of a 3 by 4 rectangle', definition: '12', answerKind: 'numeric' }),
  card({ id: 'c8', term: 'Draw it', definition: '[[figure {"kind":"bar","bars":[1]}]]' }),
])

function mastery(over: Partial<ItemMastery> = {}): ItemMastery {
  return {
    subject: 'quiz',
    itemKey: 'deck1:c1',
    listId: 'deck1',
    difficulty: 2,
    mastery: 0.5,
    reps: 3,
    lapses: 0,
    correctStreak: 1,
    totalAttempts: 4,
    totalCorrect: 3,
    intervalDays: 2,
    dueOn: '2026-09-01',
    firstSeenAt: 0,
    lastSeenAt: 0,
    ...over,
  }
}

const seeded = () => {
  let s = 7
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const noMastery = () => undefined

describe('planning', () => {
  it('never plans a card that cannot be said aloud', () => {
    for (const mode of ['practise', 'test', 'study'] as const) {
      const plan = planTutorRound({ mode, decks: [CELLS], deckId: 'deck1', band: 'middle', masteryOf: noMastery, today: '2026-09-06', rng: seeded() })
      expect(plan.map((p) => p.card.id)).not.toContain('c8')
    }
  })

  it('asks a never-met card as a choice, never at rung 0', () => {
    const plan = planTutorRound({ mode: 'practise', decks: [CELLS], deckId: 'deck1', band: 'middle', masteryOf: noMastery, today: '2026-09-06', rng: seeded() })
    expect(plan.length).toBeGreaterThan(0)
    expect(plan.every((p) => p.rung === 1)).toBe(true)
  })

  it('a test is every card at free recall, capped at the round size', () => {
    const plan = planTutorRound({ mode: 'test', decks: [CELLS], deckId: 'deck1', band: 'early', masteryOf: noMastery, today: '2026-09-06', rng: seeded() })
    expect(plan.length).toBe(6)
    expect(plan.every((p) => p.rung === 3 && p.role === 'test')).toBe(true)
  })

  it('review draws what is due across every deck, most overdue first', () => {
    const other = deck([card({ id: 'x1', term: 'Hola', definition: 'Hello' })], { id: 'deck2', title: 'Spanish' })
    const due = (deckId: string, cardId: string) =>
      cardId === 'c1' ? mastery({ itemKey: `${deckId}:c1`, dueOn: '2026-08-20' })
      : cardId === 'x1' ? mastery({ itemKey: `${deckId}:x1`, dueOn: '2026-08-01' })
      : undefined
    const plan = planTutorRound({ mode: 'review', decks: [CELLS, other], band: 'middle', masteryOf: due, today: '2026-09-06', rng: seeded() })
    expect(plan.map((p) => `${p.deckId}:${p.card.id}`)).toEqual(['deck2:x1', 'deck1:c1'])
  })

  it('study is one batch of unmet cards, at rung 0', () => {
    const plan = planTutorRound({ mode: 'study', decks: [CELLS], deckId: 'deck1', band: 'upper', masteryOf: noMastery, today: '2026-09-06', rng: seeded() })
    expect(plan.length).toBe(6)
    expect(plan.every((p) => p.rung === 0 && p.role === 'study')).toBe(true)
  })
})

describe('the question payload', () => {
  const planned = (over: Partial<PlannedTutorCard>): PlannedTutorCard => ({
    card: CELLS.cards[0], deckId: 'deck1', deckTitle: 'Cells', role: 'batch', rung: 3, direction: 'term-first', ...over,
  })

  it('rung 3 carries the prompt and nothing derived from the answer', () => {
    const q = questionFor(planned({ rung: 3 }), CELLS.cards, 1, 10, seeded())
    expect(q.kind).toBe('written')
    expect(q.choices).toBeUndefined()
    expect(q.scaffold).toBeUndefined()
    expect(JSON.stringify(q).toLowerCase()).not.toContain('mitochondria')
  })

  it('rung 1 offers choices that include the answer without marking it', () => {
    const q = questionFor(planned({ rung: 1 }), CELLS.cards, 2, 10, seeded())
    expect(q.kind).toBe('multiple-choice')
    expect(q.choices).toContain('Mitochondria')
    expect(q.choices?.length).toBe(4)
    expect(Object.keys(q)).not.toContain('answer')
    expect(q.say).toMatch(/Is it .*, or .*\?$/)
  })

  it('rung 2 gives the first letter and the shape, not the word', () => {
    const q = questionFor(planned({ rung: 2 }), CELLS.cards, 3, 10, seeded())
    expect(q.kind).toBe('letter-hint')
    expect(q.scaffold).toMatch(/^M_+$/)
    expect(q.say).toContain('starts with M and has 12 letters')
    expect(q.say.toLowerCase()).not.toContain('mitochondria')
  })

  it('a study card is the one payload that says the answer', () => {
    const s = studyCardFor(planned({ rung: 0, role: 'study', card: card({ explanation: 'It makes ATP.' }) }))
    expect(s.answer).toBe('Mitochondria')
    expect(s.say).toBe('Powerhouse of the cell: Mitochondria. It makes ATP.')
  })
})

describe('spoken answers', () => {
  it('drops fillers and lead-ins', () => {
    expect(normalizeSpoken("um, I think it's the mitochondria?")).toBe('the mitochondria')
    expect(normalizeSpoken('The answer is Golgi body.')).toBe('Golgi body')
  })

  it('turns number words into the forms a learner would type', () => {
    expect(normalizeSpoken('three quarters')).toBe('3/4')
    expect(normalizeSpoken('seventy five percent')).toBe('75%')
    expect(normalizeSpoken('twenty three')).toBe('23')
    expect(normalizeSpoken('two point five')).toBe('2.5')
    expect(normalizeSpoken('negative four')).toBe('-4')
    expect(normalizeSpoken('a hundred and twelve')).toBe('112')
    expect(normalizeSpoken('one and a half')).toBe('1 1/2')
  })

  it('leaves ordinary words alone and is idempotent', () => {
    for (const s of ['Golgi apparatus', 'a bird in the hand', 'one direction', '3/4', 'Henry the eighth']) {
      const once = normalizeSpoken(s)
      expect(normalizeSpoken(once)).toBe(once)
    }
    expect(normalizeSpoken('a bird in the hand')).toBe('a bird in the hand')
  })

  it('never turns a correct typed answer into a wrong one', () => {
    for (const c of CELLS.cards.filter((c) => c.id !== 'c8')) {
      const typed = c.definition.split('/')[0].trim()
      expect(gradeSpoken(typed, c, 'term-first').verdict).toBe('correct')
    }
  })

  it('grades the transcript the way the app grades the typed answer', () => {
    const golgi = CELLS.cards[1]
    expect(gradeSpoken("um it's the Golgi body", golgi, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('golgi aparatus', golgi, 'term-first').verdict).toBe('close')
    expect(gradeSpoken('ribosome', golgi, 'term-first').verdict).toBe('wrong')
  })

  it('compares numbers as numbers, within the card’s tolerance', () => {
    const area = CELLS.cards[6]
    expect(gradeSpoken('twelve', area, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('12.0', area, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('21', area, 'term-first').verdict).toBe('wrong')
    const frac = card({ definition: '$\\frac{3}{4}$' })
    expect(gradeSpoken('three quarters', frac, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('seventy five percent', frac, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('0.75', frac, 'term-first').verdict).toBe('correct')
    const approx = card({ definition: '3.14', answerKind: 'numeric', tolerance: 0.01 })
    expect(gradeSpoken('3.1415', approx, 'term-first').verdict).toBe('correct')
    expect(gradeSpoken('3.2', approx, 'term-first').verdict).toBe('wrong')
  })

  it('parses the number shapes speech produces', () => {
    expect(parseNumeric('3/4')).toBe(0.75)
    expect(parseNumeric('1 1/2')).toBe(1.5)
    expect(parseNumeric('75%')).toBe(0.75)
    expect(parseNumeric('-2.5')).toBe(-2.5)
    expect(parseNumeric('twelve')).toBe(12)
    expect(parseNumeric('mitochondria')).toBeNull()
  })
})

describe('recording', () => {
  const planned: PlannedTutorCard = { card: CELLS.cards[0], deckId: 'deck1', deckTitle: 'Cells', role: 'batch', rung: 3, direction: 'term-first' }
  const q = questionFor(planned, CELLS.cards, 1, 1, seeded())

  it('an unhinted rung-3 answer is unaided evidence from the mcp channel', () => {
    const a = attemptFor({ question: q, given: 'mitochondria', correct: true, hintsUsed: 0, at: 1 }, planned.card, 'science.biology')
    expect(a).toMatchObject({ activity: 'tutor', askedAt: 3, isTest: true, verified: true, channel: 'mcp', track: 'science.biology', responseMs: null })
  })

  it('a hint drops the rung to 2 and takes the answer out of the ability estimate', () => {
    const a = attemptFor({ question: q, given: 'mitochondria', correct: true, hintsUsed: 1, at: 1 }, planned.card, null)
    expect(a.askedAt).toBe(2)
    expect(a.isTest).toBe(false)
  })

  it('a skip is a miss with nothing given', () => {
    const a = attemptFor({ question: q, given: null, correct: false, hintsUsed: 0, at: 1 }, planned.card, null)
    expect(a.correct).toBe(false)
    expect(a.given).toBeNull()
  })

  it('the summary scores first sight and names what is still wrong', () => {
    const plan = planTutorRound({ mode: 'test', decks: [CELLS], deckId: 'deck1', band: 'middle', masteryOf: noMastery, today: '2026-09-06', rng: seeded() })
    const qs = plan.map((p, i) => questionFor(p, CELLS.cards, i + 1, plan.length, seeded()))
    const attempts = [
      attemptFor({ question: qs[0], given: 'x', correct: false, hintsUsed: 0, at: 1 }, plan[0].card, null),
      attemptFor({ question: qs[1], given: 'y', correct: true, hintsUsed: 0, at: 2 }, plan[1].card, null),
      // The requeue: right the second time, still a miss on the headline.
      attemptFor({ question: qs[0], given: 'z', correct: true, hintsUsed: 0, at: 3 }, plan[0].card, null),
    ]
    const s = summarizeRound(plan, attempts, () => undefined, '2026-09-06', 'middle')
    expect(s.asked).toBe(2)
    expect(s.correct).toBe(1)
    expect(s.missed).toEqual([])
    expect(s.mastery.length).toBe(2)
    expect(s.say).toContain('1 out of 2')
  })
})

describe('exposure', () => {
  it('a study exposure touches nothing but the visit itself', () => {
    const plan = planTutorRound({ mode: 'study', decks: [CELLS], deckId: 'deck1', band: 'middle', masteryOf: () => mastery({ mastery: 0.9, correctStreak: 3, lapses: 0, intervalDays: 32, dueOn: '2026-10-08' }), today: '2026-09-06', rng: seeded() })
    const q = questionFor(plan[0]!, [], 1, 1, seeded())
    const a = attemptFor({ question: q, given: null, correct: false, hintsUsed: 0, at: 5, kind: 'studied' }, plan[0]!.card, null)
    expect(a).toMatchObject({ askedAt: 0, isTest: false, verified: false })
    const before = mastery({ itemKey: q.itemKey, mastery: 0.9, correctStreak: 3, lapses: 0, intervalDays: 32, dueOn: '2026-10-08', totalAttempts: 5 })
    const s = summarizeRound(plan, [a], () => before, '2026-09-06', 'middle')
    const after = s.mastery[0]!
    expect(after.correctStreak).toBe(3)
    expect(after.lapses).toBe(0)
    expect(after.dueOn).toBe('2026-10-08')
    expect(after.mastery).toBe(0.9)
    expect(after.totalAttempts).toBe(6)
    expect(after.lastSeenAt).toBe(5)
  })

  it('schedules against the ability it is given, as the app does', () => {
    const planned: PlannedTutorCard = { card: CELLS.cards[0]!, deckId: 'deck1', deckTitle: 'Cells', role: 'batch', rung: 3, direction: 'term-first' }
    const q = questionFor(planned, CELLS.cards, 1, 1, seeded())
    const a = attemptFor({ question: q, given: 'x', correct: true, hintsUsed: 0, at: 1 }, planned.card, null)
    const prior = () => mastery({ itemKey: q.itemKey, mastery: 0.8, correctStreak: 2, intervalDays: 4 })
    const low = summarizeRound([planned], [a], prior, '2026-09-06', 'middle', () => 1).mastery[0]!
    const high = summarizeRound([planned], [a], prior, '2026-09-06', 'middle', () => 5).mastery[0]!
    expect(high.intervalDays).toBeGreaterThan(low.intervalDays)
  })
})

describe('clues', () => {
  const golgi = card({ id: 'g', term: 'Packages proteins for transport', definition: 'Golgi apparatus / Golgi body', example: 'Proteins pass through the Golgi apparatus on their way out of the cell.', explanation: 'The Golgi body sorts and packages proteins.' })

  it('masks every acceptable answer, and the words inside them', () => {
    expect(maskAnswer('The Golgi body sorts proteins made by the Golgi apparatus.', golgi, 'term-first')).toBe('The ___ sorts proteins made by the ___ .')
    expect(maskAnswer('Look for golgi in the diagram', golgi, 'term-first')).toBe('Look for ___ in the diagram')
  })

  it('prefers the authored hint, then a masked example, category, explanation', () => {
    expect(clueFor(card({ hint: 'It sounds like a Scottish name.', example: 'x y z' }), 'term-first')?.text).toBe('It sounds like a Scottish name.')
    expect(clueFor(golgi, 'term-first')?.text).toBe('Think of this: Proteins pass through the ___ on their way out of the cell.')
    expect(clueFor(card({ category: 'Organelles' }), 'term-first')?.text).toBe("It's one of these: Organelles.")
    expect(clueFor(card({ explanation: 'Mitochondria make ATP for the cell.' }), 'term-first')?.text).toBe('___ make ATP for the cell.')
  })

  it('gives no clue when there is nothing to build one from, or nothing left after masking', () => {
    expect(clueFor(card(), 'term-first')).toBeNull()
    expect(clueFor(card({ explanation: 'Mitochondria.' }), 'term-first')).toBeNull()
  })

  it('never lets the answer through', () => {
    for (const c of CELLS.cards.filter((c) => c.id !== 'c8')) {
      const clue = clueFor({ ...c, explanation: `The answer is ${c.definition}, obviously.` }, 'term-first')
      if (!clue) continue
      const answer = c.definition.split('/')[0]!.trim().toLowerCase()
      expect(clue.text.toLowerCase()).not.toContain(answer)
    }
  })
})

describe('what the assistant is told', () => {
  it('names the learner and forbids revealing the answer', () => {
    const text = tutorInstructions('growing', 'Maya', 4)
    expect(text).toContain('Maya, who is in grade 4')
    expect(text).toContain('Never tell the learner an answer before `answer` has returned it')
  })

  it('the packet carries every speakable card and says it records nothing', () => {
    const p = tutorPacket(CELLS, 'middle', 'Maya', 6)
    expect(p).toContain('Powerhouse of the cell → Mitochondria')
    expect(p).not.toContain('figure')
    expect(p).toContain('not recorded in Whizzo')
    expect(p).not.toContain('`')
  })
})
