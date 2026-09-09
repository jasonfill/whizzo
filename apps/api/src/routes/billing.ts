// Paying for children.
//
// Four routes, and the interesting one is not checkout. Checkout is the easy
// case: no subscription exists, so there is nothing to be inconsistent with.
// The one that earns its tests is `/billing/coverage`, which changes a
// subscription that is already running — because that is where the quantity
// Stripe bills and the number of rows in `learner_coverage` can drift apart,
// and once they have drifted nothing notices.
//
// The rule that keeps them together: **the quantity is always recomputed from
// the coverage rows, never incremented.** No handler here adds one to anything.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withAdmin, withUser, type Queryable } from '../db.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { env } from '../env.js'
import { handleEvent } from '../billing/webhook.js'
import {
  itemUpdates,
  lineItems,
  pricesConfigured,
  stripeClient,
  type StripeLike,
} from '../billing/stripe.js'

const uuid = z.string().uuid('That is not a valid id')

const checkoutSchema = z.object({
  // Forty is not a real family; it is the ceiling on a request body. A school
  // wanting more is the district conversation, which is a different product.
  learnerIds: z.array(uuid).min(1).max(40),
})

const coverageSchema = z
  .object({
    add: z.array(uuid).max(40).default([]),
    remove: z.array(uuid).max(40).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, {
    message: 'Say which children to add or remove',
  })

export interface BillingDeps {
  /** Injected so every path here is reachable in a test without a Stripe key. */
  stripe?: StripeLike
}

export async function billingRoutes(
  app: FastifyInstance,
  deps: BillingDeps = {},
): Promise<void> {
  const prices = { first: env.STRIPE_PRICE_FIRST ?? '', extra: env.STRIPE_PRICE_EXTRA ?? '' }

  // Stripe signs the *bytes* it sent, and `JSON.parse` then re-stringify does
  // not round-trip them — whitespace and unicode escaping do not survive. So
  // the webhook has to verify against the original string.
  //
  // Registered here rather than on the root app on purpose: it means the
  // signature check cannot be broken by an edit to a parser three files away,
  // and a webhook that silently stops verifying does not fail loudly — it
  // returns 403 to Stripe, earns three days of retries, and grants nobody the
  // coverage they paid for.
  //
  // The remove is not optional. A plugin scope *inherits* the root parser, and
  // adding the same content type on top of an inherited one throws
  // `FST_ERR_CTP_ALREADY_PRESENT` at boot — the whole API refuses to start.
  // Removing first replaces it for this scope only; routes outside the billing
  // plugin keep the root parser and never see `rawBody`.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : ''
    ;(request as { rawBody?: string }).rawBody = text
    if (!text.trim()) {
      done(null, undefined)
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch {
      done(badRequest('That request body was not valid JSON', 'bad_json'), undefined)
    }
  })

  /** The client, or a clear refusal. Never a 500 from a missing key. */
  function client(): StripeLike {
    if (deps.stripe) return deps.stripe
    if (!env.STRIPE_SECRET_KEY) {
      throw badRequest('Payments are not switched on in this build.', 'stripe_unconfigured')
    }
    if (!pricesConfigured(prices.first, prices.extra)) {
      // Both ids pointing at the same price is a configuration mistake that
      // produces a *working* checkout charging the wrong amount. Refusing
      // loudly beats billing quietly.
      throw badRequest('Payments are not configured correctly.', 'stripe_unconfigured')
    }
    return stripeClient(env.STRIPE_SECRET_KEY) as unknown as StripeLike
  }

  // -------------------------------------------------------------------------
  // Starting to pay
  // -------------------------------------------------------------------------
  app.post('/billing/checkout', { preHandler: requireCaller }, async (request) => {
    const caller = callerOf(request)
    const { learnerIds } = parse(checkoutSchema, request.body)
    const stripe = client()

    const wanted = unique(learnerIds)

    const { intentId, toCover } = await withUser(caller.id, async (db) => {
      await assertOwnsAll(db, caller.id, wanted)

      // Paying twice for the same child is the mistake this catches. It is easy
      // to make: two tabs, a back button, a checkout abandoned and restarted.
      const covered = await coveredAmong(db, wanted)
      const remaining = wanted.filter((id) => !covered.has(id))
      if (remaining.length === 0) return { intentId: null, toCover: [] as string[] }

      const { rows } = await db.query(
        `insert into public.checkout_intents (payer_id, learner_ids)
         values ($1, $2::uuid[]) returning id`,
        [caller.id, remaining],
      )
      return { intentId: rows[0]?.id as string, toCover: remaining }
    })

    if (!intentId) {
      throw badRequest('Those children are already covered.', 'already_covered')
    }

    const existing = await withAdmin((db) => activeSubscription(db, caller.id))

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems(toCover.length, prices),
      // The intent is the authority on who this covers. Stripe hands the
      // webhook a session, not a list of children, and metadata is a string
      // nobody can join on.
      client_reference_id: intentId ?? undefined,
      ...(existing?.provider_customer_id
        ? { customer: existing.provider_customer_id }
        : { customer_email: caller.email ?? undefined }),
      success_url: `${env.APP_URL}/account?checkout=done`,
      cancel_url: `${env.APP_URL}/upgrade?checkout=canceled`,
      // A card that needs 3-D Secure should get it rather than failing.
      payment_method_collection: 'always',
      subscription_data: {
        metadata: { payer_id: caller.id, intent_id: intentId ?? '' },
      },
    })

    if (!session.url) throw badRequest('Stripe did not return a checkout link.')
    return { url: session.url }
  })

  // -------------------------------------------------------------------------
  // Adding and removing children on a subscription that already exists
  // -------------------------------------------------------------------------
  //
  // The one route where the money and the record can come apart. Order matters:
  // coverage is written first, inside a transaction, and the Stripe quantity is
  // then computed from what the table now says. If the Stripe call fails the
  // transaction has already committed, so the recovery is "the family has
  // coverage we have not billed for yet" — which reconciles on the next webhook
  // and is the right way round to be wrong.
  app.post('/billing/coverage', { preHandler: requireCaller }, async (request) => {
    const caller = callerOf(request)
    const { add, remove } = parse(coverageSchema, request.body)
    const stripe = client()

    const adding = unique(add ?? [])
    const removing = unique(remove ?? [])
    const overlap = adding.filter((id) => removing.includes(id))
    if (overlap.length) {
      throw badRequest('A child cannot be added and removed in the same change.')
    }

    const subscription = await withAdmin((db) => activeSubscription(db, caller.id))
    if (!subscription) {
      throw badRequest(
        'There is no subscription to change yet. Start by covering somebody.',
        'no_subscription',
      )
    }

    // Ownership is checked as the caller, so RLS is doing the work rather than
    // a `where owner_id =` we could forget. That connection is released before
    // the writes begin.
    //
    // The writes then happen as admin, on one connection, in one block. An
    // earlier version nested `withAdmin` *inside* `withUser`, which is two
    // pooled connections held per request and a third for the count — with a
    // pool of ten that is a deadlock waiting for the eleventh concurrent
    // change, every outer connection holding one while it waits for an inner
    // one that will never come. It also meant the grant and the count ran on
    // different connections, so the number sent to Stripe could miss a
    // concurrent change and bill for the wrong quantity.
    await withUser(caller.id, (db) => assertOwnsAll(db, caller.id, [...adding, ...removing]))

    const covered = await withAdmin(async (db) => {
      if (adding.length) {
        await db.query('select public.grant_coverage($1, $2::uuid[])', [subscription.id, adding])
      }
      if (removing.length) {
        // Scoped to this subscription: a parent cannot drop coverage that
        // somebody else is paying for, even on a child they own.
        await db.query(
          `delete from public.learner_coverage
            where subscription_id = $1 and learner_id = any($2::uuid[])`,
          [subscription.id, removing],
        )
      }
      return countCovered(db, subscription.id)
    })

    // Nobody left. Cancel rather than bill for a subscription covering no one —
    // Stripe is perfectly happy to charge for a quantity of zero line items.
    if (covered === 0) {
      await stripe.subscriptions.cancel(subscription.provider_sub_id!)
      await withAdmin((db) =>
        db.query(
          `update public.subscriptions set status = 'canceled', updated_at = now() where id = $1`,
          [subscription.id],
        ),
      )
      return { covered: 0, canceled: true }
    }

    const current = await stripe.subscriptions.retrieve(subscription.provider_sub_id!)
    await stripe.subscriptions.update(subscription.provider_sub_id!, {
      items: itemUpdates(current, covered, prices),
      // The parent pays the difference for the rest of this period rather than
      // the whole month again, and gets credit when they remove somebody.
      proration_behavior: 'create_prorations',
    })

    return { covered, canceled: false }
  })

  // -------------------------------------------------------------------------
  // Managing the card, and canceling
  // -------------------------------------------------------------------------
  // Stripe's own portal rather than screens of ours. Card details are the one
  // thing this product should never see, and a cancel flow we wrote is a cancel
  // flow we would have to keep correct against Stripe's rules.
  app.post('/billing/portal', { preHandler: requireCaller }, async (request) => {
    const caller = callerOf(request)
    const stripe = client()

    const subscription = await withAdmin((db) => activeSubscription(db, caller.id))
    if (!subscription?.provider_customer_id) {
      throw notFound('There is nothing to manage yet.')
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${env.APP_URL}/account`,
    })
    return { url: session.url }
  })

  // -------------------------------------------------------------------------
  // What Stripe tells us
  // -------------------------------------------------------------------------
  //
  // No `requireCaller`: the caller is Stripe, and it authenticates with a
  // signature over the raw body rather than with a bearer token. That is also
  // why this route needs the unparsed payload — `JSON.parse` then re-stringify
  // does not round-trip byte for byte, and the signature is over bytes.
  app.post('/billing/webhook', async (request, reply) => {
      const signature = request.headers['stripe-signature']
      if (typeof signature !== 'string') throw badRequest('Missing signature')
      if (!env.STRIPE_WEBHOOK_SECRET) {
        throw badRequest('Payments are not switched on in this build.', 'stripe_unconfigured')
      }

      const raw = (request as { rawBody?: string | Buffer }).rawBody
      if (raw === undefined) throw badRequest('Missing body')

      const stripe = client()
      let event
      try {
        event = stripe.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET)
      } catch {
        // Never say why. A signature check that explains itself is a signature
        // check being tuned against.
        throw forbidden('Bad signature')
      }

      // Admin, not user: there is no user in a webhook, and RLS would refuse
      // every write.
      const result = await withAdmin((db) => handleEvent(db, event))
      request.log.info({ stripeEvent: event.type, outcome: result.outcome }, 'stripe webhook')

      // Always 2xx once the signature is good. A 500 here buys three days of
      // retries for something a retry will not fix.
    reply.code(200)
    return { received: true }
  })
}

// --- helpers ---------------------------------------------------------------

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body)
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

interface SubscriptionRow {
  id: string
  provider_sub_id: string | null
  provider_customer_id: string | null
  status: string
}

/**
 * The subscription this payer is running, if any.
 *
 * Canceled ones are excluded from "active" but their customer id is still
 * wanted, so a family who comes back is the same Stripe customer rather than a
 * second one with a second card on file.
 */
async function activeSubscription(db: Queryable, payerId: string): Promise<SubscriptionRow | null> {
  const { rows } = await db.query(
    `select id, provider_sub_id, provider_customer_id, status
       from public.subscriptions
      where payer_id = $1
      order by (status <> 'canceled') desc, updated_at desc
      limit 1`,
    [payerId],
  )
  return (rows[0] as SubscriptionRow | undefined) ?? null
}

/**
 * Refuse to bill somebody for a child that is not theirs.
 *
 * Ownership, not visibility. A tutor can *see* the children they work with, and
 * `learners` returns them — so a check written against visibility would let a
 * tutor put somebody else's child on their own card.
 */
async function assertOwnsAll(db: Queryable, userId: string, learnerIds: string[]): Promise<void> {
  if (learnerIds.length === 0) return
  const { rows } = await db.query(
    `select count(*)::int as owned
       from public.learners
      where owner_id = $1 and id = any($2::uuid[])`,
    [userId, learnerIds],
  )
  if ((rows[0]?.owned ?? 0) !== learnerIds.length) {
    throw forbidden('You can only pay for children on your own account.')
  }
}

/** Which of these are already covered by anybody. */
async function coveredAmong(db: Queryable, learnerIds: string[]): Promise<Set<string>> {
  const { rows } = await db.query(
    `select c.learner_id
       from public.learner_coverage c
       join public.subscriptions s on s.id = c.subscription_id
      where c.learner_id = any($1::uuid[]) and s.status in ('active', 'past_due')`,
    [learnerIds],
  )
  return new Set(rows.map((r: { learner_id: string }) => r.learner_id))
}

/** How many children this subscription now covers — the billed quantity. */
async function countCovered(db: Queryable, subscriptionId: string): Promise<number> {
  const { rows } = await db.query(
    'select count(*)::int as n from public.learner_coverage where subscription_id = $1',
    [subscriptionId],
  )
  return rows[0]?.n ?? 0
}
