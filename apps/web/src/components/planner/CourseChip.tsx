import type { Course } from '@whizzo/shared'

/** The colored chip a course shows as, everywhere a course appears. */
export function CourseChip({
  course,
  small = false,
  selected = false,
  onClick,
}: {
  course: Pick<Course, 'name' | 'color' | 'emoji'> | null
  small?: boolean
  selected?: boolean
  onClick?: () => void
}) {
  const label = course ? `${course.emoji ? `${course.emoji} ` : ''}${course.name}` : 'Other'
  const color = course?.color ?? '#8A8375'
  const cls = `inline-flex items-center gap-1 rounded-full font-extrabold ${
    small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-sm'
  } ${selected ? 'text-white ring-2 ring-offset-1 ring-ink' : 'text-ink'}`
  const style = selected
    ? { background: color }
    : { background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}66` }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} style={style} aria-pressed={selected}>
        {label}
      </button>
    )
  }
  return (
    <span className={cls} style={style}>
      {label}
    </span>
  )
}

/**
 * The course picker: a row of chips plus Other. No typing.
 *
 * The last course used is preselected by whoever renders this; the picker
 * only knows how to show the choice.
 */
export function CoursePicker({
  courses,
  value,
  onChange,
  allowNone = true,
}: {
  courses: Course[]
  value: string | null
  onChange: (courseId: string | null) => void
  allowNone?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Course">
      {courses.map((c) => (
        <CourseChip key={c.id} course={c} selected={value === c.id} onClick={() => onChange(c.id)} />
      ))}
      {allowNone && <CourseChip course={null} selected={value === null} onClick={() => onChange(null)} />}
    </div>
  )
}
