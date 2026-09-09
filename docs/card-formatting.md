# Math and figures on a card

A quiz card is two strings. That is still true — nothing about the deck format,
the wire contract or the database changed to make math work. What changed is
that four things inside those strings now mean something.

```
$\frac{3}{4}$ of the pizza is left. How much is that as a decimal?
```

Everything else is plain text, so a spelling deck, a vocabulary deck, and every
deck saved before any of this existed all keep working untouched.

| You write | You get |
| --- | --- |
| `$…$` | math, on the line, written TeX-style |
| `$$…$$` | the same math, on its own line and larger |
| `<math>…</math>` | MathML pasted straight out of Word, MathType or Google Docs |
| `[[figure {…}]]` | a drawing: a chart, a shape, a number line, a grid |
| `\$` | a literal dollar sign |

An unmatched `$` is left alone, because "it costs $5 to get in" is a far more
likely card than a broken equation.

## Why this shape

**Math is written, not built.** A visual equation editor is a week of work and
still slower than typing for anyone who has met a graphing calculator. `\frac`
is notation that math teachers already half-know, that every existing worksheet
generator emits, and that a language model writes without being asked twice.

**MathML is what comes out, never what goes in.** Nobody hand-writes forty
characters to say "one half". TeX-lite compiles to MathML, the browser sets it,
and the equation lands in the accessibility tree as math rather than as a
picture of math. No layout engine is shipped to the client and no fonts are
fetched at runtime.

**A figure is data, not drawing instructions.** `{"kind":"triangle","sides":
["3 cm","4 cm","5 cm"],"rightAngle":2}` is something a person can type and a
generator can produce. Where the vertices actually land is the renderer's
problem, which is the only reason authoring a diagram is realistic at all.

**Nothing author-written reaches the DOM as markup.** Both paths — TeX and
pasted MathML — produce a tree of allow-listed nodes that React renders as
elements. There is no `innerHTML` anywhere in the pipeline, no `style`, no
`href`, no `on*`; `<script>` and `<annotation>` are dropped whole. Decks get
shared with a tutor and a class, so card text is treated as hostile input.

## Math

The subset covers school work through geometry and early algebra.

| Written | Means |
| --- | --- |
| `\frac{a}{b}` | a fraction |
| `x^2`, `x_1`, `x_1^2` | powers and subscripts |
| `\sqrt{x}`, `\sqrt[3]{x}` | roots |
| `45^\circ` | degrees (`^\circ` is a degree sign, as in TeX) |
| `\overline{AB}` | a line segment |
| `\overrightarrow{AB}`, `\vec{v}` | a ray, a vector |
| `\text{cm}` | words inside an equation |
| `\times \div \cdot \pm` | operators |
| `\le \ge \ne \approx \cong \sim` | relations |
| `\angle \triangle \parallel \perp` | geometry |
| `\pi \theta \alpha \Delta …` | Greek |
| `\sin \cos \tan \log \ln` | function names, set upright |

A command that is not on the list is not silently dropped: it renders as
literal text and the editor tells the author what it did not recognize, while
they are still looking at the card.

### Typed answers

An answer is graded against what the math *says*, not how it was written.
`$\frac{3}{4}$` is matched by typing `3/4`, and `$45^\circ$` by typing `45°`.
Nobody types a backslash into an answer box.

The same projection is what a figure contributes: a card answered with a chart
is graded, searched and read aloud through the chart's description.

One consequence worth knowing: `couch / sofa` still means "either will do", but
`1/2` is a fraction, and a card carrying math keeps its slashes.

## Figures

`[[figure {…}]]` anywhere in either side of a card. The editor's **Figure**
button drops in a working example of each kind, which is faster to edit than a
blank one is to fill in.

| `kind` | Needs | Also takes |
| --- | --- | --- |
| `bar` | `data: [{label, value}]` | `xLabel`, `yLabel`, `max` (raises the axis top, never lowers it), `horizontal`, `showValues` |
| `line` | `series: [{name, points: [[x,y]]}]` | `xLabel`, `yLabel`, `xRange`, `yRange` |
| `pie` | `data: [{label, value}]` | `showPercent` |
| `numberline` | `min`, `max` | `step`, `points: [{at,label,open}]`, `intervals: [{from,to,openFrom,openTo}]` |
| `plot` | — | `xRange`, `yRange`, `step`, `points`, `segments`, `polygons`, `grid` |
| `triangle` | — | `labels`, `sides`, `angles`, `rightAngle`, `vertices` |
| `rect` | `width`, `height` | `ratio`, `diagonal`, `label` |
| `polygon` | `points: [[x,y]]` | `labels`, `sides`, `angles` |
| `circle` | — | `radius`, `diameter`, `centerLabel`, `sector: {degrees,label}` |
| `angle` | `degrees` | `measure`, `vertexLabel`, `rayLabels` |

Every kind also takes `title`, `caption` and `alt`.

Two rules run through the drawing:

**Every value a question could ask about is written on the figure.** A learner
reading a bar chart is being asked to read a number; making them estimate it
off a gridline is a different and worse task. Bars carry their values, sides
carry their lengths, angles carry their measures.

**Figures are never themed.** The app lets a learner repaint everything, but a
chart means the same thing in every theme, so it uses a fixed palette — chosen
for lightness, chroma, contrast and color-vision separation against the app's
paper background, and assigned in a fixed order rather than by rank.

A `step` finer than the range can carry is widened rather than obeyed: a number
line from 0 to 1000 marked in ones gets a readable interval instead of eighty
ticks and nine hundred blank units.

Anything the renderer cannot use is dropped rather than trusted, and anything
genuinely missing comes back as an error the author can read. A figure that
fails to parse says so on the card; it never disappears mid-quiz.

### Accessibility

Every figure generates a description whether the author writes an `alt` or not,
because a figure with no description is a question a blind learner cannot
answer. That description is also what stands in for the drawing wherever there
is no room for it — a match tile, a row of the deck list, a line of the results.

## Where this lives

| File | What it is |
| --- | --- |
| `apps/web/src/lib/rich/tex.ts` | TeX-lite → MathML tree |
| `apps/web/src/lib/rich/mathml.ts` | the node tree, the sanitiser, the plain-text projection |
| `apps/web/src/lib/rich/figures.ts` | figure specs, validation, descriptions |
| `apps/web/src/lib/rich/layout.ts` | the arithmetic behind each drawing |
| `apps/web/src/lib/rich/parse.ts` | splitting card text into its parts |
| `apps/web/src/components/rich/` | `RichText` to show it, `RichField` to write it |

`RichText` is what every screen showing a card uses. Plain text costs it one
regex test and passes through untouched, which is the point: nothing about
spelling or vocabulary got more complicated because geometry now works.
