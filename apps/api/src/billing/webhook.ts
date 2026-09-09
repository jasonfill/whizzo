// What Stripe tells us, and what we do about it.
//
// Every handler here has to be safe to run twice. Stripe retries any delivery
// that does not return 2xx, for up to three days, and it will also occasionally
// deliver the same event twice for no reason at all. `processed_stripe_events`
// catches the common case; the handlers are written to be idempotent anyway,
// because the belt is cheap and the failure is a family billed once and
// recorded twice.
//
// The other rule running through this file: **a webhook never trusts its own
// payload about who owns what.** The event says a subscription was paid for; it
// does not get to say which children that covers. That comes from the intent we
// recorded before redirecting, which was authorised against the caller.

import type Stripe from 'stripe'
import type { Queryable } from '../db.js'
import { periodEnd, statusFrom } from './stripe.js'

export interface HandledEvent {
  /** What was done, for the log. Never shown to a user. */
  outcome: string
  /** False when the event was a duplicate or of a type we do not act on. */
  changed: boolean
}

/**
 * Record that we have seen this event, and say whether it is new.
 *
 * The insert is the lock. Two deliveries racing each other both reach here;
 * exactly one wins the primary key, and the loser is told it is a duplicate
 * rather than both proceeding to grant coverage.
 */
async function claimEvent(db: Queryable, event: Stripe.Event): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into public.processed_stripe_events (id, type)
     values ($1, $2)
     on conflict (id) do nothing`,
    [event.id, event.type],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Act on one verified Stripe event.
 *
 * The signature has already been checked by the route; by the time anything
 * gets here the payload is known to have come from Stripe.
 */
export async function handleEvent(db: Queryable, event: Stripe.Event): Promise<HandledEvent> {
  if (!(await claimEvent(db, event))) {
    return { outcome: `duplicate ${event.type}`, changed: false }
  }

  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(db, event.data.object)
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscriptionChanged(db, event.data.object)
    case 'invoice.payment_failed':
      return onPaymentFailed(db, event.data.object)
    default:
      // Stripe sends dozens of event types and we subscribe to a handful. An
      // unknown one is not an error — returning 2xx stops it being retried for
      // three days.
      return { outcome: `ignored ${event.type}`, changed: false }
  }
}

/**
 * A parent finished paying.
 *
 * The children covered come from the intent recorded before the redirect, not
 * from anything in this payload. If the intent is missing — a session created
 * by something other than our own checkout route — nothing is granted, because
 * there is no authorised answer to "for whom".
 */
async function onCheckoutCompleted(
  db: Queryable,
  session: Stripe.Checkout.Session,
): Promise<HandledEvent> {
  const subscriptionId = idOf(session.subscription)
  const customerId = idOf(session.customer)
  if (!subscriptionId) return { outcome: 'checkout with no subscription', changed: false }

  const { rows } = await db.query(
    `update public.checkout_intents
        set completed_at = now(), provider_session_id = $2
      where id = $1 and completed_at is null
      returning payer_id, learner_ids`,
    [session.client_reference_id, session.id],
  )
  const intent = rows[0]
  if (!intent) {
    // Either a replay that lost the race, or a session we did not open. Both
    // are "do nothing", and neither is an error worth a retry.
    return { outcome: 'no open intent for this session', changed: false }
  }

  // `on conflict` rather than a plain insert: the retry that got past the event
  // claim would otherwise create a second subscription row for one Stripe
  // subscription, and `learner_coverage` would then have two candidate parents.
  const saved = await db.query(
    `insert into public.subscriptions
       (payer_id, status, provider, provider_customer_id, provider_sub_id)
     values ($1, 'active', 'stripe', $2, $3)
     on conflict (provider_sub_id) do update
       set status = 'active',
           provider_customer_id = excluded.provider_customer_id,
           updated_at = now()
     returning id`,
    [intent.payer_id, customerId, subscriptionId],
  )

  const id = saved.rows[0]?.id
  if (!id) return { outcome: 'subscription row not written', changed: false }

  await db.query('select public.grant_coverage($1, $2::uuid[])', [id, intent.learner_ids])
  return {
    outcome: `covered ${intent.learner_ids.length} learner(s) on ${subscriptionId}`,
    changed: true,
  }
}

/**
 * The subscription itself changed — renewed, canceled, quantity moved.
 *
 * Status is mirrored, and cancellation drops coverage. Nothing a learner made
 * is touched: a lapsed family keeps every deck and every answer, and loses the
 * reporting. Deleting a child's work for non-payment is not a business model.
 */
async function onSubscriptionChanged(
  db: Queryable,
  subscription: Stripe.Subscription,
): Promise<HandledEvent> {
  const status = statusFrom(subscription.status)
  const { rows } = await db.query(
    `update public.subscriptions
        set status = $2,
            current_period_end = $3,
            updated_at = now()
      where provider_sub_id = $1
      returning id`,
    [subscription.id, status, periodEnd(currentPeriodEnd(subscription))],
  )
  const id = rows[0]?.id
  if (!id) return { outcome: `no local row for ${subscription.id}`, changed: false }

  if (status === 'canceled') {
    await db.query('select public.revoke_coverage($1)', [id])
    return { outcome: `canceled ${subscription.id}, coverage removed`, changed: true }
  }

  return { outcome: `${subscription.id} is now ${status}`, changed: true }
}

/**
 * A payment failed.
 *
 * Marked past-due, which still counts as covered. Stripe's dunning gets several
 * days to sort it out, and only the eventual cancellation removes anything.
 */
async function onPaymentFailed(db: Queryable, invoice: Stripe.Invoice): Promise<HandledEvent> {
  const subscriptionId = idOf(subscriptionOf(invoice))
  if (!subscriptionId) return { outcome: 'invoice with no subscription', changed: false }

  const { rowCount } = await db.query(
    `update public.subscriptions
        set status = 'past_due', updated_at = now()
      where provider_sub_id = $1 and status <> 'canceled'`,
    [subscriptionId],
  )
  return {
    outcome: `payment failed on ${subscriptionId}`,
    changed: (rowCount ?? 0) > 0,
  }
}

/** Stripe fields are `string | { id } | null` depending on expansion. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

/**
 * The period end, wherever this API version keeps it.
 *
 * It moved from the subscription onto the individual items. Reading only the
 * old place gives null on every renewal and the account screen stops showing a
 * renewal date; reading only the new place breaks against older payloads still
 * in flight during a version change.
 */
function currentPeriodEnd(subscription: Stripe.Subscription): number | null {
  const top = (subscription as unknown as { current_period_end?: number }).current_period_end
  if (typeof top === 'number') return top
  const item = subscription.items?.data?.[0] as unknown as { current_period_end?: number } | undefined
  return typeof item?.current_period_end === 'number' ? item.current_period_end : null
}

/** Same story on the invoice: the subscription pointer moved into `parent`. */
function subscriptionOf(invoice: Stripe.Invoice): string | { id: string } | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription
  if (direct) return direct
  const parent = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string | { id: string } } }
    }
  ).parent
  return parent?.subscription_details?.subscription ?? null
}
