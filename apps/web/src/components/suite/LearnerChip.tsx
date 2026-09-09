import { useEffect, useRef, useState } from 'react'
import { useLearners } from '../../lib/learners/LearnerProvider'

/**
 * Who is practicing right now.
 *
 * Distinct from AccountChip on purpose: since the learner inversion the adult
 * holding the session and the learner whose progress is on screen are two
 * different things, and a parent with three children needs to see at a glance
 * which one they are looking at. With a single learner this stays a plain
 * label — no dropdown for a choice of one.
 */
export default function LearnerChip({ onManage }: { onManage: () => void }) {
  const { learners, active, select, status } = useLearners()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  if (status !== 'ready' || !active) return null

  const solo = learners.length <= 1

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (solo ? onManage() : setOpen((v) => !v))}
        aria-haspopup={solo ? undefined : 'menu'}
        aria-expanded={solo ? undefined : open}
        className="flex items-center gap-2 rounded-full border-2 border-edge bg-white/80 py-1.5 pl-2 pr-3 text-sm font-extrabold text-ink shadow-sm transition-colors hover:bg-white"
      >
        <span className="text-lg leading-none">{active.avatarEmoji}</span>
        <span className="max-w-[9rem] truncate">{active.displayName}</span>
        {!solo && <span className="text-[10px] text-stone">▼</span>}
      </button>

      {open && !solo && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-2xl border-2 border-edge bg-white shadow-xl"
        >
          {learners.map((learner) => (
            <button
              key={learner.id}
              role="menuitem"
              onClick={() => {
                select(learner.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-extrabold transition-colors hover:bg-quiet ${
                learner.id === active.id ? 'text-ink' : 'text-muted'
              }`}
            >
              <span className="text-lg leading-none">{learner.avatarEmoji}</span>
              <span className="flex-1 truncate">{learner.displayName}</span>
              {learner.id === active.id && <span className="text-xs">✓</span>}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
            className="w-full border-t-2 border-hair px-3 py-2.5 text-left text-sm font-extrabold text-stone transition-colors hover:bg-quiet hover:text-ink"
          >
            Manage family →
          </button>
        </div>
      )}
    </div>
  )
}
