// The client half of ingestion.
//
// Mostly thin, with one piece of judgement worth pinning: how often to ask a
// job whether it is done.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(async () => ({})),
  post: vi.fn(async () => ({})),
  put: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}))
vi.mock('../api/client', () => ({ api: apiMock }))

import {
  addLink,
  contentStatus,
  estimateFor,
  isFinished,
  jobStatus,
  pollDelay,
  startBuild,
  type JobView,
} from './api'

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockClear()
})

// A wrong path here is a 404 in production that nothing else would catch: the
// screen test mocks this module out entirely, so these are the only assertions
// that the URLs are the ones the API actually serves.
describe('the addresses it calls', () => {
  it('asks whether the feature is on', async () => {
    await contentStatus()
    expect(apiMock.get).toHaveBeenCalledWith('/content/status', undefined)
  })

  it('registers a link', async () => {
    await addLink('https://example.com/a.pdf')
    expect(apiMock.post).toHaveBeenCalledWith('/content/sources/link', {
      url: 'https://example.com/a.pdf',
    })
  })

  it('asks for an estimate, carrying the speed choice', async () => {
    await estimateFor('s1', true)
    expect(apiMock.get).toHaveBeenCalledWith('/content/sources/s1/estimate?noRush=true')
    await estimateFor('s1', false)
    expect(apiMock.get).toHaveBeenLastCalledWith('/content/sources/s1/estimate?noRush=false')
  })

  it('starts a build with the topics and the speed', async () => {
    await startBuild('s1', { topicIds: ['t1'], noRush: true })
    expect(apiMock.post).toHaveBeenCalledWith('/content/sources/s1/build', {
      topicIds: ['t1'],
      noRush: true,
    })
  })

  it('defaults a build to every topic, at full speed', async () => {
    // Empty means "all topics" on the server side; sending nothing would be a
    // different request.
    await startBuild('s1')
    expect(apiMock.post).toHaveBeenCalledWith('/content/sources/s1/build', {
      topicIds: [],
      noRush: false,
    })
  })

  it('polls a job', async () => {
    await jobStatus('j1')
    // The signal is passed through so a poll loop can be canceled when the
    // screen goes away.
    expect(apiMock.get).toHaveBeenCalledWith('/content/jobs/j1', undefined)
  })

})

const job = (status: JobView['status']): JobView => ({
  id: 'j1',
  status,
  stage: 'x',
  error: null,
  result: null,
})

describe('knowing when to stop asking', () => {
  it('is finished when it is done or failed', () => {
    expect(isFinished(job('done'))).toBe(true)
    expect(isFinished(job('failed'))).toBe(true)
  })

  it('is not finished while it is still working', () => {
    for (const status of ['queued', 'reading', 'building'] as const) {
      expect(isFinished(job(status)), status).toBe(false)
    }
  })
})

describe('how often to ask', () => {
  it('starts responsive, so a fast run is noticed quickly', () => {
    expect(pollDelay(0)).toBe(1000)
  })

  it('backs off, because a three-minute run does not need 180 requests', () => {
    expect(pollDelay(10)).toBeGreaterThan(pollDelay(0))
  })

  it('stops backing off, so a finished job is still noticed promptly', () => {
    expect(pollDelay(1000)).toBe(8000)
  })

  it('never waits less than a second or more than eight', () => {
    for (let i = 0; i < 100; i++) {
      expect(pollDelay(i)).toBeGreaterThanOrEqual(1000)
      expect(pollDelay(i)).toBeLessThanOrEqual(8000)
    }
  })
})
