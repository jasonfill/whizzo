// The speaker button, and the word it lights up.
//
// Two things here are promises to a child rather than implementation details:
// a button that is on screen does something when it is pressed, and the word
// that is highlighted is the word being said.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichText from '../rich/RichText'
import { stopReading } from '../../lib/speech/reading'
import ReadAloud from './ReadAloud'
import SpeakButton from './SpeakButton'

interface FakeUtterance {
  text: string
  onend?: () => void
  onboundary?: (e: { name?: string; charIndex: number }) => void
}

let said: FakeUtterance[] = []

/** A device with a voice installed, which is what puts the buttons on screen. */
function withVoice(): void {
  window.speechSynthesis.getVoices = () =>
    [{ name: 'Ava', lang: 'en-US', voiceURI: 'ava', default: true, localService: true }] as
      unknown as SpeechSynthesisVoice[]
}

beforeEach(() => {
  said = []
  withVoice()
  window.speechSynthesis.speak = vi.fn((u: SpeechSynthesisUtterance) => {
    said.push(u as unknown as FakeUtterance)
  }) as unknown as typeof window.speechSynthesis.speak
})

afterEach(() => {
  stopReading()
})

describe('SpeakButton', () => {
  it('reads the text out when it is pressed', () => {
    render(<SpeakButton source="the powerhouse of the cell" label="Read it out loud" />)
    fireEvent.click(screen.getByLabelText('Read it out loud'))
    expect(said[0]!.text).toBe('the powerhouse of the cell')
  })

  it('stops when it is pressed again', () => {
    render(<SpeakButton source="mitochondrion" label="Read it out loud" />)
    const button = screen.getByLabelText('Read it out loud')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('is not there at all on a device with no voice', () => {
    // An icon that does nothing when a child presses it teaches them to stop
    // trusting the ones that do.
    window.speechSynthesis.getVoices = () => []
    const { container } = render(<SpeakButton source="cell" label="Read it out loud" />)
    expect(container.innerHTML).toBe('')
  })

  it('is not there for a card with no words on it', () => {
    const { container } = render(<SpeakButton source="   " label="Read it out loud" />)
    expect(container.innerHTML).toBe('')
  })

  it('does not also trigger whatever it is sitting inside', () => {
    // These live on flashcards and answer tiles. Asking to hear a choice must
    // never mean picking it.
    const outer = vi.fn()
    render(
      <div onClick={outer}>
        <SpeakButton source="an answer" label="Read this answer out loud" />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Read this answer out loud'))
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('the word being said', () => {
  it('is highlighted, and only it', () => {
    const { container } = render(
      <ReadAloud source="the powerhouse of the cell" label="Read it out loud" />,
    )
    expect(container.querySelector('mark')).toBeNull()

    fireEvent.click(screen.getByLabelText('Read it out loud'))
    expect(container.querySelector('mark')!.textContent).toBe('the')

    // 'of' starts at character 15.
    act(() => said[0]!.onboundary?.({ name: 'word', charIndex: 15 }))
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]!.textContent).toBe('of')
  })

  it('leaves the rest of the line exactly where it was', () => {
    const { container } = render(
      <ReadAloud source="the powerhouse of the cell" label="Read it out loud" />,
    )
    fireEvent.click(screen.getByLabelText('Read it out loud'))
    expect(container.textContent).toContain('the powerhouse of the cell')
  })

  it('goes out when the voice finishes', () => {
    const { container } = render(
      <ReadAloud source="mitochondrion" label="Read it out loud" />,
    )
    fireEvent.click(screen.getByLabelText('Read it out loud'))
    expect(container.querySelector('mark')).not.toBeNull()
    act(() => said[0]!.onend?.())
    expect(container.querySelector('mark')).toBeNull()
  })

  it('lights up everywhere the same words are on screen', () => {
    // The reading is keyed by the text, so a card showing its answer twice —
    // in the round and again in the results — follows along in both places.
    const { container } = render(
      <div>
        <ReadAloud source="photosynthesis" label="Read it out loud" />
        <RichText source="photosynthesis" />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Read it out loud'))
    expect(container.querySelectorAll('mark')).toHaveLength(2)
  })

  it('does not touch a card that is not being read', () => {
    const { container } = render(
      <div>
        <ReadAloud source="photosynthesis" label="Read it out loud" />
        <RichText source="respiration" />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Read it out loud'))
    const marks = [...container.querySelectorAll('mark')].map((m) => m.textContent)
    expect(marks).toEqual(['photosynthesis'])
  })
})
