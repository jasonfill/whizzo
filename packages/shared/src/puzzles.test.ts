// The scaffolded rung. What matters here is that the hint helps without
// answering: a scaffold that gives the whole thing away is not a rung, it is
// a way of feeling like you knew it.

import { describe, expect, it } from 'vitest'
import { buildLetterHint, buildWordBank } from './puzzles.js'

describe('the letter hint', () => {
  it('shows the first letter and hides the rest', () => {
    expect(buildLetterHint('mitochondrion').masked).toBe('m____________')
  })

  it('counts what is left to produce', () => {
    expect(buildLetterHint('cell').hidden).toBe(3)
  })

  it('keeps word boundaries, because knowing it is two words is part of knowing it', () => {
    expect(buildLetterHint('photosynthesis in plants').masked).toBe('p_____________ __ ______')
  })

  it('keeps hyphens and apostrophes as structure', () => {
    expect(buildLetterHint("can't").masked).toBe("c__'_")
    expect(buildLetterHint('e-mail').masked).toBe('e-____')
  })

  it('never gives away the whole answer, however much reveal is asked for', () => {
    const hint = buildLetterHint('cat', 99)
    expect(hint.masked).toBe('ca_')
    expect(hint.hidden).toBe(1)
  })

  it('loosens the scaffold when asked, for a learner who is struggling', () => {
    expect(buildLetterHint('mitochondrion', 3).masked).toBe('mit__________')
  })

  it('leaves a one-letter answer with something to produce', () => {
    // 'a' is a real spelling word, and a hint that shows it is not a question.
    expect(buildLetterHint('a').masked).toBe('_')
  })

  it('handles an empty answer without throwing', () => {
    expect(buildLetterHint('')).toEqual({ masked: '', hidden: 0 })
    expect(buildLetterHint('   ')).toEqual({ masked: '', hidden: 0 })
  })

  it('hints at what the math says, not at how it was written', () => {
    // The learner types `3/4`, not a backslash, so that is what gets masked.
    const hint = buildLetterHint('$\\frac{3}{4}$')
    expect(hint.masked).not.toContain('frac')
    expect(hint.masked.length).toBeLessThan(6)
  })

  it('is stable — the same answer always yields the same hint', () => {
    expect(buildLetterHint('osmosis')).toEqual(buildLetterHint('osmosis'))
  })
})

describe('the word bank', () => {
  const seeded = () => {
    let s = 42
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  }

  it('always contains the answer', () => {
    const bank = buildWordBank('osmosis', ['diffusion', 'mitosis'], 5, seeded())
    expect(bank).toContain('osmosis')
  })

  it('offers the other candidates alongside it', () => {
    const bank = buildWordBank('osmosis', ['diffusion', 'mitosis'], 5, seeded())
    expect(bank).toHaveLength(3)
  })

  it('stops at the size asked for', () => {
    const bank = buildWordBank('a', ['b', 'c', 'd', 'e', 'f', 'g'], 4, seeded())
    expect(bank).toHaveLength(4)
    expect(bank).toContain('a')
  })

  it('does not offer the same answer twice under two spellings of case', () => {
    const bank = buildWordBank('Osmosis', ['osmosis', 'diffusion'], 5, seeded())
    expect(bank).toHaveLength(2)
  })

  it('drops blanks rather than offering an empty choice', () => {
    const bank = buildWordBank('osmosis', ['', '   ', 'mitosis'], 5, seeded())
    expect(bank).toEqual(expect.arrayContaining(['osmosis', 'mitosis']))
    expect(bank).toHaveLength(2)
  })

  it('shuffles, so the answer is not always first', () => {
    const positions = new Set<number>()
    for (let seed = 1; seed < 30; seed++) {
      let s = seed
      const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      positions.add(buildWordBank('a', ['b', 'c', 'd', 'e'], 5, rng).indexOf('a'))
    }
    expect(positions.size).toBeGreaterThan(1)
  })

  it('reads math as what a learner would type', () => {
    const bank = buildWordBank('$\\frac{1}{2}$', ['$\\frac{1}{4}$'], 5, seeded())
    expect(bank.join(' ')).not.toContain('frac')
  })

  it('copes with no other candidates at all', () => {
    expect(buildWordBank('alone', [], 5, seeded())).toEqual(['alone'])
  })
})
