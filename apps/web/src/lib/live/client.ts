// The browser end of the live channel. See docs/realtime-spec.md §5.
//
// This is a `fetch` reading a `ReadableStream` rather than an `EventSource`,
// for one reason that matters and two that follow from it: `EventSource`
// cannot set an `Authorization` header, and the usual way round that — a
// ticket in the query string — writes a credential into every access log we
// and our host keep. Reading the stream ourselves means the existing
// `authHeader()` applies unchanged (so token refresh keeps working), and the
// reconnect policy is ours rather than the browser's.
//
// What it costs is the frame parsing below, which is small and does not change.

import { type LiveEvent } from '@whizzo/shared'
import { authHeader } from '../api/client'

export type LiveStatus = 'connecting' | 'open' | 'offline'

export interface LiveOptions {
  /** Every event on the channel, already parsed. */
  onEvent: (event: LiveEvent) => void
  onStatus?: (status: LiveStatus) => void
  /**
   * The stream came back after a gap.
   *
   * The channel keeps no history — by design — so this is the moment to re-read
   * whatever you are showing. It is the only place polling survives, and it
   * runs once per reconnect rather than on a timer.
   */
  onResync?: () => void
}

/** Backoff: quick at first, capped, jittered so tabs do not resynchronise. */
const FIRST_RETRY_MS = 500
const MAX_RETRY_MS = 30_000
/** A connection that lasted this long counts as healthy; the backoff resets. */
const HEALTHY_MS = 10_000

function backoff(attempt: number): number {
  const flat = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt)
  return flat / 2 + Math.random() * (flat / 2)
}

/**
 * Split an SSE byte stream into events.
 *
 * Frames are separated by a blank line. A line starting with `:` is a comment —
 * the heartbeat — and is deliberately ignored: its job is done by arriving.
 */
function parseFrame(frame: string): LiveEvent | null {
  let data = ''
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    // `event:` is a convenience for dispatching without parsing; the envelope
    // carries the kind too, and that is the one we trust.
    if (field === 'data') data = data ? `${data}\n${value}` : value
  }
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as LiveEvent
    return parsed && typeof parsed.kind === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Subscribe to `path` (e.g. `/live/learners/<id>`) until the returned function
 * is called. Reconnects on its own; never throws at the caller.
 */
export function openLive(path: string, options: LiveOptions): () => void {
  const controller = new AbortController()
  let stopped = false
  let attempt = 0
  let everConnected = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Resolves the backoff sleep early, so closing during one is not a leak. */
  let wake: (() => void) | null = null

  const status = (s: LiveStatus) => {
    if (!stopped) options.onStatus?.(s)
  }

  async function run(): Promise<void> {
    while (!stopped) {
      status('connecting')
      const startedAt = Date.now()
      try {
        const response = await fetch(`/api${path}`, {
          method: 'GET',
          headers: { accept: 'text/event-stream', ...(await authHeader()) },
          signal: controller.signal,
          // Long-lived by nature; a cache in front of this would be a bug.
          cache: 'no-store',
        })

        // A 404 is an answer, not a failure: RLS says there is no such learner
        // for this caller, and it will say the same thing next time. Retrying
        // it would be a busy loop against a settled question.
        //
        // A 401 is *not* in that category, however much it looks like one. The
        // common cause is a token refresh that could not complete — a laptop
        // waking before its network does — and treating it as final leaves the
        // channel silently dead with nothing to restart it. It backs off like
        // any other failure; a genuinely revoked session simply keeps failing,
        // and the app's own auth listener signs them out.
        if (response.status === 404 || response.status === 403) {
          status('offline')
          return
        }
        if (!response.ok || !response.body) throw new Error(`live ${response.status}`)

        status('open')
        // A reconnect, not the first connection: whatever we are showing may
        // have moved on without us.
        if (everConnected) options.onResync?.()
        everConnected = true

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Everything up to the last blank line is complete frames; the
          // remainder is a partial one and stays in the buffer.
          let split = buffer.indexOf('\n\n')
          while (split >= 0) {
            const frame = buffer.slice(0, split)
            buffer = buffer.slice(split + 2)
            const event = parseFrame(frame)
            if (event && !stopped) options.onEvent(event)
            split = buffer.indexOf('\n\n')
          }
        }
      } catch {
        // Aborted, dropped, asleep, deployed over. All the same from here.
        if (stopped) return
      }

      if (stopped) return
      status('offline')
      // The server closes every stream after half an hour by design; a
      // connection that lasted is not a failure and must not push the backoff
      // up towards thirty seconds.
      attempt = Date.now() - startedAt >= HEALTHY_MS ? 0 : attempt + 1
      // The closer resolves this as well as clearing the timer: clearing alone
      // would leave `run` suspended for ever, holding the reader, the handlers
      // and everything they close over.
      await new Promise<void>((resolve) => {
        wake = resolve
        retryTimer = setTimeout(resolve, backoff(attempt))
      })
    }
  }

  void run()

  return () => {
    stopped = true
    if (retryTimer) clearTimeout(retryTimer)
    wake?.()
    wake = null
    controller.abort()
  }
}
