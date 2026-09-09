// Schema migrations, applied at API startup.
//
// Deliberately not an ORM's migration tool. The migrations are hand-written
// SQL that is tested directly (supabase/tests) and documented for pasting into
// the Supabase SQL editor; a framework would either have to re-express them in
// a JavaScript DSL or act as an expensive file loader. So this runs the files.
//
// What it does add over `psql -f` is the three things that matter in a deployed
// service:
//
//   * an advisory lock, so two instances starting at once cannot both migrate
//   * a ledger, so each file is applied once rather than every boot
//   * a hard stop, so the process refuses to serve traffic against a database
//     it could not bring up to date
//
// The migrations are individually idempotent as well, which makes this a belt
// as much as braces.

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { explainConnectionError } from './db.js'
import { env } from './env.js'

/** An arbitrary but fixed key; any process migrating this database uses it. */
const MIGRATION_LOCK_KEY = 8_147_233_901

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Where the .sql files live.
 *
 * The build copies them next to the compiled output so the running service does
 * not depend on the repository layout around it. The source-tree path is the
 * fallback for `tsx watch` in development.
 */
function migrationsDir(): string {
  const candidates = [
    env.MIGRATIONS_DIR,
    join(here, 'migrations'),
    resolve(here, '../../../supabase/migrations'),
  ].filter((c): c is string => Boolean(c))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `No migrations directory found. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  )
}

interface Applied {
  name: string
  checksum: string
}

export interface MigrationResult {
  applied: string[]
  skipped: string[]
  /** Recorded as done without running, because the schema already had them. */
  adopted: string[]
}

/**
 * A migration may declare how to recognize that it is already present:
 *
 *   -- @applied-if: select to_regclass('public.learners') is not null
 *
 * This matters because these migrations are idempotent individually but not in
 * sequence: 0001 rewrites policies against a `user_id` column that 0003
 * renames, so re-running 0001 on a fully-migrated database fails. Any database
 * that was migrated by hand — which is exactly what supabase/README.md tells
 * people to do — starts with an empty ledger, and without this the first boot
 * of the service would try to replay everything and refuse to start.
 *
 * A file with no predicate always runs, so new migrations are unaffected.
 */
function appliedIfPredicate(sql: string): string | null {
  const match = /^\s*--\s*@applied-if:\s*(.+)$/im.exec(sql)
  return match?.[1]?.trim() ?? null
}

async function ensureLedger(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists public.schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms int
    )
  `)
  // Internal bookkeeping: nothing in a browser should see it.
  await client.query('alter table public.schema_migrations enable row level security')
  await client.query('revoke all on public.schema_migrations from anon, authenticated')
}

/**
 * Which migrations would run, without running anything.
 *
 * Read-only. Exists so that turning the startup runner *off* — which is the
 * right default when a developer is pointed at a hosted database — does not
 * quietly let the schema drift out from under them.
 */
export async function pendingMigrations(): Promise<string[]> {
  const dir = migrationsDir()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  const client = new pg.Client({
    connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  })

  try {
    await client.connect()
  } catch (err) {
    throw explainConnectionError(err)
  }

  try {
    const present = await client.query(
      `select to_regclass('public.schema_migrations') is not null as ok`,
    )
    const ledger = new Set<string>()
    if (present.rows[0]?.ok) {
      const { rows } = await client.query('select name from public.schema_migrations')
      for (const row of rows) ledger.add(row.name)
    }

    const pending: string[] = []
    for (const name of files) {
      if (ledger.has(name)) continue
      const sql = await readFile(join(dir, name), 'utf8')
      const predicate = appliedIfPredicate(sql)
      if (predicate) {
        const { rows } = await client.query(`select (${predicate}) as ok`)
        // Adoptable: already present, so it would be recorded rather than run.
        if (rows[0]?.ok === true) continue
      }
      pending.push(name)
    }
    return pending
  } finally {
    await client.end()
  }
}

export async function runMigrations(log: {
  info: (msg: string) => void
  warn: (msg: string) => void
}): Promise<MigrationResult> {
  const dir = migrationsDir()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  if (!files.length) {
    log.warn(`No .sql migrations found in ${dir}`)
    return { applied: [], skipped: [], adopted: [] }
  }

  // A dedicated connection, not the request pool: migrations are DDL, they can
  // be slow, and they must not run as the `authenticated` role the pool drops
  // to.
  const connectionString = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL

  // Supabase's transaction pooler listens on 6543 and hands out a different
  // backend per transaction. pg_advisory_lock is SESSION-scoped, so under it the
  // lock this function relies on is silently useless — two instances would
  // migrate concurrently and neither would notice. The session pooler (5432)
  // behaves like a direct connection and is the right endpoint here.
  //
  // A warning rather than a hard stop: the lock is a safeguard against a race,
  // not a correctness requirement for a single instance, and refusing to boot
  // over a port number would be its own kind of outage.
  if (/:6543(\/|$|\?)/.test(connectionString)) {
    log.warn(
      'MIGRATION_DATABASE_URL points at port 6543 (transaction pooling); ' +
        'the advisory lock cannot hold across statements there. Use the session ' +
        'pooler on 5432 so concurrent instances cannot migrate at the same time.',
    )
  }

  const client = new pg.Client({
    connectionString,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    statement_timeout: env.MIGRATION_TIMEOUT_MS,
  })

  try {
    await client.connect()
  } catch (err) {
    throw explainConnectionError(err)
  }

  const applied: string[] = []
  const skipped: string[] = []
  const adopted: string[] = []

  try {
    // Blocks rather than failing: a second instance waits for the first to
    // finish and then finds every migration already recorded.
    log.info('waiting for the migration lock')
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

    try {
      await ensureLedger(client)

      const { rows } = await client.query<Applied>('select name, checksum from public.schema_migrations')
      const ledger = new Map(rows.map((r) => [r.name, r.checksum]))

      for (const name of files) {
        const sql = await readFile(join(dir, name), 'utf8')
        const checksum = createHash('sha256').update(sql).digest('hex')
        const recorded = ledger.get(name)

        if (recorded) {
          if (recorded !== checksum) {
            // Not fatal: these files are written to be re-runnable, and an
            // edit to an applied one is usually a comment or a fix that was
            // also applied by hand. Loud, though, because it can also mean the
            // deployed schema is not what this build expects.
            log.warn(
              `migration ${name} has changed since it was applied — the database was not re-migrated`,
            )
          }
          skipped.push(name)
          continue
        }

        // Adoption: the objects are already there, so record it rather than
        // replay it. Sentinels are deliberately late-created, durable objects.
        const predicate = appliedIfPredicate(sql)
        if (predicate) {
          const { rows: present } = await client.query(`select (${predicate}) as ok`)
          if (present[0]?.ok === true) {
            await client.query(
              `insert into public.schema_migrations (name, checksum, duration_ms)
               values ($1, $2, 0)
               on conflict (name) do nothing`,
              [name, checksum],
            )
            adopted.push(name)
            log.info(`adopted ${name} (already present in this database)`)
            continue
          }
        }

        log.info(`applying ${name}`)
        const started = Date.now()

        // Each migration is one transaction: it lands whole or not at all.
        await client.query('begin')
        try {
          await client.query(sql)
          await client.query(
            `insert into public.schema_migrations (name, checksum, duration_ms)
             values ($1, $2, $3)`,
            [name, checksum, Date.now() - started],
          )
          await client.query('commit')
        } catch (err) {
          await client.query('rollback')
          throw new Error(
            `Migration ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          )
        }

        applied.push(name)
        log.info(`applied ${name} in ${Date.now() - started}ms`)
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    await client.end()
  }

  return { applied, skipped, adopted }
}
