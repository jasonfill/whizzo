// Every item on the planner is one of these, so the learner learns one object.
//
// The anatomy: a colour bar from the course, the title, a minutes chip, and a
// state mark — an empty box for a claim, the verified mark for app work, a
// faint outline for a proposed session not yet accepted. Start appears on any
// card the app can run and nowhere else. A card the app can run has no box:
// it is closed by the round, and the one exception to "one tap finishes
// anything" is the one the whole product rests on.

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { PURPOSE_COPY, type Course, type PlannerItem } from '@whizzo/shared'

export interface CardProps {
  item: PlannerItem
  course: Course | null | undefined
  /** Who added it, when that was somebody other than the learner. */
  addedBy?: string | null
  index?: number
  dragging?: boolean
  ghost?: boolean
  compact?: boolean
  onTick?: (item: PlannerItem) => void
  onOpen?: (item: PlannerItem) => void
  onStart?: (item: PlannerItem) => void
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
}

export default function PlannerCard({
  item,
  course,
  addedBy,
  index,
  dragging,
  ghost,
  compact,
  onTick,
  onOpen,
  onStart,
  onPointerDown,
  onKeyDown,
}: CardProps) {
  const linked = item.target !== null
  const done = item.status === 'done'
  const skipped = item.status === 'skipped'
  const color = course?.color ?? (item.kind === 'event' ? '#1C1A16' : '#D9D2C4')
  const purpose = item.purpose ? PURPOSE_COPY[item.purpose].name : null

  const Trailing = () => (
    <>
      {item.minutes !== null && item.kind !== 'event' && (
        <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted">
          {item.minutes}m
        </span>
      )}
      {linked && !done && !skipped && onStart && (
        <button
          type="button"
          onClick={() => onStart(item)}
          className="shrink-0 rounded-lg bg-spark px-2.5 py-1 text-xs font-extrabold text-white shadow-[0_2px_0_#E14E12]"
        >
          ▶ Start
        </button>
      )}
    </>
  )

  return (
    <div
      data-card-index={index}
      data-card-id={item.id}
      role="listitem"
      tabIndex={0}
      aria-label={`${item.title}${done ? ', done' : skipped ? ', skipped' : ''}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onOpen?.(item)}
      className={`group relative flex select-none items-center gap-2 rounded-xl border border-hair bg-white/90 pr-2 text-left shadow-sm transition-all ${
        compact ? 'py-1.5' : 'py-2'
      } ${dragging ? 'opacity-30' : ''} ${ghost ? 'border-dashed opacity-70' : ''} ${
        done || skipped ? 'opacity-60' : ''
      } focus:outline-none focus:ring-2 focus:ring-spark ${onPointerDown ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ touchAction: 'pan-y' }}
    >
      <span
        aria-hidden
        className="ml-1 h-7 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />

      {/* The state mark. */}
      {item.kind === 'event' ? (
        <span aria-hidden className="text-base leading-none">📌</span>
      ) : linked ? (
        <span
          aria-label={done ? 'Checked by the app' : 'Closed by doing it'}
          title={done ? 'Checked by the app' : 'This one is closed by doing it. Start it.'}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-extrabold ${
            done ? 'bg-pine text-white' : 'border-2 border-dashed border-pine/60 text-pine'
          }`}
        >
          ✓
        </span>
      ) : onTick ? (
        <button
          type="button"
          aria-label={done ? `Un-tick ${item.title}` : `Tick ${item.title}`}
          aria-pressed={done}
          onClick={() => onTick(item)}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-[13px] font-extrabold transition-colors ${
            done ? 'border-ink bg-ink text-white' : 'border-edge bg-white hover:border-ink'
          }`}
        >
          {done ? '✓' : ''}
        </button>
      ) : (
        <span
          aria-label={done ? 'Done' : 'Not done'}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-[13px] font-extrabold ${
            done ? 'border-ink bg-ink text-white' : 'border-edge bg-white'
          }`}
        >
          {done ? '✓' : ''}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" data-drag-ok onClick={() => onOpen?.(item)} className="min-w-0 flex-1 text-left">
            <span
              className={`block truncate font-extrabold text-ink ${compact ? 'text-[13px]' : 'text-[15px]'} ${
                done || skipped ? 'line-through decoration-2' : ''
              }`}
            >
              {item.title}
            </span>
            {(purpose || skipped || item.proposed) && !compact && (
              <span className="block truncate text-[11px] font-bold text-muted">
                {skipped ? 'skipped' : purpose}
                {item.proposed && !skipped ? ' · suggested' : ''}
              </span>
            )}
          </button>
          {addedBy && (
            <span
              title={`Added by ${addedBy}`}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-extrabold text-white"
            >
              {addedBy.slice(0, 1).toUpperCase()}
            </span>
          )}
          {!compact && <Trailing />}
        </div>
        {compact && (item.minutes !== null || (linked && !done && !skipped && onStart)) && (
          <div className="flex flex-wrap items-center gap-1.5 pr-1">
            <Trailing />
          </div>
        )}
      </div>
    </div>
  )
}
