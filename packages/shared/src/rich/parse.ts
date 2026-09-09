// Splitting card text into the things it is made of.
//
// The format is additive on purpose: a card is still a string, so every deck
// ever saved, every pasted import and every answer already in the progress
// record keeps working untouched. What changes is that four things inside that
// string now mean something:
//
//   $x^2 + 1$                     inline math, written TeX-style
//   $$\frac{a}{b}$$               the same, set as a display block
//   <math>…</math>                MathML pasted straight out of Word or MathType
//   [[figure {"kind":"bar", …}]]  a chart or a geometry drawing
//
// Everything else is text, `\$` is a literal dollar sign, and anything that
// fails to parse is reported rather than thrown away — a broken figure on a
// card should tell its author what is wrong, not vanish mid-quiz.

import { figureAlt, findFigure, validateFigure, type FigureSpec } from './figures.js'
import { mathToText, parseMathML, type MathNode } from './mathml.js'
import { texToMath } from './tex.js'

/**
 * `start` and `end` are where the node sits in the original string. Anything
 * that wants to split card text — the paste importer cutting rows apart, the
 * grader cutting alternative answers apart — has to know which separators are
 * really separators and which are punctuation inside an equation.
 */
export type RichNode =
  | { type: 'text'; value: string }
  | {
      type: 'math'
      node: MathNode
      display: boolean
      text: string
      source: string
      start: number
      end: number
    }
  | { type: 'figure'; spec: FigureSpec; source: string; start: number; end: number }
  | { type: 'invalid'; source: string; message: string; start: number; end: number }

/** A cheap "is there anything in here at all?", for the render fast path. */
const RICH_HINT = /\$|<math|\[\[\s*fig/i

export function hasRich(source: string): boolean {
  return RICH_HINT.test(source)
}

const MATHML_OPEN = /^<\s*(?:[A-Za-z_][\w.-]*:)?math\b/i
const MATHML_CLOSE = /<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?math\s*>/i

export function parseRich(source: string): RichNode[] {
  if (!source) return []
  if (!hasRich(source)) return [{ type: 'text', value: source }]

  const out: RichNode[] = []
  let text = ''
  let i = 0

  const flush = () => {
    if (text) out.push({ type: 'text', value: text })
    text = ''
  }

  while (i < source.length) {
    const ch = source[i]

    // An escaped dollar is money, not math.
    if (ch === '\\' && source[i + 1] === '$') {
      text += '$'
      i += 2
      continue
    }

    if (ch === '$') {
      const display = source.startsWith('$$', i)
      const open = display ? 2 : 1
      const close = findClosingDollar(source, i + open, display)
      if (close < 0) {
        // An unmatched dollar is far more likely to be a price than a broken
        // equation, so it stays as text and the card reads normally.
        text += ch
        i += 1
        continue
      }
      const body = source.slice(i + open, close)
      flush()
      const { node } = texToMath(body, display)
      out.push({
        type: 'math',
        node,
        display,
        text: mathToText(node),
        source: source.slice(i, close + open),
        start: i,
        end: close + open,
      })
      i = close + open
      continue
    }

    if (ch === '<' && MATHML_OPEN.test(source.slice(i, i + 24))) {
      const rest = source.slice(i)
      const end = MATHML_CLOSE.exec(rest)
      const chunk = end ? rest.slice(0, end.index + end[0].length) : rest
      const node = parseMathML(chunk)
      flush()
      if (node) {
        out.push({
          type: 'math',
          node,
          display: false,
          text: mathToText(node),
          source: chunk,
          start: i,
          end: i + chunk.length,
        })
      } else {
        out.push({
          type: 'invalid',
          source: chunk,
          message: 'That MathML could not be read.',
          start: i,
          end: i + chunk.length,
        })
      }
      i += chunk.length
      continue
    }

    if (ch === '[' && source[i + 1] === '[') {
      const found = findFigure(source, i)
      if (found && found.start === i) {
        flush()
        out.push(readFigure(source.slice(found.start, found.end), found.json, found.start, found.end))
        i = found.end
        continue
      }
    }

    text += ch
    i += 1
  }

  flush()
  return out
}

function readFigure(source: string, json: string, start: number, end: number): RichNode {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { type: 'invalid', source, message: 'That figure is not valid JSON.', start, end }
  }
  const result = validateFigure(parsed)
  return result.ok
    ? { type: 'figure', spec: result.spec, source, start, end }
    : { type: 'invalid', source, message: result.error, start, end }
}

/**
 * Where the closing `$` is. Returns -1 when the math never closes, which is
 * the signal to leave the dollar sign as text.
 *
 * Two dollar signs in a sentence are far more often two prices than they are an
 * equation — "a shirt costs $12 and pants cost $20" would otherwise set the
 * middle of that sentence as math and drop the spaces out of it. So the span
 * has to look like math and not like money: it cannot be empty, and it cannot
 * begin or end against a space. `$\frac{3}{4}$` passes; every card about
 * pocket money fails, which is the right way round.
 */
function findClosingDollar(source: string, from: number, display: boolean): number {
  if (from >= source.length || /\s/.test(source[from])) return -1

  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] !== '$') continue
    if (display && !source.startsWith('$$', i)) continue
    if (i === from || /\s/.test(source[i - 1])) continue
    return i
  }
  return -1
}

/**
 * The card as characters a person could type or a screen reader could read.
 *
 * Everything downstream of rendering runs on this: answer checking, the
 * difficulty estimate, search, the results list. `$\frac{3}{4}$ of a pizza`
 * comes back as "3/4 of a pizza", which is exactly what a learner types.
 */
export function richToPlain(source: string): string {
  if (!hasRich(source)) return source
  return parseRich(source)
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value
        case 'math':
          return node.text
        case 'figure':
          return figureAlt(node.spec)
        case 'invalid':
          return ''
      }
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * The stretches of `source` that are math or a figure rather than prose.
 *
 * Everything that cuts card text apart needs this. A figure is JSON, and JSON
 * is made of the exact characters the paste importer splits on; an equation is
 * full of slashes and commas that mean division and decimal places. Splitting
 * without knowing where those spans are shreds them.
 */
export function richSpans(source: string): Array<[number, number]> {
  if (!hasRich(source)) return []
  return parseRich(source).flatMap((node) =>
    node.type === 'text' ? [] : [[node.start, node.end] as [number, number]],
  )
}

/**
 * Split on `pattern`, ignoring any match that falls inside math or a figure.
 *
 * `skip` gets the last chance to veto a separator — the grader uses it to keep
 * the slash in "3/4" while still splitting "couch / sofa".
 */
export function splitOutsideRich(
  text: string,
  pattern: RegExp,
  skip?: (match: string, index: number, text: string) => boolean,
): string[] {
  const spans = richSpans(text)
  if (!spans.length && !skip) return text.split(pattern)

  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  const parts: string[] = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text))) {
    const { index } = match
    // A zero-width match would spin here forever; step past it instead.
    if (!match[0].length) {
      re.lastIndex++
      continue
    }
    if (spans.some(([from, to]) => index >= from && index < to)) continue
    if (skip?.(match[0], index, text)) continue
    parts.push(text.slice(last, index))
    last = index + match[0].length
  }

  parts.push(text.slice(last))
  return parts
}

/** Card text with the math and the figures taken out, for detecting a separator. */
export function withoutRich(source: string): string {
  if (!hasRich(source)) return source
  return parseRich(source)
    .map((node) => (node.type === 'text' ? node.value : ' '))
    .join('')
}

/** Just the figures, for the places that lay a picture out separately from the text. */
export function richFigures(source: string): FigureSpec[] {
  if (!hasRich(source)) return []
  return parseRich(source).flatMap((n) => (n.type === 'figure' ? [n.spec] : []))
}

/**
 * What is wrong with this card, for the editor to show while it is being
 * written. Unknown TeX commands are included: a silent `\parallell` renders as
 * literal text in the middle of a quiz, and the author is the only person who
 * can fix it.
 */
export function richProblems(source: string): string[] {
  if (!hasRich(source)) return []
  const problems: string[] = []
  for (const node of parseRich(source)) {
    if (node.type === 'invalid') problems.push(node.message)
    if (node.type === 'math' && node.source.startsWith('$')) {
      const body = node.source.replace(/^\$+|\$+$/g, '')
      problems.push(...texToMath(body, node.display).warnings)
    }
  }
  return [...new Set(problems)]
}
