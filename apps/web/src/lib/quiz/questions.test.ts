// Grading a typed answer.
//
// The whole reason written practice stays tolerable is that a near miss is
// shown as a near miss. Get this wrong in one direction and a learner is
// marked wrong for a typo; get it wrong in the other and a one-word stab at a
// long definition scores.

import { describe, expect, it } from 'vitest'
import {
  acceptableAnswers,
  buildQuestion,
  gradeWritten,
  isPass,
  isProduced,
  normalize,
} from './questions'
import type { QuizCard } from '../progress/types'

describe('normalize', () => {
  it('ignores case, punctuation and stray spacing', () => {
    expect(normalize('  The Cat, sat!  ')).toBe(normalize('the cat sat'))
  })

  it('ignores accents, so a learner without the keyboard for them is not marked wrong', () => {
    expect(normalize('café')).toBe(normalize('cafe'))
    expect(normalize('naïve')).toBe(normalize('naive'))
  })

  it('ignores a leading article', () => {
    expect(normalize('the mitochondria')).toBe(normalize('mitochondria'))
  })

  it('leaves an empty answer empty', () => {
    expect(normalize('   ')).toBe('')
  })
})

describe('acceptableAnswers', () => {
  it('splits alternatives written with a slash', () => {
    expect(acceptableAnswers('couch / sofa')).toEqual(['couch', 'sofa'])
  })

  it('splits on a semicolon and on the word or', () => {
    expect(acceptableAnswers('couch; sofa')).toEqual(['couch', 'sofa'])
    expect(acceptableAnswers('couch or sofa')).toEqual(['couch', 'sofa'])
  })

  it('leaves a single answer alone', () => {
    expect(acceptableAnswers('photosynthesis')).toEqual(['photosynthesis'])
  })

  it('drops empty fragments from a trailing separator', () => {
    expect(acceptableAnswers('couch /')).toEqual(['couch'])
  })
})

describe('gradeWritten', () => {
  it('accepts the answer', () => {
    expect(gradeWritten('paris', 'Paris')).toBe('correct')
  })

  it('accepts either of two alternatives', () => {
    expect(gradeWritten('sofa', 'couch / sofa')).toBe('correct')
    expect(gradeWritten('couch', 'couch / sofa')).toBe('correct')
  })

  it('marks an empty answer wrong rather than close', () => {
    // Otherwise pressing enter would earn a pass.
    expect(gradeWritten('', 'Paris')).toBe('wrong')
    expect(gradeWritten('   ', 'Paris')).toBe('wrong')
  })

  it('calls a typo in a long word close, not wrong', () => {
    expect(gradeWritten('photosynthesus', 'photosynthesis')).toBe('close')
  })

  it('does not extend that tolerance to short words', () => {
    // One slip in a four-letter word is probably a different word.
    expect(gradeWritten('cat', 'cap')).toBe('wrong')
    expect(gradeWritten('bat', 'cat')).toBe('wrong')
  })

  it('accepts the head term of a qualified answer as close', () => {
    expect(gradeWritten('photosynthesis', 'photosynthesis in plants')).toBe('close')
  })

  it('does not credit a short stab at a long definition', () => {
    expect(gradeWritten('the', 'the powerhouse of the cell')).toBe('wrong')
  })

  it('marks a genuinely different answer wrong', () => {
    expect(gradeWritten('london', 'Paris')).toBe('wrong')
  })

  it('grades against every alternative, not only the first', () => {
    expect(gradeWritten('mitochondrion', 'organelle / mitochondria')).toBe('close')
  })
})

describe('isPass', () => {
  it('accepts a near miss in a forgiving mode', () => {
    expect(isPass('close', false)).toBe(true)
    expect(isPass('correct', false)).toBe(true)
    expect(isPass('wrong', false)).toBe(false)
  })

  it('requires exactness where the round is a measurement', () => {
    // A test that accepts near misses measures something other than recall.
    expect(isPass('close', true)).toBe(false)
    expect(isPass('correct', true)).toBe(true)
  })
})

describe('answers written as math', () => {
  it('grades against what the math says, not how it was written', () => {
    expect(gradeWritten('3/4', '$\\frac{3}{4}$')).toBe('correct')
    expect(gradeWritten('45°', '$45^\\circ$')).toBe('correct')
    expect(gradeWritten('1/2', '$\\frac{3}{4}$')).toBe('wrong')
  })

  it('keeps a fraction whole instead of reading it as two alternatives', () => {
    // "couch / sofa" means either will do; "1/2" does not mean "1 will do".
    expect(acceptableAnswers('1/2')).toEqual(['1/2'])
    expect(acceptableAnswers('3/4 cup')).toEqual(['3/4 cup'])
    expect(gradeWritten('1', '1/2')).toBe('wrong')
    expect(gradeWritten('3', '3/4 cup')).toBe('wrong')
  })

  it('still offers alternatives on a card that has math on it', () => {
    // The slash inside the fraction is not a separator; the one after it is.
    expect(acceptableAnswers('$\\frac{1}{2}$ / a half')).toEqual(['$\\frac{1}{2}$', 'a half'])
    expect(gradeWritten('1/2', '$\\frac{1}{2}$ / a half')).toBe('correct')
    expect(gradeWritten('a half', '$\\frac{1}{2}$ / a half')).toBe('correct')
    expect(acceptableAnswers('couch / sofa')).toEqual(['couch', 'sofa'])
  })

  it('reads a card about money as a card about money', () => {
    const money = 'A shirt costs $12 and pants cost $20. How much altogether?'
    // Not "costs 12andpantscost20" — the middle of the sentence is prose.
    expect(normalize(money)).toContain('costs $12 and pants cost $20')
  })

  it('answers a card whose prompt is a figure the same as any other card', () => {
    const answer = '[[figure {"kind":"bar","data":[{"label":"Mon","value":4}]}]]'
    // The description is what the card says, so it is what has to match.
    expect(normalize(answer)).toContain('mon 4')
  })
})

// ---------------------------------------------------------------------------
// The scaffolded rung
// ---------------------------------------------------------------------------

describe('scaffolded questions', () => {
  const pool: QuizCard[] = ['osmosis', 'diffusion', 'mitosis', 'meiosis', 'lysis'].map((d, i) => ({
    id: `c${i}`,
    term: `Term ${i}`,
    definition: d,
    hint: null,
    difficulty: 2,
  }))

  it('shows the shape of the answer and hides the rest', () => {
    const q = buildQuestion(pool[0], pool, 'letter-hint', 'term-first')
    expect(q.kind).toBe('letter-hint')
    expect(q.masked).toBe('o______')
  })

  it('lists candidates that always include the answer', () => {
    const q = buildQuestion(pool[0], pool, 'word-bank', 'term-first')
    expect(q.kind).toBe('word-bank')
    expect(q.bank).toContain('osmosis')
    expect(q.bank!.length).toBeGreaterThan(2)
  })

  it('falls back to a word bank when the answer has no letters to hint at', () => {
    // `$\frac{3}{4}$` masked character by character is nonsense, not a hint.
    const math: QuizCard[] = pool.map((c, i) => ({ ...c, definition: `$\\frac{${i}}{4}$` }))
    const q = buildQuestion(math[0], math, 'letter-hint', 'term-first')
    expect(q.kind).toBe('word-bank')
  })

  it('asks outright when there are too few candidates for a bank', () => {
    // A bank of one is the answer with decoration.
    const two = pool.slice(0, 2)
    expect(buildQuestion(two[0], two, 'word-bank', 'term-first').kind).toBe('written')
  })

  it('keeps the answer the same however it is asked', () => {
    const kinds = ['letter-hint', 'word-bank', 'written'] as const
    const answers = kinds.map((k) => buildQuestion(pool[0], pool, k, 'term-first').answer)
    expect(new Set(answers).size).toBe(1)
  })

  it('counts both scaffolds as production, and neither choice kind', () => {
    // This is what keeps a scaffolded answer out of the ability estimate while
    // still letting it be typed: produced, but not unaided.
    expect(isProduced('letter-hint')).toBe(true)
    expect(isProduced('word-bank')).toBe(true)
    expect(isProduced('written')).toBe(true)
    expect(isProduced('multiple-choice')).toBe(false)
    expect(isProduced('true-false')).toBe(false)
  })
})
