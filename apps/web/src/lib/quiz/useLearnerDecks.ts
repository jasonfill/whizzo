// The one list of decks a learner has.
//
// Three ways a deck gets in, each undone in its own way (docs/ux-coherence.md):
// the learner made it, a grown-up set it as a task, or the learner added a
// starter deck. Starter decks are a catalog, not a default — nothing reaches
// a learner uninvited — and the set a learner has added lives on the learner
// row (`learners.starter_decks`), so it follows them to any device.

import { useCallback, useMemo, useState } from 'react'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { useLearners } from '../learners/LearnerProvider'
import { useProgress } from '../progress/ProgressProvider'
import type { ProgressSnapshot, QuizDeck } from '../progress/types'
import { allDecks } from './decks'

/** The starter decks a learner has added, in catalog order. Unknown ids are dropped. */
export function addedStarters(starterIds: readonly string[] | undefined): QuizDeck[] {
  if (!starterIds?.length) return []
  return STARTER_DECKS.filter((d) => starterIds.includes(d.id))
}

/**
 * Every deck in the learner's list: their own and the ones set for them (both
 * in the snapshot), then the starter decks they have added. Pure, so a plain
 * function can take it; components use `useLearnerDecks`.
 */
export function learnerDecks(snapshot: ProgressSnapshot, starterIds: readonly string[] | undefined): QuizDeck[] {
  return allDecks(snapshot, addedStarters(starterIds))
}

export function isStarterId(id: string): boolean {
  return STARTER_DECKS.some((d) => d.id === id)
}

/**
 * Every deck the learner on screen can open. The one list every total,
 * review round and deck picker reads from. A session with no learner on
 * screen — a guest — has no starters: there is nobody to have added one.
 */
export function useLearnerDecks(): QuizDeck[] {
  const { snapshot } = useProgress()
  const { active } = useLearners()
  const starterIds = active?.starterDecks
  return useMemo(() => learnerDecks(snapshot, starterIds), [snapshot, starterIds])
}

export interface StarterCatalog {
  /** Starter decks not yet in the learner's list, in catalog order. */
  available: QuizDeck[]
  /** Ids of the starter decks already added. */
  added: string[]
  /** Whether a change is on its way to the server. */
  busy: boolean
  /** Whether adding is possible at all: it needs a learner on screen. */
  canAdd: boolean
  add: (id: string) => Promise<void>
  /** Mastery is kept — the deck comes back with its progress if added again. */
  remove: (id: string) => Promise<void>
}

/**
 * The catalog and the two moves on it. Each write sends the whole list, then
 * swaps the returned learner into the provider, so `useLearnerDecks` updates
 * everywhere at once without a reload.
 */
export function useStarterCatalog(): StarterCatalog {
  const { active, update } = useLearners()
  const [busy, setBusy] = useState(false)
  const added = useMemo(
    () => (active?.starterDecks ?? []).filter(isStarterId),
    [active?.starterDecks],
  )
  const available = useMemo(() => STARTER_DECKS.filter((d) => !added.includes(d.id)), [added])

  const write = useCallback(
    async (next: string[]) => {
      if (!active) throw new Error('Pick a learner before changing starter decks')
      setBusy(true)
      try {
        await update(active.id, { starterDecks: next })
      } finally {
        setBusy(false)
      }
    },
    [active, update],
  )

  const add = useCallback(
    async (id: string) => {
      if (!isStarterId(id) || added.includes(id)) return
      await write([...added, id])
    },
    [added, write],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!added.includes(id)) return
      await write(added.filter((x) => x !== id))
    },
    [added, write],
  )

  return { available, added, busy, canAdd: Boolean(active), add, remove }
}
