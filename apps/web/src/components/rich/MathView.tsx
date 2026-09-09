import { createElement, type ReactNode } from 'react'
import { MATH_TAGS, type MathNode } from '../../lib/rich/mathml'

const ALLOWED = new Set<string>(MATH_TAGS)

/**
 * A MathML tree, as real MathML elements.
 *
 * React has rendered the MathML namespace since 16, so `<mfrac>` here is a
 * genuine `<mfrac>` in the document and the browser sets the equation itself —
 * no layout engine shipped to the client, no `innerHTML`, and the math is in
 * the accessibility tree for a screen reader to read as math rather than as a
 * picture of math.
 *
 * The allow-list is checked again on the way out. It has already been applied
 * once during parsing, and belt-and-braces is cheap when the alternative is
 * putting author-controlled tag names into the DOM.
 */
function toElement(node: MathNode, key: number): ReactNode {
  if (!ALLOWED.has(node.tag)) return null
  const props: Record<string, unknown> = { key, ...(node.attrs ?? {}) }
  if (node.text !== undefined) return createElement(node.tag, props, node.text)
  return createElement(node.tag, props, (node.children ?? []).map(toElement))
}

export default function MathView({
  node,
  display = false,
}: {
  node: MathNode
  /** Block form: on its own line, centerd, at full size. */
  display?: boolean
}) {
  const rendered = toElement(node, 0)
  if (display) {
    // Overflow scrolls rather than wrapping: a long equation that reflows mid
    // expression is harder to read than one you scroll.
    return <span className="my-2 block overflow-x-auto text-center text-[1.15em]">{rendered}</span>
  }
  return <span className="whitespace-nowrap">{rendered}</span>
}
