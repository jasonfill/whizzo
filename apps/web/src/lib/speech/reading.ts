// What is being read out loud, right now, anywhere in the app.
//
// There is one speech engine in the browser and it says one thing at a time,
// so there is one store here rather than state per screen. That is what makes
// the highlight work across components that do not know about each other: the
// speaker button under a flashcard and the words inside it are two separate
// pieces of the tree, and neither has to be told about the other.
//
// A reading is keyed by the card text itself rather than by an id. Two places
// showing the same words are showing the same words — lighting both up is
// correct, and it saves every call site inventing a name for something the
// text already names.

import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_RATE, speak, stopSpeaking } from '../spelling/speech'
import { estimateMs, spoken, wordAt, type SpokenWord } from './spoken'

export interface Reading {
  source: string
  words: readonly SpokenWord[]
  /** Which word is being said. -1 before the first one lands. */
  index: number
}

let current: Reading | null = null
/** Which reading owns the engine. Guards callbacks from an utterance we cancelled. */
let token = 0
let timers: number[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listen of listeners) listen()
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen)
  return () => {
    listeners.delete(listen)
  }
}

function snapshot(): Reading | null {
  return current
}

function clearTimers(): void {
  for (const t of timers) window.clearTimeout(t)
  timers = []
}

function setIndex(index: number): void {
  if (!current || current.index === index) return
  current = { ...current, index }
  emit()
}

/** Stop whatever is being read, and put every highlight out. */
export function stopReading(): void {
  token += 1
  clearTimers()
  stopSpeaking()
  if (current) {
    current = null
    emit()
  }
}

/**
 * Read a piece of card text, highlighting each word as it is said.
 *
 * Highlighting runs on estimated timings from the first word and switches to
 * the browser's own boundary events the moment one arrives. Doing it the other
 * way round — waiting to see whether boundaries work — would leave the highlight
 * frozen on devices that never send them, which is most iPads.
 */
export function readAloud(source: string): void {
  const { text, words } = spoken(source)
  if (!words.length) return

  stopReading()
  const mine = (token += 1)
  current = { source, words, index: 0 }
  emit()

  let estimating = true
  let elapsed = 0
  for (let i = 1; i < words.length; i += 1) {
    elapsed += estimateMs(words[i - 1]!.text, DEFAULT_RATE)
    const at = i
    timers.push(
      window.setTimeout(() => {
        if (token === mine && estimating) setIndex(at)
      }, elapsed),
    )
  }

  speak(text, {
    onBoundary: (charIndex) => {
      if (token !== mine) return
      if (estimating) {
        estimating = false
        clearTimers()
      }
      setIndex(wordAt(words, charIndex))
    },
    onEnd: () => {
      // A cancelled utterance ends too, and by then `token` belongs to
      // whatever replaced it — so this only ever clears its own reading.
      if (token !== mine) return
      clearTimers()
      current = null
      emit()
    },
  })
}

export interface ReadingApi {
  /** Whether this text is the thing being read. */
  speaking: boolean
  /** The word being said, as an index into `words`. -1 when idle. */
  word: number
  /** Where every word of this reading sits on screen. Empty when idle. */
  words: readonly SpokenWord[]
  /** Start reading it, or stop if it is already being read. */
  toggle: () => void
}

const NOT_READING: readonly SpokenWord[] = []

/**
 * Follow — and control — the reading of one piece of card text.
 *
 * Safe to call from anything that shows card text, including a list of a
 * hundred rows: an idle reading does no work beyond one equality check, and
 * nothing is parsed until the text is actually being read.
 */
export function useReading(source: string): ReadingApi {
  const reading = useSyncExternalStore(subscribe, snapshot, snapshot)
  const speaking = reading?.source === source
  const toggle = useCallback(() => {
    if (snapshot()?.source === source) stopReading()
    else readAloud(source)
  }, [source])
  return {
    speaking,
    word: speaking ? reading!.index : -1,
    words: speaking ? reading!.words : NOT_READING,
    toggle,
  }
}
