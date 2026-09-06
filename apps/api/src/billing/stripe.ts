// Talking to Stripe.
//
// The client is injected everywhere, for the same reason it is in
// `content/model.ts`: the paths worth testing here are the ones that only
// happen when something goes wrong — a webhook delivered twice, a subscription
// whose quantity has drifted from the number of children on it, a card that
// failed three weeks after it worked. None of those are reachable against a
// real Stripe account in a test run, and all of them are reachable against a
// fake.
//
// What this file knows: how to price N children, how to open a checkout, and
// how to change the quantity on a subscription that already exists. What it
// deliberately does not know: who is allowed to do any of that. Authorisation
// lives in the routes, next to the caller.

import Stripe from 'stripe'
import { PRICE_EXTRA_LEARNER_CENTS, PRICE_FIRST_LEARNER_CENTS } from '@whizzo/shared'

/**
 * The subset of Stripe we use, named so a fake can implement it.
 *
 * Typed structurally rather than as `Stripe` itself: the real client's surface
 * is enormous, and a test double implementing all of it would be a test of the
 * double.
 */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>
    }
  }
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>
    cancel(id: string): Promise<Stripe.Subscription>
  }
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session>
    }
  }
  webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): Stripe.Event
  }
}

let cached: Stripe | null = null

/**
 * The real client, made once.
 *
 * `apiVersion` is pinned rather than left to float. An SDK upgrade that also
 * moves the API version silently changes the shape of every webhook payload,
 * and the failure arrives as a runtime undefined in a handler that is only
 * reached in production.
 */
export function stripeClient(secretKey: string): Stripe {
  if (!cached) {
    cached = new Stripe(secretKey, {
      apiVersion: '2026-08-26.dahlia',
      // Retries on our side, because the alternative is a parent seeing a
      // failure for a blip that would have cleared.
      maxNetworkRetries: 2,
      timeout: 20_000,
    })
  }
  return cached
}

/** Only for tests, which need a clean client per case. */
export function resetStripeClient(): void {
  cached = null
}

/**
 * What covering this many children costs, in cents, for a month.
 *
 * Re-exported through here rather than imported from `@whizzo/shared` at every
 * call site so there is one obvious place to look when somebody asks "where
 * does the number Stripe charges come from?". The answer has to be the same
 * constant the pricing page renders, or the page is lying.
 */
export { monthlyPriceCents } from '@whizzo/shared'

/**
 * The line items for a subscription covering `learners` children.
 *
 * Two items rather than one tiered price, and the reason is operational: a
 * graduated tier is configured in the Stripe dashboard, which means the price a
 * customer is charged lives somewhere this repository cannot see, review or
 * test. Two flat prices with explicit quantities keep the arithmetic here,
 * where `monthlyPriceCents` can be asserted against it.
 *
 * The first learner is quantity 1 of the base price; the rest are quantity
 * N-1 of the extra price. A subscription for one child has no second line at
 * all rather than a line of quantity zero — Stripe accepts zero, and an
 * invoice with a $0 line on it invites the question of what it is.
 */
export function lineItems(
  learners: number,
  prices: { first: string; extra: string },
): Array<{ price: string; quantity: number }> {
  if (learners <= 0) return []
  const items = [{ price: prices.first, quantity: 1 }]
  if (learners > 1) items.push({ price: prices.extra, quantity: learners - 1 })
  return items
}

/**
 * What the line items *should* be for a subscription that already exists.
 *
 * Returned as an update payload keyed by existing item id, because Stripe wants
 * the item's own id to change its quantity, and wants a `deleted: true` to
 * remove one. Getting this wrong in the obvious way — sending only the items
 * you want and expecting the rest to vanish — leaves the old lines in place and
 * bills for both.
 */
export function itemUpdates(
  subscription: Pick<Stripe.Subscription, 'items'>,
  learners: number,
  prices: { first: string; extra: string },
): Stripe.SubscriptionUpdateParams.Item[] {
  const want = new Map(lineItems(learners, prices).map((i) => [i.price, i.quantity]))
  const out: Stripe.SubscriptionUpdateParams.Item[] = []

  for (const item of subscription.items.data) {
    const priceId = item.price.id
    const quantity = want.get(priceId)
    if (quantity === undefined) {
      // A line we no longer want — the extra-learner line on a family that has
      // gone back down to one child. Left alone it keeps billing.
      out.push({ id: item.id, deleted: true })
    } else {
      out.push({ id: item.id, quantity })
      want.delete(priceId)
    }
  }

  // Anything still wanted has no existing line: the second child on a
  // subscription that has only ever had one.
  for (const [price, quantity] of want) out.push({ price, quantity })

  return out
}

/** How many children a subscription's line items say it covers. */
export function learnersOnSubscription(
  subscription: Pick<Stripe.Subscription, 'items'>,
  prices: { first: string; extra: string },
): number {
  let count = 0
  for (const item of subscription.items.data) {
    if (item.price.id === prices.first) count += item.quantity ?? 0
    else if (item.price.id === prices.extra) count += item.quantity ?? 0
  }
  return count
}

/**
 * Our status, from Stripe's.
 *
 * Stripe has eight; the coverage model has three, and the mapping is a product
 * decision rather than a translation. `past_due` and `unpaid` both stay covered
 * on purpose — a failed card is a payment problem, not a reason to take a
 * child's progress report away mid-week, and Stripe's own dunning resolves most
 * of them within days.
 *
 * `trialing` counts as active because a trial that does not give you the thing
 * is not a trial. `incomplete` does not, because nothing has been paid and the
 * first payment may still fail.
 */
export function statusFrom(stripeStatus: Stripe.Subscription.Status): 'active' | 'past_due' | 'cancelled' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'cancelled'
    default:
      // A status Stripe added after this was written — their type for it is
      // deliberately open, so this arm is reachable and cannot be a `never`
      // check. Treating an unknown as cancelled would silently strip a paying
      // family; treating it as active risks giving away the paid tier.
      // Past-due is the honest middle: they keep what they have, and the state
      // is visible as "something needs looking at".
      return 'past_due'
  }
}

/** Seconds since the epoch, as Stripe sends them, to an ISO timestamp. */
export function periodEnd(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * A sanity check on the prices configured, run at boot rather than at checkout.
 *
 * Not a call to Stripe — just the two ids being present and different. Pointing
 * both at the same price is a configuration mistake that produces a working
 * checkout charging the wrong amount, which is the worst class of bug this file
 * can have.
 */
export function pricesConfigured(first?: string, extra?: string): boolean {
  return Boolean(first && extra && first !== extra)
}

/** The published price, for asserting the charge matches the page. */
export const PRICES = {
  firstCents: PRICE_FIRST_LEARNER_CENTS,
  extraCents: PRICE_EXTRA_LEARNER_CENTS,
}
