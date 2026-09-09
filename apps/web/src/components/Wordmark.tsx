import { useTheme } from '../lib/theme/ThemeProvider'

/**
 * The Whizzo wordmark: an ink squircle carrying `wz` in the active theme
 * accent, followed by `whizzo` in Outfit 900.
 *
 * Always lowercase. The glyph is the one piece of brand chrome that takes the
 * theme color — the mark belongs to the learner, the rest of the chrome does
 * not — so `accent={false}` is there for the grown-up surfaces, where it
 * renders in spark instead.
 */
export default function Wordmark({
  size = 34,
  accent = true,
  className = '',
}: {
  size?: number
  accent?: boolean
  className?: string
}) {
  const { theme } = useTheme()
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="inline-flex shrink-0 items-center justify-center bg-ink font-display font-black"
        style={{
          width: size,
          height: size,
          // 11px at 34px, kept proportional so the mark holds its shape when
          // it is set larger or smaller.
          borderRadius: Math.round(size * 0.324),
          fontSize: Math.round(size * 0.5),
          letterSpacing: '-0.08em',
          color: accent ? theme.accent : '#FF6A2B',
        }}
        aria-hidden
      >
        wz
      </span>
      <span
        className="font-display font-black text-ink"
        style={{ fontSize: Math.round(size * 0.72), letterSpacing: '-0.035em' }}
      >
        whizzo
      </span>
    </span>
  )
}
