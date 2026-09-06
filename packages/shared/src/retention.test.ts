// Retention: will they still know it next week?
//
// The bands are a judgement about the future, so what is worth pinning is the
// boundaries — where "due" becomes "slipping", where a bad week becomes a
// pattern — and the two ways a report like this lies: calling something secure
// that is not, and inventing a number for a learner nobody has measured yet.

import { describe, expect, it } from 'vitest'
import type { ItemMastery } from './progress.js'
import {
  DUE_SOON_DAYS,
  FRAGILE_LAPSES,
  SECURE_INTERVAL_DAYS,
  daysOverdue,
  forecast,
  isFragile,
  retentionOf,
  retentionReading,
} from './retention.js'

const TODAY = '2026-06-15'

function anItem(over: Partial<ItemMastery> = {}): ItemMastery {
  return {
    subject: 'spelling',
    itemKey: 'because',
    listId: null,
    difficulty: 3,
    mastery: 0.8,
    reps: 6,
    lapses: 0,
    correctStreak: 3,
    totalAttempts: 8,
    totalCorrect: 6,
    intervalDays: 10,
    dueOn: '2026-06-20',
    firstSeenAt: 0,
    lastSeenAt: 0,
    ...over,
  }
}

describe('where one item stands', () => {
  it('says nothing about an item nobody has answered', () => {
    // A word that has been seen but never attempted is not "at risk"; it is
    // unmeasured, and reporting it as either is inventing evidence.
    expect(retentionOf(anItem({ totalAttempts: 0 }), TODAY)).toBe('new')
  })

  it('calls a long interval secure', () => {
    const item = anItem({ intervalDays: SECURE_INTERVAL_DAYS, dueOn: '2026-07-20' })
    expect(retentionOf(item, TODAY)).toBe('secure')
  })

  it('does not call a short interval secure just because it is not due', () => {
    // Due in four days on a four-day interval is working, not durable. The
    // difference is exactly what a parent is asking about.
    const item = anItem({ intervalDays: 4, dueOn: '2026-06-19' })
    expect(retentionOf(item, TODAY)).toBe('holding')
  })

  it('calls today due', () => {
    expect(retentionOf(anItem({ dueOn: TODAY }), TODAY)).toBe('due')
  })

  it('tolerates being a little late without crying slip', () => {
    // Two days over on a twenty-day interval. Life happens; the schedule is
    // built to absorb it, and a report that panics at one missed evening
    // teaches a parent to ignore it.
    const item = anItem({ intervalDays: 20, dueOn: '2026-06-13', lapses: 0 })
    expect(retentionOf(item, TODAY)).toBe('due')
  })

  it('calls it slipping once it is late relative to its own interval', () => {
    // Four days over on a four-day interval: the schedule's own estimate of
    // when this would be forgotten has come and gone.
    const item = anItem({ intervalDays: 4, dueOn: '2026-06-11', lapses: 0 })
    expect(retentionOf(item, TODAY)).toBe('slipping')
  })

  it('judges lateness against the interval, not a fixed number of days', () => {
    // The same six days late, on two very different items.
    const daily = anItem({ intervalDays: 2, dueOn: '2026-06-09' })
    const monthly = anItem({ intervalDays: 30, dueOn: '2026-06-09' })
    expect(retentionOf(daily, TODAY)).toBe('slipping')
    expect(retentionOf(monthly, TODAY)).toBe('due')
  })
})

describe('learned and lost, repeatedly', () => {
  it('is not one bad day', () => {
    expect(isFragile(anItem({ lapses: 1, reps: 3 }))).toBe(false)
  })

  it('is a pattern', () => {
    expect(isFragile(anItem({ lapses: FRAGILE_LAPSES, reps: 4 }))).toBe(true)
  })

  it('does not condemn a well-known item for two old slips', () => {
    // Eighty reps and two lapses is a word they know. Calling it fragile buries
    // the words that actually need looking at.
    expect(isFragile(anItem({ lapses: 2, reps: 80 }))).toBe(false)
  })

  it('is reported even on a day the item is not due', () => {
    const item = anItem({ lapses: 4, reps: 6, intervalDays: 3, dueOn: '2026-06-17' })
    expect(retentionOf(item, TODAY)).toBe('fragile')
  })

  it('gives way to slipping, which is happening now', () => {
    // Both true. "It is going right now" is the more useful of the two.
    const item = anItem({ lapses: 4, reps: 6, intervalDays: 4, dueOn: '2026-06-05' })
    expect(retentionOf(item, TODAY)).toBe('slipping')
  })
})

describe('how late', () => {
  it('counts days past the due date', () => {
    expect(daysOverdue(anItem({ dueOn: '2026-06-10' }), TODAY)).toBe(5)
  })

  it('is negative for something not due yet', () => {
    expect(daysOverdue(anItem({ dueOn: '2026-06-20' }), TODAY)).toBe(-5)
  })

  it('is nothing for an item that never earned a schedule', () => {
    expect(daysOverdue(anItem({ dueOn: null }), TODAY)).toBe(0)
  })
})

describe('the report', () => {
  it('puts every item in exactly one band', () => {
    const items = [
      anItem({ itemKey: 'a', totalAttempts: 0 }),
      anItem({ itemKey: 'b', intervalDays: 30, dueOn: '2026-07-30' }),
      anItem({ itemKey: 'c', intervalDays: 3, dueOn: '2026-06-01' }),
      anItem({ itemKey: 'd', dueOn: TODAY }),
    ]
    const reading = retentionReading(items, TODAY)
    const total = Object.values(reading.counts).reduce((n, c) => n + c, 0)
    expect(total).toBe(items.length)
  })

  it('leads with what is going, then what keeps going', () => {
    const items = [
      anItem({ itemKey: 'fragile', lapses: 4, reps: 6, intervalDays: 5, dueOn: '2026-06-18' }),
      anItem({ itemKey: 'very-late', intervalDays: 3, dueOn: '2026-06-01' }),
      anItem({ itemKey: 'a-bit-late', intervalDays: 3, dueOn: '2026-06-12' }),
    ]
    const { attention } = retentionReading(items, TODAY)
    expect(attention.map((i) => i.itemKey)).toEqual(['very-late', 'a-bit-late', 'fragile'])
  })

  it('never puts a healthy item on the list to act on', () => {
    const items = [anItem({ intervalDays: 30, dueOn: '2026-07-30' }), anItem({ dueOn: TODAY })]
    expect(retentionReading(items, TODAY).attention).toHaveLength(0)
  })

  it('scores health over what has actually been measured', () => {
    // Two holding, one slipping, and one never attempted. The unattempted item
    // must not drag the score down — nobody has failed to retain a word they
    // have not met.
    const items = [
      anItem({ itemKey: 'a', intervalDays: 30, dueOn: '2026-07-30' }),
      anItem({ itemKey: 'b', intervalDays: 5, dueOn: '2026-06-18' }),
      anItem({ itemKey: 'c', intervalDays: 3, dueOn: '2026-06-01' }),
      anItem({ itemKey: 'd', totalAttempts: 0 }),
    ]
    const reading = retentionReading(items, TODAY)
    expect(reading.tracked).toBe(3)
    expect(reading.health).toBe(67)
  })

  it('has no answer rather than a bad one for a brand-new learner', () => {
    // "0%" would tell a parent their child retains nothing. They have not been
    // measured, which is a different sentence.
    expect(retentionReading([], TODAY).health).toBeNull()
    expect(retentionReading([anItem({ totalAttempts: 0 })], TODAY).health).toBeNull()
  })
})

describe('what is coming', () => {
  it('spans the days asked for', () => {
    expect(forecast([], TODAY, 7)).toHaveLength(7)
    expect(forecast([], TODAY, 7)[0]!.day).toBe(TODAY)
  })

  it('counts an item on the day it falls due', () => {
    const days = forecast([anItem({ dueOn: '2026-06-17' })], TODAY, DUE_SOON_DAYS)
    expect(days[2]!.count).toBe(1)
    expect(days[0]!.count).toBe(0)
  })

  it('folds everything overdue into today, where the work actually is', () => {
    // Drawing three stragglers on the days they were originally due would be a
    // chart of the past. They all need doing now.
    const overdue = [
      anItem({ itemKey: 'a', dueOn: '2026-06-01' }),
      anItem({ itemKey: 'b', dueOn: '2026-05-20' }),
    ]
    expect(forecast(overdue, TODAY, 7)[0]!.count).toBe(2)
  })

  it('ignores what falls outside the window', () => {
    expect(forecast([anItem({ dueOn: '2026-09-01' })], TODAY, 7).every((d) => d.count === 0)).toBe(
      true,
    )
  })

  it('ignores items with no history', () => {
    expect(forecast([anItem({ totalAttempts: 0, dueOn: TODAY })], TODAY, 7)[0]!.count).toBe(0)
  })

  it('walks real calendar days across a month boundary', () => {
    const days = forecast([], '2026-06-29', 4)
    expect(days.map((d) => d.day)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'])
  })
})
