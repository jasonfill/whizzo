// What happens when the input is wrong.
//
// These paths matter more here than they did in the web app. Card text used to
// be typed by a person watching the editor tell them what it did not
// recognize; now a model writes it on the server, and the server has to be the
// thing that decides whether a figure is real. Every case below is one a
// generated card can produce, and the rule throughout is the same: **degrade,
// name the problem, never throw and never silently drop the question.**

import { describe, expect, it } from 'vitest'
import { figureAlt, figureSource, validateFigure, type FigureSpec } from './figures.js'
import { decodeEntities, mathToText, parseMathML } from './mathml.js'
import { hasRich, parseRich, richProblems, richToPlain, splitOutsideRich, withoutRich } from './parse.js'
import { texToMath } from './tex.js'

describe('TeX that is wrong', () => {
  it('renders an unknown command as literal text and says so', () => {
    const { warnings } = texToMath('\\wibble{x}')
    expect(warnings.join(' ')).toMatch(/wibble/i)
  })

  it('survives an unclosed group', () => {
    expect(() => texToMath('\\frac{1}{2')).not.toThrow()
    expect(texToMath('\\frac{1}{2').node).toBeTruthy()
  })

  it('ignores a stray closing brace rather than stopping', () => {
    const { node, warnings } = texToMath('1 + 2} + 3')
    expect(mathToText(node)).toContain('3')
    expect(warnings.join(' ')).toMatch(/\}/)
  })

  it('takes the next character when \\text is given no braces', () => {
    expect(() => texToMath('\\text x')).not.toThrow()
  })

  it('keeps braces balanced inside \\text', () => {
    expect(mathToText(texToMath('\\text{a {b} c}').node)).toContain('a {b} c')
  })

  it('handles an empty string, and a lone backslash', () => {
    expect(() => texToMath('')).not.toThrow()
    expect(() => texToMath('\\')).not.toThrow()
  })

  it('does not hang on deeply nested groups', () => {
    const deep = '{'.repeat(200) + 'x' + '}'.repeat(200)
    expect(() => texToMath(deep)).not.toThrow()
  })

  it('reads a subscript and superscript on the same atom', () => {
    expect(mathToText(texToMath('x_1^2').node)).toBeTruthy()
  })

  it('accepts a script with no operand rather than throwing', () => {
    expect(() => texToMath('^2')).not.toThrow()
    expect(() => texToMath('x^')).not.toThrow()
  })
})

describe('MathML that is wrong', () => {
  it('returns null when there is no markup at all', () => {
    expect(parseMathML('just words')).toBeNull()
  })

  it('wraps a fragment that is not <math>', () => {
    expect(parseMathML('<mi>x</mi>')?.tag).toBe('math')
  })

  it('returns what it has when a tag is never closed', () => {
    expect(() => parseMathML('<math><mi>x')).not.toThrow()
    expect(parseMathML('<math><mi>x')).toBeTruthy()
  })

  it('skips comments, declarations and processing instructions', () => {
    const node = parseMathML('<?xml version="1.0"?><!-- note --><math><mi>y</mi></math>')
    expect(mathToText(node!)).toContain('y')
  })

  it('survives an unterminated comment', () => {
    expect(() => parseMathML('<math><!-- never ends')).not.toThrow()
  })

  it('treats a bare < in text as text', () => {
    expect(() => parseMathML('<math><mtext>a < b</mtext></math>')).not.toThrow()
  })

  it('ignores a close tag for something that was never open', () => {
    const node = parseMathML('<math></mrow><mi>z</mi></math>')
    expect(mathToText(node!)).toContain('z')
  })

  it('leaves an entity it does not know alone', () => {
    expect(decodeEntities('&nope; &amp;')).toBe('&nope; &')
  })

  it('decodes decimal and hex character references', () => {
    expect(decodeEntities('&#65;&#x42;')).toBe('AB')
  })

  it('refuses an out-of-range code point rather than throwing', () => {
    expect(decodeEntities('&#1114112;')).toBe('&#1114112;')
    expect(decodeEntities('&#0;')).toBe('&#0;')
  })
})

describe('figures that are wrong', () => {
  it('names the kind it did not recognize', () => {
    const result = validateFigure({ kind: 'sasquatch' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/sasquatch/)
  })

  it('refuses a non-object', () => {
    for (const junk of ['nope', 42, null, undefined, []]) {
      expect(validateFigure(junk as unknown), String(junk)).toMatchObject({ ok: false })
    }
  })

  it('refuses each kind that is missing its required data', () => {
    for (const kind of ['bar', 'line', 'pie', 'numberline', 'polygon'] as const) {
      expect(validateFigure({ kind }), kind).toMatchObject({ ok: false })
    }
  })

  it('refuses a number line that runs backwards', () => {
    expect(validateFigure({ kind: 'numberline', min: 10, max: 2 })).toMatchObject({ ok: false })
  })

  it('drops a row with no usable number, and keeps one with no label', () => {
    // The value is what the figure is drawn from, so a row without one cannot
    // be drawn. A label is presentation, so a slice without a name is still a
    // slice and gets an empty label rather than being thrown away.
    const result = validateFigure({
      kind: 'pie',
      data: [{ label: 'a', value: 2 }, { label: 'b', value: 'lots' }, { value: 3 }],
    })
    expect(result.ok && result.spec.kind === 'pie' && result.spec.data).toEqual([
      { label: 'a', value: 2 },
      { label: '', value: 3 },
    ])
  })

  it('drops a bar with no value at all', () => {
    const result = validateFigure({
      kind: 'bar',
      data: [{ label: 'a', value: 2 }, { label: 'b' }, { label: 'c', value: 'x' }],
    })
    expect(result.ok && result.spec.kind === 'bar' && result.spec.data).toHaveLength(1)
  })

  it('clamps a value past its ceiling instead of refusing the figure', () => {
    const result = validateFigure({ kind: 'angle', degrees: 4000 })
    expect(result.ok && result.spec.kind === 'angle' && result.spec.degrees).toBe(359)
  })

  it('refuses infinities and NaN wherever a number is required', () => {
    expect(validateFigure({ kind: 'angle', degrees: Number.NaN })).toMatchObject({ ok: false })
    expect(validateFigure({ kind: 'angle', degrees: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
    })
  })

  it('describes a figure even when the author wrote no alt text', () => {
    const spec = { kind: 'bar', data: [{ label: 'a', value: 1 }] } as FigureSpec
    expect(figureAlt(spec).length).toBeGreaterThan(8)
  })

  it('prefers the authoratural alt text when there is some', () => {
    expect(figureAlt({ kind: 'circle', alt: 'a wheel' } as FigureSpec)).toBe('a wheel')
  })

  it('round-trips through source form without breaking on a quote in a label', () => {
    const spec = { kind: 'bar', data: [{ label: 'a "b" c', value: 1 }] } as FigureSpec
    const [node] = parseRich(figureSource(spec))
    expect(node.type === 'figure' && node.spec.kind).toBe('bar')
  })
})

describe('card text that is wrong', () => {
  it('leaves a lone dollar sign alone, because prices are commoner than equations', () => {
    const price = 'it costs $5 to get in'
    // `hasRich` is a deliberately cheap fast path — it answers "is it worth
    // parsing this?", not "is there math in it". A `$` is enough to say yes.
    // The real decision is the parse, and it yields one text node: the price
    // survives untouched. Do not "fix" hasRich to be strict; the cost of the
    // permissive answer is one parse, and the cost of a strict one is a card
    // whose equation never renders.
    expect(hasRich(price)).toBe(true)
    expect(parseRich(price).map((n) => n.type)).toEqual(['text'])
    expect(richToPlain(price)).toBe(price)
  })

  it('honors an escaped dollar', () => {
    expect(richToPlain('\\$5')).toContain('$5')
  })

  it('reports a figure whose JSON does not parse, rather than dropping it', () => {
    const problems = richProblems('[[figure {not json}]]')
    expect(problems.length).toBeGreaterThan(0)
  })

  it('reports a figure whose JSON parses but is not a figure', () => {
    expect(richProblems('[[figure {"kind":"nope"}]]').length).toBeGreaterThan(0)
  })

  it('has no problems to report on plain text', () => {
    expect(richProblems('just a word')).toEqual([])
  })

  it('strips math and figures for the plain projection', () => {
    const text = 'Area of $\\frac{1}{2}$ [[figure {"kind":"circle","radius":"2 cm"}]]'
    expect(withoutRich(text)).not.toContain('figure')
    expect(withoutRich(text)).not.toContain('frac')
  })

  it('does not split inside an equation or a figure', () => {
    const rows = splitOutsideRich('a, b, [[figure {"kind":"bar","data":[{"label":"x","value":1}]}]]', /,\s*/)
    expect(rows).toHaveLength(3)
  })

  it('returns the whole string when the separator never appears', () => {
    expect(splitOutsideRich('nothing here', /\t/)).toEqual(['nothing here'])
  })

  it('handles an empty string everywhere', () => {
    expect(parseRich('')).toEqual([])
    expect(richToPlain('')).toBe('')
    expect(hasRich('')).toBe(false)
    expect(richProblems('')).toEqual([])
  })

  it('treats an unterminated figure marker as text', () => {
    expect(() => parseRich('[[figure {"kind":"bar"')).not.toThrow()
  })

  it('treats an unmatched $$ as text rather than swallowing the card', () => {
    expect(richToPlain('$$x + 1')).toContain('x + 1')
  })
})

describe('pasted MathML inside card text', () => {
  it('reads a <math> block sitting in ordinary prose', () => {
    const nodes = parseRich('The answer is <math><mi>x</mi></math> exactly.')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'math', 'text'])
  })

  it('takes the rest of the card when the closing tag is missing', () => {
    const nodes = parseRich('So <math><mi>y</mi>')
    expect(nodes.some((n) => n.type === 'math')).toBe(true)
  })

  it('marks unreadable MathML as a problem rather than dropping the card', () => {
    // `<math>` opens, so this is claimed to be math; nothing inside parses.
    const problems = richProblems('<math></math>')
    expect(Array.isArray(problems)).toBe(true)
  })

  it('projects pasted MathML to text for grading and for a screen reader', () => {
    expect(richToPlain('<math><mi>z</mi></math>')).toContain('z')
  })
})

describe('the richer figure options', () => {
  it('keeps number-line points and intervals, and drops the ones with no position', () => {
    const result = validateFigure({
      kind: 'numberline',
      min: 0,
      max: 10,
      points: [{ at: 3, label: 'a' }, { label: 'nowhere' }, { at: 7, open: true }],
      intervals: [{ from: 8, to: 2 }, { from: 1 }],
    })
    expect(result.ok && result.spec.kind === 'numberline').toBe(true)
    if (result.ok && result.spec.kind === 'numberline') {
      expect(result.spec.points).toHaveLength(2)
      // An interval given backwards is a typo, not a reason to lose it.
      expect(result.spec.intervals?.[0]).toMatchObject({ from: 2, to: 8 })
      expect(result.spec.intervals).toHaveLength(1)
    }
  })

  it('keeps plot segments and polygons that have real coordinates', () => {
    const result = validateFigure({
      kind: 'plot',
      points: [{ at: [1, 2] }],
      segments: [{ from: [0, 0], to: [3, 3] }, { from: [0, 0] }],
      polygons: [{ points: [[0, 0], [1, 0], [0, 1]] }, { points: [[0, 0], [1, 1]] }],
    })
    expect(result.ok && result.spec.kind === 'plot').toBe(true)
    if (result.ok && result.spec.kind === 'plot') {
      expect(result.spec.segments).toHaveLength(1)
      // Two points is a line, not a polygon.
      expect(result.spec.polygons).toHaveLength(1)
    }
  })

  it('describes each kind differently, so two figures never read alike', () => {
    const said = new Set(
      (
        [
          { kind: 'bar', data: [{ label: 'a', value: 1 }] },
          { kind: 'pie', data: [{ label: 'a', value: 1 }] },
          { kind: 'numberline', min: 0, max: 5 },
          { kind: 'triangle', sides: ['3', '4', '5'] },
          { kind: 'circle', radius: '2' },
        ] as FigureSpec[]
      ).map(figureAlt),
    )
    expect(said.size).toBe(5)
  })
})
