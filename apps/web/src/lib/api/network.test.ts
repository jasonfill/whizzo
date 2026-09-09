// Everything the browser sends over the wire.
//
// One mocked `fetch` covers the client, both API modules, the library and the
// cloud progress repo — they are all one thin layer over `apiRequest`, and what
// is worth asserting is the same for all of them: the token goes on, the right
// method and path go out, and a failure comes back as something a screen can
// say out loud rather than a raw 500.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn(async () => ({
  data: { session: { access_token: 'a-token' } },
}))

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
  isSupabaseConfigured: () => true,
}))

import { api, ApiError, apiRequest } from './client'
import { createLearner, deleteLearner, listLearners, updateLearner } from '../learners/api'
import { listAssignments, updateAssignment, deleteAssignment } from '../assignments/api'
import { loadLibrary, saveLibraryDecks, deleteLibraryDeck } from '../assignments/library'
import { ApiProgressRepo } from '../progress/apiRepo'

const fetchMock = vi.fn()

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  })
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: url as string, init: init as RequestInit }
}

beforeEach(() => {
  fetchMock.mockReset()
  getSession.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

describe('apiRequest', () => {
  it('sends the session token', async () => {
    respond({ ok: true })
    await apiRequest('/thing')
    expect(lastCall().init.headers).toMatchObject({ authorization: 'Bearer a-token' })
  })

  it('omits the token where the endpoint has no session yet', async () => {
    respond({ ok: true })
    await apiRequest('/thing', { anonymous: true })
    expect(lastCall().init.headers).not.toHaveProperty('authorization')
  })

  it('sends no token at all when there is no session', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as never)
    respond({ ok: true })
    await apiRequest('/thing')
    expect(lastCall().init.headers).not.toHaveProperty('authorization')
  })

  it('serializes a body and says it is JSON', async () => {
    respond({ ok: true })
    await apiRequest('/thing', { method: 'POST', body: { a: 1 } })
    const { init } = lastCall()
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })

  it('sends no content-type when there is no body', async () => {
    respond({ ok: true })
    await apiRequest('/thing')
    expect(lastCall().init.headers).not.toHaveProperty('content-type')
  })

  it('returns nothing for a 204 rather than trying to parse it', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    await expect(apiRequest('/thing')).resolves.toBeUndefined()
  })

  it('turns a dropped connection into something a child can be shown', async () => {
    // Not a 500. The message on screen should not say "server error" when the
    // wifi dropped.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(apiRequest('/thing')).rejects.toMatchObject({
      status: 0,
      code: 'offline',
      message: 'Could not reach the server',
    })
  })

  it('lets a deliberate abort through untouched', async () => {
    // An aborted request is the caller changing its mind, not a failure.
    const abort = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValueOnce(abort)
    await expect(apiRequest('/thing')).rejects.toBe(abort)
  })

  it('carries the API’s own message and code through', async () => {
    respond({ error: { code: 'forbidden', message: 'Not allowed' } }, 403)
    await expect(apiRequest('/thing')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Not allowed',
    })
  })

  it('still fails usefully when the error body is missing', async () => {
    respond(null, 500)
    await expect(apiRequest('/thing')).rejects.toMatchObject({ status: 500 })
  })

  it('says so when the response is not JSON at all', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<html>' })
    await expect(apiRequest('/thing')).rejects.toMatchObject({ code: 'bad_response' })
  })

  it('prefixes every path with the API base', async () => {
    respond({})
    await apiRequest('/learners')
    expect(lastCall().url).toBe('/api/learners')
  })
})

describe('ApiError', () => {
  it('recognizes the two cases callers branch on', () => {
    expect(new ApiError(404, 'gone').isMissing).toBe(true)
    expect(new ApiError(401, 'nope').isAuth).toBe(true)
    expect(new ApiError(500, 'boom').isMissing).toBe(false)
    expect(new ApiError(500, 'boom').isAuth).toBe(false)
  })

  it('is a real Error', () => {
    expect(new ApiError(400, 'x')).toBeInstanceOf(Error)
  })
})

describe('the verb helpers', () => {
  it('uses the method each one names', async () => {
    for (const [verb, method] of [
      ['get', 'GET'],
      ['post', 'POST'],
      ['put', 'PUT'],
      ['patch', 'PATCH'],
      ['del', 'DELETE'],
    ] as const) {
      respond({})
      await (api[verb] as (p: string) => Promise<unknown>)('/thing')
      expect(lastCall().init.method, verb).toBe(method)
    }
  })
})

describe('learners over the wire', () => {
  it('lists them', async () => {
    respond({ learners: [{ id: 'l1' }] })
    await expect(listLearners()).resolves.toHaveLength(1)
    expect(lastCall().url).toBe('/api/learners')
  })

  it('creates one', async () => {
    respond({ learner: { id: 'l1' } })
    await createLearner({ displayName: 'Ada' })
    const { url, init } = lastCall()
    expect(url).toBe('/api/learners')
    expect(init.method).toBe('POST')
  })

  it('patches only what it was given', async () => {
    respond({ learner: { id: 'l1' } })
    await updateLearner('l1', { theme: 'ocean' })
    const { url, init } = lastCall()
    expect(url).toBe('/api/learners/l1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ theme: 'ocean' })
  })

  it('deletes one', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    await deleteLearner('l1')
    expect(lastCall().init.method).toBe('DELETE')
  })
})

describe('assignments over the wire', () => {
  it('lists a learner’s tasks', async () => {
    respond({ assignments: [] })
    await listAssignments('l1', 'all')
    expect(lastCall().url).toContain('/api/learners/l1/assignments')
  })

  it('updates one', async () => {
    respond({ assignment: {} })
    await updateAssignment('l1', 'a1', { sortOrder: 2 })
    expect(lastCall().init.method).toBe('PATCH')
  })

  it('deletes one', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    await deleteAssignment('l1', 'a1')
    expect(lastCall().init.method).toBe('DELETE')
  })
})

describe('the grown-up library over the wire', () => {
  it('loads it', async () => {
    respond({ decks: [], customLists: [] })
    await loadLibrary()
    expect(lastCall().url).toContain('/api/library')
  })

  it('saves decks', async () => {
    respond({ decks: [] })
    await saveLibraryDecks([])
    expect(lastCall().init.method).toBe('POST')
  })

  it('deletes a deck', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    await deleteLibraryDeck('d1')
    expect(lastCall().init.method).toBe('DELETE')
  })
})

describe('the cloud progress repo', () => {
  it('reports itself as the cloud store', () => {
    expect(new ApiProgressRepo('l1').kind).toBe('cloud')
  })

  it('loads a learner’s snapshot from their own path', async () => {
    respond({
      skills: [],
      mastery: [],
      lists: [],
      sessions: [],
      achievements: [],
      highScores: [],
      daily: [],
      customLists: [],
      decks: [],
    })
    await new ApiProgressRepo('l1').load()
    expect(lastCall().url).toContain('/api/learners/l1/progress')
  })

  it('does not throw when a write fails mid-round', async () => {
    // A flaky connection must never interrupt a child. The repo logs and
    // carries on; the optimistic snapshot is already on screen.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const repo = new ApiProgressRepo('l1')
    await expect(repo.persist({ skill: undefined } as never)).resolves.not.toThrow()
  })
})

describe('every call is scoped to one learner', () => {
  it('never sends a learner id in the body where the path carries it', async () => {
    respond({ learner: {} })
    await updateLearner('l1', { theme: 'cats' })
    const body = JSON.parse(lastCall().init.body as string)
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('learnerId')
    expect(body).not.toHaveProperty('ownerId')
  })
})
