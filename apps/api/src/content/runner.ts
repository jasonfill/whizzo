// Running a queued job to completion.
//
// There is no worker process and no queue. A job is a row, and this advances it
// in the background of whichever request noticed it — which is honest about
// what one 0.5 GB instance can be, and means the three things below have to be
// right rather than assumed:
//
//   * **Claiming is atomic.** Two requests noticing the same queued row must
//     not both run it. Running a document twice costs twice and produces two
//     sets of the same cards.
//   * **The heartbeat keeps beating.** A run that stops checking in is reaped
//     and retried; a run that is working but silent would be reaped *while
//     working*, and the money spent twice.
//   * **The ledger is written whatever happens.** A refunded failure and a
//     settled success are both entries; a crash between the model call and the
//     ledger is the one shape that loses money silently.

import { creditBalance, type CreditEntry, type QuizCard } from '@whizzo/shared'
import { runIngestion, type PipelineDeps } from './pipeline.js'
import { isStale, recoverStale, type JobRow } from './jobs.js'
import type { CallUsage } from './model.js'

export interface RunnerDb {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

export interface RunnerDeps extends Omit<PipelineDeps, 'onStage'> {
  db: RunnerDb
}

/**
 * Take the next queued job, if there is one and nobody else got it first.
 *
 * `for update skip locked` is the whole trick: two concurrent claims take
 * different rows rather than blocking on the same one, and a row already being
 * claimed is skipped rather than waited for.
 */
export async function claimNext(db: RunnerDb): Promise<JobRow | null> {
  const { rows } = await db.query(
    `update public.content_jobs
        set status = 'reading',
            claimed_at = now(),
            heartbeat_at = now(),
            attempts = attempts + 1
      where id = (
        select id from public.content_jobs
         where status = 'queued'
         order by created_at
         for update skip locked
         limit 1
      )
      returning *`,
  )
  return rows.length ? toJobRow(rows[0]) : null
}

/** Put abandoned jobs back, or fail them for good. Cheap, and worth doing often. */
export async function sweepStale(db: RunnerDb, now = Date.now()): Promise<number> {
  const { rows } = await db.query(
    `select * from public.content_jobs where status in ('reading', 'building')`,
  )
  let swept = 0
  for (const row of rows) {
    const job = toJobRow(row)
    if (!isStale(job, now)) continue
    const next = recoverStale(job)
    await db.query(
      `update public.content_jobs set status = $2, error = $3, updated_at = now() where id = $1`,
      [job.id, next.status, next.error],
    )
    swept += 1
  }
  return swept
}

export interface RunResult {
  status: 'done' | 'failed'
  setsLanded: number
  error: string | null
}

/**
 * Run one claimed job.
 *
 * Ordered so that the expensive, irreversible thing happens between two records
 * of it: usage is written as each call returns, and the ledger is settled
 * before the drafts are written. A crash after the model call still leaves a
 * ledger and a usage row — the money is accounted for even when the cards are
 * not.
 */
export async function runJob(deps: RunnerDeps, job: JobRow): Promise<RunResult> {
  const detail = job.stageDetail as {
    topicIds?: string[]
    noRush?: boolean
  }

  // A failed heartbeat must not become an unhandled rejection that takes the
  // process down mid-run — the worst possible moment, since the money is
  // already spent. Missing a beat only risks the job being reaped and retried.
  const beat = setInterval(() => {
    deps.db
      .query(`update public.content_jobs set heartbeat_at = now() where id = $1`, [job.id])
      .catch(() => {})
  }, 20_000)
  // Never keep the process alive for a heartbeat.
  if (typeof beat.unref === 'function') beat.unref()

  try {
    const source = await loadSource(deps.db, job.sourceId)
    if (!source) return finish(deps, job, { status: 'failed', setsLanded: 0, error: 'That document is gone.' })

    const balance = creditBalance(await loadLedger(deps.db, source.ownerUserId))
    const covered = await anyCovered(deps.db, source.ownerUserId)

    const usageRows: Array<{ usage: CallUsage; feature: string }> = []
    const outcome = await runIngestion(
      {
        client: deps.client,
        makeCard: deps.makeCard,
        onUsage: async (usage, feature) => {
          usageRows.push({ usage, feature })
          // Written as it happens rather than at the end: a crash mid-run must
          // not lose the record of what was already spent.
          await writeUsage(deps.db, source, usage, feature, job.id)
        },
        onStage: (stage, stageDetail) => {
          void deps.db.query(
            `update public.content_jobs set status = $2, stage_detail = $3, heartbeat_at = now() where id = $1`,
            [job.id, stage, JSON.stringify({ ...detail, ...stageDetail })],
          )
        },
      },
      {
        fileId: source.providerFileId ?? '',
        pages: source.pages ?? 0,
        balance,
        covered,
        noRush: detail.noRush ?? false,
        topicIds: detail.topicIds ?? [],
      },
    )

    // Ledger before drafts. If writing the drafts fails, the money is still
    // accounted for; the other order loses the accounting.
    await writeLedger(deps.db, source, outcome.ledger)

    let landed = 0
    for (const set of outcome.sets) {
      await writeDraft(deps.db, source, set)
      landed += 1
    }

    if (!outcome.cacheHealthy) {
      // Invisible in the output, visible only on the bill — worth a loud line
      // in the job record so somebody notices before the invoice does.
      await deps.db.query(
        `update public.content_jobs set usage = $2 where id = $1`,
        [job.id, JSON.stringify({ cacheHealthy: false, calls: usageRows.length })],
      )
    }

    return finish(deps, job, {
      status: outcome.ok ? 'done' : 'failed',
      setsLanded: landed,
      error: outcome.error,
    })
  } catch (error) {
    return finish(deps, job, {
      status: 'failed',
      setsLanded: 0,
      error: error instanceof Error ? error.message : 'That run did not finish.',
    })
  } finally {
    clearInterval(beat)
  }
}

async function finish(deps: RunnerDeps, job: JobRow, result: RunResult): Promise<RunResult> {
  await deps.db.query(
    `update public.content_jobs
        set status = $2, error = $3, result = $4, updated_at = now()
      where id = $1`,
    [job.id, result.status, result.error, JSON.stringify({ setsLanded: result.setsLanded })],
  )
  return result
}

interface SourceRow {
  id: string
  ownerUserId: string | null
  learnerId: string | null
  pages: number | null
  providerFileId: string | null
}

async function loadSource(db: RunnerDb, id: string): Promise<SourceRow | null> {
  const { rows } = await db.query('select * from public.content_sources where id = $1', [id])
  if (!rows.length) return null
  const r = rows[0] as Record<string, unknown>
  return {
    id: r.id as string,
    ownerUserId: (r.owner_user_id as string) ?? null,
    learnerId: (r.learner_id as string) ?? null,
    pages: (r.pages as number) ?? null,
    providerFileId: (r.provider_file_id as string) ?? null,
  }
}

async function loadLedger(db: RunnerDb, userId: string | null): Promise<CreditEntry[]> {
  if (!userId) return []
  const { rows } = await db.query(
    `select kind, bucket, credits from public.credit_ledger
      where user_id = $1
         or subscription_id in (select id from public.subscriptions where payer_id = $1)`,
    [userId],
  )
  return rows as unknown as CreditEntry[]
}

/**
 * Does this payer cover anybody? That is what lifts the page cap.
 *
 * Scoped explicitly rather than left to row-level security. The runner has no
 * user context — it advances a job in the background — so an unscoped
 * `select 1 from learners where is_learner_covered(...)` would be true whenever
 * *anyone in the system* was covered, and hand every free account the covered
 * cap. RLS is a good backstop and a bad business rule.
 */
async function anyCovered(db: RunnerDb, userId: string | null): Promise<boolean> {
  if (!userId) return false
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

async function writeUsage(
  db: RunnerDb,
  source: SourceRow,
  usage: CallUsage,
  feature: string,
  jobId: string,
): Promise<void> {
  await db.query(
    `insert into public.llm_usage
       (user_id, learner_id, feature, source_id, job_id, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        est_cost_usd, duration_ms, stop_reason, ok)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      source.ownerUserId, source.learnerId, feature, source.id, jobId, usage.model,
      usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens,
      usage.estCostUsd, usage.durationMs, usage.stopReason, usage.ok,
    ],
  )
}

async function writeLedger(db: RunnerDb, source: SourceRow, entries: CreditEntry[]): Promise<void> {
  for (const entry of entries) {
    await db.query(
      `insert into public.credit_ledger (user_id, kind, bucket, credits, source_id)
       values ($1,$2,$3,$4,$5)`,
      [source.ownerUserId, entry.kind, entry.bucket, entry.credits, source.id],
    )
  }
}

async function writeDraft(
  db: RunnerDb,
  source: SourceRow,
  set: { title: string; track: string | null; objectives: string[]; cards: QuizCard[] },
): Promise<void> {
  // `accepted_at` stays null: this is a draft until a grown-up looks at it. It
  // can be practiced and it cannot be assigned or earn a reward.
  await db.query(
    `insert into public.decks
       (owner_user_id, learner_id, title, description, tags, cards,
        term_label, definition_label, track, objectives, source_id, updated_at)
     values ($1,$2,$3,'','{}',$4,'Question','Answer',$5,$6,$7, now())`,
    [
      source.ownerUserId, source.learnerId, set.title, JSON.stringify(set.cards),
      set.track, set.objectives, source.id,
    ],
  )
}

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
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : 0,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
