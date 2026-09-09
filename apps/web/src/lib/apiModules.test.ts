// The transport layer: every function that turns a call into a request.
//
// None of these decide anything — the rules live in the API and, under it, in
// Row Level Security. What they can still get wrong is the shape of the
// request: a wrong verb, an unescaped code in a path, a body under the wrong
// key. Those are silent in development and total in production, so this pins
// the wire format of each one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let nextResponse: unknown = {}
let nextError: Error | null = null

vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client')
  const record = (method: string) => async (url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (nextError) throw nextError
    return nextResponse
  }
  return {
    ...actual,
    api: {
      get: async (url: string) => {
        calls.push({ method: 'GET', url })
        if (nextError) throw nextError
        return nextResponse
      },
      post: record('POST'),
      put: record('PUT'),
      patch: record('PATCH'),
      del: async (url: string) => {
        calls.push({ method: 'DELETE', url })
        if (nextError) throw nextError
        return nextResponse
      },
    },
  }
})

import { ApiError } from './api/client'
import * as assignments from './assignments/api'
import * as library from './assignments/library'
import * as learners from './learners/api'
import { ApiProgressRepo } from './progress/apiRepo'
import { emptySnapshot } from './progress/types'

const LEARNER = 'learner-1'

function last() {
  return calls[calls.length - 1]
}

beforeEach(() => {
  calls.length = 0
  nextError = null
  nextResponse = {}
})

describe('learners', () => {
  it('lists them', async () => {
    nextResponse = { learners: [{ id: LEARNER }] }
    await expect(learners.listLearners()).resolves.toEqual([{ id: LEARNER }])
    expect(last()).toMatchObject({ method: 'GET', url: '/learners' })
  })

  it('creates one', async () => {
    nextResponse = { learner: { id: LEARNER } }
    await learners.createLearner({ displayName: 'Ada' } as never)
    expect(last()).toMatchObject({ method: 'POST', url: '/learners' })
  })

  it('patches only what it was given', async () => {
    nextResponse = { learner: { id: LEARNER } }
    await learners.updateLearner(LEARNER, { theme: 'space' })
    expect(last()).toMatchObject({
      method: 'PATCH',
      url: `/learners/${LEARNER}`,
      body: { theme: 'space' },
    })
  })

  it('deletes one', async () => {
    await learners.deleteLearner(LEARNER)
    expect(last()).toMatchObject({ method: 'DELETE', url: `/learners/${LEARNER}` })
  })
})

describe('pairing an adult to a child', () => {
  it('mints an invite that expires by default', async () => {
    // A code that outlives the reason it was made is a way in six months later.
    nextResponse = { invite: { code: 'ABCD' } }
    await learners.mintInvite(LEARNER)
    expect(last()!.body).toMatchObject({ role: 'parent', purpose: 'guardian', ttlHours: 24 })
  })

  it('carries an explicit role and lifetime through', async () => {
    nextResponse = { invite: { code: 'ABCD' } }
    await learners.mintInvite(LEARNER, { role: 'teacher', purpose: 'guardian', ttlHours: 1 })
    expect(last()!.body).toMatchObject({ role: 'teacher', ttlHours: 1 })
  })

  it('uppercases and trims a redeemed code, because a code is read off paper', async () => {
    nextResponse = { learnerId: LEARNER }
    await expect(learners.redeemInvite('  abcd-1234 ')).resolves.toBe(LEARNER)
    expect(last()!.body).toEqual({ code: 'ABCD-1234' })
  })

  it('lists guardians', async () => {
    nextResponse = { guardians: [] }
    await learners.listGuardians(LEARNER)
    expect(last()).toMatchObject({ method: 'GET', url: `/learners/${LEARNER}/guardians` })
  })

  it('revokes one', async () => {
    await learners.revokeGuardian(LEARNER, 'g1')
    expect(last()).toMatchObject({
      method: 'DELETE',
      url: `/learners/${LEARNER}/guardians/g1`,
    })
  })

  it('changes what a guardian may do', async () => {
    await learners.setGuardianContentAccess(LEARNER, 'g1', false)
    expect(last()).toMatchObject({ method: 'PATCH', body: { canManageContent: false } })
  })
})

describe('tutor connection codes', () => {
  it('lists them', async () => {
    nextResponse = { codes: [] }
    await learners.listConnectionCodes()
    expect(last()).toMatchObject({ method: 'GET', url: '/connection-codes' })
  })

  it('mints one', async () => {
    nextResponse = { code: { code: 'WZ-1234' } }
    await learners.mintConnectionCode({ label: 'Class 4B', role: 'teacher' })
    expect(last()).toMatchObject({ method: 'POST', url: '/connection-codes' })
  })

  it('escapes a code in the path rather than pasting it in', async () => {
    // Codes are typed by people and could contain anything.
    await learners.revokeConnectionCode('a/b?c')
    expect(last()!.url).toBe('/connection-codes/a%2Fb%3Fc')
  })

  it('sends a code in the body, never in the path', async () => {
    // A code in a URL is a code in an access log, a proxy log and the
    // browser's history — and these are live until somebody redeems them.
    nextResponse = { kind: 'connection', valid: true }
    await learners.describeCode('  a/b  ')
    expect(last()).toMatchObject({
      method: 'POST',
      url: '/codes/describe',
      body: { code: 'a/b' },
    })
  })

  it('redeems for the learners named, and only those', async () => {
    // Consent is per child. There is no "all of them" here by design.
    nextResponse = { connected: 2 }
    await expect(learners.redeemConnectionCode('CODE', ['a', 'b'])).resolves.toBe(2)
    expect(last()).toMatchObject({ method: 'POST', url: '/codes/redeem' })
    expect(last()!.body).toEqual({ code: 'CODE', learnerIds: ['a', 'b'] })
  })
})

describe('a child’s own sign-in', () => {
  it('sets a PIN', async () => {
    nextResponse = { loginCode: 'ABCD1234', learnerId: LEARNER }
    await learners.setChildLogin(LEARNER, '1234')
    expect(last()).toMatchObject({
      method: 'POST',
      url: `/learners/${LEARNER}/child-login`,
      body: { pin: '1234' },
    })
  })

  it('turns it off', async () => {
    await learners.removeChildLogin(LEARNER)
    expect(last()).toMatchObject({ method: 'DELETE', url: `/learners/${LEARNER}/child-login` })
  })
})

describe('assignments', () => {
  it('lists everything by default', async () => {
    nextResponse = { assignments: [] }
    await assignments.listAssignments(LEARNER)
    expect(last()!.url).toBe(`/learners/${LEARNER}/assignments?status=all`)
  })

  it('narrows to open work when asked', async () => {
    nextResponse = { assignments: [] }
    await assignments.listAssignments(LEARNER, 'open')
    expect(last()!.url).toBe(`/learners/${LEARNER}/assignments?status=open`)
  })

  it('sets work for several learners in one call', async () => {
    nextResponse = { assignments: [] }
    await assignments.createAssignments(['a', 'b'], [{ subject: 'spelling' } as never])
    expect(last()).toMatchObject({
      method: 'POST',
      url: '/assignments',
      body: { learnerIds: ['a', 'b'] },
    })
  })

  it('lists the sets a grown-up has made', async () => {
    nextResponse = { sets: [] }
    await assignments.listAssignmentSets()
    expect(last()).toMatchObject({ method: 'GET', url: '/assignments/sets' })
  })

  it('edits the work itself, not one learner’s copy', async () => {
    await assignments.updateAssignmentSet('set-1', { title: 'New title' })
    expect(last()).toMatchObject({ method: 'PATCH', url: '/assignments/sets/set-1' })
  })

  it('withdraws a whole set', async () => {
    await assignments.deleteAssignmentSet('set-1')
    expect(last()).toMatchObject({ method: 'DELETE', url: '/assignments/sets/set-1' })
  })

  it('edits one learner’s copy under their own path', async () => {
    nextResponse = { assignment: { id: 'a1' } }
    await assignments.updateAssignment(LEARNER, 'a1', { status: 'canceled' })
    expect(last()).toMatchObject({
      method: 'PATCH',
      url: `/learners/${LEARNER}/assignments/a1`,
    })
  })

  it('takes one learner off a piece of work', async () => {
    await assignments.deleteAssignment(LEARNER, 'a1')
    expect(last()).toMatchObject({
      method: 'DELETE',
      url: `/learners/${LEARNER}/assignments/a1`,
    })
  })

  it('reads the family overview', async () => {
    nextResponse = { learners: [] }
    await assignments.familyOverview()
    expect(last()).toMatchObject({ method: 'GET', url: '/learners/overview' })
  })
})

describe('the grown-up’s library', () => {
  it('loads it', async () => {
    nextResponse = { decks: [], customLists: [] }
    await library.loadLibrary()
    expect(last()).toMatchObject({ method: 'GET', url: '/library' })
  })

  it('saves decks by POST, because ids are client-generated', async () => {
    nextResponse = { decks: [] }
    await library.saveLibraryDecks([{ id: 'd1' } as never])
    expect(last()).toMatchObject({ method: 'POST', url: '/library/decks' })
  })

  it('saves word lists', async () => {
    nextResponse = { customLists: [] }
    await library.saveLibraryLists([{ id: 'l1' } as never])
    expect(last()).toMatchObject({ method: 'POST', url: '/library/word-lists' })
  })

  it('deletes a deck and a list', async () => {
    await library.deleteLibraryDeck('d1')
    expect(last()).toMatchObject({ method: 'DELETE', url: '/library/decks/d1' })
    await library.deleteLibraryList('l1')
    expect(last()).toMatchObject({ method: 'DELETE', url: '/library/word-lists/l1' })
  })
})

describe('the signed-in progress repo', () => {
  it('reads a learner’s snapshot, not the signed-in user’s', async () => {
    // The person holding the session is usually a parent recording for a child.
    const snapshot = emptySnapshot()
    nextResponse = { snapshot }
    const repo = new ApiProgressRepo(LEARNER)
    await expect(repo.load()).resolves.toBe(snapshot)
    expect(last()!.url).toBe(`/learners/${LEARNER}/progress`)
  })

  it('swallows a failed round rather than interrupting a child mid-play', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = new ApiProgressRepo(LEARNER)
    nextError = new Error('offline')
    await expect(repo.persist({ daily: { subject: 'spelling', seconds: 1, items: 1, correct: 1 } } as never)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does NOT swallow a failed snapshot push', async () => {
    // The caller clears the local guest copy only once this resolves, so a
    // silent failure here would lose everything the child played as a guest.
    const repo = new ApiProgressRepo(LEARNER)
    nextError = new Error('offline')
    await expect(repo.pushSnapshot(emptySnapshot())).rejects.toThrow('offline')
  })

  it('sends nothing at all for an empty save', async () => {
    const repo = new ApiProgressRepo(LEARNER)
    await expect(repo.saveCustomLists([])).resolves.toEqual([])
    await expect(repo.saveDecks([])).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('saves lists and decks under the learner’s own path', async () => {
    const repo = new ApiProgressRepo(LEARNER)
    nextResponse = { customLists: [{ id: 'l1' }] }
    await repo.saveCustomLists([{ id: 'l1' } as never])
    expect(last()!.url).toBe(`/learners/${LEARNER}/word-lists`)
    nextResponse = { decks: [{ id: 'd1' }] }
    await repo.saveDecks([{ id: 'd1' } as never])
    expect(last()!.url).toBe(`/learners/${LEARNER}/decks`)
  })

  it('treats an already-gone list as deleted', async () => {
    // 404 on a delete is the outcome the caller wanted.
    const repo = new ApiProgressRepo(LEARNER)
    nextError = new ApiError(404, 'No such list', 'not_found')
    await expect(repo.deleteCustomList('l1')).resolves.toBeUndefined()
    await expect(repo.deleteDeck('d1')).resolves.toBeUndefined()
  })

  it('rethrows a delete that failed for any other reason', async () => {
    const repo = new ApiProgressRepo(LEARNER)
    nextError = new ApiError(500, 'boom')
    await expect(repo.deleteCustomList('l1')).rejects.toThrow('boom')
    await expect(repo.deleteDeck('d1')).rejects.toThrow('boom')
  })

  it('resets to an empty snapshot', async () => {
    const repo = new ApiProgressRepo(LEARNER)
    await repo.reset()
    expect(last()).toMatchObject({ method: 'DELETE', url: `/learners/${LEARNER}/progress` })
  })

  it('fetches a round’s answers only when asked for them', async () => {
    nextResponse = { attempts: [{ id: 'a' }] }
    const repo = new ApiProgressRepo(LEARNER)
    await expect(repo.attemptsForSession('s1')).resolves.toEqual([{ id: 'a' }])
    expect(last()!.url).toBe(`/learners/${LEARNER}/sessions/s1/attempts`)
  })
})
