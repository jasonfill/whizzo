import type { ReactNode } from 'react'
import { useBack } from '../../hooks/useBack'
import type { Route } from '../../routes'
import { Button } from '../ui'

interface Props {
  title: string
  subtitle?: string
  /**
   * Where Back lands when there is no history to return to. Prefer this over
   * `onBack`: a screen reached from two places goes back to whichever one the
   * visitor actually came from, and only a cold deep link uses the fallback.
   */
  back?: Route
  /** Escape hatch for screens that must do something before leaving. */
  onBack?: () => void
  backLabel?: string
  right?: ReactNode
}

export default function ScreenHeader({ title, subtitle, back, onBack, backLabel = '← Back', right }: Props) {
  const goBack = useBack(back ?? { name: 'home' })
  const handler = onBack ?? (back ? goBack : undefined)
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-ink md:text-4xl">{title}</h1>
        {subtitle && <p className="font-bold text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        {handler && (
          <Button variant="ghost" onClick={handler}>
            {backLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
