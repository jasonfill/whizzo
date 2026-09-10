// The library — decks and word lists that belong to a grown-up.
//
// Content has belonged to a learner since the app was for one family. A tutor
// needs the other kind: material that is theirs, reusable across every student,
// and readable by a student only once it has been set as work.

import type { CustomWordList, LibraryResponse, QuizDeck } from '@whizzo/shared'
import { ApiError, api } from '../api/client'

export async function loadLibrary(signal?: AbortSignal): Promise<LibraryResponse> {
  return api.get<LibraryResponse>('/library', signal)
}

/** One deck from your library, or null when it is not there any more. */
export async function getLibraryDeck(deckId: string, signal?: AbortSignal): Promise<QuizDeck | null> {
  try {
    const res = await api.get<{ deck: QuizDeck }>(`/library/decks/${deckId}`, signal)
    return res.deck
  } catch (err) {
    if (err instanceof ApiError && err.isMissing) return null
    throw err
  }
}

/** Save decks into your library. Ids are client-generated, so this is an upsert. */
export async function saveLibraryDecks(decks: QuizDeck[]): Promise<QuizDeck[]> {
  const res = await api.post<{ decks: QuizDeck[] }>('/library/decks', { decks })
  return res.decks
}

export async function saveLibraryLists(customLists: CustomWordList[]): Promise<CustomWordList[]> {
  const res = await api.post<{ customLists: CustomWordList[] }>('/library/word-lists', {
    customLists,
  })
  return res.customLists
}

export async function deleteLibraryDeck(deckId: string): Promise<void> {
  await api.del<void>(`/library/decks/${deckId}`)
}

export async function deleteLibraryList(listId: string): Promise<void> {
  await api.del<void>(`/library/word-lists/${listId}`)
}
