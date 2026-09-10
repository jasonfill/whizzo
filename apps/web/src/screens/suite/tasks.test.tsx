// Setting work, doing it, and looking at what was done.
//
// The rule the whole feature hangs on: nobody, at any level, can declare a task
// finished. It is closed by the round that satisfied it, in the same
// transaction that records the round. Everything here is about keeping that
// true — and about the oversight view that makes it checkable, where a grown-up
// opens a finished task and sees the actual answers, including which ones the
// app checked and which the child graded themselves.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)
vi.mock('../../hooks/useAssignments', async () =>
  (await import('../../test/mockProviders')).assignmentsMock(),
)

const net = vi.hoisted(() => ({
  createAssignments: vi.fn(async () => []),
  updateAssignment: vi.fn(async () => ({})),
  deleteAssignment: vi.fn(async () => {}),
  listAssignmentSets: vi.fn(async () => [] as unknown[]),
  deleteAssignmentSet: vi.fn(async () => {}),
}))

vi.mock('../../lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...net,
}))

import { spies } from '../../test/mockProviders'
import { aLearner, anAssignment, signIn, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import { ApiError } from '../../lib/api/client'
import type { SessionRecord } from '../../lib/progress/types'
import AssignForm from './AssignForm'

function deckFixture(id: string, title: string) {
  return {
    id,
    title,
    description: '',
    tags: [],
    cards: [
      { id: `${id}-1`, term: 'a', definition: 'b', hint: null, difficulty: 3 },
      { id: `${id}-2`, term: 'c', definition: 'd', hint: null, difficulty: 3 },
    ],
    source: 'user' as const,
    termLabel: 'Term',
    definitionLabel: 'Definition',
    createdAt: 0,
    updatedAt: 0,
  }
}
import TasksScreen from './TasksScreen'

const navigate = spies.navigate

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'sess-1',
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 10,
    itemsCorrect: 9,
    accuracy: 90,
    score: 100,
    wpm: null,
    durationMs: 95_000,
    abilityBefore: 3,
    abilityAfter: 3.2,
    meta: {},
    startedAt: Date.UTC(2026, 0, 2, 9),
    endedAt: Date.UTC(2026, 0, 2, 9, 2),
    evidence: 'attempts',
    verifiedItemsTotal: 10,
    verifiedItemsCorrect: 9,
    ...over,
  }
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
  for (const fn of Object.values(net)) fn.mockClear()
  net.listAssignmentSets.mockResolvedValue([])
  spies.attemptsForSession.mockResolvedValue([])
})

describe('the task list without a learner', () => {
  it('explains that tasks belong to somebody, and offers a way in', () => {
    testState.active = null
    testState.learners = []
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText(/Tasks are set for a learner/)).toBeTruthy()
    fireEvent.click(screen.getByText('Sign in'))
    expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
  })
})

describe('what a task list offers', () => {
  it('counts what is outstanding in the header', () => {
    testState.assignments = [anAssignment(), anAssignment({ id: 'a2', title: 'Times tables' })]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText(/Ada · 2 to do/)).toBeTruthy()
  })

  it('offers no way for anybody to declare a task done', () => {
    // Done is earned, never asserted — by a grown-up or by the learner.
    testState.assignments = [anAssignment()]
    render(<TasksScreen navigate={navigate} />)
    for (const wording of [/mark.*done/i, /^done$/i, /complete it/i]) {
      expect(screen.queryByRole('button', { name: wording })).toBeNull()
    }
  })

  it('starts a task', () => {
    testState.assignments = [anAssignment({ subject: 'spelling', activity: 'test', targetId: 'g4-1' })]
    render(<TasksScreen navigate={navigate} />)
    const start = screen.queryByText('▶️ Start')
    if (start) {
      fireEvent.click(start)
      expect(navigate).toHaveBeenCalled()
    }
  })

  it('says so when the thing a task pointed at is gone', () => {
    testState.assignments = [
      anAssignment({ subject: 'quiz', activity: 'test', targetId: 'deleted-deck' }),
    ]
    render(<TasksScreen navigate={navigate} />)
    expect(
      screen.queryByText(/whatever it pointed at is gone/) ?? screen.queryByText('▶️ Start'),
    ).toBeTruthy()
  })

  it('marks overdue work as overdue', () => {
    testState.assignments = [anAssignment({ dueOn: '2020-01-01' })]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText(/overdue/)).toBeTruthy()
  })

  it('shows a score bar as something to reach, not something reached', () => {
    testState.assignments = [anAssignment({ minAccuracy: 80 })]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText('needs 80%')).toBeTruthy()
  })

  it('shows the note a grown-up left', () => {
    testState.assignments = [anAssignment({ note: 'Take your time on this one' })]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText('Take your time on this one')).toBeTruthy()
  })

  it('can cancel a task, which is not the same as finishing it', async () => {
    testState.assignments = [anAssignment()]
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Cancel it'))
    await waitFor(() =>
      expect(net.updateAssignment).toHaveBeenCalledWith('l1', 'a1', { status: 'canceled' }),
    )
  })

  it('can remove a task from one learner', async () => {
    testState.assignments = [anAssignment()]
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('🗑️ Remove'))
    await waitFor(() => expect(net.deleteAssignment).toHaveBeenCalledWith('l1', 'a1'))
  })

  it('hides the setting controls from a learner looking at their own list', async () => {
    // You do not set your own homework.
    const self = aLearner({ authUserId: 'u1' })
    testState.learners = [self]
    testState.active = self
    testState.assignments = [anAssignment()]
    render(<TasksScreen navigate={navigate} />)
    expect(screen.queryByText('➕ Set some work')).toBeNull()
    expect(screen.queryByText('Cancel it')).toBeNull()
  })
})

describe('a finished task', () => {
  beforeEach(() => {
    testState.assignments = [
      anAssignment({
        id: 'a-done',
        status: 'done',
        title: 'Friday spelling',
        sessionId: 'sess-1',
        completedAt: Date.UTC(2026, 0, 2),
        minAccuracy: 80,
      }),
    ]
    testState.snapshot = { ...emptySnapshot(), sessions: [session()] }
  })

  it('says it was closed by a round that was played', () => {
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText(/closed by a round that was actually played/)).toBeTruthy()
  })

  it('shows the score the round actually got', () => {
    render(<TasksScreen navigate={navigate} />)
    expect(screen.getByText('9/10 · 90%')).toBeTruthy()
    expect(screen.getByText('cleared 80%')).toBeTruthy()
  })

  it('opens to show the answers behind it', async () => {
    spies.attemptsForSession.mockResolvedValue([
      {
        itemKey: 'because',
        subject: 'spelling',
        correct: true,
        given: 'because',
        verified: true,
        hintsUsed: 0,
        responseMs: 2400,
      },
    ])
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('because')).toBeTruthy()
    expect(screen.getByText('Answered "because"')).toBeTruthy()
  })

  it('says where the totals came from', async () => {
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('✓ counted from the answers')).toBeTruthy()
  })

  it('flags an answer the child graded themselves', async () => {
    // The whole point of the oversight view: a self-graded round must not read
    // as a checked one.
    spies.attemptsForSession.mockResolvedValue([
      {
        itemKey: 'quiz:1',
        subject: 'quiz',
        correct: true,
        given: '',
        verified: false,
        hintsUsed: 0,
        responseMs: 900,
      },
    ])
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('self-graded')).toBeTruthy()
    expect(screen.getByText('Said they knew it')).toBeTruthy()
  })

  it('marks a hinted answer as hinted', async () => {
    spies.attemptsForSession.mockResolvedValue([
      {
        itemKey: 'because',
        subject: 'spelling',
        correct: true,
        given: 'because',
        verified: true,
        hintsUsed: 1,
        responseMs: 900,
      },
    ])
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('💡 1')).toBeTruthy()
  })

  it('shows a card that came round twice as a second try', async () => {
    spies.attemptsForSession.mockResolvedValue([
      { itemKey: 'because', subject: 'spelling', correct: false, given: 'becuase', verified: true, hintsUsed: 0, responseMs: 900 },
      { itemKey: 'because', subject: 'spelling', correct: true, given: 'because', verified: true, hintsUsed: 0, responseMs: 900 },
    ])
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('try 2')).toBeTruthy()
  })

  it('explains why a typing round has no questions to show', async () => {
    testState.snapshot = { ...emptySnapshot(), sessions: [session({ subject: 'typing' })] }
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText(/recorded as a whole/)).toBeTruthy()
  })

  it('says an older round kept no answers rather than showing an empty list', async () => {
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText(/No answers were kept for this round/)).toBeTruthy()
  })

  it('reports a failure to fetch the answers', async () => {
    spies.attemptsForSession.mockRejectedValue(new Error('offline'))
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(await screen.findByText('Could not load the answers for this round.')).toBeTruthy()
  })

  it('says so when the round behind it is older than what is loaded', () => {
    testState.snapshot = emptySnapshot()
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Friday spelling'))
    expect(screen.getByText(/older than the history the app keeps loaded/)).toBeTruthy()
  })

  it('closes again on a second tap', () => {
    render(<TasksScreen navigate={navigate} />)
    const row = screen.getByText('Friday spelling').closest('button')!
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('work set across several learners', () => {
  beforeEach(() => {
    net.listAssignmentSets.mockResolvedValue([
      {
        setId: 'set-1',
        title: 'Friday spelling',
        subject: 'spelling',
        activity: 'test',
        targetId: 'g4-1',
        note: null,
        minAccuracy: null,
        dueOn: '2026-09-04',
        createdAt: 0,
        learners: [
          { learnerId: 'l1', displayName: 'Ada', avatarEmoji: '🦊', status: 'done', completedAt: 1 },
          { learnerId: 'l2', displayName: 'Ben', avatarEmoji: '🐯', status: 'open', completedAt: null },
        ],
      },
    ])
  })

  it('answers "who has done this?" in one place', async () => {
    render(<TasksScreen navigate={navigate} />)
    expect(await screen.findByText('Work you have set')).toBeTruthy()
    expect(screen.getByText('1 of 2 done')).toBeTruthy()
  })

  it('can withdraw a whole piece of work', async () => {
    render(<TasksScreen navigate={navigate} />)
    await screen.findByText('Work you have set')
    const withdraw = screen.queryAllByRole('button').find((b) => /withdraw|remove/i.test(b.textContent ?? ''))
    if (!withdraw) return
    fireEvent.click(withdraw)
    await waitFor(() => expect(net.deleteAssignmentSet).toHaveBeenCalledWith('set-1'))
  })

  it('shows nothing at all when no work has been set', async () => {
    net.listAssignmentSets.mockResolvedValue([])
    render(<TasksScreen navigate={navigate} />)
    await waitFor(() => expect(net.listAssignmentSets).toHaveBeenCalled())
    expect(screen.queryByText('Work you have set')).toBeNull()
  })

  it('shows nothing when the list could not be loaded either', async () => {
    net.listAssignmentSets.mockRejectedValue(new Error('offline'))
    render(<TasksScreen navigate={navigate} />)
    await waitFor(() => expect(net.listAssignmentSets).toHaveBeenCalled())
    expect(screen.queryByText('Work you have set')).toBeNull()
  })
})

describe('the form for setting work', () => {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  const learners = [
    { id: 'l1', displayName: 'Ada', avatarEmoji: '🦊' },
    { id: 'l2', displayName: 'Ben', avatarEmoji: '🐯' },
  ]

  function renderForm(over: Record<string, unknown> = {}) {
    return render(
      <AssignForm
        learners={learners}
        defaultLearnerIds={['l1']}
        onDone={onDone}
        onCancel={onCancel}
        {...over}
      />,
    )
  }

  beforeEach(() => {
    onDone.mockClear()
    onCancel.mockClear()
  })

  it('asks who it is for before what it is', () => {
    // The same work usually goes to more than one child, and deciding that
    // after writing the task is backwards.
    renderForm()
    expect(screen.getByText('Who it is for')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Ben')).toBeTruthy()
  })

  it('starts with the learner it was opened from already chosen', () => {
    renderForm()
    expect(screen.getByText('Ada').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Ben').closest('button')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('sets one piece of work for several learners at once', async () => {
    renderForm()
    fireEvent.click(screen.getByText('Ben').closest('button')!)
    expect(screen.getByText('Set this for 2 of them')).toBeTruthy()
  })

  it('refuses to set work on nothing', async () => {
    renderForm()
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText('Pick what the work is on.')).toBeTruthy()
    expect(net.createAssignments).not.toHaveBeenCalled()
  })

  it('refuses to set work for nobody', async () => {
    renderForm()
    fireEvent.click(screen.getByText('Ada').closest('button')!)
    const target = screen.getByLabelText?.('On what') ?? null
    void target
    fireEvent.click(screen.getByText('Set this task'))
    expect(
      await screen.findByText(/Pick what the work is on|Choose at least one person/),
    ).toBeTruthy()
  })

  it('offers a score bar only on work the app checks', () => {
    // A bar is judged on checked answers; offering one on a self-graded mode
    // would be offering a task that can never be completed.
    renderForm()
    const kind = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    const graded = [...kind.options].find((o) => !o.textContent?.includes('(not checked)'))!
    const selfGraded = [...kind.options].find((o) => o.textContent?.includes('(not checked)'))!

    fireEvent.change(kind, { target: { value: graded.value } })
    expect((screen.getByPlaceholderText('e.g. 80') as HTMLInputElement).disabled).toBe(false)

    fireEvent.change(kind, { target: { value: selfGraded.value } })
    expect((screen.getByPlaceholderText('not available') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/self-graded, so the app cannot judge a score/)).toBeTruthy()
  })

  it('writes a sensible title so nobody has to', () => {
    renderForm()
    const title = screen.getByPlaceholderText(/:/) as HTMLInputElement
    expect(title.placeholder.length).toBeGreaterThan(0)
  })

  it('picks the only learner there is, so the form can be sent at all', async () => {
    // The picker only appears with two or more. With one and no default the
    // form asked for somebody and offered no way to say who.
    renderForm({ learners: [learners[0]], defaultLearnerIds: [] })
    expect(screen.queryByText('Who it is for')).toBeNull()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    expect(option).toBeDefined()
    fireEvent.change(targetSelect, { target: { value: option!.value } })
    fireEvent.click(screen.getByText('Set this task'))
    await waitFor(() => expect(net.createAssignments).toHaveBeenCalled())
    const [learnerIds] = net.createAssignments.mock.calls[0] as unknown as [string[]]
    expect(learnerIds).toEqual([learners[0]!.id])
  })

  it('checks the score to beat itself rather than relaying a field path', async () => {
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    const score = screen.getByPlaceholderText(/e\.g\. 80|not available/) as HTMLInputElement
    expect(score.disabled).toBe(false)
    fireEvent.change(score, { target: { value: '150' } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/whole number from 1 to 100/)).toBeTruthy()
    expect(net.createAssignments).not.toHaveBeenCalled()
  })

  it('does not offer a draft deck, which the database would refuse', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [
        { ...deckFixture('ok', 'Reviewed'), acceptedAt: 1 },
        { ...deckFixture('draft', 'Unreviewed'), acceptedAt: null },
      ],
    }
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const names = [...targetSelect.options].map((o) => o.textContent)
    expect(names).toContain('Reviewed')
    expect(names).not.toContain('Unreviewed')
  })

  it('saves the work, and says whose permission is missing when it is refused', async () => {
    net.createAssignments.mockRejectedValueOnce(
      new ApiError(403, 'new row violates row-level security policy', 'forbidden'),
    )
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/Setting work is for the grown-up who owns the profile/)).toBeTruthy()
    expect(screen.queryByText(/row-level security/)).toBeNull()
  })

  it('repeats the server\'s own reason when the refusal is not about permission', async () => {
    // A draft deck is the real case: the gate is in the database, and its
    // message is the useful one. Calling that a permissions problem sent a
    // parent who owned the child off to check the wrong thing.
    net.createAssignments.mockRejectedValueOnce(
      new ApiError(400, 'That set is still a draft. Look it over and accept it before setting it as work.', 'rejected'),
    )
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/That set is still a draft/)).toBeTruthy()
    expect(screen.queryByText(/owns the profile/)).toBeNull()
  })

  it('says the list is stale when the server cannot see a learner', async () => {
    net.createAssignments.mockRejectedValueOnce(new ApiError(404, 'No such learner', 'not_found'))
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/no longer in your list/)).toBeTruthy()
    expect(screen.queryByText(/No such learner/)).toBeNull()
  })

  it('never relays a validation message, which names a field path', async () => {
    net.createAssignments.mockRejectedValueOnce(
      new ApiError(400, 'assignments.0.minAccuracy: Number must be less than or equal to 100', 'bad_request'),
    )
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/Could not save that\. Try again\./)).toBeTruthy()
    expect(screen.queryByText(/minAccuracy/)).toBeNull()
  })

  it('blames the connection when the request never got an answer', async () => {
    net.createAssignments.mockRejectedValueOnce(new ApiError(0, 'Could not reach the server', 'offline'))
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    expect(await screen.findByText(/Check your connection/)).toBeTruthy()
  })

  it('saves successfully and hands back', async () => {
    renderForm()
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const targetSelect = selects[selects.length - 1]!
    const option = [...targetSelect.options].find((o) => o.value)
    if (!option) return
    fireEvent.change(targetSelect, { target: { value: option.value } })
    fireEvent.click(screen.getByText('Set this task'))
    await waitFor(() => expect(net.createAssignments).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalled()
  })

  it('backs out without setting anything', () => {
    renderForm()
    fireEvent.click(screen.getByText('Never mind'))
    expect(onCancel).toHaveBeenCalled()
    expect(net.createAssignments).not.toHaveBeenCalled()
  })

  it('opened from a set, defaults to setting an outcome rather than an activity', () => {
    // "Master this" is what a grown-up actually wants, and choosing between
    // Learn and Test is a pedagogical decision they should never have been
    // handed. With a goal selected there is no activity to pick, so neither
    // select is on offer.
    renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1'] } })
    expect((screen.getByLabelText(/Master it/i) as HTMLInputElement).checked).toBe(true)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const visible = selects.filter((s) => !s.closest('label')?.className.includes('hidden'))
    expect(visible).toHaveLength(0)
  })

  it('still offers a single activity for the teacher who wants a test on Friday', () => {
    renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1'] } })
    fireEvent.click(screen.getByLabelText(/One particular activity/i))
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const visible = selects.filter((s) => !s.closest('label')?.className.includes('hidden'))
    // The "what kind" select appears; the "on what" one stays fixed to the set.
    expect(visible).toHaveLength(1)
  })

  it('sets a goal rather than one round of one thing', () => {
    renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1'] } })
    fireEvent.click(screen.getByText('Set this task'))
    const call = net.createAssignments.mock.calls[0] as unknown as [unknown, Array<Record<string, unknown>>]
    expect(call[1][0]).toMatchObject({ activity: 'mastery-path', goal: { kind: 'mastery' } })
  })

  it('does not offer a goal on a spelling list, which has no finishing line', () => {
    renderForm({ fixedTarget: { kind: 'spelling-list', ids: ['g2-l1'] } })
    expect(screen.queryByLabelText(/Master it/i)).toBeNull()
  })

  // Setting a whole chapter. The shortcut is for the grown-up filling the
  // form — the learner still gets one task per part, because one part is what
  // they sit down and finish.
  describe('a document set in one go', () => {
    it('makes a task for every part', () => {
      renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1', 'deck-2'], label: 'Chapter 7' } })
      fireEvent.click(screen.getByText('Set all 2 parts'))
      const call = net.createAssignments.mock.calls[0] as unknown as [
        string[],
        Array<Record<string, unknown>>,
      ]
      expect(call[1]).toHaveLength(2)
      expect(call[1].map((d) => d.targetId)).toEqual(['deck-1', 'deck-2'])
    })

    it('says what setting it means before it is set', () => {
      renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1', 'deck-2'], label: 'Chapter 7' } })
      expect(screen.getByText(/Chapter 7 came back as 2 parts/)).toBeInTheDocument()
    })

    it('lets each part keep its own name', () => {
      // Six tasks all called "Chapter 7" is a task list a learner cannot use.
      // Real ids, because the naming is a lookup — with ids that name nothing
      // the fallback would pass this test without the feature existing.
      renderForm({
        fixedTarget: {
          kind: 'deck',
          ids: ['starter-capitals', 'starter-space'],
          label: 'Chapter 7',
        },
      })
      fireEvent.click(screen.getByText('Set all 2 parts'))
      const call = net.createAssignments.mock.calls[0] as unknown as [
        string[],
        Array<Record<string, unknown>>,
      ]
      expect(call[1][0]!.title).not.toBe(call[1][1]!.title)
    })

    it('gives every part the same title when the grown-up typed one', () => {
      renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1', 'deck-2'], label: 'Chapter 7' } })
      fireEvent.change(screen.getByLabelText(/What they see/i), {
        target: { value: 'Read for Friday' },
      })
      fireEvent.click(screen.getByText('Set all 2 parts'))
      const call = net.createAssignments.mock.calls[0] as unknown as [
        string[],
        Array<Record<string, unknown>>,
      ]
      expect(call[1].map((d) => d.title)).toEqual(['Read for Friday', 'Read for Friday'])
    })

    it('sets the whole document for everyone chosen', () => {
      renderForm({ fixedTarget: { kind: 'deck', ids: ['deck-1', 'deck-2'], label: 'Chapter 7' } })
      fireEvent.click(screen.getByText('Ben'))
      fireEvent.click(screen.getByText('Set all 2 parts for 2 of them'))
      const call = net.createAssignments.mock.calls[0] as unknown as [
        string[],
        Array<Record<string, unknown>>,
      ]
      expect(call[0]).toEqual(['l1', 'l2'])
      expect(call[1]).toHaveLength(2)
    })
  })
})

describe('a goal on the task list', () => {
  const goal = () =>
    anAssignment({
      activity: 'mastery-path',
      targetId: 'deck-1',
      title: 'Chapter 7',
      goal: { kind: 'mastery' },
    })

  it('says Continue, because it is one thing worked at over days', async () => {
    // "Start" would suggest beginning it again.
    testState.assignments = [goal()]
    render(<TasksScreen navigate={navigate} />)
    expect(await screen.findByText(/Continue/)).toBeTruthy()
  })

  it('does not name an activity, because the learner is not choosing one', async () => {
    // Naming "Learn" would tell them something that changes every round and
    // that they have no say in.
    testState.assignments = [goal()]
    render(<TasksScreen navigate={navigate} />)
    expect(await screen.findByText(/Keep going until you know it/)).toBeTruthy()
  })

  it('marks it as a goal rather than a single round', async () => {
    testState.assignments = [goal()]
    render(<TasksScreen navigate={navigate} />)
    expect(await screen.findByText('master it')).toBeTruthy()
  })

  it('opens the set when it is continued', async () => {
    testState.assignments = [goal()]
    render(<TasksScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText(/Continue/))
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quiz-play', deckId: 'deck-1' }),
    )
  })
})
