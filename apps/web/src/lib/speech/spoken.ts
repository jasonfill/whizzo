// Turning card text into something that can be both said and followed.
//
// Reading a card out loud is half the feature. The other half is showing which
// word is being said, so a child who is still decoding can match the sound to
// the shape of the word rather than just hearing it go past. That needs one
// string for the speech engine and, for every word in it, the place on screen
// that word came from.
//
// The awkward part is that a card is not a string of words. It may hold an
// equation, which is spoken as a phrase ("six over eight") and drawn as a
// fraction, or a figure, which is spoken as its description and drawn as an
// SVG. Neither can be highlighted word by word, so both are treated as one
// unbreakable chunk: the whole equation lights up while the whole equation is
// being read.
//
// `richToPlain` already builds almost this string, but it trims and collapses
// whitespace — which moves every character offset after the first double space
// and would put the highlight on the wrong word. So the projection is rebuilt
// here, verbatim, and the offsets mean what the speech engine says they mean.

import { figureAlt, parseRich, type RichNode } from '../rich/parse'

/**
 * One highlightable piece of an utterance: a word of prose, or a whole
 * equation or figure description.
 */
export interface SpokenWord {
  /** Which node of `parseRich(source)` this came from. */
  node: number
  /** Where it starts inside that node's own spoken text. */
  at: number
  /** The text itself, exactly as it appears in the node. */
  text: string
  /** Where it starts in the full utterance, which is what boundaries report. */
  start: number
  /** Whether the node is spoken as a single chunk rather than word by word. */
  whole: boolean
}

export interface Spoken {
  /** Exactly what gets handed to the speech engine. */
  text: string
  words: SpokenWord[]
}

const EMPTY: Spoken = { text: '', words: [] }

/** What a node sounds like. Empty for anything with nothing to say. */
function say(node: RichNode): string {
  switch (node.type) {
    case 'text':
      return node.value
    case 'math':
      return node.text
    case 'figure':
      return figureAlt(node.spec)
    case 'invalid':
      // A broken figure is a note to whoever wrote the card. Reading the
      // warning out to the learner would be worse than saying nothing.
      return ''
  }
}

/**
 * The card as one utterance, plus where each word of it sits on screen.
 *
 * Runs of non-space characters are the unit, punctuation and all: a boundary
 * event lands on the letter a word starts with, and "cell," highlighted whole
 * looks right where "cell" followed by a stranded comma does not.
 */
export function spoken(source: string): Spoken {
  if (!source) return EMPTY
  const nodes = parseRich(source)
  const words: SpokenWord[] = []
  let text = ''

  nodes.forEach((node, index) => {
    const piece = say(node)
    if (!piece) return
    const base = text.length
    if (node.type === 'text') {
      const run = /\S+/g
      let match = run.exec(piece)
      while (match) {
        words.push({
          node: index,
          at: match.index,
          text: match[0],
          start: base + match.index,
          whole: false,
        })
        match = run.exec(piece)
      }
    } else if (piece.trim()) {
      // An equation or a figure: said as a phrase, lit up as a phrase.
      words.push({ node: index, at: 0, text: piece, start: base, whole: true })
    }
    text += piece
  })

  if (!words.length) return EMPTY
  return { text, words }
}

/**
 * The word a boundary at `charIndex` belongs to.
 *
 * Engines differ on where a word begins — some land on the first letter, some
 * a character early on the space in front of it — so a miss falls forward to
 * the next word rather than leaving the highlight behind.
 */
export function wordAt(words: readonly SpokenWord[], charIndex: number): number {
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!
    if (charIndex < w.start + w.text.length) return i
  }
  return words.length - 1
}

/**
 * Roughly how long a word takes to say, in milliseconds.
 *
 * Used only where the browser refuses to report boundaries (Safari and several
 * Android builds). An estimate that drifts is still worth far more than a
 * highlight that never moves, and it is thrown away the moment a real boundary
 * arrives.
 */
export function estimateMs(word: string, rate: number): number {
  return (110 + word.length * 60) / Math.max(0.1, rate)
}

/** Whether there is anything here worth reading out. */
export function isSayable(source: string): boolean {
  return spoken(source).words.length > 0
}
