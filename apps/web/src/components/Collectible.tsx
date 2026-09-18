import { useTheme } from '../lib/theme/ThemeProvider'
import { placeholderStripe, slotLabels } from '../lib/themes'

interface Props {
  /**
   * Which slot of the theme's set this is, 0-based, in the order the
   * collection screen fills them. The results screen passes the slot the
   * round just filled (`roundCollectible().slot`), so the item it announces
   * is the item the wall shows next — the same name, the same position.
   */
  slot?: number
  /**
   * @deprecated Legacy hashed id from the typing game's per-lesson cards.
   * Kept only so the typing lesson map still compiles; hashes to a slot, so
   * the name it produces does not line up with the wall. Pass `slot`.
   */
  seed?: string
  className?: string
  rounded?: string
  /** Show the item's name underneath. */
  showLabel?: boolean
}

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * One earned collectible, in whatever the current theme calls it.
 *
 * Replaces CatPhoto, which fetched real kitten photographs from a third-party
 * image host. That was wrong twice over: it made the typing game's rewards
 * cats no matter which of the ten themes a learner had chosen, and it put a
 * network round trip — to a service that can be down, slow, or serve something
 * unexpected — in front of a child's reward.
 *
 * Art is the theme's stripe until drawn reward art exists, the same slot the
 * collection screen uses, so the two agree about what a learner owns.
 */
export default function Collectible({
  slot,
  seed,
  className = '',
  rounded = 'rounded-2xl',
  showLabel = false,
}: Props) {
  const { theme } = useTheme()
  const labels = slotLabels(theme)
  const index =
    typeof slot === 'number'
      ? Math.min(labels.length - 1, Math.max(0, Math.floor(slot)))
      : hashSeed(seed ?? '') % labels.length
  const name = labels[index] ?? theme.unitOne

  return (
    <div className={showLabel ? '' : className}>
      <div
        role="img"
        aria-label={`${name}, a ${theme.unitOne}`}
        className={`${rounded} ${showLabel ? className : 'h-full w-full'}`}
        style={{ background: placeholderStripe(theme) }}
      />
      {showLabel && (
        <div className="mt-1 truncate text-center text-[13px] font-extrabold text-ink">{name}</div>
      )}
    </div>
  )
}
