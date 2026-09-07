// Every card remembers. This is how it shows what it remembers.

import { describeEvent, type PlannerEvent } from '@whizzo/shared'

export default function Timeline({
  events,
  learnerName,
  emptyText = 'Nothing yet.',
}: {
  events: PlannerEvent[]
  learnerName: string
  emptyText?: string
}) {
  if (events.length === 0) return <p className="text-sm font-bold text-stone">{emptyText}</p>
  return (
    <ol className="space-y-1.5" aria-label="History">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 text-sm">
          <span className="shrink-0 font-mono text-[11px] font-bold text-faint">{when(e.at)}</span>
          <span className={`font-bold ${e.actorId === null ? 'text-pine' : 'text-ink'}`}>
            {describeEvent(e, learnerName)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function when(at: number): string {
  const d = new Date(at)
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
