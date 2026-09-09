import { describe, expect, it } from 'vitest'
import {
  angleAt,
  barPathH,
  barPathV,
  defaultTriangle,
  fitPoints,
  formatNumber,
  niceScale,
  sectorPath,
  ticksBetween,
  type Pt,
} from './layout'
import { FIGURE_TEMPLATES, MATH_SNIPPETS, caretOffset } from './templates'
import { FIGURE_KINDS, figureSource, richProblems, validateFigure } from '@whizzo/shared/rich'

describe('drawing arithmetic', () => {
  it('picks axis steps a person counts in', () => {
    expect(niceScale(0, 47).step).toBe(10)
    expect(niceScale(0, 4).step).toBe(1)
    expect(niceScale(0, 1).ticks).toContain(0.2)
  })

  it('keeps floating-point dust off the axis', () => {
    expect(niceScale(0, 1).ticks.every((t) => String(t).length <= 4)).toBe(true)
    expect(formatNumber(0.30000000000000004)).toBe('0.3')
    expect(formatNumber(12)).toBe('12')
  })

  it('anchors a bar to the baseline and rounds only the value end', () => {
    const path = barPathV(10, 20, 100, 40)
    // Starts and ends on the baseline; the curves are all at the top.
    expect(path.startsWith('M 10 100')).toBe(true)
    expect(path.trim().endsWith('30 100 Z')).toBe(true)
    expect(path).toContain('Q')
  })

  it('anchors a lying-down bar to the baseline in both directions', () => {
    expect(barPathH(10, 20, 50, 100).startsWith('M 50 10')).toBe(true)
    expect(barPathH(10, 20, 50, 20).startsWith('M 50 10')).toBe(true)
    expect(barPathH(10, 20, 50, 100)).toContain('Q')
  })

  it('closes a whole-circle sector without a seam through the middle', () => {
    const whole = sectorPath(0, 0, 10, 0, 360)
    expect((whole.match(/A /g) ?? []).length).toBe(2)
    expect(whole).not.toContain('L 0 0')
  })

  it('widens a step too fine for its range instead of stopping partway', () => {
    // A number line 0-1000 marked in ones is 1001 ticks. Drawing the first
    // eighty would not look broken, it would look like a different number line.
    const long = ticksBetween(0, 1000, 1)
    expect(long.length).toBeLessThanOrEqual(41)
    expect(long[long.length - 1]).toBe(1000)

    const wide = ticksBetween(-50, 50, 1)
    expect(wide[0]).toBe(-50)
    expect(wide[wide.length - 1]).toBe(50)
  })

  it('honors a step that does fit', () => {
    expect(ticksBetween(-5, 5, 1)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5])
    expect(ticksBetween(0, 3, 0.5)).toHaveLength(7)
    expect(ticksBetween(4, 4, 1)).toEqual([4])
  })

  it('keeps a shape in proportion when fitting it to the box', () => {
    const square: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const drawn = fitPoints(square, 300, 200, 20)
    const width = Math.abs(drawn[1][0] - drawn[0][0])
    const height = Math.abs(drawn[2][1] - drawn[1][1])
    expect(Math.abs(width - height)).toBeLessThan(0.001)
  })

  it('puts the right angle on the vertex the author named', () => {
    for (const at of [0, 1, 2]) {
      const [a, b, c] = defaultTriangle(at)
      const v = [a, b, c][at]
      const others = [a, b, c].filter((_, i) => i !== at)
      const { start, end } = angleAt(v, others[0], others[1])
      expect(Math.abs(Math.abs(end - start) - 90)).toBeLessThan(0.001)
    }
  })

  it('measures the angle inside the corner, not the reflex one around it', () => {
    const { start, end } = angleAt([0, 0], [10, 0], [0, -10])
    expect(end - start).toBeCloseTo(90)
  })
})

describe('editor snippets', () => {
  it('puts the cursor inside the first empty braces', () => {
    const fraction = MATH_SNIPPETS[0].text
    expect(fraction.slice(caretOffset(fraction) - 1, caretOffset(fraction) + 1)).toBe('{}')
  })

  it('compiles every snippet it offers', () => {
    for (const snippet of MATH_SNIPPETS) {
      expect(richProblems(snippet.text)).toEqual([])
    }
  })
})

// The contract that moved here when the rich core moved to @whizzo/shared: the
// snippets the editor hands an author must be valid, and there must be one for
// every kind. Shared owns "every kind validates"; this owns "our templates do".
describe('editor templates are valid figures', () => {
  it('offers a working example of every kind', () => {
    for (const template of FIGURE_TEMPLATES) {
      const result = validateFigure(template.spec)
      expect(result.ok, `${template.kind}: ${result.ok ? '' : result.error}`).toBe(true)
    }
    expect(FIGURE_TEMPLATES.map((t) => t.kind).sort()).toEqual([...FIGURE_KINDS].sort())
  })

  it('round-trips each template through its source form', () => {
    for (const template of FIGURE_TEMPLATES) {
      expect(figureSource(template.spec), template.kind).toContain(`"${template.kind}"`)
    }
  })
})
