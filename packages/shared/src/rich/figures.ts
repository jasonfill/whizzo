// Figures: the pictures a math question needs and plain text cannot carry.
//
// Two families, one mechanism. The charts (bar, line, pie) are for the
// "read the graph" questions that start in third grade and never stop; the
// geometry (triangles, polygons, circles, angles, number lines, the coordinate
// plane) is for everything that has to be *seen* to be asked at all. Both are
// written as a small JSON object inside the card text:
//
//   [[figure {"kind":"triangle","sides":["3 cm","4 cm","5 cm"],"rightAngle":2}]]
//
// The spec is data, not drawing instructions — no paths, no coordinates you
// have to work out by hand — which is what makes a figure something an author
// can type, an editor can preview, and a generator can produce. The renderer
// decides where things actually go.

export interface FigurePoint {
  x: number
  y: number
  label?: string
}

interface FigureBase {
  title?: string
  /** Overrides the generated description read out to screen readers. */
  alt?: string
  caption?: string
}

export interface BarFigure extends FigureBase {
  kind: 'bar'
  data: Array<{ label: string; value: number }>
  xLabel?: string
  yLabel?: string
  /**
   * Raises the top of the scale, so two charts on one card can be read against
   * each other. It cannot lower it: an axis that cuts a bar off is worse than
   * an axis nobody asked for.
   */
  max?: number
  /** Bars are labeled with their value by default — these are charts to read off. */
  showValues?: boolean
  horizontal?: boolean
}

export interface LineFigure extends FigureBase {
  kind: 'line'
  series: Array<{ name?: string; points: Array<[number, number]> }>
  xLabel?: string
  yLabel?: string
  xRange?: [number, number]
  yRange?: [number, number]
}

export interface PieFigure extends FigureBase {
  kind: 'pie'
  data: Array<{ label: string; value: number }>
  /** Show each slice as a percentage of the whole as well as its label. */
  showPercent?: boolean
}

export interface NumberLineFigure extends FigureBase {
  kind: 'numberline'
  min: number
  max: number
  step?: number
  points?: Array<{ at: number; label?: string; open?: boolean }>
  intervals?: Array<{
    from: number
    to: number
    label?: string
    openFrom?: boolean
    openTo?: boolean
  }>
}

export interface PlotFigure extends FigureBase {
  kind: 'plot'
  xRange?: [number, number]
  yRange?: [number, number]
  step?: number
  points?: FigurePoint[]
  segments?: Array<{
    from: [number, number]
    to: [number, number]
    label?: string
    dashed?: boolean
  }>
  polygons?: Array<{ points: Array<[number, number]>; label?: string }>
  grid?: boolean
}

export interface TriangleFigure extends FigureBase {
  kind: 'triangle'
  /** Vertex names, starting at the top and going clockwise. Defaults to A, B, C. */
  labels?: Array<string | null>
  /** Side labels: side i is the one running from vertex i to the next. */
  sides?: Array<string | null>
  /** Angle labels at each vertex, e.g. "60°" or "x". */
  angles?: Array<string | null>
  /** Which vertex carries the right-angle square, if any. */
  rightAngle?: number
  /** Explicit shape, when the drawing has to be to scale. */
  vertices?: Array<[number, number]>
}

export interface RectFigure extends FigureBase {
  kind: 'rect'
  width: string
  height: string
  /** Width over height as drawn; the labels carry the real measurements. */
  ratio?: number
  label?: string
  diagonal?: string
}

export interface PolygonFigure extends FigureBase {
  kind: 'polygon'
  points: Array<[number, number]>
  labels?: Array<string | null>
  sides?: Array<string | null>
  angles?: Array<string | null>
}

export interface CircleFigure extends FigureBase {
  kind: 'circle'
  radius?: string
  diameter?: string
  centerLabel?: string
  /** A shaded slice, in degrees, for fraction and sector-area questions. */
  sector?: { degrees: number; label?: string }
}

export interface AngleFigure extends FigureBase {
  kind: 'angle'
  degrees: number
  /** What to write in the arc — often "x°" rather than the true measure. */
  measure?: string
  vertexLabel?: string
  rayLabels?: Array<string | null>
}

export type FigureSpec =
  | BarFigure
  | LineFigure
  | PieFigure
  | NumberLineFigure
  | PlotFigure
  | TriangleFigure
  | RectFigure
  | PolygonFigure
  | CircleFigure
  | AngleFigure

export type FigureKind = FigureSpec['kind']

export const FIGURE_KINDS: FigureKind[] = [
  'bar',
  'line',
  'pie',
  'numberline',
  'plot',
  'triangle',
  'rect',
  'polygon',
  'circle',
  'angle',
]

// Ceilings, not guidance. A card is a question, and every one of these is well
// past the point where the picture stops being readable on a phone.
const LIMITS = {
  categories: 12,
  series: 6,
  points: 120,
  vertices: 16,
  label: 40,
}

// --- Validation -----------------------------------------------------------

export type FigureParse = { ok: true; spec: FigureSpec } | { ok: false; error: string }

type Raw = Record<string, unknown>

function str(value: unknown, max = LIMITS.label): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function pair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = num(value[0])
  const y = num(value[1])
  return x === undefined || y === undefined ? undefined : [x, y]
}

function pairs(value: unknown, limit: number): Array<[number, number]> {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, limit)
    .map(pair)
    .filter((p): p is [number, number] => p !== undefined)
}

function labels(value: unknown, limit: number): Array<string | null> {
  if (!Array.isArray(value)) return []
  return value.slice(0, limit).map((v) => str(v) ?? null)
}

function positive(value: unknown): number | undefined {
  const n = num(value)
  return n !== undefined && n > 0 ? n : undefined
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function categorical(value: unknown): Array<{ label: string; value: number }> {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, LIMITS.categories)
    .map((entry) => {
      const item = (entry ?? {}) as Raw
      const v = num(item.value)
      return v === undefined ? null : { label: str(item.label) ?? '', value: v }
    })
    .filter((d): d is { label: string; value: number } => d !== null)
}

/** The optional bits every figure shares. */
function base(raw: Raw): FigureBase {
  const out: FigureBase = {}
  const title = str(raw.title, 80)
  const alt = str(raw.alt, 200)
  const caption = str(raw.caption, 120)
  if (title) out.title = title
  if (alt) out.alt = alt
  if (caption) out.caption = caption
  return out
}

/**
 * Turn parsed JSON into a figure we are willing to draw.
 *
 * Every field is checked rather than cast: the input is card text that may have
 * been typed, pasted or generated, and a renderer that trusts `data` to be an
 * array of numbers is one malformed deck away from a blank screen. Anything
 * unrecognized is dropped; anything missing that the drawing genuinely needs
 * comes back as an error the author can read.
 */
export function validateFigure(input: unknown): FigureParse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'A figure has to be an object, like {"kind":"bar", …}.' }
  }
  const raw = input as Raw
  const kind = str(raw.kind, 20)
  if (!kind) return { ok: false, error: 'A figure needs a "kind".' }
  if (!(FIGURE_KINDS as string[]).includes(kind)) {
    return {
      ok: false,
      error: `"${kind}" is not a kind of figure. Try: ${FIGURE_KINDS.join(', ')}.`,
    }
  }

  const common = base(raw)

  switch (kind as FigureKind) {
    case 'bar': {
      const data = categorical(raw.data)
      if (!data.length) {
        return { ok: false, error: 'A bar chart needs "data": [{"label":…,"value":…}].' }
      }
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'bar',
          data,
          xLabel: str(raw.xLabel),
          yLabel: str(raw.yLabel),
          max: num(raw.max),
          showValues: bool(raw.showValues) ?? true,
          horizontal: bool(raw.horizontal) ?? false,
        },
      }
    }
    case 'line': {
      const series = Array.isArray(raw.series)
        ? raw.series
            .slice(0, LIMITS.series)
            .map((s) => {
              const item = (s ?? {}) as Raw
              return { name: str(item.name), points: pairs(item.points, LIMITS.points) }
            })
            .filter((s) => s.points.length > 0)
        : []
      if (!series.length) {
        return { ok: false, error: 'A line chart needs "series": [{"points":[[x,y], …]}].' }
      }
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'line',
          series,
          xLabel: str(raw.xLabel),
          yLabel: str(raw.yLabel),
          xRange: pair(raw.xRange),
          yRange: pair(raw.yRange),
        },
      }
    }
    case 'pie': {
      const data = categorical(raw.data).filter((d) => d.value > 0)
      if (!data.length) {
        return { ok: false, error: 'A pie chart needs "data" with values above zero.' }
      }
      return {
        ok: true,
        spec: { ...common, kind: 'pie', data, showPercent: bool(raw.showPercent) ?? false },
      }
    }
    case 'numberline': {
      const min = num(raw.min)
      const max = num(raw.max)
      if (min === undefined || max === undefined || max <= min) {
        return { ok: false, error: 'A number line needs "min" and "max", with max above min.' }
      }
      const points = Array.isArray(raw.points)
        ? raw.points
            .slice(0, LIMITS.points)
            .map((p) => {
              const item = (p ?? {}) as Raw
              const at = num(item.at)
              return at === undefined
                ? null
                : { at, label: str(item.label), open: bool(item.open) ?? false }
            })
            .filter((p): p is NonNullable<typeof p> => p !== null)
        : []
      const intervals = Array.isArray(raw.intervals)
        ? raw.intervals
            .slice(0, 6)
            .map((v) => {
              const item = (v ?? {}) as Raw
              const from = num(item.from)
              const to = num(item.to)
              if (from === undefined || to === undefined) return null
              return {
                from: Math.min(from, to),
                to: Math.max(from, to),
                label: str(item.label),
                openFrom: bool(item.openFrom) ?? false,
                openTo: bool(item.openTo) ?? false,
              }
            })
            .filter((v): v is NonNullable<typeof v> => v !== null)
        : []
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'numberline',
          min,
          max,
          step: positive(raw.step),
          points,
          intervals,
        },
      }
    }
    case 'plot': {
      const points = Array.isArray(raw.points)
        ? raw.points
            .slice(0, LIMITS.points)
            .map((p) => {
              const item = (p ?? {}) as Raw
              const x = num(item.x)
              const y = num(item.y)
              return x === undefined || y === undefined ? null : { x, y, label: str(item.label) }
            })
            .filter((p): p is NonNullable<typeof p> => p !== null)
        : []
      const segments = Array.isArray(raw.segments)
        ? raw.segments
            .slice(0, 24)
            .map((s) => {
              const item = (s ?? {}) as Raw
              const from = pair(item.from)
              const to = pair(item.to)
              return from && to
                ? { from, to, label: str(item.label), dashed: bool(item.dashed) ?? false }
                : null
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)
        : []
      const polygons = Array.isArray(raw.polygons)
        ? raw.polygons
            .slice(0, 6)
            .map((p) => {
              const item = (p ?? {}) as Raw
              const pts = pairs(item.points, LIMITS.vertices)
              return pts.length >= 3 ? { points: pts, label: str(item.label) } : null
            })
            .filter((p): p is NonNullable<typeof p> => p !== null)
        : []
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'plot',
          xRange: pair(raw.xRange),
          yRange: pair(raw.yRange),
          step: positive(raw.step),
          points,
          segments,
          polygons,
          grid: bool(raw.grid) ?? true,
        },
      }
    }
    case 'triangle': {
      const vertices = pairs(raw.vertices, 3)
      const given = labels(raw.labels, 3)
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'triangle',
          labels: [given[0] || 'A', given[1] || 'B', given[2] || 'C'],
          sides: labels(raw.sides, 3),
          angles: labels(raw.angles, 3),
          rightAngle: num(raw.rightAngle),
          vertices: vertices.length === 3 ? vertices : undefined,
        },
      }
    }
    case 'rect': {
      const width = str(raw.width) ?? ''
      const height = str(raw.height) ?? ''
      if (!width && !height) {
        return { ok: false, error: 'A rectangle needs a "width" and a "height" to label.' }
      }
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'rect',
          width,
          height,
          ratio: positive(raw.ratio),
          label: str(raw.label),
          diagonal: str(raw.diagonal),
        },
      }
    }
    case 'polygon': {
      const points = pairs(raw.points, LIMITS.vertices)
      if (points.length < 3) return { ok: false, error: 'A polygon needs at least three "points".' }
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'polygon',
          points,
          labels: labels(raw.labels, LIMITS.vertices),
          sides: labels(raw.sides, LIMITS.vertices),
          angles: labels(raw.angles, LIMITS.vertices),
        },
      }
    }
    case 'circle': {
      const sectorRaw = (raw.sector ?? null) as Raw | null
      const sectorDegrees = sectorRaw ? num(sectorRaw.degrees) : undefined
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'circle',
          radius: str(raw.radius),
          diameter: str(raw.diameter),
          centerLabel: str(raw.centerLabel),
          sector:
            sectorDegrees === undefined
              ? undefined
              : { degrees: clamp(sectorDegrees, 0, 360), label: str(sectorRaw?.label) },
        },
      }
    }
    case 'angle': {
      const degrees = num(raw.degrees)
      if (degrees === undefined) return { ok: false, error: 'An angle needs "degrees".' }
      return {
        ok: true,
        spec: {
          ...common,
          kind: 'angle',
          degrees: clamp(degrees, 1, 359),
          measure: str(raw.measure),
          vertexLabel: str(raw.vertexLabel),
          rayLabels: labels(raw.rayLabels, 2),
        },
      }
    }
  }
}

// --- Source form ----------------------------------------------------------

const FIGURE_OPEN = /\[\[\s*fig(?:ure)?\b/i

/**
 * Find the next `[[figure {…}]]` at or after `from`.
 *
 * Brace counting rather than a regex, because a label can legitimately contain
 * `}` or `]]` and a regex would end the figure in the middle of someone's axis
 * title.
 */
export function findFigure(
  source: string,
  from = 0,
): { start: number; end: number; json: string } | null {
  const match = FIGURE_OPEN.exec(source.slice(from))
  if (!match) return null
  const start = from + match.index
  let i = start + match[0].length
  while (i < source.length && /\s/.test(source[i])) i++
  if (source[i] !== '{') return null
  const jsonStart = i

  let depth = 0
  let inString = false
  let escaped = false
  for (; i < source.length; i++) {
    const ch = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        let j = i + 1
        while (j < source.length && /\s/.test(source[j])) j++
        if (!source.startsWith(']]', j)) return null
        return { start, end: j + 2, json: source.slice(jsonStart, i + 1) }
      }
    }
  }
  return null
}

/** Compose the source form. This is how the editor's insert buttons write one. */
export function figureSource(spec: FigureSpec): string {
  return `[[figure ${JSON.stringify(spec)}]]`
}

// --- Description ----------------------------------------------------------

/**
 * What the picture says, in words.
 *
 * This is the figure's accessible name and its stand-in wherever a card is
 * shown as plain text — a results list, an export, a screen reader. A figure
 * with no description is a question a blind learner cannot answer, so every
 * kind generates one whether the author supplied `alt` or not.
 */
export function figureAlt(spec: FigureSpec): string {
  const title = spec.alt ? '' : spec.title ? `${spec.title}. ` : ''
  if (spec.alt) return spec.alt

  switch (spec.kind) {
    case 'bar':
      return `${title}Bar chart. ${spec.data.map((d) => `${d.label}: ${d.value}`).join(', ')}.`
    case 'line':
      return `${title}Line graph with ${spec.series.length} line${
        spec.series.length === 1 ? '' : 's'
      }. ${spec.series
        .map(
          (s, i) =>
            `${s.name ?? `Line ${i + 1}`}: ${s.points.map(([x, y]) => `(${x}, ${y})`).join(', ')}`,
        )
        .join('. ')}.`
    case 'pie': {
      const total = spec.data.reduce((sum, d) => sum + d.value, 0) || 1
      return `${title}Pie chart. ${spec.data
        .map((d) => `${d.label}: ${Math.round((d.value / total) * 100)}%`)
        .join(', ')}.`
    }
    case 'numberline': {
      const marks = (spec.points ?? []).map((p) => (p.label ? `${p.label} at ${p.at}` : `${p.at}`))
      const spans = (spec.intervals ?? []).map((v) => `from ${v.from} to ${v.to}`)
      return `${title}Number line from ${spec.min} to ${spec.max}.${
        marks.length ? ` Marked at ${marks.join(', ')}.` : ''
      }${spans.length ? ` Shaded ${spans.join(', ')}.` : ''}`
    }
    case 'plot': {
      const pts = (spec.points ?? []).map((p) => `${p.label ? `${p.label} ` : ''}(${p.x}, ${p.y})`)
      return `${title}Coordinate grid.${pts.length ? ` Points: ${pts.join(', ')}.` : ''}${
        spec.segments?.length
          ? ` ${spec.segments.length} line segment${spec.segments.length === 1 ? '' : 's'}.`
          : ''
      }`
    }
    case 'triangle': {
      const [a, b, c] = spec.labels ?? ['A', 'B', 'C']
      const sides = (spec.sides ?? []).filter(Boolean)
      const angles = (spec.angles ?? []).filter(Boolean)
      return `${title}Triangle ${a}${b}${c}.${sides.length ? ` Sides ${sides.join(', ')}.` : ''}${
        angles.length ? ` Angles ${angles.join(', ')}.` : ''
      }${spec.rightAngle !== undefined ? ' One right angle.' : ''}`
    }
    case 'rect':
      return `${title}Rectangle, ${spec.width} by ${spec.height}.${
        spec.diagonal ? ` Diagonal ${spec.diagonal}.` : ''
      }`
    case 'polygon':
      return `${title}Polygon with ${spec.points.length} sides.${
        (spec.sides ?? []).filter(Boolean).length
          ? ` Sides ${(spec.sides ?? []).filter(Boolean).join(', ')}.`
          : ''
      }`
    case 'circle':
      return `${title}Circle.${spec.radius ? ` Radius ${spec.radius}.` : ''}${
        spec.diameter ? ` Diameter ${spec.diameter}.` : ''
      }${spec.sector ? ` With a ${spec.sector.degrees} degree sector shaded.` : ''}`
    case 'angle':
      return `${title}An angle of ${spec.measure ?? `${spec.degrees} degrees`}${
        spec.vertexLabel ? ` at vertex ${spec.vertexLabel}` : ''
      }.`
  }
}
