// The signed-out site.
//
// Three rules hold this surface together, and they are what these tests exist
// to keep true as the copy changes underneath them.
//
// **Nothing leads into an activity.** A visitor has no learner, and practice
// that is not attributed to a learner moves no level and lands on no report.
//
// **A button is a door; a link is a page.** Every `<button>` on the site goes
// to the way in — the one exception being the control that opens the menu
// containing those doors. Every move between marketing pages is a real
// `<a href>`, so it can be opened in a tab and followed by a crawler.
//
// **Nothing is restated that can be quoted.** Prices come from the billing
// module the charge is built from, and the activity table comes from the app's
// own registries, so neither can say something the product does not do.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)
// Privacy and the FAQ are reachable signed in as well as out, so they ask who
// is reading in order to drop the funnel links for somebody who already has an
// account. The rest of the site is signed-out-only and never asks.
vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)

import { MODES } from '../../lib/quiz/session'
import { ACTIVITIES } from '../../lib/spelling/activities'
import { FREE_PERKS, money } from '../../lib/plans'
import { PRICE_EXTRA_LEARNER_CENTS, PRICE_FIRST_LEARNER_CENTS, monthlyPriceCents } from '@whizzo/shared'
import { AUDIENCES, AUDIENCE_ORDER } from './audiences'
import AudienceScreen from './AudienceScreen'
import FaqScreen from './FaqScreen'
import FeaturesScreen from './FeaturesScreen'
import HowItWorksScreen from './HowItWorksScreen'
import MarketingScreen from './MarketingScreen'
import PricingScreen from './PricingScreen'
import PrivacyScreen from './PrivacyScreen'

const navigate = vi.fn()

beforeEach(() => {
  navigate.mockClear()
})

/** A literal string as a regex — prices start with `$`, which is an anchor. */
function rx(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/** Every button that is not the control opening the menu of buttons. */
function doors(): HTMLButtonElement[] {
  return screen
    .getAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-expanded')) as HTMLButtonElement[]
}

describe('the front page', () => {
  it('says what the thing is before it asks for anything', () => {
    render(<MarketingScreen navigate={navigate} />)
    expect(screen.getByText('Practice that knows what your child can actually do.')).toBeTruthy()
    expect(screen.getByText(/Only unaided work counts/)).toBeTruthy()
  })

  it('offers every audience a page of their own', () => {
    render(<MarketingScreen navigate={navigate} />)
    for (const id of AUDIENCE_ORDER) {
      const links = screen.getAllByRole('link', { name: new RegExp(AUDIENCES[id].nav, 'i') })
      expect(links.some((link) => link.getAttribute('href') === `/for/${id}`)).toBe(true)
    }
  })

  it('quotes the real price rather than restating one of its own', () => {
    render(<MarketingScreen navigate={navigate} />)
    // The price a visitor reads has to be the price the charge would be, so the
    // page is checked against the constant the charge is built from.
    expect(screen.getAllByText(rx(`${money(PRICE_FIRST_LEARNER_CENTS)} a month`)).length)
      .toBeGreaterThan(0)
    expect(screen.getByText(rx(`${money(monthlyPriceCents(3))} for three`))).toBeTruthy()
    // Nothing here can take money yet, and the page must not imply otherwise.
    expect(screen.getByText(/Payments are not switched on yet/)).toBeTruthy()
  })

  it('sells coverage of a child, not a tier', () => {
    render(<MarketingScreen navigate={navigate} />)
    expect(screen.getByText(/You pay for a child, not for an account/)).toBeTruthy()
  })

  it('leads every button to the same place: the way in', () => {
    render(<MarketingScreen navigate={navigate} />)
    const buttons = doors()
    expect(buttons.length).toBeGreaterThan(3)
    for (const door of buttons) {
      navigate.mockClear()
      fireEvent.click(door)
      if (door.disabled) continue
      expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
    }
  })

  it('moves between pages with real links, not with buttons', () => {
    render(<MarketingScreen navigate={navigate} />)
    for (const link of screen.getAllByRole('link')) {
      // An href a browser can act on: openable in a tab, hoverable, crawlable.
      expect(link.getAttribute('href')).toMatch(/^\//)
    }
  })

  it('still navigates in-app when a link is followed normally', () => {
    render(<MarketingScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByRole('link', { name: /Pricing/i })[0]!)
    expect(navigate).toHaveBeenCalledWith({ name: 'pricing' })
  })

  it('leaves a cmd-click to the browser', () => {
    // Swallowing "open in a new tab" on a marketing site is the small rudeness
    // that makes a page feel like an app pretending to be a page.
    render(<MarketingScreen navigate={navigate} />)
    fireEvent.click(screen.getAllByRole('link', { name: /Pricing/i })[0]!, { metaKey: true })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('opens the whole menu on a small screen', () => {
    render(<MarketingScreen navigate={navigate} />)
    const toggle = screen.getByRole('button', { name: 'Menu' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeTruthy()
    fireEvent.click(toggle)
    const menu = document.getElementById('marketing-menu')!
    expect(within(menu).getByRole('link', { name: 'For teachers' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Create a free account' })).toBeTruthy()
  })
})

describe('the audience pages', () => {
  for (const id of AUDIENCE_ORDER) {
    it(`answers the question ${id} arrive with`, () => {
      render(<AudienceScreen who={id} navigate={navigate} />)
      const audience = AUDIENCES[id]
      expect(screen.getByRole('heading', { level: 1, name: audience.title })).toBeTruthy()
      expect(screen.getByText(audience.money.title)).toBeTruthy()
      expect(screen.getByText(audience.gets[0]!)).toBeTruthy()
    })

    it(`sends ${id} on to the other three`, () => {
      render(<AudienceScreen who={id} navigate={navigate} />)
      const elsewhere = screen.getByRole('navigation', { name: 'Other audiences' })
      const links = within(elsewhere)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
      // Its own page is never offered as somewhere else to go.
      for (const other of AUDIENCE_ORDER) {
        expect(links.includes(`/for/${other}`)).toBe(other !== id)
      }
    })
  }

  it('tells a teacher they never pay, on the page a teacher reads', () => {
    render(<AudienceScreen who="teachers" navigate={navigate} />)
    expect(screen.getByText(/You never pay\. Not for a class, not for a seat, not ever/)).toBeTruthy()
  })

  it('tells a tutor the same thing', () => {
    render(<AudienceScreen who="tutors" navigate={navigate} />)
    expect(screen.getByText(/You never pay\. The family covers their own child/)).toBeTruthy()
  })
})

describe('the features page', () => {
  it('lists every activity the app actually has', () => {
    render(<FeaturesScreen navigate={navigate} />)
    for (const activity of ACTIVITIES) {
      expect(screen.getAllByText(rx(activity.name)).length).toBeGreaterThan(0)
    }
    for (const mode of MODES) {
      expect(screen.getAllByText(rx(mode.name)).length).toBeGreaterThan(0)
    }
  })

  it('says which activities move the level, from the registry rather than by hand', () => {
    render(<FeaturesScreen navigate={navigate} />)
    const rows = screen.getAllByRole('row')
    for (const activity of ACTIVITIES) {
      const row = rows.find((r) => r.textContent?.includes(activity.name))!
      expect(row.textContent).toContain(activity.isTest ? 'Yes' : 'No')
    }
    // Flashcards are self-graded by construction, so they can never count.
    const flashcards = rows.find((r) => r.textContent?.includes('Flashcards'))!
    expect(flashcards.textContent).toContain('self-graded')
  })

  it('quotes what is free from the same list the app gates on', () => {
    render(<FeaturesScreen navigate={navigate} />)
    expect(screen.getByText(FREE_PERKS[0]!)).toBeTruthy()
  })
})

describe('the pricing page', () => {
  it('does the arithmetic for a family rather than making them do it', () => {
    render(<PricingScreen navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByText(`${money(monthlyPriceCents(3))} a month`)).toBeTruthy()
    // And shows where the total came from, which is the difference between a
    // price somebody trusts and a price they email about.
    expect(
      screen.getByText(
        `${money(PRICE_FIRST_LEARNER_CENTS)} for the first, ${money(
          PRICE_EXTRA_LEARNER_CENTS,
        )} each for 2 more`,
      ),
    ).toBeTruthy()
  })

  it('never prices zero children', () => {
    render(<PricingScreen navigate={navigate} />)
    expect(screen.getByText('$4 a month')).toBeTruthy()
    expect(screen.queryByText('$0 a month')).toBeNull()
  })

  it('cannot take money, and says so', () => {
    render(<PricingScreen navigate={navigate} />)
    expect(screen.getByRole('button', { name: 'Coming soon' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText(/Payments are not switched on yet/).length).toBeGreaterThan(0)
  })

  it('answers who pays before anyone has to ask', () => {
    render(<PricingScreen navigate={navigate} />)
    const teacher = screen.getAllByRole('row').find((r) => r.textContent?.includes('A teacher'))!
    expect(teacher.textContent).toContain('Never, for anybody')
  })
})

describe('the rest of the site', () => {
  it('publishes the mechanism rather than the adjective', () => {
    render(<HowItWorksScreen navigate={navigate} />)
    expect(screen.getByText(/P\(correct\)/)).toBeTruthy()
    expect(screen.getByText('1 → 2 → 4 → 8 → 16 → 32 → 60')).toBeTruthy()
  })

  it('states the limit it cannot get past', () => {
    // A page that claimed a guarantee here would be worth less than one that
    // does not: the server checks how an answer was given, not whether it was
    // right.
    render(<HowItWorksScreen navigate={navigate} />)
    expect(screen.getByRole('heading', { name: 'What this cannot do' })).toBeTruthy()
  })

  it('says what is stored and what is deliberately not', () => {
    render(<PrivacyScreen navigate={navigate} />)
    expect(screen.getByText('Not stored, and not wanted')).toBeTruthy()
    expect(screen.getByText(/A full date of birth/)).toBeTruthy()
  })

  it('owns up to the birth year, which the app really does keep', () => {
    // This page listed a date of birth as "not stored, and not wanted" while
    // `learners.birth_year` was a column, the family screen had an input for
    // it, and the signup age gate wrote it. A privacy page a reader can
    // disprove from inside the app is worse than no privacy page.
    render(<PrivacyScreen navigate={navigate} />)
    expect(screen.getByText(/A birth year, where one was given/)).toBeTruthy()
  })

  it('gathers every audience’s questions rather than writing a fifth set', () => {
    render(<FaqScreen navigate={navigate} />)
    for (const id of AUDIENCE_ORDER) {
      expect(screen.getByText(AUDIENCES[id].faq[0]!.q)).toBeTruthy()
    }
  })

  it('offers the way in from the bottom of every page', () => {
    for (const Screen of [FeaturesScreen, PricingScreen, HowItWorksScreen, PrivacyScreen, FaqScreen]) {
      const view = render(<Screen navigate={navigate} />)
      navigate.mockClear()
      fireEvent.click(view.getAllByRole('button', { name: 'Create a free account' }).at(-1)!)
      expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
      view.unmount()
    }
  })
})
