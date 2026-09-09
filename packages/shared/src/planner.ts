// The weekly planner: courses, the week, and studying backwards from a test.
//
// Most students do not know how to plan, and a blank grid of seven days does
// nothing for someone who has never been shown what goes in it. So the planner
// *proposes*: given a test, a date and how the learner feels about it, it puts
// study sessions on the days they belong to, each with a purpose. The learner
// keeps, moves or drops every one of them.
//
// Everything in this file is pure. The proposer, the load meter, the drag
// guards and the quick-add parser are all functions of their inputs, which is
// what lets `simulate:planner` run a few thousand assessments through them and
// assert the rules hold — the house style, and what has caught the real bugs.
//
// See docs/weekly-planner-spec.md.

import type { MaturityBand } from './band.js'

/** Re-exported under a name api.ts can import without a cycle through band. */
export type MaturityBandLike = MaturityBand
import { addDays, daysBetween, type DayString, type ItemMastery, type Subject } from './progress.js'
import { retentionOf } from './retention.js'
import { GENERAL_TRACK, TRACKS, type TrackId } from './tracks.js'

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * A class the learner is enrolled in. The learner's, open-ended, one term.
 *
 * Not a track: a track is an ability pool we define, a course is *Ms Reyes'
 * Biology, this year*. A course cites a track, which is what lets one tap on a
 * course chip file a task under the same pool decks and reports already use.
 */
export interface Course {
  id: string
  learnerId: string
  name: string
  track: TrackId
  teacherName: string | null
  period: string | null
  color: string
  emoji: string | null
  termLabel: string | null
  startsOn: DayString | null
  endsOn: DayString | null
  archivedAt: number | null
  sortOrder: number
  createdBy: string | null
}

export interface CourseDraft {
  name: string
  track?: TrackId | null
  teacherName?: string | null
  period?: string | null
  color?: string
  emoji?: string | null
  termLabel?: string | null
  startsOn?: DayString | null
  endsOn?: DayString | null
  sortOrder?: number
}

/** A fixed palette so the chip color is a choice, not a color picker. */
export const COURSE_COLORS = [
  '#E8553D', // clay
  '#F2A33A', // amber
  '#E9C46A', // straw
  '#4FA36F', // leaf
  '#2A9D8F', // teal
  '#3F7FBF', // sky
  '#6F5BD3', // violet
  '#C55B9B', // plum
  '#8A6A4A', // walnut
  '#5B6B7A', // slate
] as const

/** A color for a new course that is not already in use, then the least used. */
export function nextCourseColor(existing: readonly Pick<Course, 'color'>[]): string {
  const counts = new Map<string, number>()
  for (const c of COURSE_COLORS) counts.set(c, 0)
  for (const e of existing) counts.set(e.color, (counts.get(e.color) ?? 0) + 1)
  let best: string = COURSE_COLORS[0]
  let fewest = Infinity
  for (const c of COURSE_COLORS) {
    const n = counts.get(c) ?? 0
    if (n < fewest) {
      fewest = n
      best = c
    }
  }
  return best
}

/**
 * The track a course name is probably about.
 *
 * A short synonym map, not a classifier. It is a suggestion the learner can
 * change, and General is a real track rather than a failure — so a name this
 * does not recognize files correctly by default.
 */
const TRACK_SYNONYMS: Array<[RegExp, TrackId]> = [
  [/\bspell/i, 'language.spelling'],
  [/\bvocab/i, 'language.vocabulary'],
  [/\b(reading|literature|lit|novel|english|ela|language arts)\b/i, 'language.reading'],
  [/\bgrammar\b/i, 'language.grammar'],
  [/\b(typing|keyboard)/i, 'language.typing'],
  [/\b(math facts|times tables|multiplication)/i, 'math.facts'],
  [/\bfraction|decimal/i, 'math.fractions'],
  [/\bgeometry|geom\b/i, 'math.geometry'],
  [/\balgebra|alg\b|pre-?calc|calculus|trig/i, 'math.algebra'],
  [/\b(math|math|arithmetic)\b/i, 'math.arithmetic'],
  [/\bbio/i, 'science.biology'],
  [/\bchem/i, 'science.chemistry'],
  [/\bphys/i, 'science.physics'],
  [/\b(earth|space|astronomy|geology|environmental)/i, 'science.earth'],
  [/\bscience\b/i, 'science.biology'],
  [/\bhist/i, 'social.history'],
  [/\bgeog/i, 'social.geography'],
  [/\b(civics|government|gov|social studies|economics)/i, 'social.civics'],
  [/\b(spanish|español|espanol)/i, 'world.spanish'],
  [/\b(french|français|francais)/i, 'world.french'],
  [/\b(german|latin|mandarin|chinese|japanese|italian|arabic|language)\b/i, 'world.other'],
  [/\b(money|finance|financial|economics|business)/i, 'life.money'],
  [/\b(health|pe|p\.e\.|physical ed|gym)\b/i, 'life.health'],
]

export function suggestTrack(courseName: string): TrackId {
  const name = courseName.trim()
  if (!name) return GENERAL_TRACK
  for (const [pattern, track] of TRACK_SYNONYMS) {
    if (pattern.test(name) && TRACKS.some((t) => t.id === track)) return track
  }
  return GENERAL_TRACK
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/** The Monday on or before `day`. Weeks run Monday to Sunday, as schools do. */
export function weekStartOf(day: DayString): DayString {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  // getDay: 0 is Sunday. Monday-based offset.
  const offset = (date.getDay() + 6) % 7
  return addDays(day, -offset)
}

export function isMonday(day: DayString): boolean {
  return weekStartOf(day) === day
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: DayString): number {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return ((date.getDay() + 6) % 7) + 1
}

/** The seven days of the week that starts on `weekStart`. */
export function daysOfWeek(weekStart: DayString): DayString[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i))
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const DAY_NAMES_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export function dayName(day: DayString, long = false): string {
  const names = long ? DAY_NAMES_LONG : DAY_NAMES
  return names[isoWeekday(day) - 1] ?? day
}

// ---------------------------------------------------------------------------
// Items — the cards
// ---------------------------------------------------------------------------

export type PlannerItemKind = 'task' | 'study' | 'event'
export type PlannerItemStatus = 'open' | 'done' | 'skipped'

/**
 * What a study session is *for*. The labels follow the mastery ladder, so a
 * learner who does what the card says has, without being told, done
 * distributed practice, retrieval practice, a self-test and a targeted final
 * review.
 */
export type SessionPurpose = 'organize' | 'practice' | 'prove' | 'review'

export interface PlannerItem {
  id: string
  learnerId: string
  weekStart: DayString
  /** Null: on the shelf — this week, no day yet. */
  onDay: DayString | null
  kind: PlannerItemKind
  title: string
  courseId: string | null
  assessmentId: string | null
  minutes: number | null
  purpose: SessionPurpose | null
  proposed: boolean
  /** What the app can run for this card. Null means "not app work". */
  target: { subject: Subject; activity: string; targetId: string } | null
  status: PlannerItemStatus
  doneAt: number | null
  /** Whoever ticked it. A claim, with a name on it. */
  doneBy: string | null
  /** The round that closed it. Evidence. */
  sessionId: string | null
  deletedAt: number | null
  sortOrder: number
  createdBy: string | null
  createdAt: number
  updatedAt: number
}

export interface PlannerItemDraft {
  weekStart: DayString
  onDay?: DayString | null
  kind?: PlannerItemKind
  title: string
  courseId?: string | null
  assessmentId?: string | null
  minutes?: number | null
  purpose?: SessionPurpose | null
  proposed?: boolean
  target?: PlannerItem['target']
  sortOrder?: number
}

/** A card the app can run is closed by a round, never by a tap. */
export function isLinked(item: Pick<PlannerItem, 'target'>): boolean {
  return item.target !== null && item.target !== undefined
}

/**
 * The order a day's cards are shown in: open ones first, then the done and
 * skipped pile, each by sort order. One definition, so the grid, the drag
 * position and the keyboard move all count the same way.
 */
export function dayOrder<T extends Pick<PlannerItem, 'status' | 'sortOrder' | 'createdAt'>>(items: readonly T[]): T[] {
  const rank = (i: T) => (i.status === 'open' ? 0 : 1)
  return [...items].sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

/** Gaps of a thousand, so a reorder writes one row. */
export const SORT_GAP = 1000

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export type AssessmentKind = 'quiz' | 'test' | 'exam' | 'project'
/** "Feels easy" · "not sure" · "worried". How the learner feels, not how hard it is. */
export type Difficulty = 1 | 2 | 3

export interface AssessmentOutcome {
  feltLike: Difficulty
  score: string | null
  note: string | null
}

export interface Assessment {
  id: string
  learnerId: string
  courseId: string | null
  kind: AssessmentKind
  title: string
  on: DayString
  difficulty: Difficulty
  target: { subject: Subject; targetId: string } | null
  outcome: AssessmentOutcome | null
  planGeneratedAt: number | null
  createdBy: string | null
  createdAt: number
  updatedAt: number
}

export interface AssessmentDraft {
  courseId?: string | null
  kind: AssessmentKind
  title: string
  on: DayString
  difficulty: Difficulty
  target?: Assessment['target']
}

export const ASSESSMENT_KINDS: Array<{ id: AssessmentKind; name: string; emoji: string }> = [
  { id: 'quiz', name: 'Quiz', emoji: '📝' },
  { id: 'test', name: 'Test', emoji: '📋' },
  { id: 'exam', name: 'Exam', emoji: '🎓' },
  { id: 'project', name: 'Project', emoji: '📦' },
]

export const DIFFICULTY_LABEL: Record<Difficulty, { name: string; emoji: string }> = {
  1: { name: 'Feels easy', emoji: '😌' },
  2: { name: 'Not sure', emoji: '🤔' },
  3: { name: 'Worried', emoji: '😬' },
}

// ---------------------------------------------------------------------------
// The proposer — how many sessions, and when
// ---------------------------------------------------------------------------

/**
 * Session count by kind and difficulty.
 *
 * A project is not studied; it is done in milestones, which the proposer
 * handles separately.
 */
export const SESSION_COUNT: Record<Exclude<AssessmentKind, 'project'>, Record<Difficulty, number>> =
  {
    quiz: { 1: 2, 2: 3, 3: 4 },
    test: { 1: 3, 2: 5, 3: 6 },
    exam: { 1: 5, 2: 7, 3: 9 },
  }

/**
 * Days before the assessment, working backwards. An expanding gap: dense near
 * the end, sparse early. This is spaced practice with the density where the
 * evidence says it helps, and it produces the shape a good student arrives at
 * by instinct.
 */
export const SESSION_OFFSETS = [1, 2, 3, 5, 7, 10, 14, 18, 23] as const

/** Session length and daily cap by band. Paint on the schedule, not curriculum. */
export const PLANNER_BAND: Record<
  MaturityBand,
  { sessionMinutes: number; sessionsPerDay: number; dailyMinutes: number; shape: 'today' | 'simple' | 'full' }
> = {
  early: { sessionMinutes: 10, sessionsPerDay: 1, dailyMinutes: 30, shape: 'today' },
  growing: { sessionMinutes: 15, sessionsPerDay: 2, dailyMinutes: 45, shape: 'simple' },
  middle: { sessionMinutes: 20, sessionsPerDay: 2, dailyMinutes: 75, shape: 'full' },
  upper: { sessionMinutes: 30, sessionsPerDay: 3, dailyMinutes: 120, shape: 'full' },
}

/** Default minutes for a card, by kind and band. */
export function defaultMinutes(kind: PlannerItemKind, band: MaturityBand): number | null {
  if (kind === 'event') return null
  if (kind === 'study') return PLANNER_BAND[band].sessionMinutes
  return band === 'early' ? 10 : band === 'growing' ? 15 : 20
}

/**
 * Purposes by position.
 *
 * Two sessions: practice, review. Three: organize, practice, review. Four or
 * more: organize, practice…, prove, review.
 */
export function sessionPurposes(count: number): SessionPurpose[] {
  if (count <= 0) return []
  if (count === 1) return ['review']
  if (count === 2) return ['practice', 'review']
  if (count === 3) return ['organize', 'practice', 'review']
  const middle = Array.from({ length: count - 3 }, () => 'practice' as const)
  return ['organize', ...middle, 'prove', 'review']
}

export const PURPOSE_COPY: Record<SessionPurpose, { name: string; line: string }> = {
  organize: {
    name: 'Get organized',
    line: 'Gather your notes. Make or open the deck. Skim once.',
  },
  practice: {
    name: 'Practice',
    line: 'Work through the set. Missed ones come back.',
  },
  prove: {
    name: 'Prove it',
    line: 'Test yourself without looking. Find what is still shaky.',
  },
  review: {
    name: 'Quick review, then stop',
    line: 'Only the ones you missed. Ten minutes. Then sleep.',
  },
}

/** Activity a linked session runs, by purpose. */
export function activityForPurpose(purpose: SessionPurpose, subject: Subject): string {
  if (subject === 'quiz') {
    switch (purpose) {
      case 'organize':
        return 'learn'
      case 'practice':
        return 'learn'
      case 'prove':
        return 'test'
      case 'review':
        return 'learn'
    }
  }
  // Real spelling activity ids: a round records what it ran, and the
  // closure matches on it, so a name nothing records would never close.
  if (subject === 'spelling') return purpose === 'prove' ? 'test' : 'study'
  return 'lesson'
}

export interface ProposedSession {
  onDay: DayString
  purpose: SessionPurpose
  minutes: number
  title: string
}

export interface ProposeInput {
  assessment: Pick<Assessment, 'kind' | 'title' | 'on' | 'difficulty' | 'target' | 'courseId'>
  band: MaturityBand
  today: DayString
  /** Days with no room: marked busy, or already at the daily cap. */
  busyDays?: readonly DayString[]
  /** Existing study sessions per day, so the cap counts what is already there. */
  sessionsOnDay?: Readonly<Record<DayString, number>>
  /** Study sessions already on a day for this same test; one per test per day. */
  courseSessionsOnDay?: Readonly<Record<DayString, number>>
  /** Which weekdays the learner studies (ISO, 1-7). Default: all but Saturday. */
  studyDays?: readonly number[]
  /** One more session, because last time this course felt harder than expected. */
  extraSessions?: number
  /** Override the cap. Null means the band's. */
  sessionsPerDay?: number | null
  sessionMinutes?: number | null
}

export interface ProposeResult {
  sessions: ProposedSession[]
  /** How many the kind and difficulty wanted. */
  wanted: number
  /** Fewer fit than wanted. The lesson is delivered exactly when it will land. */
  shortRunway: boolean
  message: string | null
}

export const DEFAULT_STUDY_DAYS = [1, 2, 3, 4, 5, 7] as const

/**
 * Where the sessions go.
 *
 * Constraints, in order: never in the past; at most one per test per day;
 * at most N per day across courses; busy days skipped, shifting earlier; and
 * not-much-runway said out loud rather than crammed.
 */
export function proposeStudyPlan(input: ProposeInput): ProposeResult {
  const { assessment, band, today } = input
  const cap = input.sessionsPerDay ?? PLANNER_BAND[band].sessionsPerDay
  const minutes = input.sessionMinutes ?? PLANNER_BAND[band].sessionMinutes
  const busy = new Set(input.busyDays ?? [])
  const studyDays = new Set(input.studyDays ?? DEFAULT_STUDY_DAYS)
  const load: Record<string, number> = { ...(input.sessionsOnDay ?? {}) }
  const courseLoad: Record<string, number> = { ...(input.courseSessionsOnDay ?? {}) }

  if (assessment.kind === 'project') return proposeMilestones(input)

  const wanted = Math.min(
    SESSION_OFFSETS.length,
    SESSION_COUNT[assessment.kind][assessment.difficulty] + (input.extraSessions ?? 0),
  )
  const runway = daysBetween(today, assessment.on)

  if (runway <= 0) {
    return {
      sessions: [],
      wanted,
      shortRunway: true,
      message:
        runway === 0
          ? 'That is today. Do a quick review of anything you missed, then stop.'
          : 'That date has passed.',
    }
  }

  const fits = (day: DayString) =>
    daysBetween(today, day) >= 0 &&
    !busy.has(day) &&
    studyDays.has(isoWeekday(day)) &&
    (load[day] ?? 0) < cap &&
    (courseLoad[day] ?? 0) < 1

  const chosen: DayString[] = []
  for (const offset of SESSION_OFFSETS.slice(0, wanted)) {
    let day = addDays(assessment.on, -offset)
    // Shift earlier, day by day, until something fits or the runway is gone.
    let placed = false
    for (let tries = 0; tries < 30; tries++) {
      if (daysBetween(today, day) < 0) break
      if (fits(day) && !chosen.includes(day)) {
        chosen.push(day)
        load[day] = (load[day] ?? 0) + 1
        courseLoad[day] = (courseLoad[day] ?? 0) + 1
        placed = true
        break
      }
      day = addDays(day, -1)
    }
    if (!placed) continue
  }

  chosen.sort()
  const purposes = sessionPurposes(chosen.length)
  const sessions: ProposedSession[] = chosen.map((onDay, i) => ({
    onDay,
    purpose: purposes[i]!,
    minutes,
    title: `${PURPOSE_COPY[purposes[i]!].name} · ${assessment.title}`,
  }))

  const shortRunway = sessions.length < wanted
  let message: string | null = null
  if (sessions.length === 0) {
    message = 'There is no room before then. Do what you can on the day before.'
  } else if (shortRunway) {
    message =
      "There's not much time — here's what fits. Next time, add the test as soon as you hear about it."
  }

  return { sessions, wanted, shortRunway, message }
}

/**
 * A project is done in milestones — plan, draft, finish — at 60 %, 30 % and
 * 10 % of the runway. A project due in three weeks with no milestones is the
 * exact thing a fourteen-year-old gets wrong every time.
 */
function proposeMilestones(input: ProposeInput): ProposeResult {
  const { assessment, today } = input
  const runway = daysBetween(today, assessment.on)
  if (runway <= 1) {
    return {
      sessions: [],
      wanted: 3,
      shortRunway: true,
      message: runway <= 0 ? 'That date has passed.' : 'Due tomorrow — finish it today.',
    }
  }
  const fractions: Array<[number, SessionPurpose, string]> = [
    [0.6, 'organize', 'Plan'],
    [0.3, 'practice', 'Draft'],
    [0.1, 'prove', 'Finish'],
  ]
  const seen = new Set<DayString>()
  const sessions: ProposedSession[] = []
  for (const [fraction, purpose, name] of fractions) {
    let day = addDays(assessment.on, -Math.max(1, Math.round(runway * fraction)))
    if (daysBetween(today, day) < 0) day = today
    if (seen.has(day)) continue
    seen.add(day)
    sessions.push({
      onDay: day,
      purpose,
      minutes: input.sessionMinutes ?? PLANNER_BAND[input.band].sessionMinutes * 2,
      title: `${name} · ${assessment.title}`,
    })
  }
  return {
    sessions,
    wanted: 3,
    shortRunway: sessions.length < 3,
    message: sessions.length < 3 ? 'Not much runway — two milestones instead of three.' : null,
  }
}

// ---------------------------------------------------------------------------
// Load — the capacity meter
// ---------------------------------------------------------------------------

export interface DayLoad {
  day: DayString
  minutes: number
  /** Over the daily limit. The moment the load lesson lands. */
  heavy: boolean
  openCount: number
}

export function weekLoad(
  items: readonly Pick<PlannerItem, 'onDay' | 'minutes' | 'status' | 'kind' | 'deletedAt'>[],
  weekStart: DayString,
  band: MaturityBand,
  dailyMinutes?: number | null,
): DayLoad[] {
  const limit = dailyMinutes ?? PLANNER_BAND[band].dailyMinutes
  return daysOfWeek(weekStart).map((day) => {
    let minutes = 0
    let openCount = 0
    for (const it of items) {
      if (it.deletedAt || it.onDay !== day || it.kind === 'event') continue
      if (it.status !== 'open') continue
      openCount += 1
      minutes += it.minutes ?? 0
    }
    return { day, minutes, heavy: minutes > limit, openCount }
  })
}

// ---------------------------------------------------------------------------
// Drag guards
// ---------------------------------------------------------------------------

export interface DropContext {
  assessments: readonly Pick<Assessment, 'id' | 'on'>[]
  busyDays: readonly DayString[]
  weekStart: DayString
}

export type DropVerdict = { ok: true } | { ok: false; reason: string; ask?: boolean }

/**
 * Whether a card may land on a day. One function so the pointer, touch and
 * keyboard paths cannot disagree.
 */
export function canDrop(
  item: Pick<PlannerItem, 'kind' | 'assessmentId' | 'purpose'>,
  onDay: DayString | null,
  ctx: DropContext,
): DropVerdict {
  if (onDay === null) {
    if (item.kind !== 'task') return { ok: false, reason: 'Only tasks can wait on the shelf.' }
    return { ok: true }
  }
  if (item.kind === 'study' && item.assessmentId) {
    const a = ctx.assessments.find((x) => x.id === item.assessmentId)
    if (a && daysBetween(onDay, a.on) <= 0) {
      return { ok: false, reason: 'That is after the test.' }
    }
  }
  if (ctx.busyDays.includes(onDay) && item.kind !== 'event') {
    return { ok: false, reason: 'That day is marked busy. Put it there anyway?', ask: true }
  }
  return { ok: true }
}

/** The week a placed day belongs to. Moving out of the week moves the card's week too. */
export function weekFor(onDay: DayString | null, fallback: DayString): DayString {
  return onDay ? weekStartOf(onDay) : fallback
}

// ---------------------------------------------------------------------------
// Quick add
// ---------------------------------------------------------------------------

export interface QuickAdd {
  title: string
  onDay: DayString | null
  minutes: number | null
  courseId: string | null
  /** The line looks like a test. Offer to plan it. */
  looksLikeAssessment: AssessmentKind | null
}

const DAY_TOKENS: Array<[RegExp, number]> = [
  [/\b(mon|monday)\b/i, 1],
  [/\b(tue|tues|tuesday)\b/i, 2],
  [/\b(wed|weds|wednesday)\b/i, 3],
  [/\b(thu|thur|thurs|thursday)\b/i, 4],
  [/\b(fri|friday)\b/i, 5],
  [/\b(sat|saturday)\b/i, 6],
  [/\b(sun|sunday)\b/i, 7],
]

/**
 * The tokens a quick-add line understands. None are required.
 *
 * A day name or "tomorrow" places the card on the next such day; `30m` sets
 * the minutes; `#bio` files it under the course whose name starts that way.
 * "test", "quiz" or "exam" makes the planner ask whether to plan it.
 */
export function parseQuickAdd(
  line: string,
  courses: readonly Pick<Course, 'id' | 'name'>[],
  today: DayString,
  defaultDay: DayString | null = today,
): QuickAdd {
  let title = line.trim()
  let onDay: DayString | null = defaultDay
  let minutes: number | null = null
  let courseId: string | null = null

  const mins = /(?:^|\s)(\d{1,3})\s?(m|min|mins|minutes)\b/i.exec(title)
  if (mins) {
    minutes = Math.min(600, Number(mins[1]))
    title = title.replace(mins[0], ' ')
  }

  const tag = /(?:^|\s)#([\w-]+)/.exec(title)
  if (tag) {
    const needle = tag[1]!.toLowerCase()
    const course = courses.find((c) => c.name.toLowerCase().replace(/\s+/g, '').startsWith(needle))
    if (course) {
      courseId = course.id
      title = title.replace(tag[0], ' ')
    }
  }

  if (/\b(tomorrow|tmrw)\b/i.test(title)) {
    onDay = addDays(today, 1)
    title = title.replace(/\b(tomorrow|tmrw)\b/i, ' ')
  } else if (/\btoday\b/i.test(title)) {
    onDay = today
    title = title.replace(/\btoday\b/i, ' ')
  } else {
    for (const [pattern, weekday] of DAY_TOKENS) {
      const m = pattern.exec(title)
      if (!m) continue
      // The next such day, today included.
      const todayWd = isoWeekday(today)
      const ahead = (weekday - todayWd + 7) % 7
      onDay = addDays(today, ahead)
      title = title.replace(m[0], ' ')
      break
    }
  }

  let looksLikeAssessment: AssessmentKind | null = null
  if (/\bexam\b/i.test(title)) looksLikeAssessment = 'exam'
  else if (/\btest\b/i.test(title)) looksLikeAssessment = 'test'
  else if (/\bquiz\b/i.test(title)) looksLikeAssessment = 'quiz'

  title = title.replace(/\s{2,}/g, ' ').trim()
  return { title, onDay, minutes, courseId, looksLikeAssessment }
}

// ---------------------------------------------------------------------------
// Readiness — with linked content, the number that matters
// ---------------------------------------------------------------------------

export interface Readiness {
  total: number
  mastered: number
  slipping: number
  due: number
  daysLeft: number
}

/**
 * Reporting only, from the retention bands. It schedules nothing, per the
 * retention model's own rule.
 */
export function readiness(
  masteries: readonly ItemMastery[],
  target: { subject: Subject; targetId: string },
  today: DayString,
  on: DayString,
): Readiness {
  const prefix = `${target.targetId}:`
  let total = 0
  let mastered = 0
  let slipping = 0
  let due = 0
  for (const m of masteries) {
    if (m.subject !== target.subject) continue
    const inSet = target.subject === 'quiz' ? m.itemKey.startsWith(prefix) : m.listId === target.targetId
    if (!inSet) continue
    total += 1
    const band = retentionOf(m, today)
    if (band === 'slipping' || band === 'fragile') slipping += 1
    if (band === 'due') due += 1
    if (m.mastery >= 0.8 && m.correctStreak >= 2) mastered += 1
  }
  return { total, mastered, slipping, due, daysLeft: daysBetween(today, on) }
}

// ---------------------------------------------------------------------------
// The four sections
// ---------------------------------------------------------------------------

export interface WeekPriority {
  text: string
  courseId?: string | null
}

export interface WeekWin {
  text: string
  kind: 'own' | 'verified'
  /** A snapshot, so an erased round cannot un-win a week. */
  evidence?: Record<string, unknown> | null
}

export interface WeekGoal {
  text: string
  courseId?: string | null
}

export const MAX_PRIORITIES = 3

export interface PlannerWeek {
  id: string
  learnerId: string
  weekStart: DayString
  priorities: WeekPriority[]
  wins: WeekWin[]
  goals: WeekGoal[]
  reflection: string | null
  busyDays: DayString[]
  plannedAt: number | null
  wrappedAt: number | null
}

export interface PlannerWeekPatch {
  priorities?: WeekPriority[]
  wins?: WeekWin[]
  goals?: WeekGoal[]
  reflection?: string | null
  busyDays?: DayString[]
  planned?: boolean
  wrapped?: boolean
}

export const REFLECTION_PROMPTS: Record<MaturityBand, string[]> = {
  early: ['What was the best bit?', 'What was tricky?'],
  growing: ['What was easier than you expected?', 'What got in the way?'],
  middle: ['What got in the way?', 'What would you do differently?', 'What was easier than you expected?'],
  upper: ['What got in the way?', 'What would you do differently next week?', 'Where did the time actually go?'],
}

/** A prompt for the week, rotated by week rather than random so it is stable on reload. */
export function reflectionPrompt(band: MaturityBand, weekStart: DayString): string {
  const prompts = REFLECTION_PROMPTS[band]
  const n = daysBetween('2026-01-05', weekStart) / 7
  return prompts[((Math.round(n) % prompts.length) + prompts.length) % prompts.length]!
}

/** What this week's progress summary can vouch for. Offered as chips, marked verified. */
export interface WinSource {
  verifiedCorrectThisWeek: number
  masteredThisWeek: number
  streakDays: number
  masteryChecksPassed: number
  levelUps: Array<{ subject: string; from: number; to: number }>
  assignmentsDone: number
  studySessionsDone: number
  assessmentsRecorded: Array<{ title: string; feltLike: Difficulty }>
}

export function suggestWins(src: WinSource): WeekWin[] {
  const wins: WeekWin[] = []
  if (src.masteredThisWeek > 0) {
    wins.push({
      text: `Mastered ${src.masteredThisWeek} ${src.masteredThisWeek === 1 ? 'item' : 'items'}`,
      kind: 'verified',
      evidence: { masteredThisWeek: src.masteredThisWeek },
    })
  }
  if (src.streakDays >= 3) {
    wins.push({
      text: `${src.streakDays}-day streak`,
      kind: 'verified',
      evidence: { streakDays: src.streakDays },
    })
  }
  for (const l of src.levelUps) {
    wins.push({
      text: `${l.subject} level ${l.from} → ${l.to}`,
      kind: 'verified',
      evidence: { levelUp: l },
    })
  }
  if (src.masteryChecksPassed > 0) {
    wins.push({
      text: `Passed ${src.masteryChecksPassed} mastery ${src.masteryChecksPassed === 1 ? 'check' : 'checks'}`,
      kind: 'verified',
      evidence: { masteryChecksPassed: src.masteryChecksPassed },
    })
  }
  if (src.assignmentsDone > 0) {
    wins.push({
      text: `Finished ${src.assignmentsDone} ${src.assignmentsDone === 1 ? 'task' : 'tasks'} someone set`,
      kind: 'verified',
      evidence: { assignmentsDone: src.assignmentsDone },
    })
  }
  if (src.studySessionsDone > 0) {
    wins.push({
      text: `Did ${src.studySessionsDone} study ${src.studySessionsDone === 1 ? 'session' : 'sessions'}`,
      kind: 'verified',
      evidence: { studySessionsDone: src.studySessionsDone },
    })
  }
  if (src.verifiedCorrectThisWeek >= 50) {
    wins.push({
      text: `${src.verifiedCorrectThisWeek} checked answers right`,
      kind: 'verified',
      evidence: { verifiedCorrectThisWeek: src.verifiedCorrectThisWeek },
    })
  }
  for (const a of src.assessmentsRecorded) {
    if (a.feltLike === 1) {
      wins.push({ text: `${a.title} felt easy`, kind: 'own', evidence: null })
    }
  }
  return wins
}

/** The longest current streak across every skill row. */
export function bestStreakFrom(skills: Record<string, { streakDays?: number } | undefined>): number {
  return Object.values(skills).reduce((n, s) => Math.max(n, s?.streakDays ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Events — every card remembers
// ---------------------------------------------------------------------------

export type PlannerEntity = 'item' | 'assessment' | 'week'

export interface PlannerEvent {
  id: number
  learnerId: string
  entity: PlannerEntity
  entityId: string
  at: number
  /** Null: the system — a round closing a card, an erased round reopening it. */
  actorId: string | null
  actorName: string | null
  kind: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  sessionId: string | null
}

export interface PlannerComment {
  id: string
  learnerId: string
  weekStart: DayString
  itemId: string | null
  authorId: string
  authorName: string | null
  body: string
  createdAt: number
}

export interface PlannerPrefs {
  learnerId: string
  dailyMinutes: number | null
  sessionsPerDay: number | null
  studyDays: number[]
}

function dayLabel(v: unknown): string {
  if (v === null || v === undefined) return 'the shelf'
  return dayName(String(v), true)
}

/**
 * One event to one line of copy, so the card sheet, the week timeline and the
 * wrap-up's facts all say the same thing about the same row.
 */
export function describeEvent(
  event: Pick<PlannerEvent, 'kind' | 'before' | 'after' | 'actorName' | 'actorId' | 'entity'>,
  learnerName = 'the learner',
): string {
  const who = event.actorId === null ? 'The app' : (event.actorName ?? learnerName)
  const b = event.before ?? {}
  const a = event.after ?? {}
  switch (event.kind) {
    case 'created':
      return event.entity === 'assessment'
        ? `${who} added it, for ${dayLabel(a.on)}`
        : event.entity === 'week'
          ? `${who} started the week`
          : a.proposed
            ? `The app proposed it for ${dayLabel(a.onDay)}`
            : `${who} added it, on ${dayLabel(a.onDay)}`
    case 'moved':
      return `${who} moved it from ${dayLabel(b.onDay)} to ${dayLabel(a.onDay)}`
    case 'shelved':
      return `${who} put it on the shelf`
    case 'done':
      return event.actorId === null ? 'Closed by a round' : `${who} ticked it done`
    case 'undone':
      return `${who} un-ticked it`
    case 'skipped':
      return `${who} skipped it`
    case 'unskipped':
      return `${who} un-skipped it`
    case 'closed_by_session':
      return 'Closed by a round the app checked'
    case 'reopened':
      return 'Reopened — the round behind it was erased'
    case 'deleted':
      return `${who} removed it`
    case 'restored':
      return `${who} put it back`
    case 'date_moved':
      return `${who} moved the date from ${dayLabel(b.on)} to ${dayLabel(a.on)}`
    case 'outcome':
      return `${who} recorded how it went`
    case 'planned':
      return `${who} planned the week`
    case 'wrapped':
      return `${who} wrapped up the week`
    case 'edited': {
      const fields = Object.keys(a).filter((k) => k !== 'updatedAt')
      if (fields.includes('title')) return `${who} renamed it`
      if (fields.includes('difficulty')) return `${who} changed how it feels`
      if (fields.includes('minutes')) return `${who} changed the minutes`
      if (fields.includes('courseId')) return `${who} filed it under a different course`
      return `${who} edited it`
    }
    default:
      return `${who}: ${event.kind}`
  }
}

// ---------------------------------------------------------------------------
// The Family line
// ---------------------------------------------------------------------------

export interface PlannerOverview {
  planned: boolean
  priorities: number
  heavyDays: number
  nextAssessment: {
    title: string
    on: DayString
    sessionsDone: number
    sessionsTotal: number
  } | null
}

export function plannerLine(o: PlannerOverview | null | undefined, today: DayString): string {
  if (!o) return ''
  const parts: string[] = []
  parts.push(o.planned ? 'Planned this week' : 'Not planned yet')
  if (o.planned && o.priorities > 0) {
    parts.push(`${o.priorities} ${o.priorities === 1 ? 'priority' : 'priorities'}`)
  }
  if (o.nextAssessment) {
    const n = o.nextAssessment
    const days = daysBetween(today, n.on)
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : dayName(n.on)
    parts.push(`${n.title} ${when}: ${n.sessionsDone} of ${n.sessionsTotal} sessions done`)
  }
  if (o.heavyDays > 0) parts.push(`${o.heavyDays} heavy ${o.heavyDays === 1 ? 'day' : 'days'}`)
  return parts.join(' · ')
}
