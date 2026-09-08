// The Family screen — the grown-up's home for who is learning here.
//
// It carries three jobs that look separate and are not: first-run onboarding
// (which branches on what the person said at sign-up), the per-learner manage
// panel, and the two code flows. What is asserted below is mostly about who is
// allowed to see what: a shared learner is not manageable, a tutor is not
// marched through "add your first child", and granting a tutor access to a
// learner offers only the ones this person actually owns.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () => (await import('../../test/mockProviders')).authMock())
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)

const net = vi.hoisted(() => ({
  familyOverview: vi.fn(async () => [] as unknown[]),
  listGuardians: vi.fn(async () => [] as unknown[]),
  mintInvite: vi.fn(async () => ({ code: 'INVITE99' })),
  redeemInvite: vi.fn(async () => 'l2'),
  revokeGuardian: vi.fn(async () => {}),
  setGuardianContentAccess: vi.fn(async () => {}),
  setChildLogin: vi.fn(async () => ({ loginCode: 'KID12345', learnerId: 'l1' })),
  removeChildLogin: vi.fn(async () => {}),
  updateLearner: vi.fn(async () => ({})),
  listConnectionCodes: vi.fn(async () => []),
  mintConnectionCode: vi.fn(async () => ({ code: 'TUT12345' })),
  revokeConnectionCode: vi.fn(async () => {}),
  describeCode: vi.fn(async () => ({
    kind: 'invite',
    valid: true,
    reason: null,
    ownerName: 'A grown-up',
    label: 'Bo',
    role: 'parent',
    canManageContent: true,
  })),
  redeemConnectionCode: vi.fn(async () => 1),
}))

vi.mock('../../lib/assignments/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/assignments/api')
  return { ...actual, familyOverview: net.familyOverview }
})

vi.mock('../../lib/learners/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/learners/api')
  return { ...actual, ...net }
})

import { aLearner, signIn, testState } from '../../test/state'
import FamilyScreen from './FamilyScreen'

const navigate = vi.fn()

function overviewFor(id: string, over: Record<string, unknown> = {}) {
  return {
    learnerId: id,
    displayName: 'Ada',
    avatarEmoji: '🦊',
    openAssignments: 0,
    overdueAssignments: 0,
    doneThisWeek: 0,
    lastActiveAt: null,
    minutesThisWeek: 0,
    itemsThisWeek: 0,
    verifiedAccuracyThisWeek: null,
    currentStreakDays: 0,
    ...over,
  }
}

beforeEach(() => {
  navigate.mockClear()
  for (const fn of Object.values(net)) fn.mockClear()
  net.familyOverview.mockResolvedValue([])
  net.listGuardians.mockResolvedValue([])
})

describe('when nobody is signed in', () => {
  it('says what signing in would get you, rather than an empty list', async () => {
    testState.learnerStatus = 'unavailable'
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText(/Sign in to add learners/i)).toBeTruthy()
  })
})

describe('first run', () => {
  beforeEach(() => {
    signIn()
    testState.learners = []
    testState.active = null
  })

  it('asks who is learning, because a new grown-up owns nobody', async () => {
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText('Who is learning?')).toBeTruthy()
    expect(screen.getByText('Add your first learner')).toBeTruthy()
  })

  it('offers "actually it is me" without making them fill the form in', async () => {
    const { create } = (await import('../../test/mockProviders')).spies
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('I am the one learning'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect((create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]).toMatchObject({ displayName: 'Grown-up' })
  })

  it('shows what a new learner’s error was rather than failing silently', async () => {
    const { create } = (await import('../../test/mockProviders')).spies
    create.mockRejectedValueOnce(new Error('That name is taken'))
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('I am the one learning'))
    expect(await screen.findByText('That name is taken')).toBeTruthy()
  })

  it('lets them skip, so nobody is trapped on this screen', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Skip for now'))
    expect(navigate).toHaveBeenCalledWith({ name: 'home' })
  })
})

describe('first run, for somebody who said they are the learner', () => {
  beforeEach(() => {
    signIn()
    testState.learners = []
    testState.active = null
    window.localStorage.setItem(
      'cat-academy:signup-intent',
      JSON.stringify({ role: 'learner', birthYear: 2009 }),
    )
  })

  it('does not ask again what sign-up already established', async () => {
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText('One last thing')).toBeTruthy()
    expect(screen.getByText('Start learning')).toBeTruthy()
  })

  it('carries the birth year they already gave through', async () => {
    const { create } = (await import('../../test/mockProviders')).spies
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Start learning'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect((create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]).toMatchObject({ birthYear: 2009 })
  })
})

describe('first run, for a tutor', () => {
  beforeEach(() => {
    signIn()
    testState.learners = []
    testState.active = null
    window.localStorage.setItem(
      'cat-academy:signup-intent',
      JSON.stringify({ role: 'tutor' }),
    )
  })

  it('leads with a code to hand out, not with "add your first child"', async () => {
    // A tutor's students belong to their own families. Marching a tutor
    // through learner creation would have them making profiles for children
    // who are not theirs.
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText('Connect your first family')).toBeTruthy()
    expect(screen.queryByText('Add your first learner')).toBeNull()
    // Their own children are still welcome — just not the first thing asked.
    fireEvent.click(screen.getByText('➕ Add a learner'))
    expect(screen.getByText('Add a learner of your own')).toBeTruthy()
  })
})

describe('the family list', () => {
  beforeEach(() => {
    signIn()
  })

  it('shows each learner with their age, sign-in mode and world', async () => {
    testState.learners = [aLearner({ theme: 'space', birthYear: 2016 })]
    render(<FamilyScreen navigate={navigate} />)
    const row = screen.getByText('Ada').closest('div')!
    expect(within(row.parentElement!).getByText(/years old/)).toBeTruthy()
    expect(screen.getByText(/plays on your device/)).toBeTruthy()
  })

  it('names the sign-in mode a learner actually has', async () => {
    testState.learners = [aLearner({ authKind: 'provisioned' })]
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText(/signs in with a code/)).toBeTruthy()
  })

  it('says so when a learner is shared rather than owned', async () => {
    // Somebody else's child: visible, not manageable.
    testState.learners = [aLearner({ id: 'l9', ownerId: 'someone-else' })]
    testState.active = null
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText(/shared with you/)).toBeTruthy()
    expect(screen.queryByText('Manage')).toBeNull()
  })

  it('marks who is playing, and offers to switch to anyone else', async () => {
    const other = aLearner({ id: 'l2', displayName: 'Ben' })
    testState.learners = [aLearner(), other]
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.getByText('Playing')).toBeTruthy()
    fireEvent.click(screen.getByText('Switch to'))
    const { select } = (await import('../../test/mockProviders')).spies
    expect(select).toHaveBeenCalledWith('l2')
  })

  it('leads the subtitle with what is outstanding', async () => {
    net.familyOverview.mockResolvedValue([
      overviewFor('l1', { openAssignments: 3, overdueAssignments: 1 }),
    ])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('3 tasks outstanding, 1 overdue.')).toBeTruthy()
  })

  it('says everyone is up to date when nothing is open', async () => {
    net.familyOverview.mockResolvedValue([overviewFor('l1')])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('Nothing outstanding. Everyone is up to date.')).toBeTruthy()
  })

  it('still works when the overview call fails', async () => {
    // Not knowing this week's minutes must never stop somebody adding a child.
    net.familyOverview.mockRejectedValue(new Error('offline'))
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText('offline')).toBeNull()
  })

  it('reports checked accuracy, never a self-graded figure', async () => {
    net.familyOverview.mockResolvedValue([
      overviewFor('l1', { verifiedAccuracyThisWeek: 82, itemsThisWeek: 40, minutesThisWeek: 25 }),
    ])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('82% checked')).toBeTruthy()
  })

  it('says nothing was checked rather than showing nought per cent', async () => {
    net.familyOverview.mockResolvedValue([overviewFor('l1')])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('nothing checked yet')).toBeTruthy()
  })

  it('describes when they last practised in words', async () => {
    net.familyOverview.mockResolvedValue([overviewFor('l1', { lastActiveAt: Date.now() })])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('practised today')).toBeTruthy()
  })

  it('says so when they have never practised', async () => {
    net.familyOverview.mockResolvedValue([overviewFor('l1')])
    render(<FamilyScreen navigate={navigate} />)
    expect(await screen.findByText('has not practised yet')).toBeTruthy()
  })

  it('switches to a child before opening their work', async () => {
    // Every suite screen shows the active learner, so looking at a child's
    // tasks means being on that child first.
    const other = aLearner({ id: 'l2', displayName: 'Ben' })
    testState.learners = [aLearner(), other]
    net.familyOverview.mockResolvedValue([overviewFor('l2', { openAssignments: 2 })])
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText(/✅ Tasks \(2\)/))
    const { select } = (await import('../../test/mockProviders')).spies
    expect(select).toHaveBeenCalledWith('l2')
    expect(navigate).toHaveBeenCalledWith({ name: 'tasks' })
  })
})

describe('managing one learner', () => {
  beforeEach(() => {
    signIn()
  })

  async function openManage() {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    await waitFor(() => expect(net.listGuardians).toHaveBeenCalledWith('l1'))
  }

  it('says who else can see them', async () => {
    net.listGuardians.mockResolvedValue([
      { guardianId: 'g1', displayName: 'A teacher', role: 'teacher', canManageContent: true },
    ])
    await openManage()
    expect(await screen.findByText('A teacher')).toBeTruthy()
  })

  it('says "just you" when nobody else can', async () => {
    await openManage()
    expect(await screen.findByText('Just you so far.')).toBeTruthy()
  })

  it('mints an invite and shows the code exactly once', async () => {
    await openManage()
    fireEvent.click(screen.getByText('➕ Invite another grown-up'))
    expect(await screen.findByText('INVITE99')).toBeTruthy()
    expect(screen.getByText(/works once, and expires in 24 hours/)).toBeTruthy()
  })

  it('can take another grown-up’s access away again', async () => {
    net.listGuardians.mockResolvedValue([
      { guardianId: 'g1', displayName: 'A teacher', role: 'teacher', canManageContent: true },
    ])
    await openManage()
    fireEvent.click(await screen.findByText('Remove'))
    await waitFor(() => expect(net.revokeGuardian).toHaveBeenCalledWith('l1', 'g1'))
  })

  it('can change whether a guardian may add decks', async () => {
    net.listGuardians.mockResolvedValue([
      { guardianId: 'g1', displayName: 'A teacher', role: 'teacher', canManageContent: true },
    ])
    await openManage()
    fireEvent.click(await screen.findByRole('checkbox'))
    await waitFor(() =>
      expect(net.setGuardianContentAccess).toHaveBeenCalledWith('l1', 'g1', false),
    )
  })

  it('surfaces a failure rather than leaving the panel looking fine', async () => {
    net.listGuardians.mockResolvedValue([
      { guardianId: 'g1', displayName: 'A teacher', role: 'teacher', canManageContent: true },
    ])
    net.revokeGuardian.mockRejectedValueOnce(new Error('Not yours to revoke'))
    await openManage()
    fireEvent.click(await screen.findByText('Remove'))
    expect(await screen.findByText('Not yours to revoke')).toBeTruthy()
  })
})

describe('a child’s own code-and-PIN sign-in', () => {
  beforeEach(() => {
    signIn()
  })

  it('will not set one until the PIN is long enough', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    const button = await screen.findByText('Set up their sign-in')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('4-digit PIN'), { target: { value: '12' } })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('4-digit PIN'), { target: { value: '1234' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps non-digits out of the PIN box', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    const input = (await screen.findByPlaceholderText('4-digit PIN')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12ab34' } })
    expect(input.value).toBe('1234')
  })

  it('shows the code once, and says it cannot be shown again', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    fireEvent.change(await screen.findByPlaceholderText('4-digit PIN'), {
      target: { value: '1234' },
    })
    fireEvent.click(screen.getByText('Set up their sign-in'))
    expect(await screen.findByText('KID12345')).toBeTruthy()
    expect(screen.getByText(/we cannot show it again/i)).toBeTruthy()
  })

  it('offers to turn it off once a learner has one', async () => {
    testState.learners = [aLearner({ authKind: 'provisioned' })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    fireEvent.click(await screen.findByText('Turn it off'))
    await waitFor(() => expect(net.removeChildLogin).toHaveBeenCalledWith('l1'))
  })

  it('calls it a reset rather than a set-up when they already have one', async () => {
    testState.learners = [aLearner({ authKind: 'provisioned' })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    expect(await screen.findByText('Reset their PIN')).toBeTruthy()
  })

  it('does not offer a PIN to a learner who signs in with their own account', async () => {
    testState.learners = [aLearner({ authKind: 'self' })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    expect(await screen.findByText(/uses their own account/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('4-digit PIN')).toBeNull()
  })
})

describe('linking a learner’s own Google account', () => {
  beforeEach(() => {
    signIn()
  })

  it('is offered only from the minimum age', async () => {
    const tooYoung = new Date().getFullYear() - 8
    testState.learners = [aLearner({ birthYear: tooYoung })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    expect(await screen.findByText(/Available from age/)).toBeTruthy()
    expect(screen.queryByText('Create a linking code')).toBeNull()
  })

  it('asks for a birth year before it can decide', async () => {
    testState.learners = [aLearner({ birthYear: null })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    expect(await screen.findByText(/Add their birth year first/)).toBeTruthy()
  })

  it('mints a linking code for a learner old enough', async () => {
    const oldEnough = new Date().getFullYear() - 15
    testState.learners = [aLearner({ birthYear: oldEnough })]
    testState.active = testState.learners[0]!
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Manage'))
    fireEvent.click(await screen.findByText('Create a linking code'))
    await waitFor(() =>
      expect(net.mintInvite).toHaveBeenCalledWith('l1', { purpose: 'self_login' }),
    )
    expect(await screen.findByText('INVITE99')).toBeTruthy()
  })
})

describe('adding a learner from the list', () => {
  beforeEach(() => {
    signIn()
  })

  it('stays closed until asked for', async () => {
    render(<FamilyScreen navigate={navigate} />)
    expect(screen.queryByPlaceholderText('Ada')).toBeNull()
    fireEvent.click(screen.getByText('➕ Add a learner'))
    expect(screen.getByPlaceholderText('Ada')).toBeTruthy()
  })

  it('will not add somebody with no name', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ Add a learner'))
    expect((screen.getByText('Add them') as HTMLButtonElement).disabled).toBe(true)
  })

  it('passes the name, avatar and birth year through', async () => {
    const { create } = (await import('../../test/mockProviders')).spies
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ Add a learner'))
    fireEvent.change(screen.getByPlaceholderText('Ada'), { target: { value: 'Ben' } })
    fireEvent.change(screen.getByLabelText(/Birth year/), { target: { value: '2015' } })
    fireEvent.click(screen.getByText('🐯'))
    fireEvent.click(screen.getByText('Add them'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect((create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]).toMatchObject({
      displayName: 'Ben',
      avatarEmoji: '🐯',
      birthYear: 2015,
    })
  })

  it('ignores a birth year that cannot be one', async () => {
    const { create } = (await import('../../test/mockProviders')).spies
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ Add a learner'))
    fireEvent.change(screen.getByPlaceholderText('Ada'), { target: { value: 'Ben' } })
    fireEvent.change(screen.getByLabelText(/Birth year/), { target: { value: '1066' } })
    fireEvent.click(screen.getByText('Add them'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect((create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]).toMatchObject({ birthYear: null })
  })

  it('can be closed again', async () => {
    render(<FamilyScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ Add a learner'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByPlaceholderText('Ada')).toBeNull()
  })
})

describe('joining a learner somebody else shared', () => {
  beforeEach(() => {
    signIn()
    net.describeCode.mockClear()
    net.redeemInvite.mockClear()
  })

  /**
   * One box now, for both kinds of code.
   *
   * There used to be two — "Have a code?" for an invite and a tutor-code box
   * below it — and a code put in the wrong one came back "not valid any more".
   * Nothing on an eight-character code says which system minted it, so the
   * server decides and this box follows.
   */
  function codeBox() {
    const card = screen.getByText('Have a code?').closest('div')!
    return {
      input: within(card).getByPlaceholderText('ABCD2345') as HTMLInputElement,
      check: within(card).getByText('Check code') as HTMLButtonElement,
      card,
    }
  }

  it('will not send a code too short to be one', async () => {
    render(<FamilyScreen navigate={navigate} />)
    const { input, check } = codeBox()
    expect(check.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'AB' } })
    expect(check.disabled).toBe(true)
  })

  it('uppercases what is typed, because a code is read off paper', async () => {
    render(<FamilyScreen navigate={navigate} />)
    const { input } = codeBox()
    fireEvent.change(input, { target: { value: 'abcd2345' } })
    expect(input.value).toBe('ABCD2345')
  })

  it('says whose learner it is before joining anything', async () => {
    // Typing eight characters and hoping is not consent, and that now holds
    // for an invite too, not only for a tutor's code.
    render(<FamilyScreen navigate={navigate} />)
    const { input, check } = codeBox()
    fireEvent.change(input, { target: { value: 'ABCD2345' } })
    fireEvent.click(check)
    expect(await screen.findByText(/A grown-up shared Bo with you/)).toBeTruthy()
    expect(net.redeemInvite).not.toHaveBeenCalled()
  })

  it('confirms when the learner has been added', async () => {
    const { refreshLearners } = (await import('../../test/mockProviders')).spies
    render(<FamilyScreen navigate={navigate} />)
    const { input, check } = codeBox()
    fireEvent.change(input, { target: { value: 'ABCD2345' } })
    fireEvent.click(check)
    fireEvent.click(await screen.findByText('Join'))
    await waitFor(() => expect(net.redeemInvite).toHaveBeenCalledWith('ABCD2345'))
    expect(await screen.findByText(/You can see their progress now/)).toBeTruthy()
    expect(refreshLearners).toHaveBeenCalled()
  })

  it('says what was wrong with a code that did not work', async () => {
    net.describeCode.mockResolvedValueOnce({
      kind: 'invite',
      valid: false,
      reason: 'That code has expired',
      ownerName: null,
      label: null,
      role: null,
      canManageContent: null,
    } as never)
    render(<FamilyScreen navigate={navigate} />)
    const { input, check } = codeBox()
    fireEvent.change(input, { target: { value: 'ABCD2345' } })
    fireEvent.click(check)
    expect(await screen.findByText('That code has expired')).toBeTruthy()
    expect(net.redeemInvite).not.toHaveBeenCalled()
  })

  it('takes a tutor code in the same box and grants instead of joining', async () => {
    net.describeCode.mockResolvedValueOnce({
      kind: 'connection',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: 'Tuesday maths',
      role: 'tutor',
      canManageContent: true,
    } as never)
    render(<FamilyScreen navigate={navigate} />)
    const { input, check } = codeBox()
    fireEvent.change(input, { target: { value: 'TUT12345' } })
    fireEvent.click(check)
    expect(await screen.findByText(/Mrs Patel — Tuesday maths/)).toBeTruthy()
    expect(net.redeemInvite).not.toHaveBeenCalled()
  })
})
