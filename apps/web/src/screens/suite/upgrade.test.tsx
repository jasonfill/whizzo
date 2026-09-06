// What it costs, and who is being asked to pay it.
//
// This screen replaced a plan picker that read `profiles.plan` — a flag the
// feature gates had already stopped using — and quoted a flat $4 tier that was
// not the price in the spec. Both failures were invisible: the page rendered
// fine and said the wrong thing. So what is pinned here is the arithmetic, and
// the one rule underneath the whole billing model: coverage is bought for a
// child, and the person who benefits is not always the person who pays.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () => (await import('../../test/mockProviders')).authMock())
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)

const billing = vi.hoisted(() => ({
  startCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe/x' })),
  changeCoverage: vi.fn(async () => ({ covered: 2, cancelled: false })),
  billingPortal: vi.fn(async () => ({ url: 'https://billing.stripe/x' })),
  isUnconfigured: vi.fn(() => false),
}))
vi.mock('../../lib/billing/api', () => billing)

import { aLearner, resetTestState, signIn, testState } from '../../test/state'
import UpgradeScreen from './UpgradeScreen'

const navigate = vi.fn()

/** Where the browser was sent. Assigning to window.location is not testable. */
const assign = vi.fn()

beforeEach(() => {
  resetTestState()
  navigate.mockClear()
  assign.mockClear()
  billing.startCheckout.mockClear().mockResolvedValue({ url: 'https://checkout.stripe/x' })
  billing.changeCoverage.mockClear().mockResolvedValue({ covered: 2, cancelled: false })
  billing.isUnconfigured.mockReturnValue(false)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, pathname: '/upgrade' },
  })
  signIn()
})

/** Sign in with a household of this shape. */
function household(...covered: boolean[]) {
  const learners = covered.map((c, i) =>
    aLearner({
      id: `l${i}`,
      displayName: ['Ada', 'Ben', 'Cleo'][i] ?? `Kid ${i}`,
      covered: c,
    }),
  )
  signIn(learners[0]!)
  testState.learners = learners
}

describe('the price', () => {
  it('is $4 for one child', () => {
    household(false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('$4 a month')).toBeInTheDocument()
  })

  it('is $8 for three, which is the marketed sum', () => {
    household(false, false, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('$8 a month')).toBeInTheDocument()
  })

  it('shows the working when there is more than one child', () => {
    household(false, false, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/\$4 for the first, \$2 each for 2 more/)).toBeInTheDocument()
  })

  it('counts children already covered towards the total', () => {
    // Adding a second child costs $2, not another $4. A parent who cannot see
    // that from the screen has to take it on trust.
    household(true, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('$6 a month')).toBeInTheDocument()
    expect(screen.getByText(/\$2 more a month than you pay now/)).toBeInTheDocument()
  })

  it('offers nothing when nobody is selected', () => {
    household(false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByLabelText('Cover them'))
    expect(screen.getByText('Nothing to pay yet')).toBeInTheDocument()
  })
})

describe('who is on the screen', () => {
  it('lists the children, because that is what is being bought', () => {
    household(true, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
  })

  it('marks a covered child as covered rather than offering to sell them again', () => {
    household(true, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('Covered')).toBeInTheDocument()
    // One checkbox, for the one child who does not have coverage.
    expect(screen.getAllByLabelText('Cover them')).toHaveLength(1)
  })

  it('starts with everybody uncovered selected', () => {
    // Somebody who opened this screen came to pay for their children. Making
    // them tick each one before a price appears is a toll booth in front of
    // the price.
    household(false, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('$6 a month')).toBeInTheDocument()
  })

  it('sends a grown-up with no children to add one first', () => {
    testState.learners = []
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Add a child'))
    expect(navigate).toHaveBeenCalledWith({ name: 'family' })
  })
})

// Both of the bugs below shipped green: the first because the test double
// hands over its learners synchronously and the real provider fetches them,
// the second because every learner in the fixtures happened to be owned by the
// person looking. Neither is exotic — the first is every real page load, and
// the second is every tutor.
describe('children who arrive after the first render', () => {
  it('are selected, because nobody unselected them', () => {
    // The real provider starts at `[]` and fills in from a fetch. Seeding
    // selection state from `learners` therefore seeds it from nothing, and
    // every box renders unticked over a price of "Nothing to pay yet" — the
    // exact toll booth the screen is written to avoid.
    testState.learners = []
    const { rerender } = render(<UpgradeScreen navigate={navigate} />)
    household(false, false)
    rerender(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText('$6 a month')).toBeInTheDocument()
    for (const box of screen.getAllByLabelText('Cover them')) {
      expect((box as HTMLInputElement).checked).toBe(true)
    }
  })

  it('can still be unticked once they are there', () => {
    testState.learners = []
    const { rerender } = render(<UpgradeScreen navigate={navigate} />)
    household(false, false)
    rerender(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByLabelText('Cover them')[0]!)
    expect(screen.getByText('$4 a month')).toBeInTheDocument()
  })
})

describe('a tutor, who is never the one paying', () => {
  /** Signed in as u1, looking at a covered child that belongs to someone else. */
  function guardingSomebodyElses() {
    signIn(aLearner({ id: 'theirs', displayName: 'Ben', ownerId: 'another-parent', covered: true }))
    testState.learners = [
      aLearner({ id: 'theirs', displayName: 'Ben', ownerId: 'another-parent', covered: true }),
    ]
  }

  it('is not billed for a child somebody else covers', () => {
    // `learners` is everyone the session can *see*, guarded children included.
    // Without an ownership test this screen offers a tutor a bill for a child
    // whose parent is already paying.
    guardingSomebodyElses()
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.queryByText('$4 a month')).not.toBeInTheDocument()
    expect(screen.queryByText('Ben')).not.toBeInTheDocument()
  })

  it('is told why there is nothing here for them', () => {
    guardingSomebodyElses()
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/covered by whoever added them/)).toBeInTheDocument()
  })
})

describe('what the button admits', () => {
  it('says who handles the card, and that it can be stopped', () => {
    // This used to admit no processor was connected. Now that one is, the
    // thing a parent wants to know before typing a card number is who is
    // holding it and how they get out.
    household(false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/handled by Stripe/)).toBeInTheDocument()
    expect(screen.getByText(/Cancel whenever you like/)).toBeInTheDocument()
  })

  it('promises a part-month is prorated once somebody is already covered', () => {
    household(true, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/You pay the difference, not a fresh month/)).toBeInTheDocument()
  })

  it('has nothing to do when everyone is already covered', () => {
    household(true, true)
    render(<UpgradeScreen navigate={navigate} />)
    const button = screen.getByText('Everyone is covered') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('names the price it would charge', () => {
    household(false, false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/Cover 2 children — \$6 a month/)).toBeInTheDocument()
  })
})

describe('the promise the page makes', () => {
  it('never puts learning behind the price', () => {
    household(false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/Why is the curriculum free\?/)).toBeInTheDocument()
    expect(screen.getByText(/so does setting work/)).toBeInTheDocument()
  })

  it('says coverage follows the child, not the payer', () => {
    // The billing model in one sentence, and the reason a teacher is never
    // asked for money.
    household(false)
    render(<UpgradeScreen navigate={navigate} />)
    expect(screen.getByText(/Coverage belongs to the child/)).toBeInTheDocument()
  })

  it('offers a signed-out visitor an account before a charge', () => {
    testState.authStatus = 'signed-out'
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Create a free account'))
    expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
  })
})

// Paying, for real this time. The button used to be disabled with a note
// admitting no processor was connected; what matters now is that the two paths
// through it stay apart — a family with no subscription needs a card form, and
// one that already pays must never be sent through checkout again, because
// that gives them a second subscription and two charges a month.
describe('actually paying', () => {
  it('sends a new customer to Stripe with the children they chose', async () => {
    household(false, false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/Cover 2 children/))
    await waitFor(() => expect(billing.startCheckout).toHaveBeenCalledWith(['l0', 'l1']))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe/x'))
  })

  it('sends only the children still ticked', async () => {
    household(false, false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByLabelText('Cover them')[0]!)
    fireEvent.click(screen.getByText(/Cover them —/))
    await waitFor(() => expect(billing.startCheckout).toHaveBeenCalledWith(['l1']))
  })

  it('changes an existing subscription rather than opening a second one', async () => {
    // The bug this prevents: a family who already pays going through checkout
    // again and ending up with two subscriptions and two charges a month.
    household(true, false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/Cover them —/))
    await waitFor(() => expect(billing.changeCoverage).toHaveBeenCalledWith({ add: ['l1'] }))
    expect(billing.startCheckout).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('says nothing was charged when it fails', async () => {
    // The first thing a parent needs to know after a failed payment.
    household(false)
    billing.startCheckout.mockRejectedValueOnce(new Error('network'))
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/Cover them —/))
    expect(await screen.findByText(/Nothing has been charged/)).toBeInTheDocument()
  })

  it('does not blame the parent for a build with no Stripe in it', async () => {
    household(false)
    billing.startCheckout.mockRejectedValueOnce(new Error('nope'))
    billing.isUnconfigured.mockReturnValue(true)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/Cover them —/))
    expect(await screen.findByText(/Payments are not switched on yet/)).toBeInTheDocument()
  })
})

describe('stopping', () => {
  it('takes one child off without touching the others', async () => {
    // Without this the only way to stop paying for one child of three is to
    // cancel the subscription covering all three.
    household(true, true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByText('Stop covering')[0]!)
    await waitFor(() => expect(billing.changeCoverage).toHaveBeenCalledWith({ remove: ['l0'] }))
  })

  it('asks first, and does nothing when the answer is no', async () => {
    household(true, true)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByText('Stop covering')[0]!)
    expect(billing.changeCoverage).not.toHaveBeenCalled()
  })

  it('warns that the last one ends the subscription', async () => {
    household(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Stop covering'))
    expect(confirm.mock.calls[0]![0]).toMatch(/ends the subscription/)
  })

  it('promises nothing is deleted, because nothing is', async () => {
    household(true, true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<UpgradeScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByText('Stop covering')[0]!)
    expect(confirm.mock.calls[0]![0]).toMatch(/nothing they have made is deleted/)
  })
})
