// The webhook, which is delivered at least once and sometimes rather more.
//
// Stripe retries anything that does not return 2xx for three days, and will
// occasionally deliver the same event twice for no reason. So the case worth
// most of this file is the second delivery: it must not create a second
// subscription, must not double-grant, and must not fail in a way that earns
// three more days of retries.
//
// The other rule under test: a webhook never trusts its own payload about who
// owns what. The event says a subscription was paid for; who that covers comes
// from the intent we recorded before redirecting, which was authorised.

import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { handleEvent } from './webhook.js'

/**
 * A fake database that answers by matching the SQL.
 *
 * Cruder than a query builder and much better at showing what each handler
 * actually asks for: every case here says which statements it expects to see.
 */
function fakeDb(answers: Array<{ match: RegExp; rows?: unknown[]; rowCount?: number }>) {
  const seen: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    seen.push({ sql, values })
    const answer = answers.find((a) => a.match.test(sql))
    return { rows: answer?.rows ?? [], rowCount: answer?.rowCount ?? answer?.rows?.length ?? 0 }
  })
  return { db: { query } as never, seen, query }
}

/** Did any statement matching this run? */
function ran(seen: Array<{ sql: string }>, pattern: RegExp): boolean {
  return seen.some((s) => pattern.test(s.sql))
}

const FRESH = { match: /insert into public\.processed_stripe_events/, rowCount: 1 }
const REPLAY = { match: /insert into public\.processed_stripe_events/, rowCount: 0 }

function event(type: string, object: unknown, id = 'evt_1'): Stripe.Event {
  return { id, type, data: { object } } as Stripe.Event
}

const A_SESSION = {
  id: 'cs_1',
  subscription: 'sub_1',
  customer: 'cus_1',
  client_reference_id: 'intent-1',
}

describe('a parent finished paying', () => {
  const answers = [
    FRESH,
    {
      match: /update public\.checkout_intents/,
      rows: [{ payer_id: 'user-1', learner_ids: ['kid-1', 'kid-2'] }],
    },
    { match: /insert into public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
    { match: /grant_coverage/, rows: [{ grant_coverage: 2 }] },
  ]

  it('covers exactly the children the intent named', async () => {
    const { db, seen } = fakeDb(answers)
    const result = await handleEvent(db, event('checkout.session.completed', A_SESSION))
    expect(result.changed).toBe(true)
    const grant = seen.find((s) => /grant_coverage/.test(s.sql))
    expect(grant?.values).toEqual(['local-sub-1', ['kid-1', 'kid-2']])
  })

  it('links the local row to the Stripe subscription and customer', async () => {
    const { db, seen } = fakeDb(answers)
    await handleEvent(db, event('checkout.session.completed', A_SESSION))
    const insert = seen.find((s) => /insert into public\.subscriptions/.test(s.sql))
    expect(insert?.values).toContain('sub_1')
    expect(insert?.values).toContain('cus_1')
    expect(insert?.values).toContain('user-1')
  })

  it('grants nothing when no intent matches the session', async () => {
    // A session we did not open, or a replay that lost the race. There is no
    // authorised answer to "for whom", so nothing is granted.
    const { db, seen } = fakeDb([FRESH, { match: /update public\.checkout_intents/, rows: [] }])
    const result = await handleEvent(db, event('checkout.session.completed', A_SESSION))
    expect(result.changed).toBe(false)
    expect(ran(seen, /grant_coverage/)).toBe(false)
    expect(ran(seen, /insert into public\.subscriptions/)).toBe(false)
  })

  it('ignores a checkout that bought no subscription', async () => {
    const { db, seen } = fakeDb([FRESH])
    const result = await handleEvent(
      db,
      event('checkout.session.completed', { ...A_SESSION, subscription: null }),
    )
    expect(result.changed).toBe(false)
    expect(ran(seen, /checkout_intents/)).toBe(false)
  })

  it('accepts an expanded object where Stripe sends one', async () => {
    // `subscription` is `string | Subscription | null` depending on expansion,
    // and reading `.id` off a string gives undefined rather than throwing.
    const { db, seen } = fakeDb(answers)
    await handleEvent(
      db,
      event('checkout.session.completed', {
        ...A_SESSION,
        subscription: { id: 'sub_expanded' },
        customer: { id: 'cus_expanded' },
      }),
    )
    const insert = seen.find((s) => /insert into public\.subscriptions/.test(s.sql))
    expect(insert?.values).toContain('sub_expanded')
    expect(insert?.values).toContain('cus_expanded')
  })
})

describe('the same event, delivered twice', () => {
  it('does nothing the second time', async () => {
    const { db, seen } = fakeDb([REPLAY])
    const result = await handleEvent(db, event('checkout.session.completed', A_SESSION))
    expect(result.changed).toBe(false)
    expect(result.outcome).toMatch(/duplicate/)
    // Nothing past the claim ran at all — no second subscription, no second
    // grant.
    expect(ran(seen, /checkout_intents|subscriptions|grant_coverage/)).toBe(false)
  })

  it('still succeeds, so Stripe stops retrying it', async () => {
    // Throwing here would earn three days of redelivery for something a retry
    // cannot fix.
    const { db } = fakeDb([REPLAY])
    await expect(
      handleEvent(db, event('checkout.session.completed', A_SESSION)),
    ).resolves.toBeTruthy()
  })

  it('claims the event before doing anything else', async () => {
    const { db, seen } = fakeDb([FRESH, { match: /update public\.checkout_intents/, rows: [] }])
    await handleEvent(db, event('checkout.session.completed', A_SESSION))
    expect(seen[0]!.sql).toMatch(/processed_stripe_events/)
  })
})

describe('the subscription itself changed', () => {
  function sub(status: string, over: Record<string, unknown> = {}) {
    return {
      id: 'sub_1',
      status,
      items: { data: [{ current_period_end: 1_780_000_000 }] },
      ...over,
    }
  }

  it('mirrors the new status', async () => {
    const { db, seen } = fakeDb([
      FRESH,
      { match: /update public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
    ])
    await handleEvent(db, event('customer.subscription.updated', sub('past_due')))
    const update = seen.find((s) => /update public\.subscriptions/.test(s.sql))
    expect(update?.values).toContain('past_due')
  })

  it('drops coverage when it is cancelled', async () => {
    const { db, seen } = fakeDb([
      FRESH,
      { match: /update public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
      { match: /revoke_coverage/, rows: [{ revoke_coverage: 2 }] },
    ])
    const result = await handleEvent(db, event('customer.subscription.deleted', sub('canceled')))
    expect(result.changed).toBe(true)
    expect(seen.find((s) => /revoke_coverage/.test(s.sql))?.values).toEqual(['local-sub-1'])
  })

  it('does not drop coverage for a failed payment', async () => {
    // Coverage survives a past-due card. Only the eventual cancellation
    // removes anything.
    const { db, seen } = fakeDb([
      FRESH,
      { match: /update public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
    ])
    await handleEvent(db, event('customer.subscription.updated', sub('past_due')))
    expect(ran(seen, /revoke_coverage/)).toBe(false)
  })

  it('reads the period end from the top level where the payload has one', async () => {
    const { db, seen } = fakeDb([
      FRESH,
      { match: /update public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
    ])
    await handleEvent(
      db,
      event('customer.subscription.updated', sub('active', { current_period_end: 1_790_000_000 })),
    )
    const update = seen.find((s) => /update public\.subscriptions/.test(s.sql))
    expect(update?.values).toContain(new Date(1_790_000_000_000).toISOString())
  })

  it('falls back to the item where it does not', async () => {
    // The field moved onto the line items. Reading only the old place gives
    // null on every renewal and the account screen stops showing a date.
    const { db, seen } = fakeDb([
      FRESH,
      { match: /update public\.subscriptions/, rows: [{ id: 'local-sub-1' }] },
    ])
    await handleEvent(db, event('customer.subscription.updated', sub('active')))
    const update = seen.find((s) => /update public\.subscriptions/.test(s.sql))
    expect(update?.values).toContain(new Date(1_780_000_000_000).toISOString())
  })

  it('shrugs at a subscription it has no local row for', async () => {
    const { db } = fakeDb([FRESH, { match: /update public\.subscriptions/, rows: [] }])
    const result = await handleEvent(db, event('customer.subscription.updated', sub('active')))
    expect(result.changed).toBe(false)
  })
})

describe('a payment failed', () => {
  it('marks the subscription past due without removing anything', async () => {
    const { db, seen } = fakeDb([FRESH, { match: /update public\.subscriptions/, rowCount: 1 }])
    const result = await handleEvent(
      db,
      event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }),
    )
    expect(result.changed).toBe(true)
    expect(ran(seen, /revoke_coverage|delete/)).toBe(false)
  })

  it('finds the subscription where newer payloads keep it', async () => {
    // It moved from `invoice.subscription` into `invoice.parent`.
    const { db, seen } = fakeDb([FRESH, { match: /update public\.subscriptions/, rowCount: 1 }])
    await handleEvent(
      db,
      event('invoice.payment_failed', {
        id: 'in_1',
        parent: { subscription_details: { subscription: 'sub_nested' } },
      }),
    )
    expect(seen.find((s) => /update public\.subscriptions/.test(s.sql))?.values).toContain(
      'sub_nested',
    )
  })

  it('never revives a cancelled subscription', async () => {
    const { db, seen } = fakeDb([FRESH, { match: /update public\.subscriptions/, rowCount: 0 }])
    await handleEvent(db, event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }))
    expect(seen.find((s) => /update public\.subscriptions/.test(s.sql))?.sql).toMatch(
      /status <> 'cancelled'/,
    )
  })

  it('ignores an invoice with no subscription behind it', async () => {
    const { db } = fakeDb([FRESH])
    const result = await handleEvent(db, event('invoice.payment_failed', { id: 'in_1' }))
    expect(result.changed).toBe(false)
  })
})

describe('everything else Stripe sends', () => {
  it('is accepted rather than retried for three days', async () => {
    const { db } = fakeDb([FRESH])
    const result = await handleEvent(db, event('customer.updated', { id: 'cus_1' }))
    expect(result.changed).toBe(false)
    expect(result.outcome).toMatch(/ignored/)
  })
})
