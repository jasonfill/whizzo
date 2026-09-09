// The arithmetic behind drawing a figure, kept apart from the drawing itself.
//
// Everything here is a pure function of numbers, which is the only reason any
// of it can be tested. A wrong axis scale or a side label sitting inside the
// triangle is a real bug — the learner reads the wrong value off the chart —
// and it is not the kind of bug a rendered SVG makes obvious.

export type Pt = [number, number]

export interface Scale {
  min: number
  max: number
  step: number
  ticks: number[]
}

/**
 * An axis a person can read: round steps, and a top the data actually reaches.
 *
 * The 1-2-5 progression is the standard one, because those are the intervals
 * people count in. An axis stepping by 3.7 is technically a tighter fit and
 * nobody can read a value off it.
 */
export function niceScale(min: number, max: number, targetTicks = 5): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  if (max === min) {
    max = min + Math.abs(min || 1)
  }
  const step = niceStep((max - min) / Math.max(1, targetTicks))

  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  // Accumulating with multiplication rather than repeated addition keeps 0.30000000000000004 off the axis.
  for (let i = 0; lo + i * step <= hi + step / 1000 && ticks.length < 40; i++) {
    ticks.push(round(lo + i * step))
  }
  return { min: lo, max: hi, step, ticks }
}

/** The nearest 1-2-5 step at or above `raw`. Those are the intervals people count in. */
export function niceStep(raw: number): number {
  const size = Math.abs(raw) || 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(size)))
  const normalized = size / magnitude
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
}

/**
 * Tick positions from `from` to `to`, at `step` where that is readable.
 *
 * A step too fine for the range is widened rather than the axis being cut
 * short. Stopping early is the worse failure by a distance: a number line from
 * 0 to 1000 marked in ones would draw the full line and then label only the
 * first eighty of it, which does not look broken — it looks like a number line
 * that disagrees with the question.
 */
export function ticksBetween(from: number, to: number, step?: number, max = 40): number[] {
  const span = Math.abs(to - from)
  if (!Number.isFinite(span) || span === 0) return [round(from)]

  let use = step && step > 0 && Number.isFinite(step) ? step : niceStep(span / 8)
  if (span / use + 1 > max) use = niceStep(span / (max - 1))

  const out: number[] = []
  const first = Math.ceil(from / use - 1e-9) * use
  for (let v = first, guard = 0; v <= to + use / 1000 && guard <= max; v += use, guard++) {
    out.push(round(v))
  }
  return out
}

/**
 * Label every nth tick, so the numbers along an axis do not run into each
 * other. Thinning the labels beats thinning the ticks: a number line marked
 * every unit and numbered every fifth is how one is drawn on paper, and the
 * marks are what a learner counts along.
 */
export function labelEvery(count: number, fit: number): number {
  // A 1-2-5 stride rather than any old divisor, so the numbers that survive are
  // the round ones — and, on a symmetric axis, so both ends keep their label.
  return Math.max(1, Math.round(niceStep(count / Math.max(1, fit))))
}

/** Trims the floating-point dust a scale calculation leaves behind. */
export function round(n: number, places = 6): number {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}

/** Formats a tick or a data value the way it would be written on paper. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const rounded = round(n, 4)
  if (Number.isInteger(rounded)) return String(rounded)
  return String(Number(rounded.toFixed(2)))
}

export function centroid(points: Pt[]): Pt {
  const n = points.length || 1
  return [
    points.reduce((sum, p) => sum + p[0], 0) / n,
    points.reduce((sum, p) => sum + p[1], 0) / n,
  ]
}

/**
 * Fit a shape into the drawing box.
 *
 * Aspect ratio is preserved, always: a square drawn as a rectangle is a wrong
 * answer waiting to happen, and a learner asked "is this a rhombus?" is
 * entitled to trust the picture. Input is in math coordinates (y upward);
 * output is in SVG coordinates (y downward).
 */
export function fitPoints(points: Pt[], width: number, height: number, pad = 26): Pt[] {
  if (!points.length) return []
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2
  return points.map(([x, y]) => [
    offsetX + (x - minX) * scale,
    height - offsetY - (y - minY) * scale,
  ])
}

/** A point `dist` further out from `from`, used to push labels clear of the shape. */
export function push(point: Pt, from: Pt, dist: number): Pt {
  const dx = point[0] - from[0]
  const dy = point[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  return [point[0] + (dx / len) * dist, point[1] + (dy / len) * dist]
}

export function midpoint(a: Pt, b: Pt): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

export function polar(cx: number, cy: number, r: number, degrees: number): Pt {
  const rad = (degrees * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
}

/** An arc from `startDeg` to `endDeg`, measured the way a protractor is. */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg)
  const [x2, y2] = polar(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg > startDeg ? 0 : 1
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`
}

/** A pie slice or a shaded sector: the arc, closed back through the center. */
export function sectorPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (Math.abs(endDeg - startDeg) >= 359.99) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
  }
  return `${arcPath(cx, cy, r, startDeg, endDeg)} L ${cx} ${cy} Z`
}

/**
 * A vertical bar: square where it meets the axis, rounded at the value end.
 *
 * Rounding both ends would detach the bar from the baseline, and a bar chart
 * whose bars do not visibly start at zero is the oldest way there is to make a
 * small difference look big.
 */
export function barPathV(x: number, width: number, baseline: number, value: number, r = 4): string {
  const top = Math.min(baseline, value)
  const bottom = Math.max(baseline, value)
  const radius = Math.max(0, Math.min(r, width / 2, bottom - top))
  const right = x + width
  if (value <= baseline) {
    return `M ${x} ${bottom} L ${x} ${top + radius} Q ${x} ${top} ${x + radius} ${top} L ${right - radius} ${top} Q ${right} ${top} ${right} ${top + radius} L ${right} ${bottom} Z`
  }
  return `M ${x} ${top} L ${x} ${bottom - radius} Q ${x} ${bottom} ${x + radius} ${bottom} L ${right - radius} ${bottom} Q ${right} ${bottom} ${right} ${bottom - radius} L ${right} ${top} Z`
}

/** The same bar lying down, for charts whose categories have long names. */
export function barPathH(y: number, thickness: number, baseline: number, value: number, r = 4): string {
  const left = Math.min(baseline, value)
  const right = Math.max(baseline, value)
  const radius = Math.max(0, Math.min(r, thickness / 2, right - left))
  const bottom = y + thickness
  if (value >= baseline) {
    return `M ${left} ${y} L ${right - radius} ${y} Q ${right} ${y} ${right} ${y + radius} L ${right} ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} L ${left} ${bottom} Z`
  }
  return `M ${right} ${y} L ${left + radius} ${y} Q ${left} ${y} ${left} ${y + radius} L ${left} ${bottom - radius} Q ${left} ${bottom} ${left + radius} ${bottom} L ${right} ${bottom} Z`
}

/**
 * The little square that marks a right angle, drawn in the corner at `vertex`
 * between its two neighbours.
 */
export function rightAngleMark(vertex: Pt, a: Pt, b: Pt, size = 11): string {
  const unit = (p: Pt): Pt => {
    const dx = p[0] - vertex[0]
    const dy = p[1] - vertex[1]
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len]
  }
  const [ux, uy] = unit(a)
  const [vx, vy] = unit(b)
  const p1: Pt = [vertex[0] + ux * size, vertex[1] + uy * size]
  const p3: Pt = [vertex[0] + vx * size, vertex[1] + vy * size]
  const p2: Pt = [p1[0] + vx * size, p1[1] + vy * size]
  return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]}`
}

/** The angle at `vertex`, in degrees, for placing an arc between two sides. */
export function angleAt(vertex: Pt, a: Pt, b: Pt): { start: number; end: number } {
  // SVG y grows downward, so negate it to get protractor degrees back.
  const bearing = (p: Pt) =>
    (Math.atan2(-(p[1] - vertex[1]), p[0] - vertex[0]) * 180) / Math.PI
  const start = bearing(a)
  let delta = bearing(b) - start
  // Normalize to the turn of at most half a circle: at a polygon's corner the
  // angle anyone means is the one inside the shape, not the reflex one around it.
  while (delta <= -180) delta += 360
  while (delta > 180) delta -= 360
  return { start, end: start + delta }
}

/**
 * Default triangle vertices, in math coordinates.
 *
 * An author writing `{"kind":"triangle","sides":["3","4","5"]}` wants a
 * triangle, not a coordinate geometry exercise — so the shape is chosen for
 * them, and it is a *right* triangle exactly when they said one vertex is a
 * right angle. Getting that wrong would draw a picture that contradicts the
 * question.
 */
export function defaultTriangle(rightAngle?: number): Pt[] {
  if (rightAngle === undefined || rightAngle < 0 || rightAngle > 2) {
    return [
      [46, 92],
      [4, 6],
      [96, 6],
    ]
  }
  // A right triangle with the square corner at index 0, then rotated so it
  // lands on the vertex the author named.
  const base: Pt[] = [
    [6, 6],
    [6, 92],
    [96, 6],
  ]
  const k = Math.round(rightAngle)
  return [0, 1, 2].map((j) => base[(j - k + 3) % 3])
}
