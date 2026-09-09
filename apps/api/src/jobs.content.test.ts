// The job row, and what it says while a run is in flight.
//
// A run takes minutes on a single small instance with no queue, so the parts
// worth pinning are the ones that go wrong when a deploy lands mid-run: a job
// stuck in `reading` forever, or one that retries until the bill notices.

import { describe, expect, it } from 'vitest'
import {
  isStale,
  MAX_ATTEMPTS,
  recoverStale,
  stageLabel,
  STALE_AFTER_MS,
  toJobView,
  type JobRow,
} from './content/jobs.js'

const NOW = 1_700_000_000_000

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: 'j1',
    sourceId: 's1',
    status: 'building',
    stageDetail: {},
    claimedAt: NOW,
    heartbeatAt: NOW,
    attempts: 1,
    error: null,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

describe('what the client is told', () => {
  it('says each stage in words, not in status codes', () => {
    expect(stageLabel('queued', {})).toMatch(/waiting/i)
    expect(stageLabel('reading', {})).toMatch(/reading/i)
    expect(stageLabel('done', {})).toMatch(/ready/i)
    expect(stageLabel('failed', {})).toMatch(/could not/i)
  })

  it('says how many topics it is working through', () => {
    // "Building" on its own is not a progress report.
    expect(stageLabel('building', { topics: 6 })).toBe('Writing cards for 6 topics')
    expect(stageLabel('building', { topics: 1 })).toBe('Writing cards for 1 topic')
  })

  it('copes with a detail it does not recognize', () => {
    expect(stageLabel('building', { topics: 'lots' })).toBe('Writing cards')
    expect(stageLabel('building', {})).toBe('Writing cards')
  })

  it('shows the client a view, not the whole row', () => {
    const view = toJobView(job({ status: 'reading' }))
    expect(view).toEqual({
      id: 'j1',
      status: 'reading',
      stage: 'Reading the document',
      error: null,
      result: null,
    })
    // Claim times and attempt counts are ours.
    expect(view).not.toHaveProperty('attempts')
    expect(view).not.toHaveProperty('claimedAt')
  })
})

describe('a job interrupted by a deploy', () => {
  it('is stale once it has gone quiet for long enough', () => {
    expect(isStale(job({ heartbeatAt: NOW - STALE_AFTER_MS - 1 }), NOW)).toBe(true)
  })

  it('is not stale while it is still checking in', () => {
    expect(isStale(job({ heartbeatAt: NOW - 1000 }), NOW)).toBe(false)
  })

  it('leaves generous room, because reaping a live job spends the money twice', () => {
    expect(STALE_AFTER_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })

  it('falls back to the claim time when it never got to heartbeat', () => {
    const never = job({ heartbeatAt: null, claimedAt: NOW - STALE_AFTER_MS - 1 })
    expect(isStale(never, NOW)).toBe(true)
  })

  it('never calls a queued job stale — it is waiting, not stuck', () => {
    expect(isStale(job({ status: 'queued', claimedAt: null, heartbeatAt: null }), NOW)).toBe(false)
  })

  it('never calls a finished job stale', () => {
    for (const status of ['done', 'failed'] as const) {
      expect(isStale(job({ status, heartbeatAt: 0 }), NOW), status).toBe(false)
    }
  })
})

describe('recovering one', () => {
  it('gives it one more go', () => {
    expect(recoverStale(job({ attempts: 1 }))).toEqual({ status: 'queued', error: null })
  })

  it('gives up rather than retrying forever', () => {
    // A third run costs the same money and fails the same way, and a job that
    // retries forever is a bill growing while nobody is watching.
    const gone = recoverStale(job({ attempts: MAX_ATTEMPTS }))
    expect(gone.status).toBe('failed')
    expect(gone.error).toMatch(/uploading it again/)
  })

  it('says something a person could act on', () => {
    expect(recoverStale(job({ attempts: 9 })).error).not.toMatch(/attempts|null|undefined/)
  })
})
