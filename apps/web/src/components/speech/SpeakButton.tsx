import type { MouseEvent } from 'react'
import { useReading } from '../../lib/speech/reading'
import { isSayable } from '../../lib/speech/spoken'
import { useSpeechReady } from '../../lib/speech/useSpeechReady'

export type SpeakSize = 'sm' | 'md' | 'lg' | 'tile'

// Each size owns its radius: `tile` is a column beside an answer button and has
// to be that button's shape, not a circle floating next to it.
const SIZES: Record<SpeakSize, string> = {
  // Small enough to sit in a list row without owning it, still a 28px target.
  sm: 'h-7 w-7 rounded-full text-xs',
  md: 'h-9 w-9 rounded-full text-base',
  lg: 'h-11 w-11 rounded-full text-xl',
  tile: 'w-10 self-stretch rounded-2xl text-base',
}

/**
 * Read this text out loud, and show where the voice has got to.
 *
 * One button, everywhere card text appears. Pressing it again stops — a child
 * who set it going by accident, or who has heard enough, needs a way out that
 * is the same button they just pressed.
 *
 * It renders nothing when the device has no voice, and nothing when there is
 * nothing sayable (a card that is only a photograph). An affordance that does
 * nothing teaches a learner to stop trusting the ones that do.
 */
export default function SpeakButton({
  source,
  label,
  size = 'md',
  className = '',
}: {
  source: string
  /**
   * What is being read, for the screen reader: "Read the question out loud".
   * Say the thing, not the words — the words are already on screen.
   */
  label: string
  size?: SpeakSize
  className?: string
}) {
  const ready = useSpeechReady()
  const { speaking, toggle } = useReading(source)

  if (!ready || !isSayable(source)) return null

  // These buttons live inside cards and rows that are themselves clickable,
  // and "read it to me" must never also mean "flip the card" or "pick this
  // answer".
  const press = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle()
  }

  return (
    <button
      type="button"
      onClick={press}
      aria-label={label}
      aria-pressed={speaking}
      title={speaking ? 'Stop reading' : label}
      className={`inline-flex shrink-0 items-center justify-center ring-1 transition-colors ${
        speaking
          ? 'animate-pulse bg-sun text-ink ring-sun'
          : 'bg-white/80 text-stone ring-hair hover:bg-wash hover:text-ink'
      } ${SIZES[size]} ${className}`}
    >
      <span aria-hidden="true">{speaking ? '⏹' : '🔊'}</span>
    </button>
  )
}
