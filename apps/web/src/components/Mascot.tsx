import { useTheme } from '../lib/theme/ThemeProvider'
import { placeholderStripe, themeById, type ThemeId } from '../lib/themes'

/**
 * Four states, not six.
 *
 * `sad` is deliberately absent. It had exactly one call site — the
 * `accuracy < 50` branch of the spelling results — which meant the only child
 * who ever saw it was the one who had just scored lowest. Missing words at the
 * edge of your ability is the system working as designed; a crestfallen mascot
 * teaches that working at your level is failing. That branch points at
 * `thinking` now.
 *
 *   neutral, happy   -> idle
 *   excited, wow     -> cheer
 *   sleepy           -> resting
 *   sad              -> thinking
 */
export type Mood = 'idle' | 'cheer' | 'thinking' | 'resting'

interface Props {
  mood?: Mood
  /** Defaults to the active theme's accent. */
  color?: string
  /** 200 hero · 108 reward · 62 session · 34 avatar. */
  size?: number
  className?: string
  /**
   * Draw a theme other than the active one. The picker is the only caller that
   * needs this — it shows ten characters at once — and it exists so that
   * showing another theme's mascot cannot be done by accident.
   */
  themeId?: ThemeId
}

/**
 * The secondary companion — the one standing behind the subject you are not
 * currently in. Named rather than a hex so it reads as a role.
 */
export const MASCOT_MUTED = '#8A8375'

// ---------------------------------------------------------------------------
// Color
//
// Everything a mascot needs is derived from one input color, so an overridden
// `color` produces a coherent character rather than a themed body with themed
// trim stuck to it.
// ---------------------------------------------------------------------------

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  const to = amount < 0 ? 0 : 255
  const t = Math.abs(amount)
  const mix = (c: number) => clamp(c + (to - c) * t)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

interface Palette {
  /** Body. */
  base: string
  /** Tail, ears, the parts that sit behind the body. */
  mid: string
  /** Muzzle, belly, helmet glass — the light interior shapes. */
  light: string
  /** Eyes and line work. */
  dark: string
  /** Ground shadow. */
  shadow: string
}

function paletteFor(color: string): Palette {
  return {
    base: color,
    mid: shade(color, -0.18),
    light: shade(color, 0.68),
    dark: shade(color, -0.62),
    shadow: `${shade(color, -0.5)}22`,
  }
}

// ---------------------------------------------------------------------------
// Body plans
//
// Circles, rounded rectangles and triangles only — no traced curves. That is
// the design's style rule and it is what makes ten characters hold together
// and survive 34px, which is the size that decides the silhouette.
//
// Drawn on the same 200x200 box the old cat used, standing on y=178.
// ---------------------------------------------------------------------------

type Fill = keyof Palette
type Shape =
  | { s: 'e'; cx: number; cy: number; rx: number; ry: number; f: Fill; rot?: number }
  | { s: 'r'; x: number; y: number; w: number; h: number; r: number; f: Fill; rot?: number }
  | { s: 't'; pts: string; f: Fill }

interface Plan {
  /** Drawn behind the face. */
  body: Shape[]
  /** Drawn in front of the face — a visor, a helmet dome, a mic. */
  front?: Shape[]
  /** Where the eyes and mouth sit, and how wide apart. */
  face: { x: number; y: number; spread: number; scale?: number }
  /**
   * Space has a glow instead of a face, on purpose — anyone can be the one in
   * the suit. Nothing is drawn where the eyes would go.
   */
  faceless?: boolean
}

const GROUND: Shape = { s: 'e', cx: 100, cy: 180, rx: 58, ry: 7, f: 'shadow' }

const PLANS: Record<ThemeId, Plan> = {
  // Sitting, tail up with the tip flicked. Half-lidded: knows more than it says.
  cats: {
    body: [
      GROUND,
      { s: 'r', x: 138, y: 78, w: 17, h: 76, r: 9, f: 'mid', rot: 16 },
      { s: 'e', cx: 150, cy: 74, rx: 9, ry: 9, f: 'light' },
      { s: 'r', x: 56, y: 106, w: 88, h: 70, r: 34, f: 'base' },
      { s: 'e', cx: 100, cy: 158, rx: 22, ry: 17, f: 'light' },
      { s: 't', pts: '54,86 68,44 88,86', f: 'base' },
      { s: 't', pts: '146,86 132,44 112,86', f: 'base' },
      { s: 'e', cx: 100, cy: 92, rx: 46, ry: 40, f: 'base' },
    ],
    face: { x: 100, y: 92, spread: 20 },
  },

  // Rear end up, tail mid-wag. Long ears, short snout.
  dogs: {
    body: [
      GROUND,
      { s: 'r', x: 142, y: 84, w: 15, h: 54, r: 8, f: 'mid', rot: -28 },
      { s: 'r', x: 52, y: 108, w: 96, h: 66, r: 30, f: 'base' },
      { s: 'e', cx: 96, cy: 156, rx: 26, ry: 16, f: 'light' },
      { s: 'r', x: 52, y: 74, w: 20, h: 54, r: 10, f: 'mid' },
      { s: 'r', x: 126, y: 74, w: 20, h: 54, r: 10, f: 'mid' },
      { s: 'e', cx: 99, cy: 90, rx: 44, ry: 38, f: 'base' },
      { s: 'e', cx: 99, cy: 108, rx: 22, ry: 16, f: 'light' },
    ],
    face: { x: 99, y: 86, spread: 19 },
  },

  // A ground bird in a plain kit with a whistle on a cord. Coach, not star.
  football: {
    body: [
      GROUND,
      { s: 'r', x: 60, y: 100, w: 80, h: 74, r: 30, f: 'base' },
      { s: 'r', x: 74, y: 118, w: 52, h: 48, r: 20, f: 'light' },
      { s: 'r', x: 96, y: 128, w: 8, h: 30, r: 4, f: 'mid' },
      { s: 'e', cx: 118, cy: 152, rx: 8, ry: 8, f: 'dark' },
      { s: 'e', cx: 100, cy: 76, rx: 38, ry: 34, f: 'base' },
      { s: 't', pts: '100,88 118,98 100,106', f: 'light' },
      { s: 'r', x: 62, y: 48, w: 76, h: 16, r: 8, f: 'mid' },
    ],
    face: { x: 100, y: 72, spread: 15, scale: 0.85 },
  },

  // Bubble helmet, no face — a glow instead. Anyone can be the one inside.
  space: {
    body: [
      GROUND,
      { s: 'r', x: 52, y: 96, w: 96, h: 80, r: 32, f: 'base' },
      { s: 'r', x: 78, y: 116, w: 44, h: 40, r: 14, f: 'light' },
      { s: 'r', x: 38, y: 104, w: 18, h: 52, r: 9, f: 'mid' },
      { s: 'r', x: 144, y: 104, w: 18, h: 52, r: 9, f: 'mid' },
      { s: 'e', cx: 100, cy: 70, rx: 40, ry: 40, f: 'mid' },
    ],
    front: [
      { s: 'e', cx: 100, cy: 70, rx: 33, ry: 33, f: 'light' },
      { s: 'e', cx: 89, cy: 60, rx: 10, ry: 7, f: 'base', rot: -28 },
    ],
    face: { x: 100, y: 70, spread: 0 },
    faceless: true,
  },

  // Stubby stegosaurus, rounded plates, dig hat. No teeth.
  dinosaurs: {
    body: [
      GROUND,
      { s: 'r', x: 128, y: 116, w: 46, h: 15, r: 8, f: 'mid', rot: -16 },
      { s: 'r', x: 46, y: 104, w: 104, h: 72, r: 32, f: 'base' },
      { s: 'e', cx: 98, cy: 154, rx: 30, ry: 18, f: 'light' },
      { s: 't', pts: '74,104 86,74 98,104', f: 'mid' },
      { s: 't', pts: '100,104 114,72 128,104', f: 'mid' },
      { s: 'e', cx: 62, cy: 88, rx: 34, ry: 30, f: 'base' },
      { s: 'e', cx: 52, cy: 98, rx: 16, ry: 11, f: 'light' },
      { s: 'r', x: 32, y: 56, w: 62, h: 13, r: 6, f: 'dark' },
      { s: 'r', x: 42, y: 44, w: 42, h: 18, r: 8, f: 'dark' },
    ],
    face: { x: 62, y: 84, spread: 14, scale: 0.8 },
  },

  // Domed octopus: three arms shown, plus one waving.
  ocean: {
    body: [
      GROUND,
      { s: 'r', x: 44, y: 132, w: 30, h: 15, r: 8, f: 'mid' },
      { s: 'r', x: 86, y: 140, w: 30, h: 15, r: 8, f: 'mid' },
      { s: 'r', x: 124, y: 132, w: 30, h: 15, r: 8, f: 'mid' },
      { s: 'r', x: 140, y: 74, w: 15, h: 48, r: 8, f: 'mid', rot: 24 },
      { s: 'e', cx: 100, cy: 106, rx: 52, ry: 48, f: 'base' },
      { s: 'e', cx: 100, cy: 128, rx: 30, ry: 20, f: 'light' },
    ],
    face: { x: 100, y: 100, spread: 21 },
  },

  // Pit-crew fox in plain coveralls, wrench in paw. The weakest of the ten:
  // a red triangular ear on a round red head fights being a fox, which is why
  // the spec has this one redrawn first.
  racing: {
    body: [
      GROUND,
      { s: 'r', x: 56, y: 104, w: 88, h: 72, r: 28, f: 'base' },
      { s: 'r', x: 74, y: 122, w: 52, h: 50, r: 18, f: 'light' },
      { s: 'r', x: 138, y: 110, w: 12, h: 40, r: 6, f: 'dark', rot: 18 },
      { s: 'e', cx: 148, cy: 106, rx: 9, ry: 9, f: 'dark' },
      { s: 't', pts: '58,80 70,42 90,80', f: 'mid' },
      { s: 't', pts: '142,80 130,42 110,80', f: 'mid' },
      { s: 'e', cx: 100, cy: 84, rx: 42, ry: 36, f: 'base' },
      { s: 'e', cx: 100, cy: 100, rx: 20, ry: 14, f: 'light' },
    ],
    face: { x: 100, y: 80, spread: 18 },
  },

  // Short-legged pony, mane down the neck, light forelock at the brow.
  // Halter only — no saddle, no rider.
  horses: {
    body: [
      GROUND,
      { s: 'r', x: 48, y: 110, w: 100, h: 64, r: 26, f: 'base' },
      { s: 'r', x: 60, y: 158, w: 15, h: 20, r: 7, f: 'mid' },
      { s: 'r', x: 122, y: 158, w: 15, h: 20, r: 7, f: 'mid' },
      { s: 'r', x: 106, y: 60, w: 30, h: 60, r: 14, f: 'mid' },
      { s: 'e', cx: 128, cy: 66, rx: 30, ry: 27, f: 'base' },
      { s: 'e', cx: 146, cy: 78, rx: 15, ry: 11, f: 'light' },
      { s: 't', pts: '108,44 114,20 126,44', f: 'base' },
      { s: 'r', x: 100, y: 40, w: 20, h: 26, r: 9, f: 'light' },
      { s: 'r', x: 136, y: 72, w: 22, h: 6, r: 3, f: 'dark' },
    ],
    face: { x: 130, y: 62, spread: 13, scale: 0.78 },
  },

  // Songbird mid-note on a stand mic. No genre signalling.
  music: {
    body: [
      GROUND,
      { s: 'r', x: 96, y: 96, w: 8, h: 82, r: 4, f: 'dark' },
      { s: 'e', cx: 100, cy: 176, rx: 26, ry: 6, f: 'dark' },
      { s: 'r', x: 128, y: 96, w: 16, h: 44, r: 8, f: 'mid', rot: 30 },
      { s: 'e', cx: 88, cy: 86, rx: 40, ry: 42, f: 'base' },
      { s: 'e', cx: 84, cy: 104, rx: 22, ry: 20, f: 'light' },
      { s: 't', pts: '48,84 26,90 48,98', f: 'mid' },
      { s: 'e', cx: 100, cy: 88, rx: 15, ry: 15, f: 'dark' },
    ],
    front: [{ s: 'e', cx: 100, cy: 88, rx: 10, ry: 10, f: 'light' }],
    face: { x: 82, y: 80, spread: 15, scale: 0.8 },
  },

  // Boxy, treads, one wide visor. Equipment with a personality.
  robots: {
    body: [
      GROUND,
      { s: 'r', x: 46, y: 148, w: 108, h: 26, r: 13, f: 'dark' },
      { s: 'e', cx: 68, cy: 161, rx: 8, ry: 8, f: 'mid' },
      { s: 'e', cx: 132, cy: 161, rx: 8, ry: 8, f: 'mid' },
      { s: 'r', x: 60, y: 92, w: 80, h: 58, r: 16, f: 'base' },
      { s: 'r', x: 74, y: 106, w: 52, h: 30, r: 10, f: 'light' },
      { s: 'r', x: 40, y: 98, w: 16, h: 44, r: 8, f: 'mid' },
      { s: 'r', x: 144, y: 98, w: 16, h: 44, r: 8, f: 'mid' },
      { s: 'r', x: 96, y: 34, w: 8, h: 22, r: 4, f: 'mid' },
      { s: 'e', cx: 100, cy: 32, rx: 8, ry: 8, f: 'light' },
      { s: 'r', x: 58, y: 50, w: 84, h: 46, r: 14, f: 'base' },
      { s: 'r', x: 68, y: 62, w: 64, h: 24, r: 12, f: 'dark' },
    ],
    face: { x: 100, y: 74, spread: 17, scale: 0.9 },
  },
}

function drawShape(sh: Shape, i: number, p: Palette) {
  const rot = 's' in sh && sh.s !== 't' && sh.rot ? sh.rot : 0
  if (sh.s === 'e') {
    const t = rot ? `rotate(${rot} ${sh.cx} ${sh.cy})` : undefined
    return <ellipse key={i} cx={sh.cx} cy={sh.cy} rx={sh.rx} ry={sh.ry} fill={p[sh.f]} transform={t} />
  }
  if (sh.s === 'r') {
    const t = rot ? `rotate(${rot} ${sh.x + sh.w / 2} ${sh.y + sh.h / 2})` : undefined
    return (
      <rect key={i} x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.r} fill={p[sh.f]} transform={t} />
    )
  }
  return <polygon key={i} points={sh.pts} fill={p[sh.f]} />
}

/**
 * One face, four states, drawn over whatever body plan is underneath. Keeping
 * the expression in one place is what lets ten characters share four states
 * without forty drawings.
 */
function Face({ plan, mood, p }: { plan: Plan; mood: Mood; p: Palette }) {
  if (plan.faceless) {
    // Space: a glow where the face would be.
    return <ellipse cx={plan.face.x} cy={plan.face.y} rx={14} ry={14} fill={p.base} opacity={0.35} />
  }

  const { x, y, spread } = plan.face
  const k = plan.face.scale ?? 1
  const l = x - spread
  const r = x + spread
  const mouthY = y + 22 * k
  const line = { stroke: p.dark, strokeWidth: 4 * k, fill: 'none', strokeLinecap: 'round' } as const

  return (
    <g>
      {mood === 'resting' ? (
        <>
          <path d={`M${l - 8 * k} ${y} q${8 * k} ${7 * k} ${16 * k} 0`} {...line} />
          <path d={`M${r - 8 * k} ${y} q${8 * k} ${7 * k} ${16 * k} 0`} {...line} />
          <path d={`M${x - 7 * k} ${mouthY} q${7 * k} ${5 * k} ${14 * k} 0`} {...line} />
          <text
            x={x + spread + 18 * k}
            y={y - 18 * k}
            fontSize={20 * k}
            fontWeight="800"
            fill={p.dark}
            fontFamily="Outfit Variable, Outfit, sans-serif"
          >
            z
          </text>
        </>
      ) : mood === 'cheer' ? (
        <>
          <ellipse cx={l} cy={y} rx={9 * k} ry={10 * k} fill="#fff" />
          <ellipse cx={r} cy={y} rx={9 * k} ry={10 * k} fill="#fff" />
          <ellipse cx={l + 1 * k} cy={y + 1 * k} rx={6 * k} ry={6.5 * k} fill={p.dark} />
          <ellipse cx={r + 1 * k} cy={y + 1 * k} rx={6 * k} ry={6.5 * k} fill={p.dark} />
          <ellipse cx={l + 3 * k} cy={y - 2 * k} rx={2 * k} ry={2 * k} fill="#fff" />
          <ellipse cx={r + 3 * k} cy={y - 2 * k} rx={2 * k} ry={2 * k} fill="#fff" />
          <path
            d={`M${x - 11 * k} ${mouthY - 3 * k} q${11 * k} ${13 * k} ${22 * k} 0`}
            {...line}
            strokeWidth={4.5 * k}
          />
        </>
      ) : mood === 'thinking' ? (
        <>
          {/* Looking up and away, working on it. Not downcast. */}
          <ellipse cx={l} cy={y} rx={7 * k} ry={7.5 * k} fill={p.dark} />
          <ellipse cx={r} cy={y} rx={7 * k} ry={7.5 * k} fill={p.dark} />
          <ellipse cx={l - 2 * k} cy={y - 3 * k} rx={2.4 * k} ry={2.4 * k} fill="#fff" />
          <ellipse cx={r - 2 * k} cy={y - 3 * k} rx={2.4 * k} ry={2.4 * k} fill="#fff" />
          <path d={`M${x - 8 * k} ${mouthY} h${16 * k}`} {...line} />
          <ellipse cx={r + 17 * k} cy={y - 20 * k} rx={3.5 * k} ry={3.5 * k} fill={p.dark} opacity={0.5} />
          <ellipse cx={r + 25 * k} cy={y - 29 * k} rx={5 * k} ry={5 * k} fill={p.dark} opacity={0.35} />
        </>
      ) : (
        <>
          {/* idle — half-lidded, knows more than it says. */}
          <path d={`M${l - 8 * k} ${y - 2 * k} q${8 * k} ${8 * k} ${16 * k} 0`} {...line} strokeWidth={5 * k} />
          <path d={`M${r - 8 * k} ${y - 2 * k} q${8 * k} ${8 * k} ${16 * k} 0`} {...line} strokeWidth={5 * k} />
          <path d={`M${x - 8 * k} ${mouthY - 2 * k} q${8 * k} ${8 * k} ${16 * k} 0`} {...line} />
        </>
      )}
    </g>
  )
}

/**
 * The mascot slot.
 *
 * A fixed-aspect box that renders the theme's art if it has any and the v1
 * primitive otherwise, so themes can ship drawn art one at a time and drawn
 * and primitive mascots can stand side by side. A theme with neither gets the
 * striped placeholder rather than a hole.
 */
export default function Mascot({
  mood = 'idle',
  color,
  size = 160,
  className = '',
  themeId,
}: Props) {
  const { theme: active } = useTheme()
  const theme = themeId ? themeById(themeId) : active
  const fill = color ?? theme.accent
  const plan = PLANS[theme.id]
  const label = `${theme.name} mascot, ${mood}`

  if (theme.mascotSrc) {
    return (
      <img
        src={theme.mascotSrc}
        width={size}
        height={size}
        className={className}
        alt={label}
        style={{ objectFit: 'contain' }}
      />
    )
  }

  if (!plan) {
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.115),
          background: placeholderStripe(theme),
        }}
      />
    )
  }

  const p = paletteFor(fill)
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      {plan.body.map((sh, i) => drawShape(sh, i, p))}
      <Face plan={plan} mood={mood} p={p} />
      {plan.front?.map((sh, i) => drawShape(sh, 1000 + i, p))}
    </svg>
  )
}
