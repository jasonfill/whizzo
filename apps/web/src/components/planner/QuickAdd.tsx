// One field, always visible. Type, Enter, done.
//
// A few tokens are understood and none are required: a day name places the
// card, `30m` sets the minutes, `#bio` files it. The words test, quiz or exam
// make the planner ask whether to plan it — the seam between "write it down"
// and "plan backwards from it", crossed by accident.

import { useState, type KeyboardEvent } from 'react'
import { parseQuickAdd, type AssessmentKind, type Course, type QuickAdd as Parsed } from '@whizzo/shared'
import { CoursePicker } from './CourseChip'

export default function QuickAdd({
  courses,
  today,
  defaultDay,
  lastCourseId,
  onAdd,
  onPlanTest,
  placeholder = 'Add something…',
  autoFocus = false,
}: {
  courses: Course[]
  today: string
  /** Where a plain line lands. Null means the shelf. */
  defaultDay: string | null
  lastCourseId: string | null
  onAdd: (parsed: Parsed & { courseId: string | null }) => void
  onPlanTest?: (parsed: Parsed, kind: AssessmentKind) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [courseId, setCourseId] = useState<string | null>(lastCourseId)
  const [ask, setAsk] = useState<{ parsed: Parsed; kind: AssessmentKind } | null>(null)

  const submit = () => {
    const parsed = parseQuickAdd(text, courses, today, defaultDay)
    if (!parsed.title) return
    const withCourse = { ...parsed, courseId: parsed.courseId ?? courseId }
    if (parsed.looksLikeAssessment && onPlanTest) {
      setAsk({ parsed: withCourse, kind: parsed.looksLikeAssessment })
      return
    }
    onAdd(withCourse)
    setText('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="rounded-2xl border border-hair bg-chalk p-3">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label="Add something"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-[15px] font-bold text-ink placeholder:text-faint focus:border-ink focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-xl bg-ink px-4 py-2 text-sm font-extrabold text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {courses.length > 0 && (
        <div className="mt-2">
          <CoursePicker courses={courses} value={courseId} onChange={setCourseId} />
        </div>
      )}
      {ask && (
        <div className="mt-3 rounded-xl bg-sun/30 p-3 text-sm font-bold text-ink">
          Is this a {ask.kind}? Add it as one and I&apos;ll plan the studying.
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-extrabold text-white"
              onClick={() => {
                onPlanTest?.(ask.parsed, ask.kind)
                setAsk(null)
                setText('')
              }}
            >
              Yes, plan it
            </button>
            <button
              type="button"
              className="rounded-lg border-2 border-edge px-3 py-1.5 text-xs font-extrabold text-ink"
              onClick={() => {
                onAdd({ ...ask.parsed, courseId: ask.parsed.courseId ?? courseId })
                setAsk(null)
                setText('')
              }}
            >
              No, just a task
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
