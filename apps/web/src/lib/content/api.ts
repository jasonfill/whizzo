// The client half of document ingestion.
//
// The shape mirrors the API's, and the reason is the one thing worth carrying
// into the UI: **the estimate is a separate call from the run.** Nothing here
// starts a job as a side effect of asking what a job would cost.

import { api } from '../api/client'

export interface CreditBalanceView {
  included: number
  purchased: number
  total: number
}

export interface ContentStatus {
  enabled: boolean
  balance: CreditBalanceView | null
}

export type JobStatus = 'queued' | 'reading' | 'building' | 'done' | 'failed'

export interface JobView {
  id: string
  status: JobStatus
  /** Already in words — the API says "Reading the document", not "reading". */
  stage: string
  error: string | null
  result: { setsLanded?: number } | null
}

export interface EstimateView {
  estimate: { pages: number; credits: number; noRush: boolean }
  balance: CreditBalanceView
  allowed: boolean
  reason: string | null
}

export function contentStatus(signal?: AbortSignal): Promise<ContentStatus> {
  return api.get<ContentStatus>('/content/status', signal)
}

export function addLink(url: string): Promise<{ sourceId: string; job: JobView }> {
  return api.post('/content/sources/link', { url })
}

/** One registered file. No job yet — nothing runs until the quote is accepted. */
export interface UploadedSource {
  sourceId: string
  filename: string
  pages: number
}

export interface UploadResult {
  sources: UploadedSource[]
  /** Named, with a reason. A file that vanishes silently is a support ticket. */
  rejected: Array<{ filename: string; reason: string }>
}

/**
 * Hand over files directly.
 *
 * Each file comes back as its own source, so the caller gets a list to quote
 * one by one rather than a single opaque total — and a file that was refused is
 * named alongside the ones that were not.
 */
export function uploadFiles(files: File[]): Promise<UploadResult> {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  return api.upload<UploadResult>('/content/sources/upload', form)
}

export function estimateFor(sourceId: string, noRush: boolean): Promise<EstimateView> {
  return api.get<EstimateView>(`/content/sources/${sourceId}/estimate?noRush=${noRush}`)
}

export function startBuild(
  sourceId: string,
  opts: { topicIds?: string[]; noRush?: boolean } = {},
): Promise<{ job: JobView }> {
  return api.post(`/content/sources/${sourceId}/build`, {
    topicIds: opts.topicIds ?? [],
    noRush: opts.noRush ?? false,
  })
}

export function jobStatus(jobId: string, signal?: AbortSignal): Promise<{ job: JobView }> {
  return api.get(`/content/jobs/${jobId}`, signal)
}

export function isFinished(job: JobView): boolean {
  return job.status === 'done' || job.status === 'failed'
}

/**
 * How long to wait before asking again.
 *
 * Backs off, because a run takes one to three minutes and a one-second poll
 * for three minutes is 180 requests to watch a progress line change twice.
 * Capped so a finished job is still noticed promptly.
 */
export function pollDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.floor(attempt / 3), 8000)
}
