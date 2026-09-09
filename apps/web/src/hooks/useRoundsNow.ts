// "Ada is practising right now."
//
// The discovery half of following a round: without it, watching only works if
// you already knew to look. A round announces itself once, when it starts, to
// every grown-up linked to that learner — on their own channel, not the
// learner's, so a tutor with thirty students holds one subscription rather
// than thirty.
//
// Entries fade on their own. Nothing here is authoritative — it is a nudge
// towards a screen, and a stale nudge is worse than none.

import { useCallback, useEffect, useState } from 'react'
import type { LiveEvent } from '@whizzo/shared'
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

  useLiveMe({ onEvent })

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
