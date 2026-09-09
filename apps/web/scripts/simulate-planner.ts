// Put a few thousand random assessments through the study proposer and check
// the rules hold.
//
// The companion to simulate-ladder.ts, for the same reason: each rule in
// `proposeStudyPlan` is individually simple, and the failures worth catching
// are interactions between them — a busy day shifting a session onto a day
// that is already at its cap, say, or the runway warning firing when the plan
// actually fit. A unit test proves one rule; this proves they compose.
//
// Six claims:
//
//   1. Nothing is ever in the past.
//   2. Nothing is ever on or after the assessment.
//   3. At most one session per course per day.
//   4. The daily cap holds, counting what was already there.
//   5. Busy days stay empty.
//   6. The short-runway warning fires exactly when fewer fit than were wanted,
//      and the eve is used whenever it is available.

import {
  addDays,
  daysBetween,
  DEFAULT_STUDY_DAYS,
  isoWeekday,
  MATURITY_BANDS,
  PLANNER_BAND,
  proposeStudyPlan,
  SESSION_COUNT,
  type AssessmentKind,
  type Difficulty,
} from '@whizzo/shared'

/** Deterministic, so a failure is reproducible rather than a rumour. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const random = rng(20260906)
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!

const KINDS: AssessmentKind[] = ['quiz', 'test', 'exam']
const DIFFS: Difficulty[] = [1, 2, 3]
const TODAY = '2026-09-07'

let failures = 0
function fail(label: string, detail: unknown) {
  failures += 1
  if (failures <= 20) console.error(`FAIL ${label}`, JSON.stringify(detail))
}

const RUNS = 4000
let placed = 0
let short = 0

for (let i = 0; i < RUNS; i++) {
  const band = pick(MATURITY_BANDS)
  const kind = pick(KINDS)
  const difficulty = pick(DIFFS)
  const runway = Math.floor(random() * 30) - 2 // -2 .. 27 days
  const on = addDays(TODAY, runway)

  const busyDays: string[] = []
  for (let d = 0; d < 30; d++) if (random() < 0.15) busyDays.push(addDays(TODAY, d))

  const sessionsOnDay: Record<string, number> = {}
  for (let d = 0; d < 30; d++) if (random() < 0.2) sessionsOnDay[addDays(TODAY, d)] = 1 + Math.floor(random() * 2)

  const cap = PLANNER_BAND[band].sessionsPerDay
  const r = proposeStudyPlan({
    assessment: { kind, title: 't', on, difficulty, target: null, courseId: 'c' },
    band,
    today: TODAY,
    busyDays,
    sessionsOnDay,
  })

  const ctx = { band, kind, difficulty, on, busyDays, sessionsOnDay, sessions: r.sessions }
  const days = new Set<string>()
  const perDay: Record<string, number> = { ...sessionsOnDay }

  for (const s of r.sessions) {
    placed += 1
    if (daysBetween(TODAY, s.onDay) < 0) fail('in the past', ctx)
    if (daysBetween(s.onDay, on) <= 0) fail('on or after the assessment', ctx)
    if (days.has(s.onDay)) fail('two sessions for one course on one day', ctx)
    days.add(s.onDay)
    perDay[s.onDay] = (perDay[s.onDay] ?? 0) + 1
    if (perDay[s.onDay]! > cap) fail('over the daily cap', ctx)
    if (busyDays.includes(s.onDay)) fail('on a busy day', ctx)
    if (!DEFAULT_STUDY_DAYS.includes(isoWeekday(s.onDay) as 1)) fail('on a non-study day', ctx)
  }

  const wanted = SESSION_COUNT[kind][difficulty]
  if (r.wanted !== wanted) fail('wanted count drifted', ctx)
  if (r.shortRunway !== r.sessions.length < wanted) fail('short-runway flag disagrees with the count', ctx)
  if (r.shortRunway) short += 1

  // The eve is the most valuable slot. If it was free, it must have been used.
  const eve = addDays(on, -1)
  const eveFree =
    runway >= 2 &&
    !busyDays.includes(eve) &&
    (sessionsOnDay[eve] ?? 0) < cap &&
    DEFAULT_STUDY_DAYS.includes(isoWeekday(eve) as 1)
  if (eveFree && r.sessions.length > 0 && !days.has(eve)) fail('the eve was free and unused', ctx)

  // Purposes end on review whenever there is more than one session.
  if (r.sessions.length >= 2 && r.sessions.at(-1)!.purpose !== 'review') fail('last session is not the review', ctx)
  if (r.sessions.length >= 3 && r.sessions[0]!.purpose !== 'organize') fail('first session is not organize', ctx)
}

console.log(
  `simulate:planner — ${RUNS} assessments, ${placed} sessions placed, ${short} short-runway plans, ${failures} failure(s)`,
)
if (failures > 0) process.exit(1)
