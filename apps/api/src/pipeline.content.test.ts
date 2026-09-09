// One document, end to end, without spending anything.
//
// The behaviors worth pinning are the failure ones, because they are the ones
// that cost money or trust: a run refused before the first call, a topic that
// fails on its own, and a run that produced nothing being refunded rather than
// billed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runIngestion } from './content/pipeline.js'
import type { QuizCard } from '@whizzo/shared'

let n = 0
const makeCard = (term: string, definition: string): QuizCard => ({
  id: `c${n++}`,
  term,
  definition,
  hint: null,
  difficulty: 2,
})

const MAP = {
  title: 'Chapter 7',
  subject: 'Biology',
  track: 'science.biology',
  gradeLow: 6,
  gradeHigh: 8,
  note: 'Cells.',
  topics: [
    { id: 't1', title: 'Organelles', summary: 'Parts.', pages: [4], estimatedCards: 8 },
    { id: 't2', title: 'Membranes', summary: 'Walls.', pages: [5], estimatedCards: 6 },
  ],
}

const card = (term: string) => ({
  term,
  definition: `Answer to ${term}`,
  hint: null,
  category: null,
  example: null,
  explanation: null,
  answerKind: 'text' as const,
  tolerance: null,
  altAnswers: [],
  sourcePages: [4],
})

const setFor = (title: string) => ({ title, track: null, objectives: [], cards: [card(`Q ${title}`)] })

/* eslint-disable @typescript-eslint/no-explicit-any */
function reply(payload: unknown, over: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 },
    ...over,
  }
}

/** A client that answers the read call once, then each build call in turn. */
function scriptedClient(replies: any[]) {
  let i = 0
  const create = vi.fn(async () => {
    const next = replies[Math.min(i++, replies.length - 1)]
    if (next instanceof Error) throw next
    return next
  })
  return { messages: { create } } as any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const balance = (total: number) => ({ included: total, purchased: 0, total })
const base = { fileId: 'f1', pages: 20, covered: true }

beforeEach(() => {
  n = 0
})

describe('a document that works', () => {
  it('lands a set per topic', async () => {
    const client = scriptedClient([reply(MAP), reply(setFor('Organelles')), reply(setFor('Membranes'))])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ok).toBe(true)
    expect(out.sets.map((s) => s.title)).toEqual(['Organelles', 'Membranes'])
  })

  it('says what came back, in a line a parent reads', async () => {
    const client = scriptedClient([reply(MAP), reply(setFor('Organelles')), reply(setFor('Membranes'))])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.sets[0]!.summary).toMatch(/1 card from 1 page/)
  })

  it('builds only the topics that were asked for', async () => {
    const client = scriptedClient([reply(MAP), reply(setFor('Organelles'))])
    const out = await runIngestion(
      { client, makeCard },
      { ...base, balance: balance(100), topicIds: ['t1'] },
    )
    expect(out.sets).toHaveLength(1)
  })

  it('reports which stage it is on, so a slow run can say so', async () => {
    const onStage = vi.fn()
    const client = scriptedClient([reply(MAP), reply(setFor('a')), reply(setFor('b'))])
    await runIngestion({ client, makeCard, onStage }, { ...base, balance: balance(100) })
    expect(onStage.mock.calls.map((c) => c[0])).toEqual(['reading', 'building'])
  })
})

describe('nothing is spent before the run is authorised', () => {
  it('refuses when the balance will not cover it, without calling the model', async () => {
    const client = scriptedClient([reply(MAP)])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(5) })
    expect(out.ok).toBe(false)
    expect(client.messages.create).not.toHaveBeenCalled()
    expect(out.ledger).toEqual([])
  })

  it('says how short it is, so the next screen can offer exactly that', async () => {
    const out = await runIngestion(
      { client: scriptedClient([]), makeCard },
      { ...base, balance: balance(5) },
    )
    expect(out.error).toMatch(/20 credits/)
  })

  it('refuses a document past the page cap before spending anything', async () => {
    const client = scriptedClient([reply(MAP)])
    const out = await runIngestion(
      { client, makeCard },
      { ...base, pages: 500, balance: balance(9999) },
    )
    expect(out.ok).toBe(false)
    expect(client.messages.create).not.toHaveBeenCalled()
  })
})

describe('when it goes wrong', () => {
  it('refunds the whole hold when the read fails', async () => {
    // The tokens were spent and usage still records them, but a run that
    // produced nothing is ours to absorb.
    const client = scriptedClient([new Error('network')])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ok).toBe(false)
    const net = out.ledger.reduce((sum, e) => sum + e.credits, 0)
    expect(net).toBe(0)
  })

  it('says something useful about a Word file rather than "error"', async () => {
    const client = scriptedClient([new Error('boom')])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.error).toMatch(/printing it to PDF/)
  })

  it('passes a refusal through in words a parent can read', async () => {
    const client = scriptedClient([
      { model: 'claude-opus-5', stop_reason: 'refusal', content: [], usage: {} },
    ])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.error).toMatch(/couldn't work with that document/)
  })

  it('lands the topics that worked when one of them fails', async () => {
    // Five topics landing instead of none is strictly better for the person
    // waiting, and the one that failed is named rather than quietly missing.
    let i = 0
    const client = {
      messages: {
        create: vi.fn(async () => {
          i += 1
          if (i === 1) return reply(MAP)
          if (i === 2) throw new Error('that one failed')
          return reply(setFor('Membranes'))
        }),
      },
    } as never
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ok).toBe(true)
    expect(out.sets).toHaveLength(1)
    expect(out.failedTopics).toEqual([{ topicId: 't1', reason: 'That section could not be written up.' }])
  })

  it('reports a topic whose cards were all unusable', async () => {
    const empty = { title: 'Organelles', track: null, objectives: [], cards: [] }
    const client = scriptedClient([reply(MAP), reply(empty), reply(empty)])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ok).toBe(false)
    expect(out.failedTopics).toHaveLength(2)
  })

  it('refunds when every topic failed', async () => {
    const empty = { title: 'x', track: null, objectives: [], cards: [] }
    const client = scriptedClient([reply(MAP), reply(empty), reply(empty)])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ledger.reduce((sum, e) => sum + e.credits, 0)).toBe(0)
  })
})

describe('a document with nothing to practice', () => {
  it('says so rather than inventing cards', async () => {
    // A permission slip has no topics. Twenty cards about the school's address
    // would be a worse answer than none.
    const emptyMap = { ...MAP, topics: [], note: 'This is a permission slip.' }
    const client = scriptedClient([reply(emptyMap)])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ok).toBe(true)
    expect(out.sets).toEqual([])
    expect(out.map?.note).toMatch(/permission slip/)
  })

  it('does not charge for it', async () => {
    const emptyMap = { ...MAP, topics: [] }
    const client = scriptedClient([reply(emptyMap)])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.ledger.reduce((sum, e) => sum + e.credits, 0)).toBe(0)
  })
})

describe('the cache', () => {
  it('warms it with one call before fanning out the rest', async () => {
    // Firing every topic at once means every one starts before a cache exists,
    // so all of them miss and the document is paid for once per topic. The
    // cards come back fine either way — the only symptom is the bill.
    const inFlight: number[] = []
    let live = 0
    const client = {
      messages: {
        create: vi.fn(async () => {
          live += 1
          inFlight.push(live)
          await new Promise((r) => setTimeout(r, 1))
          live -= 1
          return reply(inFlight.length === 1 ? MAP : setFor('x'))
        }),
      },
    } as never

    await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    // Read alone, then the first build alone, then the rest together.
    expect(inFlight.slice(0, 2)).toEqual([1, 1])
  })


  it('reports healthy when the fan-out read from it', async () => {
    const client = scriptedClient([reply(MAP), reply(setFor('a')), reply(setFor('b'))])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.cacheHealthy).toBe(true)
  })

  it('reports unhealthy when it silently stopped working', async () => {
    // Invisible in the output; visible only on the bill, at roughly ten times
    // the price.
    const cold = (p: unknown) => reply(p, { usage: { input_tokens: 50000, output_tokens: 100 } })
    const client = scriptedClient([cold(MAP), cold(setFor('a')), cold(setFor('b'))])
    const out = await runIngestion({ client, makeCard }, { ...base, balance: balance(100) })
    expect(out.cacheHealthy).toBe(false)
  })
})
