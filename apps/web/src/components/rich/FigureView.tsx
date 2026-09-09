import type { ReactNode } from 'react'
import {
  figureAlt,
  type AngleFigure,
  type BarFigure,
  type CircleFigure,
  type FigureSpec,
  type LineFigure,
  type NumberLineFigure,
  type PieFigure,
  type PlotFigure,
  type PolygonFigure,
  type RectFigure,
  type TriangleFigure,
} from '../../lib/rich/figures'
import {
  angleAt,
  arcPath,
  barPathH,
  barPathV,
  centroid,
  defaultTriangle,
  fitPoints,
  formatNumber,
  labelEvery,
  midpoint,
  niceScale,
  polar,
  push,
  rightAngleMark,
  sectorPath,
  ticksBetween,
  type Pt,
} from '../../lib/rich/layout'

/**
 * Figures, drawn as inline SVG.
 *
 * No chart library. A quiz card needs a picture that is correct, legible on a
 * phone, and printable — not a hover-tooltip dashboard — and the whole set of
 * shapes here fits in less code than the smallest charting dependency, with the
 * side benefit that nothing about a deck is fetched at runtime.
 *
 * Two rules run through all of it. Every value a question could ask about is
 * written on the drawing, because a learner reading a bar chart is being asked
 * to read a number and guessing it off a gridline is a different, worse task.
 * And the colors are fixed rather than themed: the app lets a learner repaint
 * everything, but a figure means the same thing in every theme, so it does not
 * follow the accent.
 */

// Validated for lightness, chroma, contrast and color-vision separation
// against the app's paper surface. Assigned in order, never cycled by rank.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7']

const INK = '#1C1A16'
const MUTED = '#6B6558'
const GRID = '#DCD3C2'
const HAIR = '#EDE5D7'
const SURFACE = '#FAF6EF'

const FONT = 10
const SMALL = 9

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function Text({
  x,
  y,
  children,
  anchor = 'middle',
  size = FONT,
  fill = MUTED,
  weight = 700,
}: {
  x: number
  y: number
  children: ReactNode
  anchor?: 'start' | 'middle' | 'end'
  size?: number
  fill?: string
  weight?: number
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill}>
      {children}
    </text>
  )
}

/** A solid arrowhead at the end of an axis or a ray. */
function arrowHead(x: number, y: number, degrees: number, size = 6): string {
  const [ax, ay] = polar(x, y, size, degrees + 150)
  const [bx, by] = polar(x, y, size, degrees - 150)
  return `M ${x} ${y} L ${ax} ${ay} L ${bx} ${by} Z`
}

// --- Charts ---------------------------------------------------------------

function BarChart({ spec }: { spec: BarFigure }) {
  const W = 320
  const H = 210
  const left = spec.horizontal ? 74 : 38
  const right = 14
  const top = 16
  const bottom = spec.xLabel ? 46 : 34
  const plotW = W - left - right
  const plotH = H - top - bottom

  const values = spec.data.map((d) => d.value)
  const scale = niceScale(Math.min(0, ...values), Math.max(spec.max ?? 0, ...values))
  const span = scale.max - scale.min || 1
  const band = (spec.horizontal ? plotH : plotW) / Math.max(1, spec.data.length)
  const thickness = Math.min(44, band * 0.62)

  if (spec.horizontal) {
    const x = (v: number) => left + ((v - scale.min) / span) * plotW
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={top} x2={x(t)} y2={top + plotH} stroke={GRID} strokeWidth={1} />
            <Text x={x(t)} y={top + plotH + 14} size={SMALL}>
              {formatNumber(t)}
            </Text>
          </g>
        ))}
        {spec.data.map((d, i) => {
          const y = top + band * i + (band - thickness) / 2
          const to = x(d.value)
          return (
            <g key={`${d.label}-${i}`}>
              <path d={barPathH(y, thickness, x(0), to)} fill={SERIES[i % SERIES.length]} />
              <Text x={left - 8} y={y + thickness / 2 + 3} anchor="end" size={SMALL} fill={INK}>
                {short(d.label, 12)}
              </Text>
              {spec.showValues !== false && (
                <Text x={to + 5} y={y + thickness / 2 + 3} anchor="start" size={SMALL} fill={INK}>
                  {formatNumber(d.value)}
                </Text>
              )}
            </g>
          )
        })}
        <line x1={x(0)} y1={top} x2={x(0)} y2={top + plotH} stroke={MUTED} strokeWidth={1.5} />
        {spec.xLabel && (
          <Text x={left + plotW / 2} y={H - 6} size={SMALL}>
            {spec.xLabel}
          </Text>
        )}
      </svg>
    )
  }

  const y = (v: number) => top + ((scale.max - v) / span) * plotH
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={left} y1={y(t)} x2={left + plotW} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <Text x={left - 6} y={y(t) + 3} anchor="end" size={SMALL}>
            {formatNumber(t)}
          </Text>
        </g>
      ))}
      {spec.data.map((d, i) => {
        const x = left + band * i + (band - thickness) / 2
        const zero = y(Math.max(scale.min, 0))
        return (
          <g key={`${d.label}-${i}`}>
            <path d={barPathV(x, thickness, zero, y(d.value))} fill={SERIES[i % SERIES.length]} />
            {spec.showValues !== false && (
              <Text x={x + thickness / 2} y={Math.min(zero, y(d.value)) - 4} size={SMALL} fill={INK}>
                {formatNumber(d.value)}
              </Text>
            )}
            <Text x={x + thickness / 2} y={top + plotH + 14} size={SMALL} fill={INK}>
              {short(d.label, 10)}
            </Text>
          </g>
        )
      })}
      <line x1={left} y1={y(0)} x2={left + plotW} y2={y(0)} stroke={MUTED} strokeWidth={1.5} />
      {spec.yLabel && (
        <text
          x={11}
          y={top + plotH / 2}
          textAnchor="middle"
          fontSize={SMALL}
          fontWeight={700}
          fill={MUTED}
          transform={`rotate(-90 11 ${top + plotH / 2})`}
        >
          {spec.yLabel}
        </text>
      )}
      {spec.xLabel && (
        <Text x={left + plotW / 2} y={H - 6} size={SMALL}>
          {spec.xLabel}
        </Text>
      )}
    </svg>
  )
}

function LineChart({ spec }: { spec: LineFigure }) {
  const W = 320
  const legend = spec.series.length > 1
  const H = legend ? 224 : 206
  const left = 38
  const right = 14
  const top = 16
  const bottom = (spec.xLabel ? 44 : 32) + (legend ? 18 : 0)
  const plotW = W - left - right
  const plotH = H - top - bottom

  const all = spec.series.flatMap((s) => s.points)
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  // Whole-number x values get whole-number ticks. An axis of hours labeled
  // 0, 0.5, 1, 1.5 is a finer scale than the data has, and reads as though
  // half-hours were measured.
  const xLow = spec.xRange?.[0] ?? Math.min(...xs)
  const xHigh = spec.xRange?.[1] ?? Math.max(...xs)
  const wholeX = xs.every(Number.isInteger)
  const xScale = niceScale(xLow, xHigh, wholeX ? Math.min(6, Math.max(2, xHigh - xLow)) : 6)
  const yScale = niceScale(spec.yRange?.[0] ?? Math.min(0, ...ys), spec.yRange?.[1] ?? Math.max(...ys))
  const xSpan = xScale.max - xScale.min || 1
  const ySpan = yScale.max - yScale.min || 1
  const px = (v: number) => left + ((v - xScale.min) / xSpan) * plotW
  const py = (v: number) => top + ((yScale.max - v) / ySpan) * plotH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {yScale.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={left} y1={py(t)} x2={left + plotW} y2={py(t)} stroke={GRID} strokeWidth={1} />
          <Text x={left - 6} y={py(t) + 3} anchor="end" size={SMALL}>
            {formatNumber(t)}
          </Text>
        </g>
      ))}
      {xScale.ticks.map((t) => (
        <g key={`x${t}`}>
          <line x1={px(t)} y1={top} x2={px(t)} y2={top + plotH} stroke={HAIR} strokeWidth={1} />
          <Text x={px(t)} y={top + plotH + 14} size={SMALL}>
            {formatNumber(t)}
          </Text>
        </g>
      ))}
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke={MUTED} strokeWidth={1.5} />
      <line
        x1={left}
        y1={py(Math.max(yScale.min, 0))}
        x2={left + plotW}
        y2={py(Math.max(yScale.min, 0))}
        stroke={MUTED}
        strokeWidth={1.5}
      />
      {spec.series.map((s, i) => {
        const color = SERIES[i % SERIES.length]
        const ordered = [...s.points].sort((a, b) => a[0] - b[0])
        return (
          <g key={s.name ?? i}>
            <polyline
              points={ordered.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {ordered.map(([x, y], j) => (
              <circle
                key={j}
                cx={px(x)}
                cy={py(y)}
                r={3}
                fill={color}
                stroke={SURFACE}
                strokeWidth={1.5}
              />
            ))}
          </g>
        )
      })}
      {legend &&
        spec.series.map((s, i) => (
          <g key={`legend${i}`}>
            <rect
              x={left + i * 84}
              y={H - 14}
              width={10}
              height={10}
              rx={2}
              fill={SERIES[i % SERIES.length]}
            />
            <Text x={left + i * 84 + 15} y={H - 5} anchor="start" size={SMALL} fill={INK}>
              {short(s.name ?? `Line ${i + 1}`, 10)}
            </Text>
          </g>
        ))}
      {spec.yLabel && (
        <text
          x={11}
          y={top + plotH / 2}
          textAnchor="middle"
          fontSize={SMALL}
          fontWeight={700}
          fill={MUTED}
          transform={`rotate(-90 11 ${top + plotH / 2})`}
        >
          {spec.yLabel}
        </text>
      )}
      {spec.xLabel && (
        <Text x={left + plotW / 2} y={top + plotH + 30} size={SMALL}>
          {spec.xLabel}
        </Text>
      )}
    </svg>
  )
}

function PieChart({ spec }: { spec: PieFigure }) {
  const W = 320
  const H = Math.max(180, 26 + spec.data.length * 18)
  const cx = 88
  const cy = H / 2
  const r = Math.min(74, H / 2 - 8)
  const total = spec.data.reduce((sum, d) => sum + d.value, 0) || 1

  let angle = 90 // start at twelve o'clock and go clockwise, like a clock face
  const slices = spec.data.map((d, i) => {
    const sweep = (d.value / total) * 360
    const from = angle
    const to = angle - sweep
    angle = to
    return { ...d, from, to, color: SERIES[i % SERIES.length], percent: (d.value / total) * 100 }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {slices.map((s, i) => (
        <path
          key={i}
          d={sectorPath(cx, cy, r, s.from, s.to)}
          fill={s.color}
          stroke={SURFACE}
          strokeWidth={2}
        />
      ))}
      {slices.map((s, i) => (
        <g key={`k${i}`}>
          <rect x={184} y={cy - (slices.length * 18) / 2 + i * 18} width={11} height={11} rx={2} fill={s.color} />
          <Text
            x={200}
            y={cy - (slices.length * 18) / 2 + i * 18 + 10}
            anchor="start"
            size={SMALL}
            fill={INK}
          >
            {`${short(s.label, 14)} — ${formatNumber(s.value)}${
              spec.showPercent ? ` (${Math.round(s.percent)}%)` : ''
            }`}
          </Text>
        </g>
      ))}
    </svg>
  )
}

// --- Number line and the coordinate plane ---------------------------------

function NumberLine({ spec }: { spec: NumberLineFigure }) {
  const W = 320
  const H = 96
  const x0 = 24
  const x1 = W - 24
  const y = 50
  const span = spec.max - spec.min || 1
  const px = (v: number) => x0 + ((v - spec.min) / span) * (x1 - x0)
  const ticks = ticksBetween(spec.min, spec.max, spec.step, 40)
  // Every tick gets a mark; only some of them get a number.
  const labelStride = labelEvery(ticks.length, 12)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={x0} y1={y} x2={x1} y2={y} stroke={INK} strokeWidth={1.5} />
      <path d={arrowHead(x1 + 6, y, 0)} fill={INK} />
      <path d={arrowHead(x0 - 6, y, 180)} fill={INK} />
      {ticks.map((t, i) => (
        <g key={t}>
          <line x1={px(t)} y1={y - 5} x2={px(t)} y2={y + 5} stroke={MUTED} strokeWidth={1.2} />
          {i % labelStride === 0 && (
            <Text x={px(t)} y={y + 20} size={SMALL}>
              {formatNumber(t)}
            </Text>
          )}
        </g>
      ))}
      {(spec.intervals ?? []).map((v, i) => (
        <g key={`i${i}`}>
          <line
            x1={px(v.from)}
            y1={y}
            x2={px(v.to)}
            y2={y}
            stroke={SERIES[0]}
            strokeWidth={5}
            strokeLinecap="butt"
          />
          <circle
            cx={px(v.from)}
            cy={y}
            r={5}
            fill={v.openFrom ? SURFACE : SERIES[0]}
            stroke={SERIES[0]}
            strokeWidth={2}
          />
          <circle
            cx={px(v.to)}
            cy={y}
            r={5}
            fill={v.openTo ? SURFACE : SERIES[0]}
            stroke={SERIES[0]}
            strokeWidth={2}
          />
          {v.label && (
            <Text x={(px(v.from) + px(v.to)) / 2} y={y - 12} size={SMALL} fill={INK}>
              {v.label}
            </Text>
          )}
        </g>
      ))}
      {(spec.points ?? []).map((p, i) => (
        <g key={`p${i}`}>
          <circle
            cx={px(p.at)}
            cy={y}
            r={5.5}
            fill={p.open ? SURFACE : SERIES[1]}
            stroke={SERIES[1]}
            strokeWidth={2}
          />
          {p.label && (
            <Text x={px(p.at)} y={y - 13} size={SMALL} fill={INK}>
              {p.label}
            </Text>
          )}
        </g>
      ))}
    </svg>
  )
}

function Plot({ spec }: { spec: PlotFigure }) {
  const size = 260
  const pad = 18
  const [xMin, xMax] = spec.xRange ?? [-5, 5]
  const [yMin, yMax] = spec.yRange ?? [-5, 5]
  const step = spec.step ?? 1
  const px = (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (size - pad * 2)
  const py = (v: number) => size - pad - ((v - yMin) / (yMax - yMin || 1)) * (size - pad * 2)

  const xs = ticksBetween(xMin, xMax, step, 40)
  const ys = ticksBetween(yMin, yMax, step, 40)
  // With a dense grid, numbering every line turns the axis into a smear.
  const xStride = labelEvery(xs.length, 12)
  const yStride = labelEvery(ys.length, 12)

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full">
      {spec.grid !== false && (
        <g>
          {xs.map((v) => (
            <line key={`gx${v}`} x1={px(v)} y1={py(yMin)} x2={px(v)} y2={py(yMax)} stroke={HAIR} strokeWidth={1} />
          ))}
          {ys.map((v) => (
            <line key={`gy${v}`} x1={px(xMin)} y1={py(v)} x2={px(xMax)} y2={py(v)} stroke={HAIR} strokeWidth={1} />
          ))}
        </g>
      )}
      <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke={INK} strokeWidth={1.4} />
      <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke={INK} strokeWidth={1.4} />
      <path d={arrowHead(px(xMax) + 5, py(0), 0, 5)} fill={INK} />
      <path d={arrowHead(px(0), py(yMax) - 5, 90, 5)} fill={INK} />
      {xs.map((v, i) =>
        v === 0 || i % xStride !== 0 ? null : (
          <Text key={`tx${v}`} x={px(v)} y={py(0) + 12} size={8}>
            {formatNumber(v)}
          </Text>
        ),
      )}
      {ys.map((v, i) =>
        v === 0 || i % yStride !== 0 ? null : (
          <Text key={`ty${v}`} x={px(0) - 5} y={py(v) + 3} anchor="end" size={8}>
            {formatNumber(v)}
          </Text>
        ),
      )}
      {(spec.polygons ?? []).map((poly, i) => (
        <polygon
          key={`poly${i}`}
          points={poly.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')}
          fill={`${SERIES[i % SERIES.length]}22`}
          stroke={SERIES[i % SERIES.length]}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {(spec.segments ?? []).map((seg, i) => (
        <g key={`seg${i}`}>
          <line
            x1={px(seg.from[0])}
            y1={py(seg.from[1])}
            x2={px(seg.to[0])}
            y2={py(seg.to[1])}
            stroke={SERIES[0]}
            strokeWidth={2}
            strokeDasharray={seg.dashed ? '5 4' : undefined}
            strokeLinecap="round"
          />
          {seg.label && (
            <Text
              x={(px(seg.from[0]) + px(seg.to[0])) / 2}
              y={(py(seg.from[1]) + py(seg.to[1])) / 2 - 6}
              size={SMALL}
              fill={INK}
            >
              {seg.label}
            </Text>
          )}
        </g>
      ))}
      {(spec.points ?? []).map((p, i) => (
        <g key={`pt${i}`}>
          <circle cx={px(p.x)} cy={py(p.y)} r={4} fill={SERIES[1]} stroke={SURFACE} strokeWidth={1.5} />
          {p.label && (
            <Text x={px(p.x) + 7} y={py(p.y) - 6} anchor="start" size={SMALL} fill={INK}>
              {p.label}
            </Text>
          )}
        </g>
      ))}
    </svg>
  )
}

// --- Shapes ---------------------------------------------------------------

/**
 * Triangles, rectangles and polygons all end up here: the same drawing with a
 * different way of arriving at the vertices. Labels go outside the shape, angle
 * marks inside, which is the convention every textbook uses and the only
 * arrangement that stays readable when a side label is "12.5 cm".
 */
function Shape({
  points,
  vertexLabels,
  sideLabels,
  angleLabels,
  rightAngle,
}: {
  points: Pt[]
  vertexLabels: Array<string | null>
  sideLabels: Array<string | null>
  angleLabels: Array<string | null>
  rightAngle?: number
}) {
  const W = 280
  const H = 210
  const drawn = fitPoints(points, W, H, 34)
  const mid = centroid(drawn)
  const n = drawn.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <polygon
        points={drawn.map(([x, y]) => `${x},${y}`).join(' ')}
        fill={`${SERIES[0]}1a`}
        stroke={SERIES[0]}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {drawn.map((v, i) => {
        const next = drawn[(i + 1) % n]
        const prev = drawn[(i + n - 1) % n]
        // Side i runs from vertex i to the next one, and in a triangle that is
        // the side opposite vertex i + 2 — so authors label sides in the same
        // order they label vertices.
        const sideLabel = sideLabels[i]
        const label = midpoint(v, next)
        const outside = push(label, mid, 15)
        const angleLabel = angleLabels[i]
        const inward = push(v, mid, -26)
        return (
          <g key={i}>
            {sideLabel && (
              <Text x={outside[0]} y={outside[1] + 3} size={SMALL} fill={INK}>
                {sideLabel}
              </Text>
            )}
            {vertexLabels[i] && (
              <Text
                x={push(v, mid, 13)[0]}
                y={push(v, mid, 13)[1] + 4}
                size={FONT}
                fill={INK}
                weight={800}
              >
                {vertexLabels[i]}
              </Text>
            )}
            {rightAngle === i ? (
              <path d={rightAngleMark(v, prev, next)} fill="none" stroke={MUTED} strokeWidth={1.5} />
            ) : (
              angleLabel && (
                <path
                  d={(() => {
                    const { start, end } = angleAt(v, prev, next)
                    return arcPath(v[0], v[1], 18, start, end)
                  })()}
                  fill="none"
                  stroke={MUTED}
                  strokeWidth={1.4}
                />
              )
            )}
            {angleLabel && (
              <Text x={inward[0]} y={inward[1] + 3} size={SMALL} fill={MUTED}>
                {angleLabel}
              </Text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Triangle({ spec }: { spec: TriangleFigure }) {
  const points = (spec.vertices as Pt[] | undefined) ?? defaultTriangle(spec.rightAngle)
  return (
    <Shape
      points={points}
      vertexLabels={spec.labels ?? ['A', 'B', 'C']}
      sideLabels={spec.sides ?? []}
      angleLabels={spec.angles ?? []}
      rightAngle={spec.rightAngle}
    />
  )
}

function Rectangle({ spec }: { spec: RectFigure }) {
  const ratio = Math.min(3, Math.max(0.33, spec.ratio ?? 1.55))
  const points: Pt[] = [
    [0, 0],
    [100 * ratio, 0],
    [100 * ratio, 100],
    [0, 100],
  ]
  const W = 280
  const H = 210
  const drawn = fitPoints(points, W, H, 40)
  const [tl, tr, br, bl] = drawn

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <polygon
        points={drawn.map(([x, y]) => `${x},${y}`).join(' ')}
        fill={`${SERIES[0]}1a`}
        stroke={SERIES[0]}
        strokeWidth={2}
      />
      {[tl, tr, br, bl].map((corner, i) => {
        const prev = drawn[(i + 3) % 4]
        const next = drawn[(i + 1) % 4]
        return (
          <path
            key={i}
            d={rightAngleMark(corner, prev, next, 10)}
            fill="none"
            stroke={MUTED}
            strokeWidth={1.3}
          />
        )
      })}
      {spec.diagonal && (
        <line x1={tl[0]} y1={tl[1]} x2={br[0]} y2={br[1]} stroke={SERIES[1]} strokeWidth={1.6} strokeDasharray="5 4" />
      )}
      {spec.width && (
        <Text x={(tl[0] + tr[0]) / 2} y={tl[1] - 8} size={FONT} fill={INK}>
          {spec.width}
        </Text>
      )}
      {spec.height && (
        <Text x={tr[0] + 22} y={(tr[1] + br[1]) / 2 + 3} size={FONT} fill={INK}>
          {spec.height}
        </Text>
      )}
      {spec.diagonal && (
        <Text x={(tl[0] + br[0]) / 2 + 18} y={(tl[1] + br[1]) / 2 - 5} size={SMALL} fill={SERIES[1]}>
          {spec.diagonal}
        </Text>
      )}
      {spec.label && (
        <Text x={(tl[0] + br[0]) / 2} y={(tl[1] + br[1]) / 2 + 4} size={FONT} fill={INK}>
          {spec.label}
        </Text>
      )}
    </svg>
  )
}

function Polygon({ spec }: { spec: PolygonFigure }) {
  return (
    <Shape
      points={spec.points as Pt[]}
      vertexLabels={spec.labels ?? []}
      sideLabels={spec.sides ?? []}
      angleLabels={spec.angles ?? []}
    />
  )
}

function Circle({ spec }: { spec: CircleFigure }) {
  const W = 260
  const H = 200
  const cx = W / 2
  const cy = H / 2
  const r = 72
  const radiusEnd = polar(cx, cy, r, -40)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {spec.sector && (
        <path d={sectorPath(cx, cy, r, 90, 90 - spec.sector.degrees)} fill={`${SERIES[1]}33`} stroke="none" />
      )}
      <circle cx={cx} cy={cy} r={r} fill={spec.sector ? 'none' : `${SERIES[0]}12`} stroke={SERIES[0]} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2.5} fill={INK} />
      {spec.centerLabel && (
        <Text x={cx - 8} y={cy + 14} size={FONT} fill={INK}>
          {spec.centerLabel}
        </Text>
      )}
      {spec.radius && (
        <g>
          {/*
            Drawn down and to the right, and labeled on the line itself. A
            shaded sector starts at twelve o'clock and eats the top-right of
            the circle, which is where a radius label would otherwise land on
            top of the sector's own label.
          */}
          <line x1={cx} y1={cy} x2={radiusEnd[0]} y2={radiusEnd[1]} stroke={INK} strokeWidth={1.6} />
          <Text x={(cx + radiusEnd[0]) / 2 + 4} y={(cy + radiusEnd[1]) / 2 - 6} size={FONT} fill={INK}>
            {spec.radius}
          </Text>
        </g>
      )}
      {spec.diameter && (
        <g>
          <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={INK} strokeWidth={1.6} />
          <Text x={cx} y={cy - 7} size={FONT} fill={INK}>
            {spec.diameter}
          </Text>
        </g>
      )}
      {spec.sector?.label && (
        <Text
          x={polar(cx, cy, r * 0.55, 90 - spec.sector.degrees / 2)[0]}
          y={polar(cx, cy, r * 0.55, 90 - spec.sector.degrees / 2)[1] + 3}
          size={FONT}
          fill={INK}
        >
          {spec.sector.label}
        </Text>
      )}
    </svg>
  )
}

function Angle({ spec }: { spec: AngleFigure }) {
  const W = 290
  const H = 190
  const vertex: Pt = [140, 158]
  const length = 122
  const a: Pt = [vertex[0] + length, vertex[1]]
  const b = polar(vertex[0], vertex[1], length, spec.degrees)
  const arcEnd = polar(vertex[0], vertex[1], 40, spec.degrees)
  const labelAt = polar(vertex[0], vertex[1], 58, spec.degrees / 2)
  const rays = spec.rayLabels ?? []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={vertex[0]} y1={vertex[1]} x2={a[0]} y2={a[1]} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <line x1={vertex[0]} y1={vertex[1]} x2={b[0]} y2={b[1]} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <path d={arrowHead(a[0] + 5, a[1], 0, 5)} fill={INK} />
      <path d={arrowHead(b[0] + Math.cos((spec.degrees * Math.PI) / 180) * 5, b[1] - Math.sin((spec.degrees * Math.PI) / 180) * 5, spec.degrees, 5)} fill={INK} />
      {spec.degrees === 90 ? (
        <path d={rightAngleMark(vertex, a, b, 16)} fill="none" stroke={SERIES[1]} strokeWidth={1.8} />
      ) : (
        <path
          d={arcPath(vertex[0], vertex[1], 40, 0, spec.degrees)}
          fill="none"
          stroke={SERIES[1]}
          strokeWidth={1.8}
        />
      )}
      <Text x={labelAt[0]} y={labelAt[1] + 3} size={FONT + 1} fill={INK} weight={800}>
        {spec.measure ?? `${formatNumber(spec.degrees)}°`}
      </Text>
      {spec.vertexLabel && (
        <Text x={vertex[0] - 12} y={vertex[1] + 14} size={FONT} fill={INK} weight={800}>
          {spec.vertexLabel}
        </Text>
      )}
      {rays[0] && (
        <Text x={a[0] + 2} y={a[1] + 16} size={SMALL} fill={MUTED}>
          {rays[0]}
        </Text>
      )}
      {rays[1] && (
        <Text x={arcEnd[0] + (b[0] - arcEnd[0]) + 6} y={b[1] - 8} size={SMALL} fill={MUTED}>
          {rays[1]}
        </Text>
      )}
    </svg>
  )
}

// --- The figure itself ----------------------------------------------------

function body(spec: FigureSpec): ReactNode {
  switch (spec.kind) {
    case 'bar':
      return <BarChart spec={spec} />
    case 'line':
      return <LineChart spec={spec} />
    case 'pie':
      return <PieChart spec={spec} />
    case 'numberline':
      return <NumberLine spec={spec} />
    case 'plot':
      return <Plot spec={spec} />
    case 'triangle':
      return <Triangle spec={spec} />
    case 'rect':
      return <Rectangle spec={spec} />
    case 'polygon':
      return <Polygon spec={spec} />
    case 'circle':
      return <Circle spec={spec} />
    case 'angle':
      return <Angle spec={spec} />
  }
}

/** How wide the drawing is allowed to get. A figure is an illustration, not a poster. */
const MAX_WIDTH: Partial<Record<FigureSpec['kind'], string>> = {
  plot: '17rem',
  circle: '17rem',
  triangle: '19rem',
  rect: '19rem',
  polygon: '19rem',
  angle: '19rem',
}

export default function FigureView({ spec }: { spec: FigureSpec }) {
  return (
    <figure
      className="my-3 mx-auto w-full rounded-2xl bg-white/70 p-2 ring-1 ring-hair"
      style={{ maxWidth: MAX_WIDTH[spec.kind] ?? '24rem' }}
    >
      {spec.title && (
        <figcaption className="mb-1 text-center text-sm font-extrabold text-ink">
          {spec.title}
        </figcaption>
      )}
      {/*
        The description names the drawing and nothing else — the title and the
        caption stay outside it, so a screen reader gets them once each rather
        than the whole figure twice.
      */}
      <div role="img" aria-label={figureAlt(spec)}>
        {body(spec)}
      </div>
      {spec.caption && (
        <figcaption className="mt-1 text-center text-xs font-bold text-stone">
          {spec.caption}
        </figcaption>
      )}
    </figure>
  )
}
