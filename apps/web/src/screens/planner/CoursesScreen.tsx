// The learner's courses: add, edit, archive, roll over to a new term.
//
// A course is an enrollment, not a track. It cites one, and the track is
// suggested from the name — "Bio" files under Biology without anybody being
// asked — so filing a task under a class is one chip tap forever after.

import { useCallback, useEffect, useState } from 'react'
import { COURSE_COLORS, nextCourseColor, suggestTrack, TRACKS, trackOf, type Course } from '@whizzo/shared'
import { CourseChip } from '../../components/planner/CourseChip'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { archiveCourse, createCourse, deleteCourse, listCourses, rolloverCourses, updateCourse } from '../../lib/planner/api'
import type { Navigate } from '../../routes'

export default function CoursesScreen({ navigate }: { navigate: Navigate }) {
  const { active } = useLearners()
  const learnerId = active?.id ?? null
  const [courses, setCourses] = useState<Course[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!learnerId) return
      try {
        setCourses(await listCourses(learnerId, true, signal))
      } catch (err) {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load courses')
      }
    },
    [learnerId],
  )

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  if (!active || !learnerId) {
    return (
      <div className="mx-auto w-full max-w-2xl py-4">
        <ScreenHeader title="Courses" onBack={() => navigate({ name: 'planner' })} />
        <Card>
          <p className="font-bold text-muted">Courses belong to a learner. Sign in with one first.</p>
        </Card>
      </div>
    )
  }

  const live = courses.filter((c) => !c.archivedAt)
  const archived = courses.filter((c) => c.archivedAt)

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <ScreenHeader
        title={`${active.displayName}'s courses 🎒`}
        subtitle="The classes this term. Tap one to edit."
        onBack={() => navigate({ name: 'planner' })}
      />
      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mb-4 space-y-2">
        {live.length === 0 && (
          <Card>
            <p className="font-bold text-muted">No courses yet. Add the classes on the timetable and every task gets a chip.</p>
          </Card>
        )}
        {live.map((c) =>
          editing === c.id ? (
            <CourseForm
              key={c.id}
              existing={c}
              others={courses}
              onSave={async (draft) => {
                try {
                  const saved = await updateCourse(learnerId, c.id, draft)
                  setCourses((cs) => cs.map((x) => (x.id === saved.id ? saved : x)))
                  setEditing(null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not save')
                }
              }}
              onArchive={async () => {
                const saved = await archiveCourse(learnerId, c.id, true)
                setCourses((cs) => cs.map((x) => (x.id === saved.id ? saved : x)))
                setEditing(null)
              }}
              onDelete={async () => {
                if (!window.confirm(`Remove ${c.name}? Tasks filed under it stay, without the chip.`)) return
                await deleteCourse(learnerId, c.id)
                setCourses((cs) => cs.filter((x) => x.id !== c.id))
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c.id)}
              className="flex w-full items-center gap-3 rounded-2xl border border-hair bg-chalk p-3 text-left hover:bg-wash"
            >
              <CourseChip course={c} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-muted">
                {trackOf(c.track).name}
                {c.teacherName ? ` · ${c.teacherName}` : ''}
                {c.period ? ` · ${c.period}` : ''}
              </span>
              <span className="text-xs font-extrabold text-stone">Edit</span>
            </button>
          ),
        )}
      </div>

      {editing === 'new' ? (
        <CourseForm
          others={courses}
          onSave={async (draft) => {
            try {
              const saved = await createCourse(learnerId, draft)
              setCourses((cs) => [...cs, saved])
              setEditing(null)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not add')
            }
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button onClick={() => setEditing('new')}>➕ Add a course</Button>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {live.length > 0 && (
          <Button
            variant="ghost"
            onClick={async () => {
              const label = window.prompt('New term. What is it called? (optional)') ?? undefined
              if (label === undefined) return
              const next = await rolloverCourses(learnerId, label || null)
              await load()
              setError(null)
              void next
            }}
          >
            🔄 New term — copy these, archive the old
          </Button>
        )}
        {archived.length > 0 && (
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </Button>
        )}
      </div>

      {showArchived && (
        <div className="mt-3 space-y-2">
          {archived.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-hair bg-chalk/60 p-3 opacity-80">
              <CourseChip course={c} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-muted">{c.termLabel ?? 'earlier'}</span>
              <button
                type="button"
                className="text-xs font-extrabold text-stone underline"
                onClick={async () => {
                  const saved = await archiveCourse(learnerId, c.id, false)
                  setCourses((cs) => cs.map((x) => (x.id === saved.id ? saved : x)))
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CourseForm({
  existing,
  others,
  onSave,
  onArchive,
  onDelete,
  onCancel,
}: {
  existing?: Course
  others: Course[]
  onSave: (draft: {
    name: string
    track: string | null
    teacherName: string | null
    period: string | null
    color: string
    emoji: string | null
    termLabel: string | null
  }) => Promise<void>
  onArchive?: () => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [track, setTrack] = useState<string>(existing?.track ?? 'general')
  const [trackTouched, setTrackTouched] = useState(!!existing)
  const [teacher, setTeacher] = useState(existing?.teacherName ?? '')
  const [period, setPeriod] = useState(existing?.period ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '')
  const [term, setTerm] = useState(existing?.termLabel ?? '')
  const [color, setColor] = useState(existing?.color ?? nextCourseColor(others))
  const [busy, setBusy] = useState(false)

  const onName = (v: string) => {
    setName(v)
    if (!trackTouched) setTrack(suggestTrack(v))
  }

  return (
    <form
      className="rounded-2xl border border-hair bg-chalk p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        setBusy(true)
        try {
          await onSave({
            name: name.trim(),
            track,
            teacherName: teacher.trim() || null,
            period: period.trim() || null,
            color,
            emoji: emoji.trim() || null,
            termLabel: term.trim() || null,
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <Label>Course name</Label>
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Biology"
            aria-label="Course name"
            autoFocus
            className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-[16px] font-extrabold text-ink focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <Label>Files under</Label>
          <select
            value={track}
            onChange={(e) => {
              setTrack(e.target.value)
              setTrackTouched(true)
            }}
            aria-label="Track"
            className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink"
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>Teacher</Label>
          <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="Ms Reyes" aria-label="Teacher" className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink" />
        </label>
        <label className="block">
          <Label>Period or block</Label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="3rd" aria-label="Period" className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink" />
        </label>
        <label className="block">
          <Label>Term</Label>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Fall 2026" aria-label="Term" className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink" />
        </label>
        <label className="block">
          <Label>Emoji</Label>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🧬" aria-label="Emoji" maxLength={4} className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink" />
        </label>
        <div>
          <Label>Color</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color">
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {existing ? 'Save' : 'Add course'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onArchive && (
          <Button type="button" variant="ghost" onClick={onArchive}>
            Archive
          </Button>
        )}
        {onDelete && (
          <Button type="button" variant="ghost" className="text-red-700" onClick={onDelete}>
            Remove
          </Button>
        )}
      </div>
    </form>
  )
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">{children}</div>
}
