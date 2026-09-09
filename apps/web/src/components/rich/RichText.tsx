import { useMemo } from 'react'
import { figureAlt } from '../../lib/rich/figures'
import { parseRich } from '../../lib/rich/parse'
import FigureView from './FigureView'
import MathView from './MathView'

/**
 * Card text, with its math and its figures.
 *
 * This is the one component every screen that shows a card should use. Plain
 * text goes through untouched and costs a single regex test, so putting it
 * everywhere is free for the decks that have no math in them at all — which
 * is most of them, and which is the point: nothing about spelling or vocabulary
 * gets more complicated because geometry now works.
 */
export default function RichText({
  source,
  className,
  figures = 'draw',
}: {
  source: string
  className?: string
  /**
   * Somewhere too small to draw in — a match tile, a row in the deck list, a
   * line of the results — takes the figure's description instead. Dropping it
   * would leave the row saying nothing; drawing it would wreck the layout.
   */
  figures?: 'draw' | 'describe'
}) {
  const nodes = useMemo(() => parseRich(source), [source])

  // A drawn figure is a block element and a span may not contain one, so the
  // wrapper follows the content rather than making every caller decide.
  // Display math does not need it — it lays itself out as a block from inside
  // a span, which keeps this usable inside a paragraph.
  const needsBlock = nodes.some((n) => n.type === 'figure' && figures === 'draw')
  const Wrapper = needsBlock ? 'div' : 'span'

  return (
    <Wrapper className={className}>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <span key={i}>{node.value}</span>
          case 'math':
            return <MathView key={i} node={node.node} display={node.display} />
          case 'figure':
            return figures === 'draw' ? (
              <FigureView key={i} spec={node.spec} />
            ) : (
              <span key={i} className="italic">
                {figureAlt(node.spec)}
              </span>
            )
          case 'invalid':
            // Loud enough that whoever wrote the card notices, quiet enough
            // that a learner mid-round is not derailed by it.
            return (
              <span
                key={i}
                className="mx-1 rounded-lg bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-extrabold text-amber-800"
                title={node.message}
              >
                ⚠️ {node.message}
              </span>
            )
        }
      })}
    </Wrapper>
  )
}
