// The two things on the browser side that are easy to get subtly wrong: the
// frame parser, and the promise that a field with focus is never overwritten.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeferredEdits, editingKey } from './editing'
import { openLive } from './client'
import type { LiveEvent } from '@whizzo/shared'

// The reconnect cases wait out a real backoff delay, so they depend on
// wall-clock time. Vitest's default 5s budget per test was the same number as
// the waits inside them: fine locally, a coin flip on a loaded CI container.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

vi.mock('../api/client', () => ({
  authHeader: async () => ({ authorization: 'Bearer test' }),
  ORIGIN_ID: 'origin-under-test',
}))

function event(kind: string, payload: unknown): LiveEvent {
  return {
    kind: kind as LiveEvent['kind'],
    subjectId: 'l1',
    at: 1,
    actorId: null,
    actorName: null,
    originId: null,
    payload,
  }
}

/** A response whose body yields the given chunks, then ends. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('openLive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses events and ignores the heartbeat', async () => {
    const seen: LiveEvent[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamOf([
          ': open\n\n',
          `event: planner.item\ndata: ${JSON.stringify(event('planner.item', { id: 'a' }))}\n\n`,
          ': ping 1\n\n',
          `event: planner.week\ndata: ${JSON.stringify(event('planner.week', { weekStart: '2026-09-07' }))}\n\n`,
        ]),
      ),
    )

    const close = openLive('/live/learners/l1', { onEvent: (e) => seen.push(e) })
    await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 10_000 })
    close()

    expect(seen.map((e) => e.kind)).toEqual(['planner.item', 'planner.week'])
    expect(seen[0]!.payload).toEqual({ id: 'a' })
  })

  // A chunk boundary can fall anywhere, including the middle of a JSON string.
  it('reassembles an event split across chunks', async () => {
    const seen: LiveEvent[] = []
    const frame = `event: planner.item\ndata: ${JSON.stringify(event('planner.item', { id: 'split' }))}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamOf([frame.slice(0, 20), frame.slice(20, 45), frame.slice(45)])),
    )

    const close = openLive('/live/learners/l1', { onEvent: (e) => seen.push(e) })
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 10_000 })
    close()
    expect(seen[0]!.payload).toEqual({ id: 'split' })
  })

  // The channel keeps no history, so re-reading is the only way back to the
  // truth after a gap — and it must not fire on the first connection, where
  // the caller has just loaded anyway.
  it('asks for a resync on reconnect but not on first connect', async () => {
    let resyncs = 0
    const fetchMock = vi.fn(async () => streamOf([': open\n\n']))
    vi.stubGlobal('fetch', fetchMock)

    const close = openLive('/live/learners/l1', {
      onEvent: () => {},
      onResync: () => {
        resyncs += 1
      },
    })

    // A real backoff delay separates these, so give it room: the point of the
    // test is that a reconnect happens at all, not how fast.
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    close()
    expect(resyncs).toBeGreaterThanOrEqual(1)
  })

  // A 401 here is almost always a token refresh that could not finish — a
  // laptop waking before its network does. Treating it as final leaves the
  // channel dead with nothing to restart it.
  it('keeps retrying after a 401', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const close = openLive('/live/learners/l1', { onEvent: () => {} })
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    close()
  })

  // Retrying these forever is a busy loop against an answer that will not change.
  it('gives up on 404 rather than reconnecting', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const statuses: string[] = []

    const close = openLive('/live/learners/nope', {
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    })
    await vi.waitFor(() => expect(statuses).toContain('offline'), { timeout: 10_000 })
    await new Promise((r) => setTimeout(r, 50))
    close()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('DeferredEdits', () => {
  let edits: DeferredEdits

  beforeEach(() => {
    document.body.innerHTML = `
      <div data-live-key="card-1"><input id="title" /></div>
      <div data-live-key="card-2"><input id="other" /></div>
      <button id="elsewhere"></button>`
    edits = new DeferredEdits()
  })

  afterEach(() => {
    edits.dispose()
    document.body.innerHTML = ''
  })

  it('applies straight away when nothing is being edited', () => {
    const apply = vi.fn()
    expect(edits.applyOrDefer('card-1', apply)).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('holds a change to the card being typed in', () => {
    document.querySelector<HTMLInputElement>('#title')!.focus()
    expect(editingKey()).toBe('card-1')

    const apply = vi.fn()
    expect(edits.applyOrDefer('card-1', apply)).toBe(false)
    expect(apply).not.toHaveBeenCalled()
  })

  it('lets a change to a different card through', () => {
    document.querySelector<HTMLInputElement>('#title')!.focus()
    const apply = vi.fn()
    expect(edits.applyOrDefer('card-2', apply)).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
  })

  // A card edited and then deleted: without the cancel, the held edit runs on
  // blur and puts the deleted card back on the grid.
  it('drops a held change when it is canceled', async () => {
    const input = document.querySelector<HTMLInputElement>('#title')!
    input.focus()
    const apply = vi.fn()
    edits.applyOrDefer('card-1', apply)

    edits.cancel('card-1')
    input.blur()
    await new Promise((r) => setTimeout(r, 20))
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies what it held once focus leaves', async () => {
    const input = document.querySelector<HTMLInputElement>('#title')!
    input.focus()
    const apply = vi.fn()
    edits.applyOrDefer('card-1', apply)

    input.blur()
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce(), { timeout: 10_000 })
  })

  // Only the newest matters: an intermediate state nobody saw is not worth
  // replaying on blur.
  it('keeps only the latest change per card', async () => {
    const input = document.querySelector<HTMLInputElement>('#title')!
    input.focus()
    const first = vi.fn()
    const second = vi.fn()
    edits.applyOrDefer('card-1', first)
    edits.applyOrDefer('card-1', second)

    input.blur()
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce(), { timeout: 10_000 })
    expect(first).not.toHaveBeenCalled()
  })

  // Focus moves out of one element and into the next in two steps; flushing in
  // the gap would overwrite a field the user is still in.
  it('does not flush when focus moves within the same card', async () => {
    document.body.innerHTML = `<div data-live-key="card-1"><input id="a" /><input id="b" /></div>`
    const a = document.querySelector<HTMLInputElement>('#a')!
    const b = document.querySelector<HTMLInputElement>('#b')!
    a.focus()
    const apply = vi.fn()
    edits.applyOrDefer('card-1', apply)

    a.blur()
    b.focus()
    await new Promise((r) => setTimeout(r, 20))
    expect(apply).not.toHaveBeenCalled()
  })
})
