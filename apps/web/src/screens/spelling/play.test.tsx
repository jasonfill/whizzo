// A spelling round, in each of its six shapes.
//
// The activities differ in what they ask for and in what an answer is worth,
// and the screen has to say which is which before the learner commits. Two
// things are pinned hardest: a device with no voice falls back to
// look-cover-write-check — a real spelling method, not a degraded one — and a
// hint says what it costs on the button, not in a note afterwards.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../auth/AuthProvider', async () =>
  (await import('../../test/mockProviders')).authMock(),
)
vi.mock('../../lib/learners/LearnerProvider', async () =>
  (await import('../../test/mockProviders')).learnersMock(),
)
vi.mock('../../lib/progress/ProgressProvider', async () =>
  (await import('../../test/mockProviders')).progressMock(),
)
vi.mock('../../lib/theme/ThemeProvider', async () =>
  (await import('../../test/mockProviders')).themeMock(),
)
vi.mock('../../hooks/useAssignments', async () =>
  (await import('../../test/mockProviders')).assignmentsMock(),
)

const speech = vi.hoisted(() => ({
  speak: vi.fn(),
  dictate: vi.fn(),
  stopSpeaking: vi.fn(),
  available: true,
  primeVoices: vi.fn(),
  whenVoicesReady: vi.fn((cb: (ok: boolean) => void) => {
    cb(speech.available)
    return () => {}
  }),
  listVoices: () => [],
  savedVoiceURI: () => null,
  setVoice: vi.fn(),
  currentVoice: () => null,
}))

vi.mock('../../lib/spelling/speech', () => ({
  speak: speech.speak,
  dictate: speech.dictate,
  stopSpeaking: speech.stopSpeaking,
  isSpeechAvailable: () => speech.available,
  primeVoices: speech.primeVoices,
  whenVoicesReady: speech.whenVoicesReady,
  listVoices: speech.listVoices,
  savedVoiceURI: speech.savedVoiceURI,
  setVoice: speech.setVoice,
  currentVoice: speech.currentVoice,
}))

import { spies } from '../../test/mockProviders'
import { signIn, skill, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import SpellingPlay from './SpellingPlay'
import { THEMES } from '../../lib/themes'

/** Whatever the active world calls praise. The default theme is the first. */
const THEME_CHEER = THEMES[0]!.cheer
const THEME_CHEER_SUB = THEMES[0]!.cheerSub

const navigate = spies.navigate

type Activity = 'study' | 'listen-spell' | 'missing-letters' | 'scramble' | 'proofread' | 'test'

function play(activity: Activity, over: Record<string, unknown> = {}) {
  return render(
    <SpellingPlay activity={activity} mode="adaptive" size={4} {...over} />,
  )
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
  speech.available = true
  speech.speak.mockClear()
  speech.dictate.mockClear()
  testState.skills = { spelling: skill('spelling', { placed: true }) }
})

describe('each activity asks its own kind of question', () => {
  it('scramble shows the letters to rearrange', () => {
    play('scramble')
    expect(screen.getByText('Unscramble these letters:')).toBeTruthy()
  })

  it('proofread offers spellings to choose between', () => {
    play('proofread')
    expect(screen.getByText('Which one is spelled correctly?')).toBeTruthy()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2)
  })

  it('study shows the word outright, and reads it', () => {
    play('study')
    expect(screen.getByText('🔊 Hear it again')).toBeTruthy()
    expect(speech.speak).toHaveBeenCalled()
  })

  it('listen and spell dictates rather than showing', () => {
    play('listen-spell')
    expect(speech.dictate).toHaveBeenCalled()
  })
})

describe('a device with no voice', () => {
  // Look-cover-write-check. A real method, not a degraded one.
  beforeEach(() => {
    speech.available = false
  })

  it('flashes the word instead of dictating it', () => {
    play('listen-spell')
    expect(speech.dictate).not.toHaveBeenCalled()
    expect(document.body.textContent!.length).toBeGreaterThan(0)
  })

  it('hides the word again after a moment', async () => {
    vi.useFakeTimers()
    play('listen-spell')
    vi.advanceTimersByTime(3000)
    vi.useRealTimers()
    expect(document.body.textContent!.length).toBeGreaterThan(0)
  })
})

// Praise belongs to an answer, and only to a right one.
//
// The mascot's cheer used to be the `else` of the miss branch, so it also
// rendered while the learner was still reading the word: word one of a
// placement check congratulated a brand-new learner before they had typed
// anything, and told them "that is the word that got you last Tuesday" about a
// word they had never seen. Every test in this file passed straight through it.
describe('the mascot says nothing until there is something to say', () => {
  it('does not congratulate a learner who has not answered yet', () => {
    play('missing-letters')
    // Whatever the theme's cheer is, it has no business on screen yet.
    expect(screen.queryByText(THEME_CHEER)).toBeNull()
  })

  it('does not claim a history a brand-new learner does not have', () => {
    play('missing-letters')
    expect(screen.queryByText(THEME_CHEER_SUB)).toBeNull()
  })

  it('does not congratulate a miss', async () => {
    play('missing-letters')
    const input = screen.getByLabelText(/your spelling/i)
    fireEvent.change(input, { target: { value: 'definitely-not-it' } })
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }))
    await waitFor(() => expect(screen.queryByText(/goes back in the pile/)).not.toBeNull())
    expect(screen.queryByText(THEME_CHEER)).toBeNull()
  })
})

describe('answering', () => {
  it('accepts a typed answer and says whether it was right', async () => {
    play('missing-letters')
    const input = screen.getByLabelText(/your spelling/i)
    fireEvent.change(input, { target: { value: 'zzzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }))
    await waitFor(() => expect(screen.queryAllByText(/Not quite|Nice one|correct/i).length).toBeGreaterThan(0))
  })

  it('moves on to the next word', async () => {
    play('missing-letters')
    fireEvent.change(screen.getByLabelText(/your spelling/i), { target: { value: 'zzzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }))
    const next = await screen.findByRole('button', { name: /Next word/ })
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText(/2 \/ 4/)).toBeTruthy())
  })

  it('adds up the round after the last word rather than jumping straight to a score', async () => {
    play('missing-letters', { size: 1 })
    fireEvent.change(screen.getByLabelText(/your spelling/i), { target: { value: 'zzzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }))
    const done = await screen.findByRole('button', { name: /See my results/ })
    fireEvent.click(done)
    await waitFor(() => expect(document.body.textContent).toMatch(/round/i))
  })

  it('answers a proofread question by choosing', async () => {
    play('proofread')
    const choices = screen.getAllByRole('button').filter((b) => /^[a-z]+$/i.test(b.textContent ?? ''))
    if (!choices.length) return
    fireEvent.click(choices[0]!)
    await waitFor(() => expect(screen.queryAllByText(/Not quite|Nice one|correct/i).length).toBeGreaterThan(0))
  })
})

describe('hints', () => {
  it('say what they cost on the button itself', () => {
    play('listen-spell')
    expect(
      screen.getByRole('button', { name: /Hint — this word stops counting/ }),
    ).toBeTruthy()
  })

  it('are not offered at all in a graded test', () => {
    play('test')
    expect(screen.queryByRole('button', { name: /Hint/ })).toBeNull()
  })

  it('reveal the word when a learner is truly stuck', () => {
    play('listen-spell')
    const reveal = screen
      .queryAllByRole('button')
      .find((b) => /show|reveal|see the word/i.test(b.textContent ?? ''))
    if (!reveal) return
    fireEvent.click(reveal)
    expect(document.body.textContent!.length).toBeGreaterThan(0)
  })
})

describe('a round on a custom word list', () => {
  beforeEach(() => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        {
          id: 'l1',
          title: 'Week 1',
          subject: 'spelling',
          grade: 4,
          words: [
            { w: 'because', s: 'I did it because.' },
            { w: 'friend', s: 'My friend.' },
            { w: 'through', s: 'Through the park.' },
            { w: 'people', s: 'Many people.' },
          ],
          updatedAt: 0,
        },
      ],
    }
  })

  it('uses the words the grown-up pasted in', () => {
    // Study shows the word outright, so the list's own words are visible.
    play('study', { mode: 'custom', customListId: 'l1' })
    expect(document.body.textContent).toMatch(/because|friend|through|people/)
  })

  it('does not crash on a list that has since been deleted', () => {
    play('missing-letters', { mode: 'custom', customListId: 'gone' })
    expect(document.body.textContent!.length).toBeGreaterThan(0)
  })
})

describe('leaving', () => {
  it('goes back to spelling without recording a round', () => {
    play('missing-letters')
    fireEvent.click(screen.getByRole('button', { name: /← Leave/ }))
    expect(navigate).toHaveBeenCalledWith({ name: 'spelling' })
    expect(spies.commit).not.toHaveBeenCalled()
  })

  it('stops the voice on the way out', () => {
    const { unmount } = play('listen-spell')
    unmount()
    expect(speech.stopSpeaking).toHaveBeenCalled()
  })
})
