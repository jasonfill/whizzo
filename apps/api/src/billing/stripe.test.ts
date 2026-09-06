// The arithmetic Stripe is asked to charge.
//
// The one thing this file exists to prevent: the pricing page and the invoice
// disagreeing. Every case here checks the line items against
// `monthlyPriceCents`, which is the same function the page renders from, so a
// price changed in one place fails here rather than on somebody's card.

import { describe, expect, it } from 'vitest'
import { monthlyPriceCents } from '@whizzo/shared'
import {
  PRICES,
  itemUpdates,
  learnersOnSubscription,
  lineItems,
  periodEnd,
  pricesConfigured,
  statusFrom,
} from './stripe.js'

const PRICE = { first: 'price_first', extra: 'price_extra' }

/** What the line items would actually cost, in cents. */
function charged(items: Array<{ price: string; quantity: number }>): number {
  return items.reduce(
    (n, i) =>
      n + i.quantity * (i.price === PRICE.first ? PRICES.firstCents : PRICES.extraCents),
    0,
  )
}

describe('what a subscription is billed', () => {
  it('matches the price on the page, for every household size', () => {
    // The whole point. If these ever diverge the product is charging something
    // other than what it advertised.
    for (let n = 1; n <= 8; n++) {
      expect(charged(lineItems(n, PRICE))).toBe(monthlyPriceCents(n))
    }
  })

  it('is $4 for one child and $8 for three', () => {
    expect(charged(lineItems(1, PRICE))).toBe(400)
    expect(charged(lineItems(3, PRICE))).toBe(800)
  })

  it('gives a one-child family no second line rather than a line of zero', () => {
    // Stripe accepts a quantity of zero, and an invoice with a $0 line on it
    // invites the question of what it is.
    expect(lineItems(1, PRICE)).toEqual([{ price: PRICE.first, quantity: 1 }])
  })

  it('bills nobody for nobody', () => {
    expect(lineItems(0, PRICE)).toEqual([])
    expect(lineItems(-2, PRICE)).toEqual([])
  })
})

/** A subscription as Stripe returns it, with the line items given. */
function subscription(...items: Array<{ id: string; price: string; quantity: number }>) {
  return {
    items: { data: items.map((i) => ({ id: i.id, price: { id: i.price }, quantity: i.quantity })) },
  } as never
}

describe('changing a subscription that already exists', () => {
  it('adds a line for the second child', () => {
    const current = subscription({ id: 'si_1', price: PRICE.first, quantity: 1 })
    expect(itemUpdates(current, 2, PRICE)).toEqual([
      { id: 'si_1', quantity: 1 },
      { price: PRICE.extra, quantity: 1 },
    ])
  })

  it('raises the quantity on a line that is already there', () => {
    const current = subscription(
      { id: 'si_1', price: PRICE.first, quantity: 1 },
      { id: 'si_2', price: PRICE.extra, quantity: 1 },
    )
    expect(itemUpdates(current, 4, PRICE)).toEqual([
      { id: 'si_1', quantity: 1 },
      { id: 'si_2', quantity: 3 },
    ])
  })

  it('deletes the extra line when a family goes back to one child', () => {
    // The mistake this catches: sending only the items you want and expecting
    // the rest to vanish. Stripe leaves them, and the family keeps paying for
    // a child who is no longer covered.
    const current = subscription(
      { id: 'si_1', price: PRICE.first, quantity: 1 },
      { id: 'si_2', price: PRICE.extra, quantity: 2 },
    )
    expect(itemUpdates(current, 1, PRICE)).toEqual([
      { id: 'si_1', quantity: 1 },
      { id: 'si_2', deleted: true },
    ])
  })

  it('removes a price that is no longer part of the plan at all', () => {
    const current = subscription({ id: 'si_old', price: 'price_retired', quantity: 1 })
    const updates = itemUpdates(current, 1, PRICE)
    expect(updates).toContainEqual({ id: 'si_old', deleted: true })
    expect(updates).toContainEqual({ price: PRICE.first, quantity: 1 })
  })

  it('reads back how many children a subscription covers', () => {
    const current = subscription(
      { id: 'si_1', price: PRICE.first, quantity: 1 },
      { id: 'si_2', price: PRICE.extra, quantity: 2 },
    )
    expect(learnersOnSubscription(current, PRICE)).toBe(3)
  })
})

describe('Stripe status, mapped to ours', () => {
  it('keeps a failed card covered', () => {
    // A failed card is a payment problem, not a reason to take a child's
    // progress report away mid-week.
    expect(statusFrom('past_due')).toBe('past_due')
    expect(statusFrom('unpaid')).toBe('past_due')
  })

  it('counts a trial as active, because a trial that gives you nothing is not one', () => {
    expect(statusFrom('trialing')).toBe('active')
  })

  it('does not cover a subscription nobody has paid for yet', () => {
    expect(statusFrom('incomplete')).toBe('cancelled')
    expect(statusFrom('incomplete_expired')).toBe('cancelled')
  })

  it('ends coverage when it is actually cancelled', () => {
    expect(statusFrom('canceled')).toBe('cancelled')
  })

  it('takes nothing away for a status it has never heard of', () => {
    // Stripe adds statuses. Treating an unknown as cancelled would silently
    // strip a paying family.
    expect(statusFrom('something_new' as never)).toBe('past_due')
  })
})

describe('the renewal date', () => {
  it('converts Stripe seconds to a timestamp', () => {
    expect(periodEnd(1_780_000_000)).toBe(new Date(1_780_000_000_000).toISOString())
  })

  it('has no date rather than the epoch when Stripe sent none', () => {
    expect(periodEnd(null)).toBeNull()
    expect(periodEnd(undefined)).toBeNull()
    expect(periodEnd(0)).toBeNull()
  })
})

describe('configuration that would charge the wrong amount', () => {
  it('refuses two prices that are the same one', () => {
    // Both ids pointing at the same price produces a *working* checkout that
    // bills every child at the first-child rate.
    expect(pricesConfigured('price_a', 'price_a')).toBe(false)
  })

  it('refuses a half-configured pair', () => {
    expect(pricesConfigured('price_a', undefined)).toBe(false)
    expect(pricesConfigured(undefined, 'price_b')).toBe(false)
    expect(pricesConfigured('', '')).toBe(false)
  })

  it('accepts two distinct prices', () => {
    expect(pricesConfigured('price_a', 'price_b')).toBe(true)
  })
})
