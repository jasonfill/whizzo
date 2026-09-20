// Reading a card out loud, and knowing where the voice has got to.
//
// The highlight is the part worth testing hard. It is built on an event the
// specification describes and half the browsers on the market never send, so
// the estimate that stands in for it, and the handover from one to the other,
// are the whole feature rather than a detail of it.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAloud, stopReading, useReading } from './reading'
import { estimateMs, isSayable, spoken, wordAt } from './spoken'

describe('spoken', () => {
  it('says plain text word by word', () => {
    const { text, words } = spoken('the powerhouse of the cell')
    expect(text).toBe('the powerhouse of the cell')
    expect(words.map((w) => w.text)).toEqual(['the', 'powerhouse', 'of', 'the', 'cell'])
    expect(words[1]!.start).toBe(4)
  })

  it('keeps the spacing the card was written with', () => {
    // `richToPlain` collapses runs of spaces, which would move every offset
    // after the first one and put the highlight on the wrong word.
    const { text, words } = spoken('one  two')
    expect(text).toBe('one  two')
    expect(words[1]!.start).toBe(5)
  })

  it('treats an equation as one chunk, because that is how it is said', () => {
    const { words } = spoken('Simplify $\\frac{6}{8}$')
    expect(words[0]!.text).toBe('Simplify')
    expect(words[0]!.whole).toBe(false)
    const math = words[words.length - 1]!
    expect(math.whole).toBe(true)
    expect(math.node).toBe(1)
  })

  it('reads a figure as its description', () => {
    const { text, words } = spoken('[[figure {"kind":"bar","data":[{"label":"Mon","value":4}]}]]')
    expect(text.length).toBeGreaterThan(0)
    expect(words).toHaveLength(1)
    expect(words[0]!.whole).toBe(true)
  })

  it('keeps punctuation with the word it belongs to', () => {
    expect(spoken('a cell, roughly').words.map((w) => w.text)).toEqual(['a', 'cell,', 'roughly'])
  })

  it('has nothing to say about a card with no words on it', () => {
    expect(isSayable('')).toBe(false)
    expect(isSayable('   ')).toBe(false)
    expect(isSayable('photosynthesis')).toBe(true)
  })
})

describe('wordAt', () => {
  const { words } = spoken('the powerhouse of the cell')

  it('finds the word a boundary landed in', () => {
    expect(wordAt(words, 4)).toBe(1)
    expect(wordAt(words, 8)).toBe(1)
  })

  it('falls forward when an engine reports the space in front of a word', () => {
    // Better a highlight one word early than one stuck behind the voice.
    expect(wordAt(words, 3)).toBe(1)
  })

  it('never runs off the end', () => {
    expect(wordAt(words, 9999)).toBe(words.length - 1)
  })
})

describe('estimateMs', () => {
  it('gives a longer word longer', () => {
    expect(estimateMs('photosynthesis', 1)).toBeGreaterThan(estimateMs('the', 1))
  })

  it('gives a slower voice longer', () => {
    expect(estimateMs('cell', 0.5)).toBeGreaterThan(estimateMs('cell', 1))
  })
})

// --- the store -------------------------------------------------------------

interface FakeUtterance {
  text: string
  onend?: () => void
  onboundary?: (e: { name?: string; charIndex: number }) => void
}

const CARD = 'the powerhouse of the cell'
let said: FakeUtterance[] = []

beforeEach(() => {
  said = []
  // The jsdom stub in test/setup.ts throws the utterance away, and every one
  // of these tests is about what happens to it after it is handed over.
  window.speechSynthesis.speak = vi.fn((u: SpeechSynthesisUtterance) => {
    said.push(u as unknown as FakeUtterance)
  }) as unknown as typeof window.speechSynthesis.speak
})

afterEach(() => {
  stopReading()
  vi.useRealTimers()
})

describe('readAloud', () => {
  it('starts on the first word of the text it was given', () => {
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    expect(said[0]!.text).toBe(CARD)
    expect(result.current.speaking).toBe(true)
    expect(result.current.word).toBe(0)
  })

  it('follows the voice when the browser reports word boundaries', () => {
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    act(() => said[0]!.onboundary?.({ name: 'word', charIndex: 15 }))
    expect(result.current.words[result.current.word]!.text).toBe('of')
  })

  it('ignores a sentence boundary, which would jump the highlight backwards', () => {
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    act(() => said[0]!.onboundary?.({ name: 'word', charIndex: 15 }))
    act(() => said[0]!.onboundary?.({ name: 'sentence', charIndex: 0 }))
    expect(result.current.words[result.current.word]!.text).toBe('of')
  })

  it('moves the highlight on its own where the browser sends no boundaries', () => {
    // Safari and a good share of Android tablets. An estimate that drifts is
    // worth far more than a highlight frozen on the first word.
    vi.useFakeTimers()
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    expect(result.current.word).toBe(0)
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.word).toBeGreaterThan(0)
  })

  it('stops estimating the moment a real boundary arrives', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    act(() => said[0]!.onboundary?.({ name: 'word', charIndex: 4 }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(result.current.words[result.current.word]!.text).toBe('powerhouse')
  })

  it('puts the highlight out when the voice finishes', () => {
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    act(() => said[0]!.onend?.())
    expect(result.current.speaking).toBe(false)
    expect(result.current.word).toBe(-1)
  })

  it('lights up only the text being read', () => {
    const { result } = renderHook(() => useReading('some other card'))
    act(() => readAloud(CARD))
    expect(result.current.speaking).toBe(false)
  })

  it('says nothing at all about a card with no words on it', () => {
    readAloud('   ')
    expect(said).toHaveLength(0)
  })

  it('does not let a replaced reading put out the one that replaced it', () => {
    // Cancelling fires `end` on the old utterance, and it can arrive after the
    // new one has started. Without the token check that would clear a
    // highlight that had only just been lit.
    const { result } = renderHook(() => useReading('second card'))
    act(() => readAloud('first card'))
    act(() => readAloud('second card'))
    act(() => said[0]!.onend?.())
    expect(result.current.speaking).toBe(true)
  })

  it('stops on request', () => {
    const { result } = renderHook(() => useReading(CARD))
    act(() => readAloud(CARD))
    act(() => stopReading())
    expect(result.current.speaking).toBe(false)
  })
})
