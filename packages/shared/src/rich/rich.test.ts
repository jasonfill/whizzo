import { describe, expect, it } from 'vitest'
import {
  FIGURE_KINDS,
  figureAlt,
  figureSource,
  findFigure,
  validateFigure,
  type FigureKind,
  type FigureSpec,
} from './figures.js'
import { decodeEntities, mathToText, parseMathML, type MathNode } from './mathml.js'
import {
  hasRich,
  parseRich,
  richProblems,
  richSpans,
  richToPlain,
  splitOutsideRich,
  withoutRich,
} from './parse.js'
import { texToMath } from './tex.js'

/**
 * One minimal valid spec per kind, so the invariants below belong to this
 * module rather than to whatever the editor happens to offer. The editor's
 * templates are checked against `FIGURE_KINDS` on the web side; that is a
 * different contract — "the snippets we hand an author are valid" — and it
 * should fail there rather than here.
 */
const SAMPLE: Record<FigureKind, FigureSpec> = {
  bar: { kind: 'bar', data: [{ label: 'a', value: 3 }] },
  line: { kind: 'line', series: [{ name: 's', points: [[0, 0], [1, 2]] }] },
  pie: { kind: 'pie', data: [{ label: 'a', value: 1 }] },
  numberline: { kind: 'numberline', min: 0, max: 10 },
  plot: { kind: 'plot', points: [{ at: [1, 1] }] },
  triangle: { kind: 'triangle', sides: ['3 cm', '4 cm', '5 cm'] },
  rect: { kind: 'rect', width: '8 m', height: '5 m' },
  polygon: { kind: 'polygon', points: [[0, 0], [2, 0], [1, 2]] },
  circle: { kind: 'circle', radius: '6 in' },
  angle: { kind: 'angle', degrees: 55 },
}

/** Every tag in the tree, for asserting on structure without matching serialized XML. */
function tags(node: MathNode): string[] {
  return [node.tag, ...(node.children ?? []).flatMap(tags)]
}

describe('TeX-lite', () => {
  it('reads a fraction back as the thing a learner would type', () => {
    const { node } = texToMath('\\frac{3}{4}')
    expect(tags(node)).toContain('mfrac')
    expect(mathToText(node)).toBe('3/4')
  })

  it('keeps a compound numerator readable by parenthesising it', () => {
    expect(mathToText(texToMath('\\frac{x+1}{2}').node)).toBe('(x+1)/2')
  })

  it('writes ^\\circ as a degree sign, because that is what it means', () => {
    expect(mathToText(texToMath('45^\\circ').node)).toBe('45°')
  })

  it('handles powers, subscripts and both at once', () => {
    expect(mathToText(texToMath('x^2').node)).toBe('x^2')
    expect(mathToText(texToMath('a_1').node)).toBe('a_1')
    expect(tags(texToMath('x_i^2').node)).toContain('msubsup')
  })

  it('takes an index on a root', () => {
    const { node } = texToMath('\\sqrt[3]{8}')
    expect(tags(node)).toContain('mroot')
    expect(mathToText(node)).toBe('root3(8)')
  })

  it('draws the segment and triangle notation geometry is written in', () => {
    expect(tags(texToMath('\\overline{AB}').node)).toContain('mover')
    expect(mathToText(texToMath('\\triangle ABC \\sim \\triangle DEF').node)).toBe('△ABC∼△DEF')
    expect(mathToText(texToMath('\\overline{AB} \\parallel \\overline{CD}').node)).toContain('∥')
  })

  it('keeps a number with a decimal point or a comma in one piece', () => {
    expect(mathToText(texToMath('1,250.5').node)).toBe('1,250.5')
  })

  it('sets a minus sign rather than a hyphen', () => {
    expect(mathToText(texToMath('5-3').node)).toBe('5−3')
  })

  it('keeps the words in \\text together, spaces and all', () => {
    expect(mathToText(texToMath('\\text{miles per hour}').node)).toBe('miles per hour')
  })

  it('says so when it meets a command it does not know, instead of failing quietly', () => {
    const { warnings, node } = texToMath('\\parallell')
    expect(warnings[0]).toContain('\\parallell')
    // The author still sees where it went wrong on the card itself.
    expect(mathToText(node)).toBe('\\parallell')
  })

  it('survives an unbalanced brace rather than losing the rest of the card', () => {
    expect(mathToText(texToMath('\\frac{1}{2').node)).toBe('1/2')
  })
})

describe('pasted MathML', () => {
  it('reads an equation exported with a namespace prefix', () => {
    const node = parseMathML('<m:math><m:mfrac><m:mn>1</m:mn><m:mn>2</m:mn></m:mfrac></m:math>')
    expect(node).not.toBeNull()
    expect(mathToText(node!)).toBe('1/2')
  })

  it('throws away the TeX annotation an exporter leaves beside the math', () => {
    const node = parseMathML(
      '<math><semantics><mn>7</mn><annotation encoding="application/x-tex">7</annotation></semantics></math>',
    )
    expect(mathToText(node!)).toBe('7')
  })

  it('drops attributes that are not presentation, and scripts entirely', () => {
    const node = parseMathML(
      '<math><mstyle mathvariant="bold" onclick="steal()" style="position:fixed"><mi>x</mi></mstyle><script>alert(1)</script></math>',
    )
    const style = node!.children![0]
    expect(style.attrs).toEqual({ mathvariant: 'bold' })
    expect(mathToText(node!)).toBe('x')
  })

  it('unwraps elements it does not know rather than losing what is inside them', () => {
    const node = parseMathML('<math><mfenced><mi>y</mi></mfenced></math>')
    expect(mathToText(node!)).toBe('y')
  })

  it('decodes the entities an office suite exports', () => {
    expect(decodeEntities('5 &times; 3 &ne; 14 &#x2212; 2')).toBe('5 × 3 ≠ 14 − 2')
  })
})

describe('limits on pasted MathML', () => {
  it('caps a huge paste rather than putting all of it on the page', () => {
    const huge = `<math>${'<mn>1</mn>'.repeat(900)}</math>`
    const node = parseMathML(huge)
    expect(node).not.toBeNull()
    expect(mathToText(node!).length).toBeLessThan(900)
  })

  it('survives deeply nested markup', () => {
    const deep = `<math>${'<mrow>'.repeat(80)}<mn>7</mn>${'</mrow>'.repeat(80)}</math>`
    expect(mathToText(parseMathML(deep)!)).toContain('7')
  })
})

describe('card text', () => {
  it('leaves text with no math in it completely alone', () => {
    expect(hasRich('the powerhouse of the cell')).toBe(false)
    expect(parseRich('plain')).toEqual([{ type: 'text', value: 'plain' }])
  })

  it('splits text from the math inside it', () => {
    const nodes = parseRich('Simplify $\\frac{6}{8}$ please')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'math', 'text'])
    expect(richToPlain('Simplify $\\frac{6}{8}$ please')).toBe('Simplify 6/8 please')
  })

  it('treats a lone dollar sign as money, not as broken math', () => {
    expect(parseRich('It costs $5 to get in').every((n) => n.type === 'text')).toBe(true)
    expect(richToPlain('\\$5 each')).toBe('$5 each')
  })

  it('leaves two prices in one sentence alone', () => {
    // The likeliest card with two dollar signs on it is a word problem about
    // money, not an equation — and pairing them would set the words between
    // them as math and strip the spaces out of the sentence.
    const money = 'A shirt costs $12 and pants cost $20. How much altogether?'
    expect(parseRich(money).every((n) => n.type === 'text')).toBe(true)
    expect(richToPlain(money)).toBe(money)
  })

  it('will not open math on a space, or close on one', () => {
    expect(parseRich('$ x + 1$').every((n) => n.type === 'text')).toBe(true)
    expect(parseRich('$x + 1 $').every((n) => n.type === 'text')).toBe(true)
    // The rule that rejects those still accepts everything real.
    expect(parseRich('$x + 1$').some((n) => n.type === 'math')).toBe(true)
    expect(parseRich('$$\\frac{1}{2}$$').some((n) => n.type === 'math')).toBe(true)
  })

  it('recognizes the display form', () => {
    const [node] = parseRich('$$x^2$$')
    expect(node.type === 'math' && node.display).toBe(true)
  })

  it('reads a figure as a figure and describes it in plain text', () => {
    const source = 'Which day? [[figure {"kind":"bar","data":[{"label":"Mon","value":4}]}]]'
    const nodes = parseRich(source)
    expect(nodes[1].type).toBe('figure')
    expect(richToPlain(source)).toContain('Mon: 4')
  })

  it('reports a broken figure to whoever wrote it instead of dropping the card', () => {
    const nodes = parseRich('[[figure {"kind":"bar"}]]')
    expect(nodes[0].type).toBe('invalid')
    expect(richProblems('[[figure {"kind":"bar"}]]')[0]).toContain('data')
    expect(richProblems('$\\nope$')[0]).toContain('\\nope')
  })
})

describe('splitting text that has math in it', () => {
  it('knows which stretches are math and which are prose', () => {
    const source = 'a $x$ b'
    expect(richSpans(source)).toEqual([[2, 5]])
    expect(richSpans('nothing here')).toEqual([])
  })

  it('splits on separators outside the math and leaves the ones inside it', () => {
    expect(splitOutsideRich('a, $f(x, y)$, b', /\s*,\s*/)).toEqual(['a', '$f(x, y)$', 'b'])
  })

  it('steps over a figure, whose JSON is made of separators', () => {
    const row = 'Area [[figure {"kind":"rect","width":"8 m","height":"5 m"}]]: 40'
    const parts = splitOutsideRich(row, /\s*:\s*/)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('"height":"5 m"')
    expect(parts[1]).toBe('40')
  })

  it('cannot be made to spin by a pattern that can match nothing', () => {
    // The scanning path steps past a zero-width match rather than looping on it.
    expect(splitOutsideRich('a$x$b', /y*/).join('')).toContain('a')
  })

  it('hands back the prose alone, for working out how a paste is separated', () => {
    expect(withoutRich('Area [[figure {"kind":"circle"}]] of it').replace(/\s+/g, ' ')).toBe(
      'Area of it',
    )
  })
})

describe('finding a figure in card text', () => {
  it('ends the figure at its own closing braces, not at a bracket inside a label', () => {
    const source = 'a [[figure {"kind":"pie","data":[{"label":"a]] b","value":1}]}]] z'
    const found = findFigure(source)
    expect(found).not.toBeNull()
    expect(source.slice(found!.end)).toBe(' z')
    expect(JSON.parse(found!.json).data[0].label).toBe('a]] b')
  })

  it('round-trips every kind through its source form', () => {
    for (const kind of FIGURE_KINDS) {
      const spec = SAMPLE[kind]
      const [node] = parseRich(figureSource(spec))
      expect(node.type === 'figure' && node.spec.kind, kind).toBe(kind)
    }
  })
})

describe('figure validation', () => {
  it('accepts a minimal spec for every kind', () => {
    for (const kind of FIGURE_KINDS) {
      const result = validateFigure(SAMPLE[kind])
      expect(result.ok, `${kind}: ${result.ok ? '' : result.error}`).toBe(true)
    }
    // The fixture has to keep up with the kinds, or the two tests below quietly
    // stop covering whatever was added last.
    expect(Object.keys(SAMPLE).sort()).toEqual([...FIGURE_KINDS].sort())
  })

  it('names what is missing rather than drawing nothing', () => {
    expect(validateFigure({ kind: 'wobble' })).toMatchObject({ ok: false })
    expect(validateFigure({ kind: 'line' })).toMatchObject({ ok: false })
    expect(validateFigure({ kind: 'numberline', min: 5, max: 1 })).toMatchObject({ ok: false })
    expect(validateFigure('nope')).toMatchObject({ ok: false })
  })

  it('drops the entries it cannot use and keeps the rest', () => {
    const result = validateFigure({
      kind: 'bar',
      data: [{ label: 'a', value: 3 }, { label: 'b' }, { label: 'c', value: 'lots' }],
    })
    expect(result.ok && result.spec.kind === 'bar' && result.spec.data).toHaveLength(1)
  })

  it('refuses an infinite or missing number', () => {
    expect(validateFigure({ kind: 'angle', degrees: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
    })
    const clamped = validateFigure({ kind: 'angle', degrees: 4000 })
    expect(clamped.ok && clamped.spec.kind === 'angle' && clamped.spec.degrees).toBe(359)
  })

  it('describes every kind for a screen reader', () => {
    for (const kind of FIGURE_KINDS) {
      expect(figureAlt(SAMPLE[kind]).length, kind).toBeGreaterThan(8)
    }
    const withAlt = { kind: 'circle', alt: 'a wheel' } as FigureSpec
    expect(figureAlt(withAlt)).toBe('a wheel')
  })
})
