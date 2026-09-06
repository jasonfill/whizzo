// Turning a document into practice material.
//
// The shape worth noticing: **nothing here spends money without saying what it
// will cost first.** A source is registered and read for its page count, the
// estimate comes back to the client, and only a second, explicit call starts
// the run. That is one more round trip and it is the difference between a
// parent choosing to spend twenty credits and discovering they did.

import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  authorizeJob,
  creditBalance,
  estimateJob,
  type CreditEntry,
} from '@whizzo/shared'
import { callerOf, requireCaller } from '../auth.js'
import { withAdmin, withUser } from '../db.js'
import { badRequest, notFound } from '../errors.js'
import { env } from '../env.js'
import { toJobView, type JobRow } from '../content/jobs.js'
import { fetchSource, googleExportUrl, screenUrl } from '../content/fetch.js'
import { anthropic, storeFile } from '../content/client.js'
import {
  MAX_FILES_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  digestOf,
  pagesOf,
  screenUpload,
} from '../content/upload.js'

const uuid = z.string().uuid('That is not a valid id')

const linkSchema = z.object({ url: z.string().min(1).max(2000) })

/**
 * The estimate's one query parameter.
 *
 * Spelled out rather than left to `z.coerce.boolean()`, which treats every
 * non-empty string as true — including the string `"false"`. That is the whole
 * bug: asking for the full-price quote returned the half-price one, so a parent
 * was shown three credits and charged five. An under-quote is the one failure
 * this flow exists to prevent, and it is invisible in a test that only ever
 * passes `true`.
 */
const querySchema = z.object({
  noRush: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
})

const buildSchema = z.object({
  topicIds: z.array(z.string().max(60)).max(20).default([]),
  /** Half the credits, lands within a day. */
  noRush: z.boolean().default(false),
  target: z
    .union([z.literal('library'), z.object({ learnerIds: z.array(uuid).min(1).max(40) })])
    .default('library'),
})

/* eslint-disable @typescript-eslint/no-explicit-any */
function toJobRow(row: any): JobRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    stageDetail: row.stage_detail ?? {},
    claimedAt: row.claimed_at ? Date.parse(row.claimed_at) : null,
    heartbeatAt: row.heartbeat_at ? Date.parse(row.heartbeat_at) : null,
    attempts: row.attempts ?? 0,
    error: row.error ?? null,
    result: row.result ?? null,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  // Every route here is a grown-up's, and every one of them either spends money
  // or reads what was spent.
  app.addHook('preHandler', requireCaller)

  // Registered on this plugin rather than the server, so the one surface that
  // takes files is the only one that will parse them.
  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      // Deliberately looser than MAX_FILES_PER_REQUEST. The plugin's own limit
      // aborts the whole request with its error rather than ours, so the
      // friendly "only ten at a time, send the rest after these" would never be
      // the thing anybody read. Ten is the answer people get; this is the point
      // at which we stop reading bytes at all.
      files: MAX_FILES_PER_REQUEST * 3,
      // Nothing here reads a non-file field, and accepting them invites a
      // request that is entirely fields.
      fields: 0,
    },
  })

  /**
   * Whether this feature is available at all.
   *
   * A contributor running the API without a key should get a clear answer
   * rather than a 500 from three layers down, and the client should be able to
   * hide the upload door rather than offering something that cannot work.
   */
  const enabled = Boolean(env.ANTHROPIC_API_KEY)

  app.get('/content/status', async (request) => {
    const caller = callerOf(request)
    if (!enabled) return { enabled: false, balance: null }

    const balance = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select kind, bucket, credits from public.credit_ledger
          where user_id = $1
             or subscription_id in (select id from public.subscriptions where payer_id = $1)`,
        [caller.id],
      )
      return creditBalance(rows as CreditEntry[])
    })
    return { enabled: true, balance }
  })

  /**
   * Register a link as a source.
   *
   * Screened here and fetched by the runner, so an obviously bad link is
   * refused while the person is still looking at the field rather than in a
   * job that fails a minute later.
   */
  app.post('/content/sources/link', async (request) => {
    if (!enabled) throw badRequest('Document upload is not switched on here.', 'not_enabled')
    const caller = callerOf(request)
    const { url } = linkSchema.parse(request.body)

    const screened = screenUrl(url)
    if (!screened.ok) throw badRequest(screened.message, screened.code)

    const target = googleExportUrl(screened.url) ?? screened.url

    // Creating a source and its job is a service-role write: 0017 grants the
    // authenticated role select and delete only, deliberately, so that a client
    // can watch a run and never start one. The owner is the verified `sub` from
    // the token rather than anything the request supplied, which is what makes
    // bypassing RLS safe here.
    // Fetched here rather than left to a job, and the reason is the number on
    // the next screen. A source registered without its bytes has no page count,
    // and `creditsForPages(0)` is the five-credit floor — so every link, a
    // one-page worksheet and a forty-page chapter alike, quoted as "0 pages,
    // about 5 credits". A quote that is the same for every document is not an
    // estimate, it is a placeholder, and this flow exists precisely so that
    // nobody is asked to accept one.
    const got = await fetchSource(target)
    if (!got.ok) throw badRequest(got.message, got.code)

    const named = decodeURIComponent(target.pathname.split('/').filter(Boolean).pop() ?? 'document')
    const usable = screenUpload({
      filename: named,
      mime: got.fetched.mime,
      bytes: got.fetched.bytes.length,
    })
    if (!usable.ok) throw badRequest(usable.message, usable.code)

    const counted = await pagesOf(usable.kind, got.fetched.bytes)
    if (!counted.ok) throw badRequest(counted.message, counted.code)

    const sha = digestOf(got.fetched.bytes)

    // Same document, already here. Skip the second upload and the second bill.
    const existing = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select id from public.content_sources
          where sha256 = $1 and provider_file_id is not null
          limit 1`,
        [sha],
      )
      return rows[0] ?? null
    })
    if (existing) return { sourceId: existing.id as string }

    const stored = await storeFile(anthropic(), {
      filename: named,
      mime: got.fetched.mime,
      bytes: got.fetched.bytes,
      kind: usable.kind,
    })

    return withAdmin(async (db) => {
      const { rows } = await db.query(
        `insert into public.content_sources
           (owner_user_id, kind, origin, mime, bytes, pages, sha256, provider_file_id)
         values ($1, 'link', $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          caller.id,
          target.toString(),
          got.fetched.mime,
          got.fetched.bytes.length,
          counted.pages,
          sha,
          stored.fileId,
        ],
      )
      return { sourceId: rows[0].id as string }
    })
  })

  /**
   * Hand over files directly.
   *
   * Several at once, and **each file becomes its own source, its own job and
   * its own charge.** That is the whole design decision here: a parent handing
   * over three chapters gets three sets of cards, one bad file does not take
   * the other two down with it, and every quote on the next screen is a number
   * about a document they can name.
   *
   * Unlike a link, a file needs no acquisition step later — the bytes are here,
   * so they go to the Files API now and the page count is exact before the
   * person has been shown a price. That is why no job is queued at this point:
   * nothing is running, and saying otherwise would put a spinner on a screen
   * where the honest answer is "waiting for you".
   */
  app.post('/content/sources/upload', async (request) => {
    if (!enabled) throw badRequest('Document upload is not switched on here.', 'not_enabled')
    const caller = callerOf(request)

    if (!request.isMultipart()) {
      throw badRequest('Send the files as a form upload.', 'not_multipart')
    }

    const accepted: Array<{
      filename: string
      mime: string
      kind: 'pdf' | 'image' | 'text'
      pages: number
      sha256: string
      bytes: Buffer
    }> = []
    const rejected: Array<{ filename: string; reason: string }> = []

    // Every part is drained, including the ones being refused. A part left
    // unread leaves the request hanging rather than failing, which reads to the
    // person waiting as the upload having silently stopped.
    for await (const part of request.files()) {
      const filename = part.filename || 'that file'
      if (accepted.length + rejected.length >= MAX_FILES_PER_REQUEST) {
        await part.toBuffer().catch(() => Buffer.alloc(0))
        rejected.push({
          filename,
          reason: `Only ${MAX_FILES_PER_REQUEST} files at a time. Send the rest after these.`,
        })
        continue
      }

      let bytes: Buffer
      try {
        bytes = await part.toBuffer()
      } catch {
        rejected.push({ filename, reason: 'That file did not finish uploading.' })
        continue
      }

      // The multipart limit truncates rather than throwing, so a file over the
      // ceiling arrives looking complete and shorter than it is.
      if (part.file.truncated) {
        const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)
        rejected.push({
          filename,
          reason: `That file is bigger than ${mb}MB. Split it and upload the part you need.`,
        })
        continue
      }

      const screened = screenUpload({ filename, mime: part.mimetype, bytes: bytes.length })
      if (!screened.ok) {
        rejected.push({ filename, reason: screened.message })
        continue
      }

      const counted = await pagesOf(screened.kind, bytes)
      if (!counted.ok) {
        rejected.push({ filename, reason: counted.message })
        continue
      }

      accepted.push({
        filename,
        mime: part.mimetype.split(';')[0]!.trim().toLowerCase(),
        kind: screened.kind,
        pages: counted.pages,
        sha256: digestOf(bytes),
        bytes,
      })
    }

    if (!accepted.length && !rejected.length) {
      throw badRequest('No files arrived.', 'no_files')
    }

    const client = accepted.length ? anthropic() : null
    const sources: Array<{ sourceId: string; filename: string; pages: number }> = []

    for (const file of accepted) {
      try {
        // The same file twice is the same file. Reusing the row skips a second
        // upload and, more to the point, means the parent is not asked to pay
        // twice for a document they already handed over.
        const existing = await withUser(caller.id, async (db) => {
          const { rows } = await db.query(
            `select id, pages from public.content_sources
              where sha256 = $1 and provider_file_id is not null
              limit 1`,
            [file.sha256],
          )
          return rows[0] ?? null
        })
        if (existing) {
          sources.push({
            sourceId: existing.id as string,
            filename: file.filename,
            pages: (existing.pages as number) ?? file.pages,
          })
          continue
        }

        const stored = await storeFile(client!, {
          filename: file.filename,
          mime: file.mime,
          bytes: file.bytes,
          kind: file.kind,
        })

        // Service-role, for the reason the link route is: 0017 grants the
        // authenticated role no insert on this table, deliberately.
        const row = await withAdmin(async (db) => {
          const { rows } = await db.query(
            `insert into public.content_sources
               (owner_user_id, kind, origin, mime, bytes, pages, sha256, provider_file_id)
             values ($1, 'upload', $2, $3, $4, $5, $6, $7)
             returning id`,
            [
              caller.id,
              file.filename,
              file.mime,
              file.bytes.length,
              file.pages,
              file.sha256,
              stored.fileId,
            ],
          )
          return rows[0]
        })
        sources.push({ sourceId: row.id as string, filename: file.filename, pages: file.pages })
      } catch (err) {
        request.log.error({ err, filename: file.filename }, 'upload failed')
        rejected.push({ filename: file.filename, reason: 'That file could not be stored.' })
      }
    }

    return { sources, rejected }
  })

  /** Watch a run. The client polls this; the row is the only progress there is. */
  app.get('/content/jobs/:id', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.content_jobs where id = $1', [id])
      // RLS is the filter: from inside the transaction, "not yours" and "not
      // there" are genuinely the same thing.
      if (!rows.length) throw notFound('No such run')
      return { job: toJobView(toJobRow(rows[0])) }
    })
  })

  /**
   * What this document will cost, before anything is spent.
   *
   * Separate from starting the run on purpose. The page count is known once the
   * file is registered, so the estimate is exact — and showing it to the person
   * deciding is the whole reason the two calls are not one.
   */
  app.get('/content/sources/:id/estimate', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    const { noRush } = querySchema.parse(request.query)

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.content_sources where id = $1', [id])
      if (!rows.length) throw notFound('No such document')
      const pages = rows[0].pages ?? 0

      const ledger = await db.query(
        `select kind, bucket, credits from public.credit_ledger
          where user_id = $1
             or subscription_id in (select id from public.subscriptions where payer_id = $1)`,
        [caller.id],
      )
      const balance = creditBalance(ledger.rows as CreditEntry[])
      const covered = await isAnyLearnerCovered(db, caller.id)
      const decision = authorizeJob(balance, pages, { covered, noRush })

      return {
        estimate: estimateJob(pages, noRush),
        balance,
        allowed: decision.ok,
        reason: decision.ok ? null : decision.reason,
      }
    })
  })

  /**
   * Start the run.
   *
   * Refuses here rather than inside the job, so a parent who cannot afford it
   * finds out immediately and the refusal carries the number the next screen
   * needs.
   */
  app.post('/content/sources/:id/build', async (request, reply) => {
    if (!enabled) throw badRequest('Document upload is not switched on here.', 'not_enabled')
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    const body = buildSchema.parse(request.body ?? {})

    // Two transactions, and the split is the point: the source is read as the
    // caller, so RLS deciding whether the row is visible *is* the ownership
    // check, and the policy stays the single place that knows what "yours"
    // means. Only the insert — which the authenticated role has no grant for —
    // runs as the service role, and by then the row has been proven visible.
    const authorized = await withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.content_sources where id = $1', [id])
      if (!rows.length) throw notFound('No such document')

      const ledger = await db.query(
        `select kind, bucket, credits from public.credit_ledger
          where user_id = $1
             or subscription_id in (select id from public.subscriptions where payer_id = $1)`,
        [caller.id],
      )
      const balance = creditBalance(ledger.rows as CreditEntry[])
      const covered = await isAnyLearnerCovered(db, caller.id)
      const decision = authorizeJob(balance, rows[0].pages ?? 0, { covered, noRush: body.noRush })
      return { balance, decision }
    })

    if (!authorized.decision.ok) {
      reply.code(402)
      return {
        error: authorized.decision.reason,
        estimate: authorized.decision.estimate,
        balance: authorized.balance,
      }
    }

    return withAdmin(async (db) => {
      const job = await db.query(
        `insert into public.content_jobs (source_id, stage_detail)
         values ($1, $2) returning *`,
        [id, JSON.stringify({ topicIds: body.topicIds, noRush: body.noRush, target: body.target })],
      )
      return { job: toJobView(toJobRow(job.rows[0])) }
    })
  })

  /**
   * Accept a draft.
   *
   * One action on the whole set, because the three-action setup budget does not
   * survive line-by-line review being mandatory. Editing exists and nobody has
   * to use it.
   */
  app.post('/library/decks/:id/accept', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.decks set accepted_at = now(), updated_at = now()
          where id = $1 and accepted_at is null
          returning id, accepted_at`,
        [id],
      )
      // Already accepted is not an error — a second tap on a slow connection
      // should not read as a failure.
      if (!rows.length) {
        const existing = await db.query('select id, accepted_at from public.decks where id = $1', [id])
        if (!existing.rows.length) throw notFound('No such set')
        return { acceptedAt: Date.parse(existing.rows[0].accepted_at) }
      }
      return { acceptedAt: Date.parse(rows[0].accepted_at) }
    })
  })

  app.delete('/content/sources/:id', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    await withUser(caller.id, async (db) => {
      await db.query('delete from public.content_sources where id = $1', [id])
    })
    return { ok: true }
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Whether this caller covers anybody, which is what lifts the page cap.
 *
 * Scoped by the caller rather than left to row-level security. RLS does filter
 * `learners` here, so both give the same answer today — but the rule is a
 * business rule, and one that silently becomes "is anyone in the system
 * covered?" the first time it is called without a user context is not one worth
 * relying on. The runner is exactly that context.
 */
async function isAnyLearnerCovered(db: any, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1
       from public.learners l
      where (
              l.owner_id = $1
              or exists (
                select 1 from public.guardian_links g
                 where g.learner_id = l.id and g.guardian_id = $1
              )
            )
        and public.is_learner_covered(l.id)
      limit 1`,
    [userId],
  )
  return rows.length > 0
}
/* eslint-enable @typescript-eslint/no-explicit-any */

