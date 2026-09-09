// Running a queued job.
//
// There is no worker process and no queue — a job is a row advanced in the
// background of whichever request noticed it. The three things that have to be
// right are claiming (two requests must not run the same document twice), the
// order of writes (money accounted for even when the cards are not), and what
// a draft is when it lands.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimNext, runJob, sweepStale, type RunnerDb } from './content/runner.js'
import { STALE_AFTER_MS, type JobRow } from './content/jobs.js'
import type { QuizCard } from '@whizzo/shared'

const NOW = 1_700_000_000_000
let n = 0
const makeCard = (term: string, definition: string): QuizCard => ({
  id: `c${n++}`, term, definition, hint: null, difficulty: 2,
})

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: 'j1', sourceId: 's1', status: 'reading', stageDetail: {},
    claimedAt: NOW, heartbeatAt: NOW, attempts: 1, error: null, result: null,
    createdAt: NOW, updatedAt: NOW, ...over,
  }
}

const MAP = {
  title: 'Chapter 7', subject: 'Biology', track: 'science.biology',
  gradeLow: 6, gradeHigh: 8, note: 'Cells.',
  topics: [{ id: 't1', title: 'Organelles', summary: 'Parts.', pages: [4], estimatedCards: 8 }],
}
const SET = {
  title: 'Organelles', track: 'science.biology', objectives: [],
  cards: [{
    term: 'What makes ATP?', definition: 'The mitochondrion', hint: null, category: null,
    example: null, explanation: null, answerKind: 'text' as const, tolerance: null,
    altAnswers: [], sourcePages: [4],
  }],
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function reply(payload: unknown) {
  return {
    model: 'claude-opus-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 },
  }
}

/** A db that answers by matching the SQL, so tests read as intent not as order. */
function fakeDb(over: Array<[RegExp, Record<string, unknown>[]]> = []): RunnerDb & { calls: string[]; params: unknown[][] } {
  const calls: string[] = []
  const params: unknown[][] = []
  const query = vi.fn(async (sql: string, p?: unknown[]) => {
    calls.push(sql.replace(/\s+/g, ' ').trim())
    params.push(p ?? [])
    for (const [pattern, rows] of over) if (pattern.test(sql)) return { rows }
    return { rows: [] }
  })
  return { query, calls, params } as never
}

function client(replies: unknown[]) {
  let i = 0
  return { messages: { create: vi.fn(async () => reply(replies[Math.min(i++, replies.length - 1)])) } } as never
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SOURCE = [/from public.content_sources/, [{
  id: 's1', owner_user_id: 'u1', learner_id: null, pages: 10, provider_file_id: 'file_1',
}]] as [RegExp, Record<string, unknown>[]]
const CREDITS = [/from public.credit_ledger/, [
  { kind: 'grant', bucket: 'included', credits: 100 },
]] as [RegExp, Record<string, unknown>[]]

beforeEach(() => { n = 0 })

describe('claiming', () => {
  it('takes a row without letting a second request take the same one', async () => {
    // Running a document twice costs twice and produces two sets of the same
    // cards. `for update skip locked` is what stops that.
    const db = fakeDb([[/update public.content_jobs/, [{ id: 'j1', source_id: 's1', status: 'reading' }]]])
    await claimNext(db)
    expect(db.calls[0]).toMatch(/for update skip locked/)
  })

  it('counts the attempt as it claims, so a retry loop cannot be endless', async () => {
    const db = fakeDb([[/update public.content_jobs/, [{ id: 'j1', source_id: 's1', status: 'reading' }]]])
    await claimNext(db)
    expect(db.calls[0]).toMatch(/attempts = attempts \+ 1/)
  })

  it('returns nothing when there is nothing queued', async () => {
    expect(await claimNext(fakeDb())).toBeNull()
  })
})

describe('sweeping abandoned runs', () => {
  const running = (heartbeat: number, attempts = 1) => ({
    id: 'j1', source_id: 's1', status: 'building', stage_detail: {},
    claimed_at: new Date(heartbeat).toISOString(),
    heartbeat_at: new Date(heartbeat).toISOString(),
    attempts, error: null, result: null,
    created_at: new Date(heartbeat).toISOString(),
    updated_at: new Date(heartbeat).toISOString(),
  })

  it('leaves a run that is still checking in alone', async () => {
    // Reaping a live job spends the money twice.
    const db = fakeDb([[/select \* from public.content_jobs/, [running(NOW - 1000)]]])
    expect(await sweepStale(db, NOW)).toBe(0)
  })

  it('requeues one that went quiet', async () => {
    const db = fakeDb([[/select \* from public.content_jobs/, [running(NOW - STALE_AFTER_MS - 1)]]])
    expect(await sweepStale(db, NOW)).toBe(1)
    expect(db.params[1]).toEqual(['j1', 'queued', null])
  })

  it('fails one that has already been round twice', async () => {
    const db = fakeDb([[/select \* from public.content_jobs/, [running(NOW - STALE_AFTER_MS - 1, 2)]]])
    await sweepStale(db, NOW)
    expect(db.params[1]![1]).toBe('failed')
    expect(String(db.params[1]![2])).toMatch(/uploading it again/)
  })
})

describe('running one', () => {
  it('lands a draft per topic', async () => {
    const db = fakeDb([SOURCE, CREDITS])
    const result = await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    expect(result).toMatchObject({ status: 'done', setsLanded: 1 })
    expect(db.calls.some((c) => /insert into public.decks/.test(c))).toBe(true)
  })

  it('lands it as a draft, not as something assignable', async () => {
    // `accepted_at` stays null until a grown-up looks at it. A draft can be
    // practiced; it cannot be assigned or earn a reward.
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    const insert = db.calls.find((c) => /insert into public.decks/.test(c))!
    expect(insert).not.toMatch(/accepted_at/)
  })

  it('writes what each call cost as it happens', async () => {
    // A crash mid-run must not lose the record of what was already spent.
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    const usageWrites = db.calls.filter((c) => /insert into public.llm_usage/.test(c))
    expect(usageWrites).toHaveLength(2) // one read, one build
  })

  it('settles the ledger before it writes the cards', async () => {
    // If writing the drafts fails, the money is still accounted for. The other
    // order loses the accounting.
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    const ledgerAt = db.calls.findIndex((c) => /insert into public.credit_ledger/.test(c))
    const deckAt = db.calls.findIndex((c) => /insert into public.decks/.test(c))
    expect(ledgerAt).toBeGreaterThan(-1)
    expect(ledgerAt).toBeLessThan(deckAt)
  })

  it('marks the job done and says how much landed', async () => {
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    const finish = db.params[db.calls.length - 1]!
    expect(finish[1]).toBe('done')
    expect(JSON.parse(String(finish[3]))).toEqual({ setsLanded: 1 })
  })
})

describe('who counts as covered', () => {
  it('asks only about learners this payer is actually connected to', async () => {
    // The runner has no user context. An unscoped
    // `select 1 from learners where is_learner_covered(...)` would be true
    // whenever *anyone in the system* was covered, and hand every free account
    // the 100-page cap — a free user uploading a textbook we then pay for.
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    const check = db.calls.find((c) => /is_learner_covered/.test(c))!
    expect(check).toMatch(/owner_id = \$1/)
    expect(check).toMatch(/guardian_links/)
  })

  it('treats a source with no owner as uncovered rather than as everyone', async () => {
    const orphan = [/from public.content_sources/, [{
      id: 's1', owner_user_id: null, learner_id: null, pages: 10, provider_file_id: 'f',
    }]] as [RegExp, Record<string, unknown>[]]
    const db = fakeDb([orphan, CREDITS])
    await runJob({ db, client: client([MAP, SET]), makeCard }, job())
    expect(db.calls.some((c) => /is_learner_covered/.test(c))).toBe(false)
  })
})

describe('when it goes wrong', () => {
  it('fails cleanly when the document has vanished', async () => {
    const db = fakeDb() // no source row
    const result = await runJob({ db, client: client([]), makeCard }, job())
    expect(result).toMatchObject({ status: 'failed' })
    expect(result.error).toMatch(/gone/)
  })

  it('records the failure on the job rather than throwing out of the runner', async () => {
    const db = fakeDb([SOURCE, CREDITS])
    const boom = { messages: { create: vi.fn(async () => { throw new Error('network') }) } } as never
    const result = await runJob({ db, client: boom, makeCard }, job())
    expect(result.status).toBe('failed')
    expect(db.calls.some((c) => /update public.content_jobs/.test(c))).toBe(true)
  })

  it('still writes a ledger when the run failed, so the refund is recorded', async () => {
    const db = fakeDb([SOURCE, CREDITS])
    const boom = { messages: { create: vi.fn(async () => { throw new Error('x') }) } } as never
    await runJob({ db, client: boom, makeCard }, job())
    const ledger = db.calls.filter((c) => /insert into public.credit_ledger/.test(c))
    expect(ledger.length).toBeGreaterThan(0)
  })

  it('flags a run where the cache silently stopped working', async () => {
    // Invisible in the output and visible only on the bill, so it goes on the
    // job record where somebody might notice before the invoice does.
    const cold = {
      messages: {
        create: vi.fn(async () => ({
          model: 'claude-opus-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(MAP) }],
          usage: { input_tokens: 50000, output_tokens: 100 },
        })),
      },
    } as never
    const twoTopics = { ...MAP, topics: [MAP.topics[0]!, { ...MAP.topics[0]!, id: 't2' }] }
    let i = 0
    const client2 = {
      messages: {
        create: vi.fn(async () => ({
          model: 'claude-opus-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(i++ === 0 ? twoTopics : SET) }],
          usage: { input_tokens: 50000, output_tokens: 100 },
        })),
      },
    } as never
    void cold
    const db = fakeDb([SOURCE, CREDITS])
    await runJob({ db, client: client2, makeCard }, job())
    const flagged = db.params.find((p) => String(p[1] ?? '').includes('cacheHealthy'))
    expect(flagged).toBeTruthy()
  })
})
