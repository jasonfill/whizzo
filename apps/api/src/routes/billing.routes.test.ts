// Paying for children, over HTTP.
//
// Two things this surface must never do, and both are tested first: bill
// somebody for a child that is not theirs, and let the quantity Stripe charges
// drift away from the number of rows in `learner_coverage`. The second is the
// subtle one — it does not fail, it just quietly bills for two children while
// covering three, and nothing notices until somebody reads an invoice.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)

// Connections are counted, not just recorded. Holding two at once is the
// difference between a route that works and one that deadlocks the pool.
const { open } = vi.hoisted(() => ({ open: { now: 0, most: 0 } }))
function tracked<T>(fn: () => Promise<T>): Promise<T> {
  open.now += 1
  open.most = Math.max(open.most, open.now)
  return fn().finally(() => {
    open.now -= 1
  })
}

vi.mock('../db.js', () => ({
  withUser: (_id: string, fn: (db: unknown) => Promise<unknown>) => tracked(() => fn({ query })),
  withAdmin: (fn: (db: unknown) => Promise<unknown>) => tracked(() => fn({ query })),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_FIRST: 'price_first',
    STRIPE_PRICE_EXTRA: 'price_extra',
    APP_URL: 'https://whizzo.test',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false }))

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const KID_A = '11111111-2222-4333-8444-555555555551'
const KID_B = '11111111-2222-4333-8444-555555555552'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')

async function auth() {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(CALLER)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
  return { authorization: `Bearer ${token}` }
}

/** A Stripe double that records what it was asked to do. */
function fakeStripe(over: Record<string, unknown> = {}) {
  const created = vi.fn(async (_params?: unknown) => ({ id: 'cs_1', url: 'https://checkout.stripe/x' }))
  const retrieve = vi.fn(async (_id?: string) => ({
    id: 'sub_1',
    items: { data: [{ id: 'si_1', price: { id: 'price_first' }, quantity: 1 }] },
  }))
  const update = vi.fn(async (_id?: string, _params?: unknown) => ({ id: 'sub_1' }))
  const cancel = vi.fn(async (_id?: string) => ({ id: 'sub_1' }))
  const portal = vi.fn(async (_params?: unknown) => ({ url: 'https://billing.stripe/x' }))
  const constructEvent = vi.fn(() => ({ id: 'evt_1', type: 'customer.updated', data: {} }))
  return {
    stripe: {
      checkout: { sessions: { create: created } },
      subscriptions: { retrieve, update, cancel },
      billingPortal: { sessions: { create: portal } },
      webhooks: { constructEvent },
      ...over,
    } as never,
    created,
    retrieve,
    update,
    cancel,
    portal,
    constructEvent,
  }
}

async function buildApp(stripe: unknown) {
  const Fastify = (await import('fastify')).default
  const { billingRoutes } = await import('./billing.js')
  const { HttpError, fromDatabaseError, fromValidationError } = await import('../errors.js')
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message } })
      return
    }
    const invalid = fromValidationError(error)
    if (invalid) {
      reply.code(invalid.status).send({ error: { code: invalid.code, message: invalid.message } })
      return
    }
    const mapped = fromDatabaseError(error)
    if (mapped) {
      reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      return
    }
    reply.code(500).send({ error: { code: 'error', message: (error as Error).message } })
  })
  await app.register(billingRoutes, { prefix: '/api', stripe } as never)
  await app.ready()
  return app
}

/** Answer queries by matching the SQL, like the webhook tests do. */
function answering(answers: Array<{ match: RegExp; rows?: unknown[]; rowCount?: number }>) {
  query.mockReset().mockImplementation(async (sql: string) => {
    const answer = answers.find((a) => a.match.test(sql))
    return { rows: answer?.rows ?? [], rowCount: answer?.rowCount ?? answer?.rows?.length ?? 0 }
  })
}

const OWNS_BOTH = { match: /count\(\*\)::int as owned/, rows: [{ owned: 2 }] }
const OWNS_ONE = { match: /count\(\*\)::int as owned/, rows: [{ owned: 1 }] }
const NOTHING_COVERED = { match: /from public\.learner_coverage c/, rows: [] }
const NO_SUBSCRIPTION = { match: /from public\.subscriptions/, rows: [] }
const A_SUBSCRIPTION = {
  match: /from public\.subscriptions/,
  rows: [
    {
      id: 'local-1',
      provider_sub_id: 'sub_1',
      provider_customer_id: 'cus_1',
      status: 'active',
    },
  ],
}

beforeEach(() => {
  query.mockReset()
  withUser.mockClear()
  open.now = 0
  open.most = 0
})

describe('starting to pay', () => {
  it('opens a checkout for the children named', async () => {
    answering([
      OWNS_BOTH,
      NOTHING_COVERED,
      { match: /insert into public\.checkout_intents/, rows: [{ id: 'intent-1' }] },
      { match: /select learner_ids/, rows: [{ learner_ids: [KID_A, KID_B] }] },
      NO_SUBSCRIPTION,
    ])
    const { stripe, created } = fakeStripe()
    const app = await buildApp(stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A, KID_B] },
    })
    expect(res.statusCode).toBeLessThan(400)
    expect(res.json().url).toBe('https://checkout.stripe/x')

    const params = created.mock.calls[0]![0] as Record<string, unknown>
    // Two children: one of the first-child price, one of the extra.
    expect(params.line_items).toEqual([
      { price: 'price_first', quantity: 1 },
      { price: 'price_extra', quantity: 1 },
    ])
    // The intent, not metadata, is what the webhook will reconcile against.
    expect(params.client_reference_id).toBe('intent-1')
  })

  it('refuses to bill somebody for a child that is not theirs', async () => {
    // `learners` includes children a tutor can *see*. A check written against
    // visibility would let them put somebody else's child on their card.
    answering([OWNS_ONE])
    const { stripe, created } = fakeStripe()
    const app = await buildApp(stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A, KID_B] },
    })
    expect(res.statusCode).toBe(403)
    expect(created).not.toHaveBeenCalled()
  })

  it('does not sell coverage somebody already has', async () => {
    // Two tabs, a back button, an abandoned checkout restarted. Easy to do and
    // it would charge twice for one child.
    answering([
      OWNS_BOTH,
      { match: /from public\.learner_coverage c/, rows: [{ learner_id: KID_A }, { learner_id: KID_B }] },
    ])
    const { stripe, created } = fakeStripe()
    const app = await buildApp(stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A, KID_B] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('already_covered')
    expect(created).not.toHaveBeenCalled()
  })

  it('reuses the Stripe customer a returning family already has', async () => {
    // A second customer record is how somebody ends up with two subscriptions
    // and one of them invisible.
    answering([
      OWNS_ONE,
      NOTHING_COVERED,
      { match: /insert into public\.checkout_intents/, rows: [{ id: 'intent-1' }] },
      { match: /select learner_ids/, rows: [{ learner_ids: [KID_A] }] },
      A_SUBSCRIPTION,
    ])
    const { stripe, created } = fakeStripe()
    const app = await buildApp(stripe)
    await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A] },
    })
    expect((created.mock.calls[0]![0] as Record<string, unknown>).customer).toBe('cus_1')
  })

  it('opens a checkout without stacking connections either', async () => {
    answering([
      OWNS_ONE,
      NOTHING_COVERED,
      { match: /insert into public\.checkout_intents/, rows: [{ id: 'intent-1' }] },
      NO_SUBSCRIPTION,
    ])
    const app = await buildApp(fakeStripe().stripe)
    await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A] },
    })
    expect(open.most).toBe(1)
  })

  it('needs a signed-in caller', async () => {
    answering([])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      payload: { learnerIds: [KID_A] },
    })
    expect(res.statusCode).toBe(401)
  })
})

// The route where money and record can come apart. Every case checks the
// quantity sent to Stripe against what the coverage table now says.
describe('adding and removing children later', () => {
  async function change(payload: Record<string, string[]>, covered: number) {
    answering([
      A_SUBSCRIPTION,
      OWNS_ONE,
      { match: /count\(\*\)::int as n/, rows: [{ n: covered }] },
      { match: /grant_coverage/, rows: [] },
      { match: /delete from public\.learner_coverage/, rowCount: 1 },
    ])
    const fake = fakeStripe()
    const app = await buildApp(fake.stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/coverage',
      headers: await auth(),
      payload,
    })
    return { res, ...fake }
  }

  it('bills the new total after adding a child', async () => {
    const { res, update } = await change({ add: [KID_B] }, 2)
    expect(res.statusCode).toBeLessThan(400)
    expect(res.json().covered).toBe(2)
    const params = update.mock.calls[0]![1] as Record<string, unknown>
    expect(params.items).toEqual([
      { id: 'si_1', quantity: 1 },
      { price: 'price_extra', quantity: 1 },
    ])
  })

  it('charges the difference rather than a fresh month', async () => {
    const { update } = await change({ add: [KID_B] }, 2)
    expect((update.mock.calls[0]![1] as Record<string, unknown>).proration_behavior).toBe(
      'create_prorations',
    )
  })

  it('recomputes the quantity from the table rather than incrementing', async () => {
    // The invariant that keeps the two in step. If this ever became "+1" then a
    // failed request, a retry or a second tab would put them out permanently.
    const { update } = await change({ add: [KID_B] }, 5)
    const items = (update.mock.calls[0]![1] as { items: Array<Record<string, unknown>> }).items
    const extra = items.find((i) => i.price === 'price_extra' || i.id === 'si_2')
    expect(extra?.quantity).toBe(4)
  })

  it('drops the extra line when the family goes back to one child', async () => {
    const { update } = await change({ remove: [KID_B] }, 1)
    expect((update.mock.calls[0]![1] as Record<string, unknown>).items).toEqual([
      { id: 'si_1', quantity: 1 },
    ])
  })

  it('cancels rather than billing for nobody', async () => {
    // Stripe is perfectly happy to keep a subscription alive with no line
    // items, and the family would keep paying for nothing.
    const { res, cancel, update } = await change({ remove: [KID_A] }, 0)
    expect(res.json()).toMatchObject({ covered: 0, cancelled: true })
    expect(cancel).toHaveBeenCalledWith('sub_1')
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a child the caller does not own', async () => {
    answering([
      A_SUBSCRIPTION,
      { match: /count\(\*\)::int as owned/, rows: [{ owned: 0 }] },
    ])
    const fake = fakeStripe()
    const app = await buildApp(fake.stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/coverage',
      headers: await auth(),
      payload: { add: [KID_B] },
    })
    expect(res.statusCode).toBe(403)
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('has nothing to change without a subscription', async () => {
    answering([NO_SUBSCRIPTION])
    const fake = fakeStripe()
    const app = await buildApp(fake.stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/coverage',
      headers: await auth(),
      payload: { add: [KID_A] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('no_subscription')
  })

  it('refuses a change that both adds and removes the same child', async () => {
    answering([A_SUBSCRIPTION, OWNS_ONE])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/coverage',
      headers: await auth(),
      payload: { add: [KID_A], remove: [KID_A] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a change that changes nothing', async () => {
    answering([A_SUBSCRIPTION])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/coverage',
      headers: await auth(),
      payload: { add: [], remove: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('never holds two database connections at once', async () => {
    // Not a style point. An earlier version nested `withAdmin` inside
    // `withUser`, so each request held two pooled connections and a third for
    // the count. With a pool of ten that is a deadlock waiting for the
    // eleventh concurrent change: every outer connection sits holding one
    // while it waits for an inner one that can never be granted. It also put
    // the grant and the count on different connections, so the quantity sent
    // to Stripe could miss a concurrent change.
    await change({ add: [KID_B] }, 2)
    expect(open.most).toBe(1)
  })

  it('only drops coverage on the subscription the caller pays for', async () => {
    // A parent must not be able to cancel coverage somebody else is paying
    // for, even on a child they own.
    const { res } = await change({ remove: [KID_A] }, 1)
    expect(res.statusCode).toBeLessThan(400)
    const del = query.mock.calls.find(([sql]) =>
      /delete from public\.learner_coverage/.test(sql as string),
    )
    expect(del?.[1]).toEqual(['local-1', [KID_A]])
  })
})

describe('the webhook', () => {
  it('refuses a request with no signature', async () => {
    answering([])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a signature that does not verify, without saying why', async () => {
    // A signature check that explains itself is a signature check being tuned
    // against.
    answering([])
    const fake = fakeStripe()
    fake.constructEvent.mockImplementation(() => {
      throw new Error('no match for whsec_...')
    })
    const app = await buildApp(fake.stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: { 'stripe-signature': 'nonsense' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.body).not.toMatch(/whsec/)
  })

  it('accepts a verified event', async () => {
    answering([{ match: /processed_stripe_events/, rowCount: 1 }])
    const fake = fakeStripe()
    const app = await buildApp(fake.stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: { 'stripe-signature': 't=1,v1=good' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it('needs no bearer token, because Stripe has none to send', async () => {
    answering([{ match: /processed_stripe_events/, rowCount: 1 }])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: { 'stripe-signature': 't=1,v1=good' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).not.toBe(401)
  })
})

describe('managing the card', () => {
  it('hands back Stripe’s own portal rather than screens of ours', async () => {
    answering([A_SUBSCRIPTION])
    const { stripe, portal } = fakeStripe()
    const app = await buildApp(stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/portal',
      headers: await auth(),
    })
    expect(res.json().url).toBe('https://billing.stripe/x')
    expect((portal.mock.calls[0]![0] as Record<string, unknown>).customer).toBe('cus_1')
  })

  it('has nothing to manage before anybody has paid', async () => {
    answering([NO_SUBSCRIPTION])
    const app = await buildApp(fakeStripe().stripe)
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/portal',
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('a build with no Stripe behind it', () => {
  it('refuses politely rather than crashing', async () => {
    // A contributor without a Stripe account should be able to run the API.
    envMock.STRIPE_SECRET_KEY = undefined
    answering([])
    const Fastify = (await import('fastify')).default
    const { billingRoutes } = await import('./billing.js')
    const { HttpError } = await import('../errors.js')
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      const e = error as InstanceType<typeof HttpError>
      reply.code(e.status ?? 500).send({ error: { code: e.code, message: e.message } })
    })
    await app.register(billingRoutes, { prefix: '/api' })
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: await auth(),
      payload: { learnerIds: [KID_A] },
    })
    expect(res.json().error.code).toBe('stripe_unconfigured')
    envMock.STRIPE_SECRET_KEY = 'sk_test_x'
  })
})
