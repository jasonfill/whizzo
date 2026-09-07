import { describe, expect, it } from 'vitest'
import {
  canDrop,
  daysOfWeek,
  dayOrder,
  describeEvent,
  isoWeekday,
  nextCourseColor,
  parseQuickAdd,
  plannerLine,
  proposeStudyPlan,
  readiness,
  sessionPurposes,
  suggestTrack,
  suggestWins,
  weekLoad,
  weekStartOf,
  type PlannerItem,
} from './planner.js'
import type { ItemMastery } from './progress.js'

// 2026-09-07 is a Monday.
const MON = '2026-09-07'

describe('the week', () => {
  it('starts on Monday', () => {
    expect(weekStartOf('2026-09-07')).toBe(MON)
    expect(weekStartOf('2026-09-10')).toBe(MON)
    expect(weekStartOf('2026-09-13')).toBe(MON) // Sunday belongs to the week before
    expect(weekStartOf('2026-09-14')).toBe('2026-09-14')
  })

  it('numbers weekdays ISO style', () => {
    expect(isoWeekday(MON)).toBe(1)
    expect(isoWeekday('2026-09-13')).toBe(7)
  })

  it('lists seven days', () => {
    expect(daysOfWeek(MON)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ])
  })
})

describe('courses', () => {
  it('suggests a track from the name and falls back to General', () => {
    expect(suggestTrack('Biology')).toBe('science.biology')
    expect(suggestTrack("Mr Okafor's Algebra 1")).toBe('math.algebra')
    expect(suggestTrack('Spanish II')).toBe('world.spanish')
    expect(suggestTrack('AP Chem')).toBe('science.chemistry')
    expect(suggestTrack('Homeroom')).toBe('general')
    expect(suggestTrack('')).toBe('general')
  })

  it('hands out the least used colour', () => {
    const first = nextCourseColor([])
    const second = nextCourseColor([{ color: first }])
    expect(second).not.toBe(first)
  })
})

describe('sessionPurposes', () => {
  it('follows the ladder by position', () => {
    expect(sessionPurposes(0)).toEqual([])
    expect(sessionPurposes(1)).toEqual(['review'])
    expect(sessionPurposes(2)).toEqual(['practise', 'review'])
    expect(sessionPurposes(3)).toEqual(['organise', 'practise', 'review'])
    expect(sessionPurposes(5)).toEqual(['organise', 'practise', 'practise', 'prove', 'review'])
  })
})

describe('proposeStudyPlan', () => {
  const test = (over = {}) => ({
    kind: 'test' as const,
    title: 'Chapter 7',
    on: '2026-09-25', // a Friday, 18 days out from MON
    difficulty: 2 as const,
    target: null,
    courseId: 'c1',
    ...over,
  })

  it('wants the count the kind and difficulty say, and puts the last one on the eve', () => {
    const r = proposeStudyPlan({ assessment: test(), band: 'middle', today: MON })
    expect(r.wanted).toBe(5)
    expect(r.sessions).toHaveLength(5)
    expect(r.shortRunway).toBe(false)
    expect(r.sessions.at(-1)!.onDay).toBe('2026-09-24')
    expect(r.sessions.map((s) => s.purpose)).toEqual([
      'organise', 'practise', 'practise', 'prove', 'review',
    ])
  })

  it('never places a session in the past, and says so when few fit', () => {
    const r = proposeStudyPlan({
      assessment: test({ on: '2026-09-09', difficulty: 3 }),
      band: 'middle',
      today: MON,
    })
    expect(r.wanted).toBe(6)
    for (const s of r.sessions) expect(s.onDay >= MON).toBe(true)
    expect(r.sessions.length).toBeLessThan(6)
    expect(r.shortRunway).toBe(true)
    expect(r.message).toMatch(/not much time/i)
  })

  it('routes around busy days by shifting earlier', () => {
    const r = proposeStudyPlan({
      assessment: test(),
      band: 'middle',
      today: MON,
      busyDays: ['2026-09-24'],
    })
    expect(r.sessions.some((s) => s.onDay === '2026-09-24')).toBe(false)
    expect(r.sessions.at(-1)!.onDay).toBe('2026-09-23')
  })

  it('respects the daily cap across courses', () => {
    const r = proposeStudyPlan({
      assessment: test(),
      band: 'early', // one session a day
      today: MON,
      sessionsOnDay: { '2026-09-24': 1 },
    })
    expect(r.sessions.some((s) => s.onDay === '2026-09-24')).toBe(false)
  })

  it('says today is today rather than planning around it', () => {
    const r = proposeStudyPlan({ assessment: test({ on: MON }), band: 'middle', today: MON })
    expect(r.sessions).toEqual([])
    expect(r.message).toMatch(/today/i)
  })

  it('plans a project as milestones', () => {
    const r = proposeStudyPlan({
      assessment: test({ kind: 'project', on: '2026-09-27' }),
      band: 'upper',
      today: MON,
    })
    expect(r.sessions.map((s) => s.title.split(' · ')[0])).toEqual(['Plan', 'Draft', 'Finish'])
    expect(r.sessions.map((s) => s.onDay)).toEqual([...r.sessions.map((s) => s.onDay)].sort())
  })

  it('adds an extra session when asked', () => {
    const r = proposeStudyPlan({
      assessment: test(),
      band: 'middle',
      today: MON,
      extraSessions: 1,
    })
    expect(r.wanted).toBe(6)
  })
})

describe('weekLoad', () => {
  const item = (over: Partial<PlannerItem>): PlannerItem =>
    ({
      id: 'x', learnerId: 'l', weekStart: MON, onDay: MON, kind: 'task', title: 't',
      courseId: null, assessmentId: null, minutes: 30, purpose: null, proposed: false,
      target: null, status: 'open', doneAt: null, doneBy: null, sessionId: null,
      deletedAt: null, sortOrder: 0, createdBy: null, createdAt: 0, updatedAt: 0,
      ...over,
    }) as PlannerItem

  it('adds minutes per day and flags a heavy one', () => {
    const load = weekLoad(
      [item({ minutes: 50 }), item({ minutes: 40 }), item({ onDay: '2026-09-08', minutes: 10 })],
      MON,
      'middle',
    )
    expect(load[0]!.minutes).toBe(90)
    expect(load[0]!.heavy).toBe(true)
    expect(load[1]!.minutes).toBe(10)
    expect(load[1]!.heavy).toBe(false)
  })

  it('ignores done, deleted, shelved and event cards', () => {
    const load = weekLoad(
      [
        item({ status: 'done' }),
        item({ deletedAt: 1 }),
        item({ onDay: null }),
        item({ kind: 'event', minutes: 999 }),
      ],
      MON,
      'middle',
    )
    expect(load[0]!.minutes).toBe(0)
  })
})

describe('dayOrder', () => {
  it('shows open cards first, then the done pile, each by sort order', () => {
    const rows = [
      { id: 'x', status: 'done' as const, sortOrder: 1000, createdAt: 0 },
      { id: 'a', status: 'open' as const, sortOrder: 2000, createdAt: 0 },
      { id: 'b', status: 'open' as const, sortOrder: 3000, createdAt: 0 },
      { id: 's', status: 'skipped' as const, sortOrder: 500, createdAt: 0 },
    ]
    expect(dayOrder(rows).map((r) => r.id)).toEqual(['a', 'b', 's', 'x'])
  })
})

describe('canDrop', () => {
  const ctx = { assessments: [{ id: 'a1', on: '2026-09-10' }], busyDays: ['2026-09-09'], weekStart: MON }

  it('refuses a study session past its test', () => {
    const v = canDrop({ kind: 'study', assessmentId: 'a1', purpose: 'practise' }, '2026-09-11', ctx)
    expect(v.ok).toBe(false)
  })

  it('asks before a busy day', () => {
    const v = canDrop({ kind: 'task', assessmentId: null, purpose: null }, '2026-09-09', ctx)
    expect(v).toMatchObject({ ok: false, ask: true })
  })

  it('shelves tasks only', () => {
    expect(canDrop({ kind: 'task', assessmentId: null, purpose: null }, null, ctx).ok).toBe(true)
    expect(canDrop({ kind: 'study', assessmentId: null, purpose: null }, null, ctx).ok).toBe(false)
  })
})

describe('parseQuickAdd', () => {
  const courses = [{ id: 'c1', name: 'Biology' }, { id: 'c2', name: 'Algebra 1' }]

  it('reads a day, minutes and a course tag', () => {
    const q = parseQuickAdd('Bio worksheet p.42 thu 30m #bio', courses, MON)
    expect(q).toEqual({
      title: 'Bio worksheet p.42',
      onDay: '2026-09-10',
      minutes: 30,
      courseId: 'c1',
      looksLikeAssessment: null,
    })
  })

  it('leaves a plain line alone and lands it on the default day', () => {
    const q = parseQuickAdd('Read chapter 4', courses, MON, '2026-09-09')
    expect(q.title).toBe('Read chapter 4')
    expect(q.onDay).toBe('2026-09-09')
    expect(q.minutes).toBeNull()
  })

  it('spots a test', () => {
    expect(parseQuickAdd('Chapter 7 test fri', courses, MON).looksLikeAssessment).toBe('test')
    expect(parseQuickAdd('vocab quiz', courses, MON).looksLikeAssessment).toBe('quiz')
    expect(parseQuickAdd('finish testing the code', courses, MON).looksLikeAssessment).toBeNull()
  })

  it('understands tomorrow', () => {
    expect(parseQuickAdd('permission slip tomorrow', courses, MON).onDay).toBe('2026-09-08')
  })
})

describe('readiness', () => {
  const m = (itemKey: string, over: Partial<ItemMastery> = {}): ItemMastery => ({
    subject: 'quiz', itemKey, listId: null, difficulty: 2, mastery: 0.9, reps: 3, lapses: 0,
    correctStreak: 3, totalAttempts: 3, totalCorrect: 3, intervalDays: 10,
    dueOn: '2026-10-01', firstSeenAt: 0, lastSeenAt: 0, ...over,
  })

  it('counts the set only', () => {
    const r = readiness(
      [m('d1:a'), m('d1:b', { mastery: 0.2, correctStreak: 0 }), m('d2:z')],
      { subject: 'quiz', targetId: 'd1' },
      MON,
      '2026-09-12',
    )
    expect(r.total).toBe(2)
    expect(r.mastered).toBe(1)
    expect(r.daysLeft).toBe(5)
  })
})

describe('wins and copy', () => {
  it('offers verified wins with evidence, and marks the learner\'s own as such', () => {
    const wins = suggestWins({
      verifiedCorrectThisWeek: 80, masteredThisWeek: 12, streakDays: 5, masteryChecksPassed: 1,
      levelUps: [], assignmentsDone: 2, studySessionsDone: 3,
      assessmentsRecorded: [{ title: 'Bio quiz', feltLike: 1 }],
    })
    expect(wins.filter((w) => w.kind === 'verified').every((w) => w.evidence)).toBe(true)
    expect(wins.find((w) => w.kind === 'own')?.text).toMatch(/Bio quiz/)
  })

  it('describes events in one line', () => {
    expect(
      describeEvent({
        kind: 'moved', entity: 'item', actorId: 'u1', actorName: 'Mum',
        before: { onDay: '2026-09-09' }, after: { onDay: '2026-09-08' },
      }),
    ).toBe('Mum moved it from Wednesday to Tuesday')
    expect(
      describeEvent({ kind: 'closed_by_session', entity: 'item', actorId: null, actorName: null, before: null, after: null }),
    ).toMatch(/checked/)
  })

  it('writes the Family line', () => {
    expect(
      plannerLine(
        { planned: true, priorities: 3, heavyDays: 1,
          nextAssessment: { title: 'Chapter 7 test', on: '2026-09-11', sessionsDone: 2, sessionsTotal: 5 } },
        MON,
      ),
    ).toBe('Planned this week · 3 priorities · Chapter 7 test Fri: 2 of 5 sessions done · 1 heavy day')
    expect(plannerLine({ planned: false, priorities: 0, heavyDays: 0, nextAssessment: null }, MON)).toBe(
      'Not planned yet',
    )
  })
})
