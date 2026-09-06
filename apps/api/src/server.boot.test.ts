// Does the real server actually start?
//
// This file exists because of a bug that every other test in the repository was
// structurally unable to see. The billing plugin registers its own JSON parser,
// so the webhook can verify Stripe's signature over the exact bytes it was
// sent. Each route suite builds a *bare* Fastify instance with no root parser,
// so that registration always succeeded there — and in the real server, where
// `server.ts` has already registered one on the root and plugin scopes inherit
// it, Fastify threw `FST_ERR_CTP_ALREADY_PRESENT` and the API refused to boot.
//
// Green tests, dead process. So: one test that assembles the whole thing the
// way production does, and asserts the least interesting possible thing — that
// it comes up.

import { describe, expect, it, vi } from 'vitest'

// Nothing here should touch a database or a network. The pool is faked at the
// `pg` level so `buildServer` can wire everything without connecting.
vi.mock('pg', () => {
  const client = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    release: vi.fn(),
  }
  class Pool {
    connect = vi.fn(async () => client)
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
    on = vi.fn()
    end = vi.fn(async () => {})
  }
  return { default: { Pool }, Pool }
})

vi.mock('./env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    // Set, so the billing plugin registers for real rather than short-circuiting.
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_FIRST: 'price_first',
    STRIPE_PRICE_EXTRA: 'price_extra',
    APP_URL: 'https://whizzo.test',
    WEB_ORIGINS: '',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
    RUN_MIGRATIONS_ON_START: false,
    DEV_LOGIN_ACCOUNTS: [],
  },
  isProduction: false,
  webOrigins: [],
}))

describe('the server as production assembles it', () => {
  it('boots with every plugin registered', async () => {
    // The assertion is not the point; reaching it is. `buildServer` throwing
    // is the failure this test exists to catch.
    const { buildServer } = await import('./server.js')
    const app = await buildServer()
    await app.ready()
    expect(app.hasRoute({ method: 'POST', url: '/api/billing/webhook' })).toBe(true)
    await app.close()
  })

  it('gives the billing scope its own body parser without disturbing the rest', async () => {
    // Both halves matter. The webhook needs the raw bytes; every other route
    // needs the parsed object it has always had, and a parser that leaked out
    // of the billing scope would quietly hand `rawBody` to routes that then
    // keep whole request bodies alive in memory for no reason.
    const { buildServer } = await import('./server.js')
    const app = await buildServer()
    await app.ready()

    // An unsigned webhook call is refused *by the handler*, which means the
    // body reached it — a parser collision would have failed at boot instead.
    const webhook = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: '{"id":"evt_1"}',
    })
    expect(webhook.statusCode).toBe(400)

    // And an ordinary route still parses JSON the ordinary way: 401 for no
    // token, rather than a body-parsing error.
    const ordinary = await app.inject({
      method: 'POST',
      url: '/api/library/decks',
      headers: { 'content-type': 'application/json' },
      payload: '{"decks":[]}',
    })
    expect(ordinary.statusCode).toBe(401)

    await app.close()
  })

  it('still boots with no Stripe configuration at all', async () => {
    // A contributor without a Stripe account has to be able to run the API,
    // and the parser registration must not depend on the keys being present.
    vi.resetModules()
    vi.doMock('./env.js', () => ({
      env: {
        DATABASE_URL: 'postgres://test',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
        WEB_ORIGINS: '',
        PG_POOL_MAX: 4,
        NODE_ENV: 'test',
        PORT: 8099,
        RUN_MIGRATIONS_ON_START: false,
        DEV_LOGIN_ACCOUNTS: [],
        APP_URL: '',
      },
      isProduction: false,
      webOrigins: [],
    }))
    const { buildServer } = await import('./server.js')
    const app = await buildServer()
    await app.ready()
    expect(app.hasRoute({ method: 'POST', url: '/api/billing/webhook' })).toBe(true)
    await app.close()
  })
})
