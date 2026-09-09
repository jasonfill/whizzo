// A small TeX-like notation compiled to the MathML tree in ./mathml.
//
// Nobody writes MathML by hand — it takes forty characters to say "one half" —
// so the thing an author types is `$\frac{1}{2}$`, which is the notation every
// math teacher already half-knows and every AI already writes. This covers the
// subset that shows up in school work through geometry and early algebra:
// fractions, roots, powers, the Greek letters, the relation symbols, and the
// overline/arrow accents that segment and ray names need. Anything past that
// (matrices, integrals with limits, chemistry) is deliberately absent — a card
// is a prompt, not a textbook.
//
// Unknown commands are never dropped silently: they come back as warnings so
// the editor can say "\foo isn't something I know" while the author is still
// looking at the card.

import { el, leaf, row, type MathNode } from './mathml.js'

export interface TexResult {
  node: MathNode
  warnings: string[]
}

/** Single characters that stand for themselves as operators. */
const OPERATOR_TEXT: Record<string, string> = {
  '-': '−',
  '*': '⋅',
}

const SYMBOLS: Record<string, string> = {
  // Greek — the ones that turn up in geometry and early algebra.
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  Omega: 'Ω',
  Theta: 'Θ',
  Pi: 'Π',
}

const OPERATORS: Record<string, string> = {
  times: '×',
  div: '÷',
  cdot: '⋅',
  pm: '±',
  mp: '∓',
  ast: '∗',
  circ: '∘',
  degree: '°',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  cong: '≅',
  sim: '∼',
  propto: '∝',
  parallel: '∥',
  nparallel: '∦',
  perp: '⊥',
  angle: '∠',
  measuredangle: '∡',
  triangle: '△',
  square: '□',
  infty: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  mapsto: '↦',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  therefore: '∴',
  because: '∵',
  ldots: '…',
  cdots: '⋯',
  dots: '…',
  prime: '′',
  '%': '%',
  $: '$',
  '{': '{',
  '}': '}',
  '&': '&',
  '#': '#',
  _: '_',
  '^': '^',
}

/** Function names set upright, the way TeX sets them. */
const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'csc',
  'sec',
  'cot',
  'arcsin',
  'arccos',
  'arctan',
  'log',
  'ln',
  'exp',
  'max',
  'min',
  'gcd',
  'lcm',
  'mod',
])

/**
 * Accents drawn over their argument: the notation for segments, rays and
 * vectors. The bar and the arrows are marked stretchy so they run the full
 * width of what they cover — an overline that sits over the A of AB is not
 * segment notation, it is a typo.
 */
const OVER_ACCENTS: Record<string, { text: string; stretchy: boolean }> = {
  overline: { text: '¯', stretchy: true },
  bar: { text: '¯', stretchy: true },
  hat: { text: '^', stretchy: false },
  tilde: { text: '~', stretchy: false },
  vec: { text: '→', stretchy: true },
  overrightarrow: { text: '→', stretchy: true },
  overleftarrow: { text: '←', stretchy: true },
  overleftrightarrow: { text: '↔', stretchy: true },
}

const SPACES: Record<string, string> = {
  ',': '0.17em',
  ':': '0.22em',
  ';': '0.28em',
  ' ': '0.5em',
  quad: '1em',
  qquad: '2em',
}

const OPEN_FENCES = '([{|'
const CLOSE_FENCES = ')]}|'

class TexParser {
  private i = 0
  readonly warnings: string[] = []

  constructor(private readonly src: string) {}

  parse(): MathNode[] {
    return this.nodes(null)
  }

  // --- scanning helpers ---

  private eof() {
    return this.i >= this.src.length
  }

  private peek() {
    return this.src[this.i] ?? ''
  }

  private skipSpace() {
    while (!this.eof() && /\s/.test(this.src[this.i])) this.i++
  }

  /** Reads `\name` (letters) or a single-character command such as `\{`. */
  private readCommand(): string {
    this.i++ // the backslash
    const rest = this.src.slice(this.i)
    const word = /^[a-zA-Z]+/.exec(rest)
    if (word) {
      this.i += word[0].length
      return word[0]
    }
    const ch = this.src[this.i] ?? ''
    this.i++
    return ch
  }

  /** The raw contents of a `{...}` group, braces balanced, for `\text`. */
  private readRawGroup(): string {
    this.skipSpace()
    if (this.peek() !== '{') {
      // `\text x` is not legal TeX, but taking the next character beats failing.
      const ch = this.src[this.i] ?? ''
      this.i++
      return ch
    }
    this.i++
    let depth = 1
    let out = ''
    while (!this.eof() && depth > 0) {
      const ch = this.src[this.i]
      if (ch === '\\' && this.i + 1 < this.src.length) {
        out += this.src[this.i + 1]
        this.i += 2
        continue
      }
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === 0) {
          this.i++
          break
        }
      }
      out += ch
      this.i++
    }
    return out
  }

  /** One argument: a braced group, or the single atom that follows. */
  private argument(): MathNode {
    this.skipSpace()
    if (this.peek() === '{') {
      this.i++
      return row(this.nodes('}'))
    }
    const atom = this.atom()
    return atom ?? el('mrow', [])
  }

  // --- the grammar ---

  private nodes(stop: string | null): MathNode[] {
    const out: MathNode[] = []
    while (!this.eof()) {
      this.skipSpace()
      if (this.eof()) break
      if (stop && this.peek() === stop) {
        this.i++
        break
      }
      if (this.peek() === '}') {
        // A closing brace with nothing open is a typo, not a reason to stop.
        this.i++
        this.warnings.push('An extra } was ignored.')
        continue
      }
      const atom = this.atom()
      if (!atom) continue
      out.push(this.withScripts(atom))
    }
    return out
  }

  /**
   * Attaches `^` and `_` to the atom just read. Both together become msubsup
   * rather than two nested scripts, because that is the only way the sub and
   * the sup line up vertically.
   */
  private withScripts(base: MathNode): MathNode {
    let sub: MathNode | null = null
    let sup: MathNode | null = null

    for (;;) {
      this.skipSpace()
      const ch = this.peek()
      if (ch !== '^' && ch !== '_') break
      this.i++
      const arg = this.scriptArgument(ch === '^')
      if (ch === '^') sup = sup ? row([sup, arg]) : arg
      else sub = sub ? row([sub, arg]) : arg
    }

    if (sub && sup) return el('msubsup', [base, sub, sup])
    if (sup) return el('msup', [base, sup])
    if (sub) return el('msub', [base, sub])
    return base
  }

  /**
   * `45^\circ` is how everyone writes 45 degrees, and `∘` is not `°`. TeX has
   * the same special case; without it every angle on every geometry card is
   * set with a ring operator instead of a degree sign.
   */
  private scriptArgument(isSuper: boolean): MathNode {
    if (isSuper) {
      const save = this.i
      this.skipSpace()
      if (this.peek() === '\\') {
        const name = this.readCommand()
        if (name === 'circ' || name === 'degree') return leaf('mo', '°')
        this.i = save
      } else {
        this.i = save
      }
    }
    return this.argument()
  }

  private atom(): MathNode | null {
    const ch = this.peek()

    if (ch === '{') {
      this.i++
      return row(this.nodes('}'))
    }
    if (ch === '\\') return this.command()

    // Numbers keep their decimal point and thousands separators together, so
    // "1,250.5" is one number and not five atoms.
    const number = /^\d[\d,]*(?:\.\d+)?|^\.\d+/.exec(this.src.slice(this.i))
    if (number) {
      this.i += number[0].length
      return leaf('mn', number[0])
    }
    if (/[a-zA-Z]/.test(ch)) {
      this.i++
      return leaf('mi', ch)
    }

    this.i++
    if (OPEN_FENCES.includes(ch) || CLOSE_FENCES.includes(ch)) {
      return leaf('mo', ch, { stretchy: 'false' })
    }
    return leaf('mo', OPERATOR_TEXT[ch] ?? ch)
  }

  private command(): MathNode | null {
    const name = this.readCommand()

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = this.argument()
      const den = this.argument()
      return el('mfrac', [num, den])
    }
    if (name === 'sqrt') {
      this.skipSpace()
      // `\sqrt[3]{8}` — the optional index makes it a cube root.
      if (this.peek() === '[') {
        this.i++
        const index = row(this.nodes(']'))
        return el('mroot', [this.argument(), index])
      }
      return el('msqrt', [this.argument()])
    }
    if (name === 'text' || name === 'textrm' || name === 'mbox') {
      return leaf('mtext', this.readRawGroup())
    }
    if (name === 'underline') {
      return el('munder', [this.argument(), leaf('mo', '_', { stretchy: 'true' })], {
        accentunder: 'true',
      })
    }
    if (name in OVER_ACCENTS) {
      const accent = OVER_ACCENTS[name]
      return el(
        'mover',
        [this.argument(), leaf('mo', accent.text, { stretchy: String(accent.stretchy) })],
        { accent: 'true' },
      )
    }
    if (name === 'left' || name === 'right') {
      this.skipSpace()
      const fence = this.src[this.i] ?? ''
      this.i++
      if (fence === '.') return null // \left. is an invisible fence
      return leaf('mo', fence, { stretchy: 'true' })
    }
    if (name in SPACES) {
      return leaf('mspace', '', { width: SPACES[name] })
    }
    if (name === '\\' || name === 'newline') {
      return leaf('mspace', '', { width: '0.5em' })
    }
    if (FUNCTIONS.has(name)) {
      return leaf('mi', name, { mathvariant: 'normal' })
    }
    if (name in SYMBOLS) {
      return leaf('mi', SYMBOLS[name])
    }
    if (name in OPERATORS) {
      return leaf('mo', OPERATORS[name])
    }

    this.warnings.push(`\\${name} is not something I know how to draw.`)
    return leaf('mtext', `\\${name}`)
  }
}

/**
 * Compile TeX-lite to a `<math>` node.
 *
 * `display` is the block form — bigger, centerd, with full-size fraction bars —
 * used for `$$…$$`. Inline math stays on the text's line and at its size.
 */
export function texToMath(source: string, display = false): TexResult {
  const parser = new TexParser(source)
  const children = parser.parse()
  const node = el('math', [row(children.length ? children : [el('mrow', [])])], {
    display: display ? 'block' : 'inline',
  })
  return { node, warnings: parser.warnings }
}
