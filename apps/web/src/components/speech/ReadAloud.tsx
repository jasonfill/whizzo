import RichText from '../rich/RichText'
import SpeakButton, { type SpeakSize } from './SpeakButton'

/**
 * Card text with its own speaker beside it.
 *
 * For the places where the text is a line rather than a stage — a row in a
 * deck, a word in the results, an answer in a list. Where the text is the
 * whole point of the screen the two are laid out by hand instead, so the
 * speaker can sit with the "Question" label rather than in front of the first
 * word.
 */
export default function ReadAloud({
  source,
  label,
  className = '',
  textClassName = '',
  size = 'sm',
  figures = 'describe',
}: {
  source: string
  label: string
  /** The row. */
  className?: string
  /** The text inside it. */
  textClassName?: string
  size?: SpeakSize
  figures?: 'draw' | 'describe'
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <SpeakButton source={source} label={label} size={size} />
      <RichText source={source} className={textClassName} figures={figures} />
    </span>
  )
}
