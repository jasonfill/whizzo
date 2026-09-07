// Configuration, validated once at boot.
//
// A missing variable should stop the process here with a readable message
// rather than surface as a confusing 500 on the first request that needs it.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// --- .env -------------------------------------------------------------------
//
// Load apps/api/.env for local development. In production App Platform injects
// the real variables and no file exists, so this is a no-op there.
//
// Node's loader deliberately does NOT override variables that are already set,
// which is the correct precedence but also a trap: a value exported into your
// shell earlier silently beats the file you just edited, and the symptom is the
// API connecting somewhere you stopped pointing it. So anything the shell is
// shadowing gets called out by name below.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shadowed: string[] = []

// Snapshot the real environment before any file is loaded. Comparing against
// live process.env would flag `.env` losing to `.env.local` as shell shadowing,
// when that is exactly the precedence we want.
const fromShell = { ...process.env }

// `.env.local` first, then `.env`. Because the loader never overwrites a value
// that is already set, loading in this order gives the Vite-style precedence
// people expect: .env.local wins. That is what lets you keep hosted-project
// credentials in .env and a local stack in .env.local without editing either
// when you switch.
for (const file of ['.env.local', '.env']) {
  const envFile = resolve(packageRoot, file)
  if (!existsSync(envFile)) continue
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (!key) continue
      const value = (rawValue ?? '').trim().replace(/^["']|["']$/g, '')
      const current = fromShell[key]
      if (value && current && current !== value && !shadowed.includes(key)) {
        shadowed.push(key)
      }
    }
    process.loadEnvFile(envFile)
  } catch (err) {
    console.warn(`Could not read ${envFile}:`, err instanceof Error ? err.message : err)
  }
}

if (shadowed.length) {
  console.warn(
    `\nHeads up: your shell already sets ${shadowed.join(', ')}, and those values win ` +
      `over apps/api/.env.\nIf you edited the file and nothing changed, that is why. ` +
      `Clear them with:\n  unset ${shadowed.join(' ')}\n`,
  )
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),

  /**
   * Postgres connection for request traffic. Use Supabase's **transaction**
   * pooler (port 6543): every query here runs inside an explicit transaction,
   * which is exactly what that mode supports.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Project URL, e.g. https://abcdefgh.supabase.co — used to derive the JWKS. */
  SUPABASE_URL: z.string().url(),

  /**
   * Only needed for the symmetric (HS256) JWTs older projects issue. Newer
   * projects sign asymmetrically and are verified from the JWKS instead, so
   * this stays optional.
   */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  /**
   * Admin key. Required only by the routes that mint child sessions; the API
   * boots without it so the rest of the surface works before that lands.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  /**
   * Needed only by document ingestion, and optional for the same reason the
   * service-role key is: a contributor without one should still be able to run
   * the whole rest of the API. The content routes refuse politely when it is
   * absent rather than the process refusing to boot.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Comma-separated origins allowed to call the API. Empty means same-origin
   * only, which is the production shape: the SPA and the API sit behind one
   * DigitalOcean app on one hostname.
   */
  WEB_ORIGINS: z.string().default(''),

  /** Postgres pool ceiling. App Platform instances are small; so is this. */
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Server-side secret used to stretch a child's PIN into the actual Supabase
   * password. A four-digit PIN is not a credential; HMAC'd with this it is.
   * Rotating this invalidates every provisioned child login, so treat it as
   * permanent once set. Required only by the child-login routes.
   */
  CHILD_LOGIN_SECRET: z.string().min(32).optional(),

  /**
   * Domain for the synthetic addresses provisioned child accounts are created
   * with. It never receives mail and is never shown to anyone.
   */
  CHILD_EMAIL_DOMAIN: z.string().default('no-reply.whizzo.app'),

  /**
   * Enables POST /api/dev/login, which mints a session for a nominated test
   * account without a password. Absent by default, and absent is the only safe
   * value anywhere but a developer's own machine — the route is not registered
   * at all unless this is set.
   *
   * It exists because verifying signed-in screens otherwise needs a human to
   * type a password into a browser. That convenience is also exactly why it
   * would be a catastrophic thing to ship: see the guards in devLogin.ts, and
   * the hard stop in server.ts that refuses to boot with this set in
   * production.
   */
  DEV_LOGIN_SECRET: z.string().min(16).optional(),

  /**
   * Comma-separated accounts /api/dev/login will mint sessions for — email
   * addresses, user ids, or a mix. There is no wildcard on purpose: the blast
   * radius of a leaked dev secret should be the accounts you nominated for
   * testing, never a real customer's.
   */
  DEV_LOGIN_ACCOUNTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Apply pending migrations before serving traffic. On by default: a deploy
   * that ships a migration and a route that needs it should not have a window
   * where only one of them is live.
   */
  RUN_MIGRATIONS_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Connection used only for migrations. Point this at Supabase's **session**
   * pooler (port 5432), not the transaction pooler on 6543: the runner holds a
   * pg_advisory_lock, and advisory locks are session-scoped.
   *
   * Not the old direct host either — `db.<ref>.supabase.co` is IPv6-only unless
   * the project has the IPv4 add-on, so it fails with ENOTFOUND on most
   * machines. Falls back to DATABASE_URL.
   */
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),

  /** Ceiling on any single migration statement. */
  MIGRATION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  /** Override where the .sql files are read from. Rarely needed. */
  MIGRATIONS_DIR: z.string().min(1).optional(),

  // --- Stripe --------------------------------------------------------------
  //
  // All optional, for the same reason the Anthropic key is: a contributor
  // without a Stripe account should be able to run the whole rest of the API.
  // The billing routes refuse politely when these are absent rather than the
  // process refusing to boot.

  /** Secret key, `sk_...`. Absent means payments are off in this build. */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),

  /**
   * Signing secret for the webhook endpoint, `whsec_...`.
   *
   * Separate from the secret key and not interchangeable with it. Without this
   * the webhook cannot verify that a request came from Stripe, and an
   * unverified webhook is an open endpoint for granting yourself coverage — so
   * its absence refuses the route rather than skipping the check.
   */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * The two recurring prices: one for the first child, one for each after.
   *
   * Two flat prices rather than one graduated tier, so the arithmetic lives in
   * this repository where it can be tested against the number the pricing page
   * renders. A tier configured in the Stripe dashboard is a price nothing here
   * can see or assert.
   */
  STRIPE_PRICE_FIRST: z.string().min(1).optional(),
  STRIPE_PRICE_EXTRA: z.string().min(1).optional(),

  /**
   * Where the SPA lives, for Stripe's return URLs.
   *
   * Stripe sends the parent back here after checkout, so a wrong value is a
   * paid customer landing on somebody else's site. Defaults to same-origin,
   * which is the production shape.
   */
  APP_URL: z.string().default(''),

  // --- MCP ---------------------------------------------------------------------
  //
  // The app as tools for an assistant (docs/mcp-tutor-spec.md). Optional like
  // the other integrations: without a secret the OAuth and /mcp routes refuse
  // politely and everything else runs.

  /**
   * Signs the access and refresh tokens the API's own OAuth server issues to
   * assistants. Separate from every Supabase secret on purpose: those tokens
   * are for the app, these are for `/mcp`, and neither is ever accepted by
   * the other. Rotating this signs every assistant out; they reconnect.
   */
  MCP_TOKEN_SECRET: z.string().min(32).optional(),

  /**
   * The canonical URL of the MCP endpoint, e.g. https://whizzo.app/mcp — the
   * audience every token is bound to (RFC 8707) and what the protected
   * resource metadata names. Defaults to APP_URL + /mcp.
   */
  MCP_PUBLIC_URL: z.string().url().optional(),
})

/**
 * An unset variable and one set to the empty string mean the same thing here.
 *
 * `.env` files and App Platform both hand you `KEY=` as an empty string rather
 * than leaving the key out, and zod's `.optional()` only accepts `undefined` —
 * so without this, deliberately blanking an optional secret (which is exactly
 * what you do when your project signs JWTs asymmetrically) fails validation and
 * the process exits.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === '' ? undefined : value
  }
  return out
}

const parsed = schema.safeParse(withoutBlanks(process.env))

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`Invalid environment:\n${detail}`)
  process.exit(1)
}

export const env = parsed.data

export const isProduction = env.NODE_ENV === 'production'

// Developing against a hosted project is legitimate, but it should never be a
// surprise: writes hit real learners, and migrations run on startup. Say so.
if (!isProduction && /supabase\.(co|com)/.test(env.DATABASE_URL)) {
  const target = /pooler\.supabase\.com/.test(env.DATABASE_URL) ? 'pooler' : 'direct'
  console.warn(
    `\n  NOTE: NODE_ENV=${env.NODE_ENV} but DATABASE_URL points at a hosted Supabase ` +
      `project (${target}).\n  Writes affect real data, and pending migrations will be ` +
      `applied at startup.\n  For an isolated stack see apps/api/README.md; to skip ` +
      `migrating set RUN_MIGRATIONS_ON_START=false.\n`,
  )
}

export const webOrigins = env.WEB_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
