import { Pill } from '../ui'
import type { QuizDeck } from '../../lib/progress/types'

/**
 * How a deck got into the learner's list — one of the three ways in
 * docs/ux-coherence.md, in the words the doc uses. The same pill on the list
 * and on the deck, so the deck's own screen never surprises.
 */
export default function SourcePill({ source }: { source: QuizDeck['source'] }) {
  if (source === 'starter') return <Pill className="shrink-0 bg-teal-100 text-teal-700">Starter</Pill>
  if (source === 'assigned') return <Pill className="shrink-0 bg-sun/30 text-ink">Set by a grown-up</Pill>
  return <Pill className="shrink-0 bg-wash text-ink">Mine</Pill>
}
