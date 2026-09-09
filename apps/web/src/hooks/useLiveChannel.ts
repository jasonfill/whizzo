// One live subscription per learner, shared by every feature that wants one.
//
// The connection itself lives in lib/live/pool.ts; this is the React face of
// it. A screen asks for a handler, not a socket, and several screens asking at
// once still means one stream — which is what lets the planner, the home
// screen's Today strip and a running round all listen without three sockets
// and three copies of every event.
//
// Handlers are held in a ref so that a caller passing an inline arrow function
// — which everybody does — does not tear the subscription down and rebuild it
// on every render.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { type LiveEvent, type LiveWatcher } from '@whizzo/shared'
import { useAuth } from '../auth/AuthProvider'
import { ORIGIN_ID } from '../lib/api/client'
import { acquire, snapshotOf, subscribeToSnapshot } from '../lib/live/pool'
import type { LiveStatus } from '../lib/live/client'

export interface LiveChannel {
  status: LiveStatus
  /** Everyone announced on this channel right now, this tab included. */
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
  return useChannel(learnerId ? `/live/learners/${learnerId}` : null, handlers)
}

/**
 * The caller's own channel: things addressed to one grown-up rather than to a
 * learner — a child starting a round, a job finishing, an invite accepted.
 */
export function useLiveMe(handlers: LiveHandlers = {}): LiveChannel {
  const { user } = useAuth()
  return useChannel(user ? '/live/me' : null, handlers)
}

function useChannel(path: string | null, handlers: LiveHandlers): LiveChannel {
  const { user } = useAuth()
  const me = user?.id ?? null

  const ref = useRef(handlers)
  ref.current = handlers

  // Not read through the ref: it decides how the connection is opened, so it
  // has to be a dependency rather than a detail an open stream cannot act on.
  const announce = handlers.announce ?? false

  const onEvent = useCallback((event: LiveEvent) => {
    // The echo of this tab's own optimistic write. Applying it would be
    // harmless in most cases and a flicker in the rest; either way there is
    // nothing to learn from being told what you just did.
    if (event.originId && event.originId === ORIGIN_ID) return
    ref.current.onEvent?.(event)
  }, [])

  const onResync = useCallback(() => ref.current.onResync?.(), [])

  useEffect(() => {
    if (!path) return
    return acquire(path, { onEvent, onResync, announce })
  }, [path, onEvent, onResync, announce])

  const subscribe = useCallback(
    (listener: () => void) => subscribeToSnapshot(path, listener),
    [path],
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    () => snapshotOf(path),
    () => snapshotOf(path),
  )

  const others = useMemo(
    () => snapshot.watchers.filter((w) => w.userId !== me),
    [snapshot.watchers, me],
  )

  return { status: snapshot.status, watchers: snapshot.watchers, others }
}
