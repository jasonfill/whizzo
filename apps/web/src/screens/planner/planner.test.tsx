// The planner, from the learner's side and the grown-up's.
//
// What these pin is the interaction budget and the two kinds of done: a task
// is a line and Enter; a claim card has a box that ticks; a linked card has
// Start and no box, and swiping or tapping cannot finish it; a move is one
// gesture — here the keyboard one, since a pointer drag is not something jsdom
// can do honestly.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () => (await import('../../test/mockProviders')).authMock())
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)
vi.mock('../../hooks/usePlannerWeek', async () =>
  (await import('../../test/mockProviders')).plannerMock(),
)

const net = vi.hoisted(() => ({
  weekHistory: vi.fn(async () => []),
  addComment: vi.fn(async () => ({})),
  itemHistory: vi.fn(async () => []),
  listCourses: vi.fn(async () => []),
  createCourse: vi.fn(async (_id: string, d: Record<string, unknown>) => ({
    id: 'c-new',
    learnerId: 'l1',
    name: d.name,
    track: d.track,
    teacherName: null,
    period: null,
    color: d.color,
    emoji: null,
    termLabel: null,
    startsOn: null,
    endsOn: null,
    archivedAt: null,
    sortOrder: 1,
    createdBy: 'u1',
  })),
}))
vi.mock('../../lib/planner/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...net,
}))

import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import type { PlannerItem, PlannerWeekResponse } from '../../lib/planner/api'
import PlannerScreen from './PlannerScreen'
import CoursesScreen from './CoursesScreen'

const navigate = spies.navigate
const MON = '2026-09-07'

function item(over: Partial<PlannerItem>): PlannerItem {
  return {
    id: 'i1',
    learnerId: 'l1',
    weekStart: MON,
    onDay: MON,
    kind: 'task',
    title: 'Bio worksheet',
    courseId: 'c1',
    assessmentId: null,
    minutes: 25,
    purpose: null,
    proposed: false,
    target: null,
    status: 'open',
    doneAt: null,
    doneBy: null,
    sessionId: null,
    deletedAt: null,
    sortOrder: 1000,
    createdBy: 'u1',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function week(items: PlannerItem[], over: Partial<PlannerWeekResponse> = {}): PlannerWeekResponse {
  return {
    week: {
      id: 'w1', learnerId: 'l1', weekStart: MON, priorities: [], wins: [], goals: [],
      reflection: null, busyDays: [], plannedAt: Date.now(), wrappedAt: null,
    },
    band: 'middle',
    canWrite: true,
    items,
    carryOver: [],
    assessments: [],
    assignments: [],
    reviewDue: {},
    sessionCounts: {},
    comments: [],
    courses: [
      { id: 'c1', learnerId: 'l1', name: 'Biology', track: 'science.biology', teacherName: null, period: null,
        color: '#4FA36F', emoji: null, termLabel: null, startsOn: null, endsOn: null, archivedAt: null, sortOrder: 0, createdBy: 'u1' },
    ],
    prefs: { learnerId: 'l1', dailyMinutes: null, sessionsPerDay: null, studyDays: [1, 2, 3, 4, 5, 7] },
    ...over,
  }
}

beforeEach(() => {
  signIn()
  // The learner is signed in as themselves: the planner is theirs.
  testState.active = aLearner({ gradeHint: 7, authUserId: 'u1' })
  testState.learners = [testState.active]
  navigate.mockClear()
  for (const s of [spies.plannerAdd, spies.plannerTick, spies.plannerMove, spies.plannerPatch]) s.mockClear()
})

describe('the interaction budget', () => {
  it('adds a task from one line and Enter, filed under the course chip', async () => {
    testState.plannerWeek = week([])
    render(<PlannerScreen navigate={navigate} view="week" />)
    const input = screen.getByLabelText('Add something')
    fireEvent.change(input, { target: { value: 'Read chapter 4 thu 30m' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(spies.plannerAdd).toHaveBeenCalled())
    expect(spies.plannerAdd.mock.calls[0]![0]).toMatchObject({
      title: 'Read chapter 4',
      onDay: '2026-09-10',
      minutes: 30,
      kind: 'task',
    })
  })

  it('offers to plan a line that looks like a test rather than filing it as a task', async () => {
    testState.plannerWeek = week([])
    render(<PlannerScreen navigate={navigate} view="week" />)
    const input = screen.getByLabelText('Add something')
    fireEvent.change(input, { target: { value: 'Chapter 7 test fri' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/Is this a test\?/)).toBeTruthy()
    expect(spies.plannerAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Yes, plan it'))
    expect(await screen.findByRole('dialog', { name: 'Add a test' })).toBeTruthy()
  })

  it('ticks a claim card with one tap on its box', async () => {
    testState.plannerWeek = week([item({})])
    render(<PlannerScreen navigate={navigate} view="week" />)
    fireEvent.click(screen.getByLabelText('Tick Bio worksheet'))
    expect(spies.plannerTick).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }))
  })

  it('moves a card with the keyboard, one gesture', async () => {
    testState.plannerWeek = week([item({})])
    render(<PlannerScreen navigate={navigate} view="week" />)
    const card = screen.getByRole('listitem', { name: 'Bio worksheet' })
    fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true })
    expect(spies.plannerMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), '2026-09-08')
  })

  it('shows a view-only guardian the cards without a box, a drag or an add', async () => {
    testState.plannerWeek = week([item({})], { canWrite: false })
    render(<PlannerScreen navigate={navigate} view="week" />)
    expect(screen.queryByLabelText('Tick Bio worksheet')).toBeNull()
    expect(screen.queryByLabelText('Add something')).toBeNull()
    expect(screen.queryByText('📝 Add a test')).toBeNull()
    expect(screen.getByRole('listitem', { name: 'Bio worksheet' })).toBeTruthy()
  })
})

describe('two kinds of done', () => {
  it('gives a linked card Start and no box', async () => {
    testState.plannerWeek = week([
      item({
        id: 's1', kind: 'study', title: 'Practice · Chapter 7', purpose: 'practice', proposed: true,
        target: { subject: 'quiz', activity: 'learn', targetId: 'deck-1' },
      }),
    ])
    render(<PlannerScreen navigate={navigate} view="week" />)
    const card = screen.getByRole('listitem', { name: 'Practice · Chapter 7' })
    expect(within(card).queryByLabelText(/^Tick /)).toBeNull()
    expect(within(card).getByLabelText('Closed by doing it')).toBeTruthy()
    fireEvent.click(within(card).getByText('▶ Start'))
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'quiz-play', deckId: 'deck-1' }))
  })

  it('will not tick a linked card from the keyboard either', async () => {
    testState.plannerWeek = week([
      item({ id: 's1', kind: 'study', title: 'Practice', target: { subject: 'quiz', activity: 'learn', targetId: 'deck-1' } }),
    ])
    render(<PlannerScreen navigate={navigate} view="week" />)
    fireEvent.keyDown(screen.getByRole('listitem', { name: 'Practice' }), { key: ' ' })
    expect(spies.plannerTick).not.toHaveBeenCalled()
  })

  it('shows a grown-up\'s assignment on its due day with Start, pinned', async () => {
    testState.plannerWeek = week([], {
      assignments: [
        {
          id: 'a1', setId: 's', learnerId: 'l1', createdBy: 'p1', subject: 'spelling', activity: 'test',
          targetId: null, size: null, title: 'Friday spelling', note: null, minAccuracy: null,
          dueOn: '2026-09-11', sortOrder: 0, status: 'open', completedAt: null, sessionId: null, createdAt: 0,
        },
      ],
    })
    render(<PlannerScreen navigate={navigate} view="week" />)
    const fri = screen.getByRole('region', { name: /Fri 2026-09-11/ })
    expect(within(fri).getByText('Friday spelling')).toBeTruthy()
    fireEvent.click(within(fri).getByText('▶ Start'))
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'spell-play' }))
  })
})

describe('the grown-up view', () => {
  it('shows the learner\'s name and who added a card', async () => {
    testState.user = { id: 'parent-1', email: 'p@example.com' }
    testState.plannerWeek = week([item({ createdBy: 'parent-1' })])
    render(<PlannerScreen navigate={navigate} view="week" />)
    expect(screen.getByText("Ada's planner")).toBeTruthy()
    expect(screen.getByTitle('Added by You')).toBeTruthy()
  })

  // The consent rule from docs/realtime-spec.md §9, at the one place it is
  // visible today: nobody is in a week silently, in either direction.
  it('says who else is in the week, and says nothing when nobody is', async () => {
    testState.user = { id: 'parent-1', email: 'p@example.com' }
    testState.plannerWeek = week([item({})])

    const alone = render(<PlannerScreen navigate={navigate} view="week" />)
    expect(screen.queryByText(/is here/)).toBeNull()
    alone.unmount()

    testState.watchers = [{ userId: 'kid-1', name: 'Ada', isLearner: true }]
    render(<PlannerScreen navigate={navigate} view="week" />)
    expect(screen.getByText('Ada is here')).toBeTruthy()
  })

  it('opens the week history on request', async () => {
    net.weekHistory.mockResolvedValueOnce([
      { id: 1, learnerId: 'l1', entity: 'item', entityId: 'i1', at: Date.now(), actorId: 'u1', actorName: 'Ada',
        kind: 'moved', before: { onDay: '2026-09-09' }, after: { onDay: '2026-09-08' }, sessionId: null },
    ] as never)
    testState.plannerWeek = week([item({})])
    render(<PlannerScreen navigate={navigate} view="week" />)
    fireEvent.click(screen.getByText(/Week history/))
    expect(await screen.findByText('Ada moved it from Wednesday to Tuesday')).toBeTruthy()
  })
})

describe('the shelf and today', () => {
  it('keeps a card with no day on the shelf', async () => {
    testState.plannerWeek = week([item({ id: 'sh', onDay: null, title: 'Permission slip' })])
    render(<PlannerScreen navigate={navigate} view="week" />)
    expect(screen.getByText(/Sometime this week · 1/)).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Permission slip' })).toBeTruthy()
  })

  it('says "That\'s today" when everything on today is done', async () => {
    testState.plannerWeek = week([item({ status: 'done', doneBy: 'u1', doneAt: 1 })])
    render(<PlannerScreen navigate={navigate} view="today" />)
    expect(screen.getByText("That's today.")).toBeTruthy()
  })
})

describe('courses', () => {
  it('suggests the track from the name and adds the course', async () => {
    render(<CoursesScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('➕ Add a course'))
    fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'AP Chem' } })
    expect((screen.getByLabelText('Track') as HTMLSelectElement).value).toBe('science.chemistry')
    fireEvent.click(screen.getByText('Add course'))
    await waitFor(() => expect(net.createCourse).toHaveBeenCalled())
    expect(net.createCourse.mock.calls[0]![1]).toMatchObject({ name: 'AP Chem', track: 'science.chemistry' })
    expect(await screen.findByText('AP Chem')).toBeTruthy()
  })
})
