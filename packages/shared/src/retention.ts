// What is sticking, and what is about to slip.
//
// Every other report in the app answers "how did they do?" — a score, an
// accuracy, a count of what was mastered. Those are all statements about the
// past, and a parent reading one still cannot answer the question they actually
// have, which is *will they still know this next week*.
//
// The spaced-repetition record already knows. Each item carries the interval it
// earned, the day it next falls due, and how many times it has been learned and
// lost again. Nothing read those three fields together, so the data to answer
// the question was being written and thrown away.
//
// What this deliberately is not: a second difficulty model. Nothing here feeds
// back into planning, scheduling or what counts as evidence. It reads the
// record and describes it. If it ever starts deciding what to show a learner,
// there will be two schedulers disagreeing about the same item.

import type { DayString, ItemMastery } from './progress.js'
import { daysBetween } from './progress.js'

/**
 * Where one item stands, from the point of view of "will this last".
 *
 * Ordered by how much attention it wants: `slipping` first, `secure` last.
 * That ordering is the whole reason these are one scale rather than a set of
 * booleans — a report has to be able to say what to look at first.
 */
export type RetentionBand = 'slipping' | 'fragile' | 'due' | 'holding' | 'secure' | 'new'

/**
 * How long an interval has to be before "they will still know it next month" is
 * a fair thing to tell a parent.
 *
 * Three weeks rather than four: an item due in 28 days was last answered
 * correctly at a 28-day remove, and the month boundary a parent has in mind is
 * not a precise one. Promising slightly less than the schedule believes is the
 * right direction to be wrong in.
 */
export const SECURE_INTERVAL_DAYS = 21

/** Inside this many days is "coming up", not "someday". A school week. */
export const DUE_SOON_DAYS = 7

/**
 * Learned and lost this many times, and it is not a bad day — it is a pattern.
 *
 * Two, because one lapse is ordinary forgetting and the schedule is built to
 * absorb it. The share test alongside it stops a well-known item that has been
 * practised eighty times from being called fragile for two old slips.
 */
export const FRAGILE_LAPSES = 2
export const FRAGILE_LAPSE_SHARE = 0.3

/**
 * Overdue by more than this and it is not "due", it is going.
 *
 * Relative to the item's own interval rather than a fixed number of days: being
 * a week late on a fortnightly item is a different thing from being a week late
 * on a daily one, and a fixed threshold would call the first fine and the
 * second fine too.
 */
export const SLIPPING_OVERDUE_SHARE = 0.5

/** Whether an item has been learned and lost repeatedly, rather than just once. */
export function isFragile(item: ItemMastery): boolean {
  if (item.lapses < FRAGILE_LAPSES) return false
  return item.lapses / Math.max(item.reps, 1) >= FRAGILE_LAPSE_SHARE
}

/**
 * How many days late this item is. Negative means it is not due yet.
 *
 * An item with no due date has never earned a schedule, so it cannot be late.
 */
export function daysOverdue(item: ItemMastery, today: DayString): number {
  if (!item.dueOn) return 0
  return daysBetween(item.dueOn, today)
}

/**
 * Where one item stands.
 *
 * The order of these tests is the meaning of the scale. `slipping` is checked
 * before `fragile` because an item that is both is slipping *now* and fragile
 * *historically*, and now wins. `fragile` is checked before `due` for the
 * opposite reason: an item that keeps being lost deserves saying so even on a
 * day when it happens not to be due.
 */
export function retentionOf(item: ItemMastery, today: DayString): RetentionBand {
  if (item.totalAttempts === 0) return 'new'

  const overdue = daysOverdue(item, today)
  const interval = Math.max(item.intervalDays, 1)

  // Well past its own interval. The schedule's estimate of when this would be
  // forgotten has come and gone.
  if (overdue > 0 && overdue >= interval * SLIPPING_OVERDUE_SHARE) return 'slipping'

  if (isFragile(item)) return 'fragile'

  if (overdue >= 0) return 'due'

  const until = -overdue
  if (until <= DUE_SOON_DAYS) return 'holding'

  // Not due for weeks, and it earned that interval by being answered right at
  // increasing removes.
  return item.intervalDays >= SECURE_INTERVAL_DAYS ? 'secure' : 'holding'
}

export interface RetentionReading {
  /** How many items sit in each band. Every item is in exactly one. */
  counts: Record<RetentionBand, number>
  /** Items worth acting on, worst first. Never the whole list. */
  attention: ItemMastery[]
  /** Items that will still be known in three weeks, on the schedule's estimate. */
  secure: number
  /** Everything with any history. `new` items are not part of a retention claim. */
  tracked: number
  /**
   * Share of tracked items that are holding or better, 0..100.
   *
   * The one number for the top of the report. Null when nothing is tracked —
   * "no answer yet" and "0%" are different, and a new learner has not failed
   * at retention, they simply have not been measured.
   */
  health: number | null
}

/**
 * The report, for one learner and one day.
 *
 * `attention` is capped by the caller rather than here: the screen showing four
 * and the printable showing forty want the same ordering and a different
 * length, and a function that decided the length for both would be wrong for
 * one of them.
 */
export function retentionReading(
  items: readonly ItemMastery[],
  today: DayString,
): RetentionReading {
  const counts: Record<RetentionBand, number> = {
    slipping: 0,
    fragile: 0,
    due: 0,
    holding: 0,
    secure: 0,
    new: 0,
  }
  const attention: ItemMastery[] = []

  for (const item of items) {
    const band = retentionOf(item, today)
    counts[band] += 1
    if (band === 'slipping' || band === 'fragile') attention.push(item)
  }

  // Worst first: most overdue, then most often lost. A parent reading down this
  // list should be able to stop whenever they run out of patience and still
  // have seen the things that mattered most.
  attention.sort(
    (a, b) =>
      daysOverdue(b, today) - daysOverdue(a, today) ||
      b.lapses - a.lapses ||
      a.itemKey.localeCompare(b.itemKey),
  )

  const tracked = items.length - counts.new
  const wellHeld = counts.holding + counts.secure

  return {
    counts,
    attention,
    secure: counts.secure,
    tracked,
    health: tracked > 0 ? Math.round((wellHeld / tracked) * 100) : null,
  }
}

export interface ForecastDay {
  day: DayString
  /** Items falling due on this day. Overdue items land on the first day. */
  count: number
}

/**
 * What is coming, day by day.
 *
 * The point of a forecast rather than a total: "eleven things are due this
 * week" and "eleven things are due on Thursday" call for different evenings.
 * Everything already overdue is folded into day one, because that is when it
 * needs doing — spreading it across the days it was originally due would draw a
 * chart of the past.
 */
export function forecast(
  items: readonly ItemMastery[],
  today: DayString,
  days = DUE_SOON_DAYS,
): ForecastDay[] {
  const span = Math.max(1, Math.round(days))
  const out: ForecastDay[] = Array.from({ length: span }, (_, i) => ({
    day: addDaysLocal(today, i),
    count: 0,
  }))

  for (const item of items) {
    if (item.totalAttempts === 0 || !item.dueOn) continue
    const offset = daysBetween(today, item.dueOn)
    if (offset >= span) continue
    out[Math.max(0, offset)]!.count += 1
  }

  return out
}

// Local rather than imported from `progress.ts` only because `addDays` there
// rounds through a Date and this needs the same day arithmetic `daysBetween`
// uses. Keeping them consistent matters more than saving four lines: a forecast
// whose day labels disagree with its own offsets is off by one on the day the
// clocks change.
function addDaysLocal(day: DayString, days: number): DayString {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
