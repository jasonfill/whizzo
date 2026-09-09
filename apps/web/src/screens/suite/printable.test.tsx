// The weekly sheet, and the retention card behind it.
//
// Both of these were on the pricing page for months with nothing behind them,
// so the first thing worth pinning is that they exist. After that: a report
// about the future is easy to make confident and wrong, so what is tested is
// where it declines to answer — a learner nobody has measured, a week with no
// rounds in it — and that the paywall opens a door rather than hiding one.

import { fireEvent, render, screen } from '@testing-library/react'
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

import { aLearner, resetTestState, signIn, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import PrintableReport from './PrintableReport'

const navigate = vi.fn()

beforeEach(() => {
  resetTestState()
  navigate.mockClear()
  signIn(aLearner({ displayName: 'Ada', covered: true }))
})

/** One mastery record, with only the fields retention actually reads. */
function item(over: Record<string, unknown> = {}) {
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
    intervalDays: 30,
    dueOn: '2099-01-01',
    firstSeenAt: 0,
    lastSeenAt: 0,
    ...over,
  }
}

function withMastery(...items: Array<Record<string, unknown>>) {
  testState.snapshot = {
    ...emptySnapshot(),
    mastery: Object.fromEntries(items.map((m, i) => [`spelling:i${i}`, { ...m, itemKey: `w${i}` }])),
  } as never
}

describe('the sheet exists at all', () => {
  it('names the learner it is about', () => {
    withMastery(item())
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/Ada — weekly progress/)).toBeInTheDocument()
  })

  it('offers to print itself', () => {
    withMastery(item())
    const print = vi.fn()
    Object.assign(window, { print })
    render(<PrintableReport navigate={navigate} />)
    fireEvent.click(screen.getByText(/Print this sheet/))
    expect(print).toHaveBeenCalled()
  })

  it('says what every number on it is counting', () => {
    // The sheet leaves the house. Somebody reading it who was not there needs
    // to know a self-graded round did not go into these figures.
    withMastery(item())
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/only answers the app checked/)).toBeInTheDocument()
  })
})

describe('what it will not claim', () => {
  it('declines to score a learner nobody has measured', () => {
    // "0% retained" would be a verdict on a child who has answered nothing.
    withMastery(item({ totalAttempts: 0 }))
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/Nothing has been tested often enough/)).toBeInTheDocument()
  })

  it('says a quiet week was quiet rather than reporting nothing', () => {
    withMastery(item())
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/No rounds in the last seven days/)).toBeInTheDocument()
  })

  it('scores retention once there is something to score', () => {
    withMastery(item({ intervalDays: 30, dueOn: '2099-01-01' }))
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/are on schedule or better/)).toBeInTheDocument()
  })
})

describe('what is slipping', () => {
  it('is named on the sheet, in words rather than color', () => {
    // Printed in one ink: a band that reads as a color on screen has to read
    // as a word on paper.
    withMastery(
      item({ itemKey: 'gone', intervalDays: 2, dueOn: '2020-01-01', lapses: 3, reps: 4 }),
    )
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText('Slipping')).toBeInTheDocument()
  })
})

describe('the paywall', () => {
  it('shows an uncovered learner what the sheet would be', () => {
    // A locked door you can see beats a feature nobody knows exists.
    signIn(aLearner({ displayName: 'Ada', covered: false }))
    withMastery(item())
    render(<PrintableReport navigate={navigate} />)
    expect(screen.getByText(/A sheet to take away/)).toBeInTheDocument()
    expect(screen.getByText(/Covering Ada turns it on/)).toBeInTheDocument()
  })

  it('leads to the place that explains the price', () => {
    signIn(aLearner({ displayName: 'Ada', covered: false }))
    render(<PrintableReport navigate={navigate} />)
    fireEvent.click(screen.getByText(/See what covering adds/))
    expect(navigate).toHaveBeenCalledWith({ name: 'upgrade' })
  })

  it('does not print a sheet the account has not paid for', () => {
    signIn(aLearner({ displayName: 'Ada', covered: false }))
    withMastery(item())
    render(<PrintableReport navigate={navigate} />)
    expect(screen.queryByText(/Print this sheet/)).toBeNull()
    expect(screen.queryByText(/weekly progress/)).toBeNull()
  })
})
