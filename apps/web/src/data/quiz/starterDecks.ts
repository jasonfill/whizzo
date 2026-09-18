// Decks that ship with the app.
//
// The hand-written starter catalog moved to `@whizzo/shared` (`starters.ts`)
// so the API can hand a learner's added starters to the tutor with the same
// derived card ids the client writes mastery under. Re-exported here so every
// existing import in apps/web keeps working unchanged.

import { generatedDecks, STARTER_DECKS } from '@whizzo/shared'
import type { QuizDeck } from '../../lib/progress/types'

export { STARTER_DECKS, isStarterDeck, starterDecksFor } from '@whizzo/shared'

/**
 * Everything that ships with the app.
 *
 * The generated banks are folded in here rather than seeded, for the same
 * reason the hand-written starters are: they are constants, so they stay
 * updatable without a migration, and their card ids are derived rather than
 * random so a learner's mastery survives every reload.
 *
 * These are the content nobody should ever have to type. Four hundred
 * multiplication facts is not a thing to ask a parent for.
 */
export const SHIPPED_DECKS: QuizDeck[] = [...generatedDecks(), ...STARTER_DECKS]
