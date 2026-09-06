// The Whizzo API.
//
// Deployed alongside the SPA as a second component of one DigitalOcean app, so
// in production this is same-origin with the web app and CORS is a development
// convenience rather than a dependency.

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { closePool, pool } from './db.js'
import { env, isProduction, webOrigins } from './env.js'
import { fromDatabaseError, HttpError, fromValidationError } from './errors.js'
import { pendingMigrations, runMigrations } from './migrate.js'
import { childLoginAdminRoutes, childLoginPublicRoutes } from './routes/childLogin.js'
import { devLoginRoutes } from './routes/devLogin.js'
import { inviteRoutes, learnerRoutes } from './routes/learners.js'
import { callerOf, requireCaller } from './auth.js'
import { contentRoutes } from './routes/content.js'
import { progressRoutes } from './routes/progress.js'
import { rewardRoutes } from './routes/rewards.js'
import { billingRoutes } from './routes/billing.js'

export async function buildServer() {
  const app = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty' } },
    // App Platform terminates TLS in front of us, so the client's real address
    // and scheme arrive in forwarding headers.
    trustProxy: true,
    disableRequestLogging: false,
  })

  // Plenty of HTTP clients set a JSON content-type on a DELETE that carries no
  // body. Fastify's default parser calls that a malformed request; treating an
  // empty body as absent is friendlier and costs nothing, since every route
  // validates its own input anyway.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, payload, done) => {
      const text = typeof payload === 'string' ? payload.trim() : ''
      if (!text) {
        done(null, undefined)
        return
      }
      try {
        done(null, JSON.parse(text))
      } catch {
        done(new HttpError(400, 'That request body was not valid JSON', 'bad_json'), undefined)
      }
    },
  )

  await app.register(helmet, {
    // The API serves JSON, never markup; the SPA carries its own policy.
    contentSecurityPolicy: false,
  })

  await app.register(cors, {
    origin: webOrigins.length ? webOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Behind App Platform every request shares the proxy's address unless we
    // key on the forwarded one.
    keyGenerator: (request) => request.ip,
  })

  // One place to turn an exception into a response. Database refusals are
  // answers, not failures, so they are mapped rather than swallowed as 500s.
  app.setErrorHandler((error, request, reply) => {
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
      request.log.info({ err: error }, 'database refused the request')
      reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      return
    }

    // Fastify's own refusals (a malformed body, a rate limit) already carry a
    // status; pass those through rather than dressing them as 500s.
    const withStatus = error as { statusCode?: number; message?: string }
    if (withStatus.statusCode && withStatus.statusCode < 500) {
      reply.code(withStatus.statusCode).send({
        error: { code: 'bad_request', message: withStatus.message ?? 'That request was not valid' },
      })
      return
    }

    request.log.error({ err: error }, 'unhandled error')
    reply.code(500).send({
      error: { code: 'internal', message: 'Something went wrong on our side' },
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'No such endpoint' } })
  })

  // App Platform polls this; keep it cheap but real — a process that cannot
  // reach Postgres is not healthy, however well it answers HTTP.
  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('select 1')
      return { status: 'ok', uptime: Math.round(process.uptime()) }
    } catch (err) {
      reply.code(503)
      return { status: 'degraded', detail: err instanceof Error ? err.message : 'unknown' }
    }
  })

  // Only ever registered on a developer's machine, and only when they have
  // deliberately set a secret. The four guards are in devLogin.ts; the fatal
  // check for the production case is at the top of main().
  if (env.DEV_LOGIN_SECRET) {
    await app.register(devLoginRoutes, { prefix: '/api' })
    app.log.warn(
      { allowed: env.DEV_LOGIN_ACCOUNTS },
      'DEV LOGIN IS ENABLED: POST /api/dev/login mints sessions for the listed accounts ' +
        'without a password. Never set DEV_LOGIN_SECRET in a deployed environment.',
    )
  }

  await app.register(learnerRoutes, { prefix: '/api' })
  await app.register(progressRoutes, { prefix: '/api' })
  await app.register(childLoginAdminRoutes, { prefix: '/api' })
  await app.register(rewardRoutes, { prefix: '/api' })

  // Billing sits in its own scope with a tighter limiter than the rest: every
  // route here either opens a Stripe session or changes what somebody is
  // charged, and none of them is worth calling in a loop. The webhook is
  // exempt — Stripe retries, sometimes in bursts, and rate-limiting our own
  // payment provider into a three-day retry backlog would be a self-inflicted
  // outage.
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 30,
      timeWindow: '1 hour',
      allowList: (request) => request.url.endsWith('/billing/webhook'),
      keyGenerator: (request) => request.caller?.id ?? request.ip,
    })
    await scoped.register(billingRoutes, { prefix: '/api' })
  })

  // Ingestion gets its own rate-limit scope. The global 300/min is irrelevant
  // here — a handful of jobs an hour is the shape, because each one costs real
  // money and the global limit would let somebody spend a month's credits in a
  // minute.
  await app.register(async (scoped) => {
    // Identify the caller here rather than leaving it to the routes. The
    // limiter keys on `onRequest`, which runs before any route's `preHandler`,
    // so without this its key generator would be reaching for a caller that
    // has not been worked out yet — and one ceiling shared by every signed-in
    // user on an IP is not the ceiling this is trying to impose.
    scoped.addHook('onRequest', requireCaller)
    await scoped.register(rateLimit, {
      max: 12,
      timeWindow: '1 hour',
      keyGenerator: (request) => callerOf(request).id,
    })
    await scoped.register(contentRoutes, { prefix: '/api' })
  })

  // Redeeming is a guess surface: a short code, typed by a human. The database
  // refuses expired and used codes, but nothing there slows down someone trying
  // thousands, so this does.
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 10,
      timeWindow: '10 minutes',
      keyGenerator: (request) => request.ip,
    })
    await scoped.register(inviteRoutes, { prefix: '/api' })
  })

  // The only unauthenticated write in the product, guarding a four-digit PIN.
  // Tighter than anything else here, and deliberately so: the HMAC stretch
  // means a guessed PIN is not enough, but there is no reason to let anyone
  // stand at the door trying.
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '15 minutes',
      keyGenerator: (request) => request.ip,
    })
    await scoped.register(childLoginPublicRoutes, { prefix: '/api' })
  })

  return app
}

async function main(): Promise<void> {
  // Before anything else, and fatal. A password-free way into a nominated
  // account is survivable on a laptop and unforgivable in production; refusing
  // to start is the only response that cannot be ignored or missed in a log.
  if (env.DEV_LOGIN_SECRET && env.NODE_ENV === 'production') {
    console.error(
      '\nFATAL: DEV_LOGIN_SECRET is set and NODE_ENV=production.\n' +
        '/api/dev/login mints sessions without a password. Unset DEV_LOGIN_SECRET\n' +
        'in this environment before starting the server.\n',
    )
    process.exit(1)
  }

  const app = await buildServer()

  // Before the listener, not after: an instance that cannot bring the schema up
  // to date must not take traffic. A failure here is fatal on purpose.
  if (env.RUN_MIGRATIONS_ON_START) {
    try {
      const result = await runMigrations({
        info: (msg) => app.log.info({ scope: 'migrate' }, msg),
        warn: (msg) => app.log.warn({ scope: 'migrate' }, msg),
      })
      app.log.info(
        {
          applied: result.applied,
          adopted: result.adopted,
          skipped: result.skipped.length,
        },
        result.applied.length || result.adopted.length
          ? `applied ${result.applied.length}, adopted ${result.adopted.length} migration(s)`
          : 'schema is up to date',
      )
    } catch (err) {
      app.log.error({ err }, 'migrations failed — refusing to start')
      process.exit(1)
    }
  } else {
    // Disabled is a reasonable choice — especially pointed at a hosted database
    // — but it must not mean "find out later". Check, say nothing if clean.
    try {
      const pending = await pendingMigrations()
      if (pending.length) {
        app.log.warn(
          { pending },
          `RUN_MIGRATIONS_ON_START is false and ${pending.length} migration(s) are ` +
            `pending: ${pending.join(', ')}. Apply them with ` +
            `\`npm run migrate --workspace @whizzo/api\`.`,
        )
      } else {
        app.log.info('migrations are disabled at startup; schema is already current')
      }
    } catch (err) {
      app.log.warn({ err }, 'could not check for pending migrations')
    }
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down')
    try {
      await app.close()
      await closePool()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'failed to shut down cleanly')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  try {
    // 0.0.0.0 rather than localhost: App Platform routes to the container's
    // published port from outside the container.
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error({ err }, 'failed to start')
    process.exit(1)
  }
}

// Only self-start when run directly, so tests can import buildServer().
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
