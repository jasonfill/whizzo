// The instructions, kept apart from the code that sends them.
//
// Separate because they are the cacheable half. The document, the system
// prompt and the card-formatting grammar are identical across every topic call
// for one document, so they sit in front of a cache breakpoint and only the
// topic instruction varies. On a twenty-page PDF that is the difference between
// paying for the document six times and paying for it once.

/**
 * The grammar a card may be written in.
 *
 * Kept verbatim from docs/card-formatting.md rather than paraphrased: it is the
 * highest-leverage part of the whole prompt, and a summary of a grammar is a
 * grammar the model will get subtly wrong.
 */
export const CARD_GRAMMAR = `Card text is plain text, with four exceptions:

  $x^2 + 1$                     math, on the line, written TeX-style
  $$\\frac{a}{b}$$               the same math, on its own line
  <math>…</math>                MathML pasted from a word processor
  [[figure {"kind":"bar", …}]]  a drawing: chart, shape, number line, grid
  \\$                            a literal dollar sign

Supported math: \\frac \\sqrt ^ _ ^\\circ \\overline \\overrightarrow \\vec
\\text \\times \\div \\cdot \\pm \\le \\ge \\ne \\approx \\cong \\sim \\angle
\\triangle \\parallel \\perp, Greek letters, and \\sin \\cos \\tan \\log \\ln.
A command outside that list renders as literal text — do not use one.

Figure kinds and their required fields:
  bar        data: [{label, value}]
  line       series: [{name, points: [[x,y]]}]
  pie        data: [{label, value}]
  numberline min, max
  plot       (all optional: points, segments, polygons, grid)
  triangle   (optional: sides, angles, labels, rightAngle)
  rect       width, height
  polygon    points: [[x,y]]
  circle     (optional: radius, diameter, sector)
  angle      degrees

Every value a question could ask about must be written on the figure. A learner
reading a bar chart is being asked to read a number; making them estimate it off
a gridline is a different and worse task.`

export const READ_SYSTEM = `You are helping a parent or teacher turn a document
they already have into practice material for one child.

Your job in this step is only to read and describe. Do not write any cards yet.

Report what the document is, who it appears to be for, and what is genuinely
learnable in it — broken into topics a child could practice one at a time. A
topic is something with enough substance for a short round of practice, not
every heading on the page.

Be honest about what is there. A worksheet with six spelling words has one
topic, not six. If the document is mostly instructions, a permission slip, or a
timetable, say so in the note and return no topics rather than inventing them —
a parent would far rather hear "there is nothing to practice here" than be
handed twenty cards about the school's address.

Cite the pages each topic came from.`

export const BUILD_SYSTEM = `You are writing practice cards from a document a
parent or teacher uploaded, for one child to study.

A card is a question and the answer to it. That is the whole shape, and it is
stricter than it sounds:

  * The question side must be answerable on its own. "1953" is not a card;
    "What year was Everest first climbed?" is.
  * The answer side is what the learner has to produce. Keep it as short as it
    can be while still being the answer — a learner typing a paragraph from
    memory is being tested on typing.
  * Ask about what the document teaches, not about the document. "How many
    pages is this chapter?" is not a card.
  * Never write a card whose answer is not in the source material.

Write the math and the figures in the grammar below. A figure earns its place
when the figure *is* the question — a chart to read, a shape to measure — and
not as decoration.

Fill in the optional fields when the document supports them and leave them null
when it does not. An invented example sentence is worse than none; a wrong
explanation is much worse than none.`

/** One topic's worth of instruction. The only part that varies per call. */
export function buildInstruction(topic: { title: string; summary: string; pages: number[] }): string {
  const pages = topic.pages.length ? ` It is on page${topic.pages.length === 1 ? '' : 's'} ${topic.pages.join(', ')}.` : ''
  return `Write the cards for this topic, and only this topic: "${topic.title}".
${topic.summary}${pages}

Return between 4 and 30 cards. Fewer good cards beat more thin ones — if the
topic only supports six, write six.`
}
