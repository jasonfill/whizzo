// One live subscription per learner, shared by every feature that wants one.
//
// The connection is deliberately not per-feature: the planner, presence and
// (next) watching a round all ride the same stream and filter by `kind`. A
// screen that wants events asks for a handler, not a socket.
//
// Handlers are held in a ref so that a caller passing an inline arrow function
// — which everybody does — does not tear the connection down and build it up
// again on every render.

import { useCallback, useEffect, useRef, useState } from 'react'
import { type LiveEvent, type LiveWatcher, type WatchPayload } from '@whizzo/shared'
import { useAuth } from '../auth/AuthProvider'
import { ORIGIN_ID } from '../lib/api/client'
import { openLive, type LiveStatus } from '../lib/live/client'

export interface LiveChannel {
  status: LiveStatus
  /** Everyone on this channel right now, this tab included. */
  watchers: LiveWatcher[]
  /** Everyone else — what you show as "Mom is here". */
  others: LiveWatcher[]
}

export interface LiveHandlers {
  /** Events from other tabs. This tab's own echoes are filtered out first. */
  onEvent?: (event: LiveEvent) => void
  /** The stream came back after a gap: re-read what you are showing. */
  onResync?: () => void
  /**
   * Appear to everyone else on this channel as being here.
   *
   * Off by default, and that default is the point: holding a subscription is
   * not the same as being somewhere. Only a screen that is actually showing
   * the thing should announce itself, or "Ada is here" ends up meaning "Ada
   * has the app open", which is a different and much weaker claim — on the one
   * surface the consent rule rests on.
   */
  announce?: boolean
}

export function useLiveLearner(learnerId: string | null, handlers: LiveHandlers = {}): LiveChannel {
  const { user } = useAuth()
  const me = user?.id ?? null
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [watchers, setWatchers] = useState<LiveWatcher[]>([])

  const ref = useRef(handlers)
  ref.current = handlers

  // Not read through the ref: changing it changes the connection, so it has to
  // be a dependency rather than a detail the open stream cannot act on.
  const announce = handlers.announce ?? false

  const onEvent = useCallback((event: LiveEvent) => {
    // Presence is bookkeeping every consumer wants and none should have to do,
    // so it is handled here and still passed on for anyone who cares who moved.
    if (event.kind === 'watch.begin' || event.kind === 'watch.end') {
      setWatchers((event.payload as WatchPayload).watchers ?? [])
    }
    // The echo of this tab's own optimistic write. Applying it would be
    // harmless in most cases and a flicker in the rest; either way there is
    // nothing to learn from being told what you just did.
    if (event.originId && event.originId === ORIGIN_ID) return
    ref.current.onEvent?.(event)
  }, [])

  useEffect(() => {
    if (!learnerId) {
      setStatus('offline')
      setWatchers([])
      return
    }
    setWatchers([])
    const close = openLive(`/live/learners/${learnerId}${announce ? '?announce=1' : ''}`, {
      onEvent,
      onStatus: setStatus,
      onResync: () => ref.current.onResync?.(),
    })
    return () => {
      close()
      setWatchers([])
    }
  }, [learnerId, onEvent, announce])

  // One entry per person, so "who else is here" means people, not tabs.
  const others = watchers.filter((w) => w.userId !== me)
  return { status, watchers, others }
}
