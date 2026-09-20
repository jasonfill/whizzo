import { useMemo, type ReactNode } from 'react'
import { figureAlt } from '../../lib/rich/figures'
import { parseRich } from '../../lib/rich/parse'
import { useReading } from '../../lib/speech/reading'
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
 *
 * It also follows the read-aloud voice. While this exact text is the thing
 * being spoken, the word being said is highlighted — so a child who is still
 * decoding can see which shape made which sound instead of hearing the whole
 * line go past. Nothing has to be passed in for that: the reading is keyed by
 * the text, so every place showing it lights up together and a card that is
 * not being read does no extra work at all.
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
  const { word, words } = useReading(source)
  const spoken = word >= 0 ? (words[word] ?? null) : null

  // A drawn figure is a block element and a span may not contain one, so the
  // wrapper follows the content rather than making every caller decide.
  // Display math does not need it — it lays itself out as a block from inside
  // a span, which keeps this usable inside a paragraph.
  const needsBlock = nodes.some((n) => n.type === 'figure' && figures === 'draw')
  const Wrapper = needsBlock ? 'div' : 'span'

  return (
    <Wrapper className={className}>
      {nodes.map((node, i) => {
        // The word being said, when it falls inside this node. Held as the
        // word itself rather than a flag so the slicing below stays narrow.
        const lit = spoken && spoken.node === i ? spoken : null
        switch (node.type) {
          case 'text':
            // Only the word being said is wrapped, so the rest of the line is
            // the same single text node it was before anyone pressed play.
            return lit && !lit.whole ? (
              <span key={i}>
                {node.value.slice(0, lit.at)}
                <Spoken>{lit.text}</Spoken>
                {node.value.slice(lit.at + lit.text.length)}
              </span>
            ) : (
              <span key={i}>{node.value}</span>
            )
          case 'math':
            // An equation is read as a phrase — "six over eight" — so it
            // lights up as one thing. Highlighting inside it would mean
            // claiming a mapping from words back to symbols that does not
            // survive a fraction.
            return (
              <Spoken key={i} lit={lit !== null}>
                <MathView node={node.node} display={node.display} />
              </Spoken>
            )
          case 'figure':
            return figures === 'draw' ? (
              // A drawing cannot be read word by word either, so it takes the
              // highlight as a ring around the whole thing while its
              // description is being said.
              <div key={i} className={lit ? 'rounded-2xl ring-4 ring-sun' : undefined}>
                <FigureView spec={node.spec} />
              </div>
            ) : (
              <Spoken key={i} lit={lit !== null}>
                <span className="italic">{figureAlt(node.spec)}</span>
              </Spoken>
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

/**
 * The word the voice is on.
 *
 * `bg-sun` rather than the theme accent, for the same reason a progress bar is
 * never themed: this is telling the learner where they are, not decorating.
 * With `lit` given explicitly it renders the children unchanged when false,
 * which keeps the rendered tree identical to the pre-speech one while nothing
 * is being read.
 */
function Spoken({ children, lit = true }: { children: ReactNode; lit?: boolean }) {
  if (!lit) return <>{children}</>
  // No padding, on purpose. Padding on an inline element pushes the rest of
  // the line along, so every word the voice reached would nudge the sentence
  // sideways. The ring is drawn with a shadow instead, which takes up no
  // space at all and leaves the text exactly where the eye left it.
  return (
    <mark className="box-decoration-clone rounded-[3px] bg-sun text-ink shadow-[0_0_0_3px_#FFC542]">
      {children}
    </mark>
  )
}
