// The MathML half of rich card content: the node tree everything compiles to,
// a sanitiser for MathML pasted in from elsewhere, and a plain-text projection.
//
// Card text is authored by parents, tutors and kids, and a deck can be shared
// with a whole class — so author input is never HTML we trust. Nothing here
// produces markup. It produces a tree of allow-listed nodes, which React turns
// into real elements; there is no innerHTML anywhere in the pipeline, which is
// what makes "paste the equation out of Word" a safe thing to offer.

/** Every element we are willing to put on the page. MathML Core only. */
export const MATH_TAGS = [
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'mfrac',
  'msqrt',
  'mroot',
  'msup',
  'msub',
  'msubsup',
  'mover',
  'munder',
  'munderover',
  'mstyle',
  'mtable',
  'mtr',
  'mtd',
] as const

export type MathTag = (typeof MATH_TAGS)[number]

const TAG_SET = new Set<string>(MATH_TAGS)

/**
 * Presentation attributes worth keeping. Anything outside this set is dropped,
 * which is the whole sanitisation story for attributes: no `style`, no `href`,
 * no `on*`, no `class` that could borrow the app's own styling.
 */
const ALLOWED_ATTRS = new Set([
  'accent',
  'accentunder',
  'columnalign',
  'columnspacing',
  'depth',
  'display',
  'displaystyle',
  'fence',
  'height',
  'linethickness',
  'mathvariant',
  'movablelimits',
  'rowalign',
  'rowspacing',
  'scriptlevel',
  'separator',
  'stretchy',
  'symmetric',
  'width',
])

/**
 * Elements dropped along with their contents. `annotation` holds the TeX or
 * OMML an exporter tucked beside the MathML, which would otherwise be printed
 * as visible text; `script` and `style` are here because unknown elements are
 * unwrapped rather than dropped, and unwrapping those two would put their
 * source on the page.
 */
const DROPPED_TAGS = new Set([
  'annotation',
  'annotation-xml',
  'maction',
  'merror',
  'script',
  'style',
])

export interface MathNode {
  tag: MathTag
  attrs?: Record<string, string>
  children?: MathNode[]
  /** Leaf text, on mi/mn/mo/mtext only. */
  text?: string
}

// A pasted equation should never be able to lock the tab up rendering itself.
const MAX_NODES = 600
const MAX_DEPTH = 30

export function el(
  tag: MathTag,
  children: MathNode[] = [],
  attrs?: Record<string, string>,
): MathNode {
  return attrs ? { tag, children, attrs } : { tag, children }
}

export function leaf(tag: MathTag, text: string, attrs?: Record<string, string>): MathNode {
  return attrs ? { tag, text, attrs } : { tag, text }
}

/** One child stays as it is; several get wrapped, because most MathML elements take exactly one. */
export function row(children: MathNode[]): MathNode {
  return children.length === 1 ? children[0] : el('mrow', children)
}

// --- Entities -------------------------------------------------------------

// Word, MathType and Google Docs all export named entities, and a missed one
// shows up as literal "&times;" in the middle of a question. The list is the
// ones that actually turn up in school math rather than all 2000 of them.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  minus: '−',
  times: '×',
  divide: '÷',
  plusmn: '±',
  middot: '·',
  sdot: '⋅',
  deg: '°',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  equiv: '≡',
  cong: '≅',
  sim: '∼',
  ang: '∠',
  angle: '∠',
  perp: '⊥',
  par: '∥',
  parallel: '∥',
  radic: '√',
  infin: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  mu: 'μ',
  sigma: 'σ',
  omega: 'ω',
  rarr: '→',
  larr: '←',
  harr: '↔',
  frac12: '½',
  frac13: '⅓',
  frac14: '¼',
  frac34: '¾',
  prime: '′',
  Prime: '″',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

// --- Parsing pasted MathML ------------------------------------------------

interface Cursor {
  src: string
  i: number
  nodes: number
}

/**
 * A small, forgiving XML reader rather than DOMParser.
 *
 * DOMParser would be less code, but it only exists in the browser, and the
 * same parse has to run in a plain Node test and (later) anywhere else that
 * wants to know what a card actually says. Forgiving matters too: this is fed
 * whatever an office suite exported, so an unclosed tag returns what it has
 * rather than throwing the question away.
 */
export function parseMathML(source: string): MathNode | null {
  const cursor: Cursor = { src: source, i: 0, nodes: 0 }
  const start = source.indexOf('<')
  if (start < 0) return null
  cursor.i = start
  const parsed = readElement(cursor, 0)
  if (!parsed) return null
  // Whatever we were handed, the outermost element we render is always <math>.
  if (parsed.tag === 'math') return parsed
  return el('math', [row(parsed.children ?? [parsed])])
}

function localName(name: string): string {
  const colon = name.indexOf(':')
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase()
}

/** Reads one element (and its subtree) starting at a `<`. */
function readElement(c: Cursor, depth: number): MathNode | null {
  const children = readNodes(c, depth, null)
  return children.length ? (children.length === 1 ? children[0] : el('mrow', children)) : null
}

/**
 * Reads siblings until `closing` is closed (or the source runs out). Unknown
 * elements are unwrapped rather than dropped: an `<mrow>` inside a `<semantics>`
 * inside an `<m:math>` should still reach the page.
 */
function readNodes(c: Cursor, depth: number, closing: string | null): MathNode[] {
  const out: MathNode[] = []
  if (depth > MAX_DEPTH) return out

  while (c.i < c.src.length) {
    const lt = c.src.indexOf('<', c.i)
    if (lt < 0) {
      pushText(out, c.src.slice(c.i))
      c.i = c.src.length
      break
    }
    pushText(out, c.src.slice(c.i, lt))
    c.i = lt

    if (c.src.startsWith('<!--', c.i)) {
      const end = c.src.indexOf('-->', c.i)
      c.i = end < 0 ? c.src.length : end + 3
      continue
    }
    if (c.src.startsWith('<?', c.i) || c.src.startsWith('<!', c.i)) {
      const end = c.src.indexOf('>', c.i)
      c.i = end < 0 ? c.src.length : end + 1
      continue
    }

    const close = /^<\/\s*([^\s>]+)\s*>/.exec(c.src.slice(c.i))
    if (close) {
      c.i += close[0].length
      // A stray close tag for something else is simply ignored, which keeps a
      // mismatched export from swallowing the rest of the equation.
      if (closing === null || localName(close[1]) === closing) break
      continue
    }

    const open = /^<\s*([^\s/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*(\/?)>/.exec(c.src.slice(c.i))
    if (!open) {
      // Not a tag after all — a bare "<" in the text.
      pushText(out, '<')
      c.i += 1
      continue
    }
    c.i += open[0].length

    const name = localName(open[1])
    const selfClosing = open[3] === '/'
    const kids = selfClosing ? [] : readNodes(c, depth + 1, name)

    if (DROPPED_TAGS.has(name)) continue
    if (!TAG_SET.has(name)) {
      // Unknown wrapper (semantics, mfenced, m:oMath, …): keep the contents.
      out.push(...kids)
      continue
    }
    // Past the budget the surplus children are dropped, but never the <math>
    // itself — losing that turns a big-but-valid equation into "could not be
    // read", when a truncated equation is much closer to what was pasted.
    if (c.nodes++ > MAX_NODES && name !== 'math') continue

    const tag = name as MathTag
    const attrs = readAttrs(open[2])
    if (isLeafTag(tag)) {
      out.push(leaf(tag, textOf(kids), attrs))
    } else if (tag === 'math') {
      out.push(el('math', [row(kids)], attrs))
    } else {
      out.push(el(tag, kids, attrs))
    }
  }

  return out
}

function isLeafTag(tag: MathTag): boolean {
  return tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext'
}

function pushText(out: MathNode[], raw: string) {
  const text = decodeEntities(raw)
  if (!text.trim()) return
  // Loose text inside MathML is rare and always incidental; treating it as an
  // operator is closer to right than dropping it.
  out.push(leaf('mo', text.trim()))
}

function textOf(nodes: MathNode[]): string {
  return nodes.map((n) => n.text ?? textOf(n.children ?? [])).join('')
}

function readAttrs(raw: string): Record<string, string> | undefined {
  const attrs: Record<string, string> = {}
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const name = localName(m[1])
    if (!ALLOWED_ATTRS.has(name)) continue
    attrs[name] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '').slice(0, 60)
  }
  return Object.keys(attrs).length ? attrs : undefined
}

// --- Plain text -----------------------------------------------------------

/**
 * What the equation says, in characters a person could type.
 *
 * This is not decoration: it is what a written answer is graded against and
 * what a screen reader is given, so `$\frac{1}{2}$` has to come back as "1/2"
 * — the thing a learner would actually type — and not as "12".
 */
export function mathToText(node: MathNode): string {
  const kids = node.children ?? []
  const part = (i: number) => (kids[i] ? mathToText(kids[i]) : '')
  const wrap = (i: number) => {
    const text = part(i)
    // Parenthesise only when the piece is compound, so simple fractions read
    // as "1/2" rather than "(1)/(2)".
    return /^[\w.°]*$/.test(text) ? text : `(${text})`
  }

  switch (node.tag) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
      return node.text ?? ''
    case 'mspace':
      return ' '
    case 'mfrac':
      return `${wrap(0)}/${wrap(1)}`
    case 'msqrt':
      return `sqrt(${part(0)})`
    case 'mroot':
      return `root${part(1)}(${part(0)})`
    case 'msup': {
      const sup = part(1)
      // A degree sign or a prime is written up against its number, not as a
      // power: 45° reads back as "45°", which is what someone types.
      if (sup === '°' || sup === '′' || sup === '″') return `${wrap(0)}${sup}`
      return `${wrap(0)}^${wrap(1)}`
    }
    case 'msub':
      return `${wrap(0)}_${wrap(1)}`
    case 'msubsup':
      return `${wrap(0)}_${wrap(1)}^${wrap(2)}`
    case 'mover':
    case 'munder':
      return part(0)
    case 'munderover':
      return part(0)
    case 'mtd':
      return part(0)
    case 'mtr':
      return kids.map(mathToText).join(', ')
    case 'mtable':
      return kids.map(mathToText).join('; ')
    default:
      return kids.map(mathToText).join('')
  }
}
