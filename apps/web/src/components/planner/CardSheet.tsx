// Tap a card and this opens: title, course, day, minutes, done or skip,
// remove — and its history, and the notes people left on it. Not a modal
// wizard; one small sheet, everything on it.

import { useEffect, useState } from 'react'
import {
  DAY_NAMES,
  daysOfWeek,
  isLinked,
  PURPOSE_COPY,
  type Course,
  type PlannerComment,
  type PlannerEvent,
  type PlannerItem,
} from '@whizzo/shared'
import { Button } from '../ui'
import { CoursePicker } from './CourseChip'
import Timeline from './Timeline'
import { addComment, deleteComment, itemHistory } from '../../lib/planner/api'
import type { ItemPatch } from '../../lib/planner/api'

export default function CardSheet({
  item,
  courses,
  comments,
  learnerId,
  learnerName,
  userId,
  weekStart,
  canWrite,
  onPatch,
  onTick,
  onSkip,
  onRemove,
  onCopy,
  onStart,
  onCommentAdded,
  onCommentRemoved,
  onClose,
}: {
  item: PlannerItem
  courses: Course[]
  comments: PlannerComment[]
  learnerId: string
  learnerName: string
  userId: string | undefined
  weekStart: string
  canWrite: boolean
  onPatch: (item: PlannerItem, patch: ItemPatch, label?: string) => Promise<unknown>
  onTick: (item: PlannerItem) => void
  onSkip: (item: PlannerItem) => void
  onRemove: (item: PlannerItem) => void
  onCopy: (item: PlannerItem, onDay: string | null) => void
  onStart?: (item: PlannerItem) => void
  onCommentAdded: (c: PlannerComment) => void
  onCommentRemoved: (id: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [minutes, setMinutes] = useState(item.minutes ?? '')
  const [tab, setTab] = useState<'card' | 'history' | 'notes'>('card')
  const [events, setEvents] = useState<PlannerEvent[] | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const linked = isLinked(item)
  const days = daysOfWeek(weekStart)

  useEffect(() => {
    setTitle(item.title)
    setMinutes(item.minutes ?? '')
  }, [item.id, item.title, item.minutes])

  useEffect(() => {
    if (tab !== 'history' || events) return
    const controller = new AbortController()
    itemHistory(learnerId, item.id, controller.signal)
      .then(setEvents)
      .catch(() => setEvents([]))
    return () => controller.abort()
  }, [tab, events, learnerId, item.id])

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const commit = async () => {
    const patch: ItemPatch = {}
    if (title.trim() && title.trim() !== item.title) patch.title = title.trim()
    const m = minutes === '' ? null : Number(minutes)
    if (m !== item.minutes) patch.minutes = m
    if (Object.keys(patch).length) await onPatch(item, patch, 'Saved')
  }

  const own = comments.filter((c) => c.itemId === item.id)

  const sendNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    try {
      const c = await addComment(learnerId, weekStart, note.trim(), item.id)
      onCommentAdded(c)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label={item.title}
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-hair bg-chalk p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex gap-1 rounded-xl bg-tray p-1 text-sm font-extrabold">
          {(['card', 'history', 'notes'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${tab === t ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}
            >
              {t === 'notes' && own.length ? `Notes (${own.length})` : t}
            </button>
          ))}
        </div>

        {tab === 'card' && (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              disabled={!canWrite}
              aria-label="Title"
              className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-[16px] font-extrabold text-ink focus:border-ink focus:outline-none"
            />
            {item.purpose && (
              <p className="rounded-xl bg-wash p-3 text-sm font-bold text-ink">
                <span className="text-pine">{PURPOSE_COPY[item.purpose].name}.</span>{' '}
                {PURPOSE_COPY[item.purpose].line}
              </p>
            )}
            {courses.length > 0 && item.kind !== 'event' && (
              <div>
                <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">Course</div>
                <CoursePicker
                  courses={courses}
                  value={item.courseId}
                  onChange={(courseId) => canWrite && onPatch(item, { courseId }, 'Filed')}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">Day</div>
                <select
                  value={item.onDay ?? ''}
                  disabled={!canWrite}
                  onChange={(e) => onPatch(item, { onDay: e.target.value || null }, 'Moved')}
                  className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink"
                >
                  {item.kind === 'task' && <option value="">Shelf (no day yet)</option>}
                  {days.map((d, i) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[i]} {d.slice(5)}
                    </option>
                  ))}
                  {item.onDay && !days.includes(item.onDay) && <option value={item.onDay}>{item.onDay}</option>}
                </select>
              </label>
              {item.kind !== 'event' && (
                <label className="block">
                  <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">Minutes</div>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={minutes}
                    disabled={!canWrite}
                    onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                    onBlur={commit}
                    className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink"
                  />
                </label>
              )}
            </div>

            {item.doneBy && item.status === 'done' && (
              <p className="text-xs font-bold text-muted">Ticked by hand — a claim, with a name on it.</p>
            )}
            {item.sessionId && item.status === 'done' && (
              <p className="text-xs font-bold text-pine">Closed by a round the app checked.</p>
            )}

            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-1">
                {linked && item.status === 'open' && onStart && (
                  <Button onClick={() => onStart(item)}>▶ Start</Button>
                )}
                {!linked && item.kind !== 'event' && (
                  <Button variant="ghost" onClick={() => onTick(item)}>
                    {item.status === 'done' ? 'Un-tick' : '✓ Done'}
                  </Button>
                )}
                {item.kind === 'study' && (
                  <Button variant="ghost" onClick={() => onSkip(item)}>
                    {item.status === 'skipped' ? 'Un-skip' : 'Skip'}
                  </Button>
                )}
                {item.kind === 'task' && (
                  <Button variant="ghost" onClick={() => onCopy(item, item.onDay)}>
                    Duplicate
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => {
                    onRemove(item)
                    onClose()
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <Timeline events={events ?? []} learnerName={learnerName} emptyText={events ? 'Nothing yet.' : 'Loading…'} />
        )}

        {tab === 'notes' && (
          <div className="space-y-3">
            {own.length === 0 && <p className="text-sm font-bold text-stone">No notes on this one.</p>}
            <ul className="space-y-2">
              {own.map((c) => (
                <li key={c.id} className="rounded-xl bg-sun/30 p-3 text-sm">
                  <div className="font-extrabold text-ink">{c.body}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-muted">
                    <span>{c.authorName ?? 'Someone'}</span>
                    {c.authorId === userId && (
                      <button
                        type="button"
                        className="underline"
                        onClick={async () => {
                          await deleteComment(c.id)
                          onCommentRemoved(c.id)
                        }}
                      >
                        remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendNote()}
                placeholder="Leave a note"
                aria-label="Leave a note"
                className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink focus:border-ink focus:outline-none"
              />
              <Button onClick={sendNote} disabled={busy || !note.trim()}>
                Post
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 text-right">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
