// The client half of paying.
//
// Note what is missing: nothing here grants coverage. `learner_coverage` is
// written by a webhook that verified a signature from Stripe, and a client
// function for it would be a way to give yourself the paid feature set.
//
// What the client can do is ask for a checkout link, change which of *its own*
// children are on an existing subscription, and open Stripe's own portal to
// deal with the card.

import { api } from '../api/client'

/**
 * Start paying for these children.
 *
 * Returns somewhere to send the browser. The redirect is the caller's job so
 * that a screen can show its own "taking you to Stripe" state rather than
 * having the page yanked out from under a button press.
 */
export function startCheckout(learnerIds: string[]): Promise<{ url: string }> {
  return api.post('/billing/checkout', { learnerIds })
}

export interface CoverageChange {
  covered: number
  /** True when the last child came off and the subscription was ended. */
  canceled: boolean
}

/**
 * Add or remove children on a subscription that already exists.
 *
 * The price changes immediately and is prorated: a child added halfway through
 * a month costs half a month, and one removed earns credit against the next.
 */
export function changeCoverage(change: {
  add?: string[]
  remove?: string[]
}): Promise<CoverageChange> {
  return api.post('/billing/coverage', {
    add: change.add ?? [],
    remove: change.remove ?? [],
  })
}

/** Stripe's own portal: the card, the invoices, and canceling. */
export function billingPortal(): Promise<{ url: string }> {
  return api.post('/billing/portal', {})
}

/**
 * Whether the failure was "payments are not switched on in this build".
 *
 * Worth distinguishing, because it is the one billing error that is not the
 * parent's problem and should not be phrased as though it were.
 */
export function isUnconfigured(err: unknown): boolean {
  return (err as { code?: string })?.code === 'stripe_unconfigured'
}
