// Starting points for the editor's insert menu.
//
// Every template is a working example rather than an empty shell, because the
// fastest way to learn what a figure spec can do is to change the numbers in
// one that already draws something. They double as the worked examples in the
// tests: if a template stops validating, the menu is offering something broken.

import { figureSource, type FigureKind, type FigureSpec } from '@whizzo/shared/rich'

export interface FigureTemplate {
  kind: FigureKind
  label: string
  emoji: string
  spec: FigureSpec
}

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    kind: 'triangle',
    label: 'Triangle',
    emoji: '📐',
    spec: {
      kind: 'triangle',
      labels: ['A', 'B', 'C'],
      sides: ['5 cm', '3 cm', '4 cm'],
      rightAngle: 1,
    },
  },
  {
    kind: 'rect',
    label: 'Rectangle',
    emoji: '▭',
    spec: { kind: 'rect', width: '8 m', height: '5 m' },
  },
  {
    kind: 'angle',
    label: 'Angle',
    emoji: '∠',
    spec: { kind: 'angle', degrees: 55, measure: 'x°', vertexLabel: 'B', rayLabels: ['A', 'C'] },
  },
  {
    kind: 'circle',
    label: 'Circle',
    emoji: '⭕',
    spec: { kind: 'circle', radius: '6 in', centerLabel: 'O' },
  },
  {
    kind: 'polygon',
    label: 'Polygon',
    emoji: '⬠',
    spec: {
      kind: 'polygon',
      points: [
        [0, 0],
        [6, 0],
        [8, 4],
        [3, 7],
        [-2, 4],
      ],
      labels: ['P', 'Q', 'R', 'S', 'T'],
    },
  },
  {
    kind: 'plot',
    label: 'Coordinate grid',
    emoji: '🧭',
    spec: {
      kind: 'plot',
      xRange: [-6, 6],
      yRange: [-6, 6],
      points: [
        { x: 2, y: 3, label: 'A' },
        { x: -3, y: -1, label: 'B' },
      ],
    },
  },
  {
    kind: 'numberline',
    label: 'Number line',
    emoji: '📏',
    spec: {
      kind: 'numberline',
      min: -5,
      max: 5,
      step: 1,
      points: [{ at: 2, label: 'x' }],
    },
  },
  {
    kind: 'bar',
    label: 'Bar chart',
    emoji: '📊',
    spec: {
      kind: 'bar',
      title: 'Books read',
      yLabel: 'Books',
      data: [
        { label: 'Mon', value: 4 },
        { label: 'Tue', value: 7 },
        { label: 'Wed', value: 3 },
        { label: 'Thu', value: 6 },
      ],
    },
  },
  {
    kind: 'line',
    label: 'Line graph',
    emoji: '📈',
    spec: {
      kind: 'line',
      xLabel: 'Hour',
      yLabel: 'Miles',
      series: [
        {
          name: 'Distance',
          points: [
            [0, 0],
            [1, 12],
            [2, 26],
            [3, 35],
          ],
        },
      ],
    },
  },
  {
    kind: 'pie',
    label: 'Pie chart',
    emoji: '🥧',
    spec: {
      kind: 'pie',
      title: 'Favorite fruit',
      showPercent: true,
      data: [
        { label: 'Apple', value: 8 },
        { label: 'Banana', value: 5 },
        { label: 'Grapes', value: 3 },
      ],
    },
  },
]

export function templateSource(template: FigureTemplate): string {
  return figureSource(template.spec)
}

/** Math snippets, with where the cursor should land once one is inserted. */
export interface MathSnippet {
  label: string
  text: string
  hint: string
}

export const MATH_SNIPPETS: MathSnippet[] = [
  { label: '½', text: '$\\frac{}{}$', hint: 'Fraction' },
  { label: 'x²', text: '$x^{2}$', hint: 'Power' },
  { label: '√', text: '$\\sqrt{}$', hint: 'Square root' },
  { label: '45°', text: '$45^\\circ$', hint: 'Degrees' },
  { label: 'AB', text: '$\\overline{AB}$', hint: 'Line segment' },
  { label: '∠', text: '$m\\angle ABC = $', hint: 'Angle measure' },
]

/** Single characters that need no math markup at all. */
export const SYMBOLS = [
  '×',
  '÷',
  '±',
  '≤',
  '≥',
  '≠',
  '≈',
  '°',
  'π',
  '∠',
  '△',
  '∥',
  '⊥',
  '≅',
  '∼',
  '√',
  '∞',
  '½',
  '¼',
  '⅓',
]

/** Where to put the caret after inserting a snippet: the first empty pair of braces. */
export function caretOffset(snippet: string): number {
  const empty = snippet.indexOf('{}')
  if (empty >= 0) return empty + 1
  const trailing = snippet.lastIndexOf('$')
  return trailing >= 0 ? trailing : snippet.length
}
