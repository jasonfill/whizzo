// "Ada is practising right now."
//
// The discovery half of following a round: without it, watching only works if
// you already knew to look. A round announces itself when it starts, to every
// grown-up linked to that learner — on their own channel, not the learner's, so
// a tutor with thirty students holds one subscription rather than thirty.
//
// The broadcast alone is not enough, and that was the first version's mistake:
// a grown-up saw it only if they were already on the right screen at the moment
// it started. So this also *asks* on mount. The read is what makes it work at
// all; the channel is what makes it instant.
//
// Nothing here is authoritative — it is a nudge towards a screen, and a stale
// nudge is worse than none, so entries fade on their own.

import { useCallback, useEffect, useState } from 'react'
import type { LiveEvent } from '@whizzo/shared'
import { api } from '../lib/api/client'
import { useLiveMe } from './useLiveChannel'

export interface RoundNow {
  learnerId: string
  learnerName: string | null
  activity: string
  title: string
  startedAt: number
}

/**
 * How long a round is assumed to still be going without further word.
 *
 * The backstop, not the mechanism: a round that finishes says so, and this only
 * catches the tab that died without saying goodbye.
 */
const ASSUME_RUNNING_MS = 20 * 60_000

export function useRoundsNow(): RoundNow[] {
  const [rounds, setRounds] = useState<RoundNow[]>([])

  const onEvent = useCallback((event: LiveEvent) => {
    if (event.kind !== 'round.begin' && event.kind !== 'round.end') return
    const p = event.payload as {
      learnerId?: string
      learnerName?: string | null
      activity?: string
      title?: string
    }
    if (!p.learnerId) return

    // A finished round takes its own invitation away. Offering to follow
    // something that ended is worse than offering nothing.
    if (event.kind === 'round.end') {
      setRounds((prev) => prev.filter((r) => r.learnerId !== p.learnerId))
      return
    }

    const next: RoundNow = {
      learnerId: p.learnerId,
      learnerName: p.learnerName ?? null,
      activity: p.activity ?? 'practice',
      title: p.title ?? '',
      startedAt: Date.now(),
    }
    // One entry per learner: starting a second round replaces the first.
    setRounds((prev) => [next, ...prev.filter((r) => r.learnerId !== next.learnerId)])
  }, [])

  // What is already running when this mounts. Without it, opening the app while
  // a child is mid-round shows nothing at all.
  const read = useCallback(async (signal?: AbortSignal) => {
    try {
      const { rounds: found } = await api.get<{ rounds: RoundNow[] }>('/live/now', signal)
      if (!signal?.aborted) setRounds(found)
    } catch {
      // A nudge that cannot be fetched is simply absent. Never an error on a
      // screen that was asking about something else.
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void read(controller.signal)
    return () => controller.abort()
  }, [read])

  // The channel keeps it instant; the read above is what makes it work at all.
  useLiveMe({ onEvent, onResync: () => void read() })

  // Sweep rather than trust: a learner who closed the tab sends no `round.end`,
  // and a chip offering to follow a round that finished an hour ago is a lie.
  useEffect(() => {
    const timer = setInterval(() => {
      setRounds((prev) => {
        const fresh = prev.filter((r) => Date.now() - r.startedAt < ASSUME_RUNNING_MS)
        return fresh.length === prev.length ? prev : fresh
      })
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  return rounds
}
