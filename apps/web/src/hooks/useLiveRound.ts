// A round, telling anybody watching where it has got to.
//
// The goal this serves is co-presence, not oversight: a grown-up and a learner
// working through the same set from two screens instead of huddling round one.
// That shapes every decision here.
//
//   * **Nothing goes out unless somebody is there.** A round nobody has joined
//     — nearly all of them — sends one message when it starts and never
//     another. The client knows because presence rides the same channel it is
//     already listening to.
//   * **Drafts go out on a pause, never on a keystroke.** A pause is when a
//     person is thinking and a grown-up might usefully say something; it is
//     also the difference between a few messages a card and a hundred.
//   * **A failed send is never the learner's problem.** Every call here is
//     fire-and-forget, and a dropped one is simply lost — which is exactly what
//     the spec means by the live feed never being the record.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  DRAFT_IDLE_MS,
  DRAFT_MIN_GAP_MS,
  type RoundBeginPayload,
  type RoundDraftPayload,
  type RoundEndPayload,
  type RoundTickPayload,
} from '@whizzo/shared'
import { api } from '../lib/api/client'
import { useLearners } from '../lib/learners/LearnerProvider'
import { useLiveLearner } from './useLiveChannel'

type Sent =
  | ({ kind: 'round.begin' } & RoundBeginPayload)
  | ({ kind: 'round.tick' } & RoundTickPayload)
  | ({ kind: 'round.draft' } & RoundDraftPayload)
  | ({ kind: 'round.end' } & RoundEndPayload)

export interface LiveRound {
  /** True while somebody other than this learner is on the channel. */
  watched: boolean
  /** Their names, for the "Mom is here" line the learner must always see. */
  watcherNames: string[]
  begin: (round: RoundBeginPayload) => void
  /** The card on screen, and — once answered — how it went. */
  card: (tick: RoundTickPayload) => void
  /** What is in the answer box. Sent on a pause, not on every keystroke. */
  draft: (roundId: string, at: number, text: string) => void
  end: (summary: RoundEndPayload) => void
}

export function useLiveRound(): LiveRound {
  const { active } = useLearners()
  const learnerId = active?.id ?? null

  // A silent listener: a learner practising is not "watching" themselves, and
  // the pool means this costs no extra socket.
  //
  // `watchers` rather than `others`, and the difference matters: `others` drops
  // anyone sharing this session's user id, which is exactly the household where
  // a young learner works on a grown-up's account. Filtering by person would
  // mean a parent following from their phone was invisible to the iPad and the
  // round never emitted at all. This connection is silent, so it never appears
  // in the list — anybody in it is by definition somebody else's screen.
  const { watchers } = useLiveLearner(learnerId)
  const watched = watchers.length > 0

  const watchedRef = useRef(watched)
  watchedRef.current = watched
  const learnerRef = useRef(learnerId)
  learnerRef.current = learnerId

  const send = useCallback((body: Sent, evenIfUnwatched = false) => {
    const id = learnerRef.current
    if (!id) return
    if (!evenIfUnwatched && !watchedRef.current) return
    // Deliberately not awaited and deliberately swallowed. A child mid-round
    // must never wait on this, or be shown an error because of it.
    void api.post(`/live/learners/${id}`, body).catch(() => {})
  }, [])

  // --- drafts ---------------------------------------------------------------

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ roundId: string; at: number; text: string } | null>(null)
  const lastText = useRef('')
  const lastSentAt = useRef(0)

  const flushDraft = useCallback(() => {
    timer.current = null
    const next = pending.current
    if (!next) return
    // Nothing new to say. Retyping the same word after a pause is not news.
    if (next.text === lastText.current) return
    const since = Date.now() - lastSentAt.current
    if (since < DRAFT_MIN_GAP_MS) {
      // Too soon after the last one — wait out the remainder rather than drop
      // it, or a fast typist's final pause never gets sent.
      timer.current = setTimeout(flushDraft, DRAFT_MIN_GAP_MS - since)
      return
    }
    lastText.current = next.text
    lastSentAt.current = Date.now()
    send({ kind: 'round.draft', ...next })
  }, [send])

  const draft = useCallback(
    (roundId: string, at: number, text: string) => {
      pending.current = { roundId, at, text }
      if (!watchedRef.current) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flushDraft, DRAFT_IDLE_MS)
    },
    [flushDraft],
  )

  const stopDrafting = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    lastText.current = ''
  }, [])

  useEffect(() => stopDrafting, [stopDrafting])

  // --- the round ------------------------------------------------------------

  // `begin` and `end` are a pair, and both go out whether or not anybody is
  // watching. `begin` is how a grown-up learns there is something to join;
  // `end` is what takes that invitation away again — and since `begin` is
  // unconditional, gating `end` on somebody watching would leave every
  // unwatched round advertising itself until it aged out twenty minutes later.
  //
  // The ticks and drafts in between are the part that costs nothing when
  // nobody is there.
  const begin = useCallback(
    (round: RoundBeginPayload) => {
      stopDrafting()
      send({ kind: 'round.begin', ...round }, true)
    },
    [send, stopDrafting],
  )

  const card = useCallback(
    (tick: RoundTickPayload) => {
      // A new card, or the same one resolved: either way the draft is spent.
      stopDrafting()
      send({ kind: 'round.tick', ...tick })
    },
    [send, stopDrafting],
  )

  const end = useCallback(
    (summary: RoundEndPayload) => {
      stopDrafting()
      send({ kind: 'round.end', ...summary }, true)
    },
    [send, stopDrafting],
  )

  const watcherNames = useMemo(
    () => watchers.map((w) => w.name?.trim() || 'Someone'),
    [watchers],
  )

  // Memoised, and not as a micro-optimisation: callers put this in effect
  // dependency arrays. A fresh object every render turns "tell them which card
  // is up" into "tell them again on every render".
  return useMemo(
    () => ({ watched, watcherNames, begin, card, draft, end }),
    [watched, watcherNames, begin, card, draft, end],
  )
}
