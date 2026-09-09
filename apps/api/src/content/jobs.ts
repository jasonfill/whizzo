// The job record, and what a client is allowed to know about it.
//
// A run takes one to three minutes. The API is one 0.5 GB instance with no
// worker component and no queue, so a job is a row that the request handler
// advances in the background and the client polls — adding a queue would be a
// bigger change than this feature is worth, and this is honest about what it is.
//
// Two consequences worth stating rather than discovering:
//
//   * A job is claimed and heartbeated, so a run interrupted by a deploy is
//     recognizable as abandoned rather than hanging in `reading` forever.
//   * `attempts` is on the row. A job that has failed twice is not retried a
//     third time — the third run costs the same money and fails the same way.

export type JobStatus = 'queued' | 'reading' | 'building' | 'done' | 'failed'

export const MAX_ATTEMPTS = 2

/**
 * How long a claimed job may go without a heartbeat before it is considered
 * abandoned. Generous: a build call on a long document genuinely takes minutes,
 * and reaping a job that is still working would spend the money twice.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000

export interface JobRow {
  id: string
  sourceId: string
  status: JobStatus
  stageDetail: Record<string, unknown>
  claimedAt: number | null
  heartbeatAt: number | null
  attempts: number
  error: string | null
  result: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

/** What the polling client sees. Deliberately not the whole row. */
export interface JobView {
  id: string
  status: JobStatus
  stage: string
  error: string | null
  result: Record<string, unknown> | null
}

/** Said in words, because "building" on its own is not a progress report. */
export function stageLabel(status: JobStatus, detail: Record<string, unknown>): string {
  switch (status) {
    case 'queued':
      return 'Waiting to start'
    case 'reading':
      return 'Reading the document'
    case 'building': {
      const topics = typeof detail.topics === 'number' ? detail.topics : null
      return topics ? `Writing cards for ${topics} topic${topics === 1 ? '' : 's'}` : 'Writing cards'
    }
    case 'done':
      return 'Ready to look over'
    case 'failed':
      return 'Could not finish'
  }
}

export function toJobView(job: JobRow): JobView {
  return {
    id: job.id,
    status: job.status,
    stage: stageLabel(job.status, job.stageDetail),
    error: job.error,
    result: job.result,
  }
}

/**
 * Whether a claimed job has gone quiet long enough to be treated as abandoned.
 *
 * Only ever asked of a job that is actually running: a queued job has no
 * heartbeat and is not stale, it is waiting.
 */
export function isStale(job: JobRow, now = Date.now()): boolean {
  if (job.status !== 'reading' && job.status !== 'building') return false
  const last = job.heartbeatAt ?? job.claimedAt
  if (last === null) return false
  return now - last > STALE_AFTER_MS
}

/**
 * What to do with a job that was found abandoned.
 *
 * Retried once, then failed for good. A third run costs the same money and
 * fails the same way, and a job that retries forever is a bill that grows
 * while nobody is watching.
 */
export function recoverStale(job: JobRow): { status: JobStatus; error: string | null } {
  if (job.attempts >= MAX_ATTEMPTS) {
    return {
      status: 'failed',
      error: 'That run stopped part way through more than once. Try uploading it again.',
    }
  }
  return { status: 'queued', error: null }
}
