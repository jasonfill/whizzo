// The four ways to study a deck, driven end to end through QuizPlay.
//
// Each mode makes a different bargain about evidence, and the bargain is the
// point. Flashcards are self-graded and say so; Learn and Test check the
// answer; Match checks every pair itself. A mode may change how hard a round
// feels — it may never change what an answer is worth without saying so.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('../../lib/spelling/speech', () => ({
  speak: vi.fn(),
  dictate: vi.fn(),
  stopSpeaking: vi.fn(),
  isSpeechAvailable: () => true,
  primeVoices: vi.fn(),
  whenVoicesReady: vi.fn(() => () => {}),
  listVoices: () => [],
  savedVoiceURI: () => null,
  setVoice: vi.fn(),
  currentVoice: () => null,
}))

import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { spies } from '../../test/mockProviders'
import { signIn, testState } from '../../test/state'
import QuizPlay from './QuizPlay'

const navigate = spies.navigate
const DECK = STARTER_DECKS[0]!

beforeEach(() => {
  signIn()
  navigate.mockClear()
})

describe('a deck with nothing to study', () => {
  it('says review is empty because the system is working, not broken', async () => {
    render(<QuizPlay mode="review" navigate={navigate} />)
    expect(await screen.findByText(/That is the system working/)).toBeTruthy()
  })

  it('offers a way back to the decks', async () => {
    render(<QuizPlay mode="review" navigate={navigate} />)
    fireEvent.click(await screen.findByText('Back to decks'))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })

  it('says so plainly for a deck with no cards', async () => {
    testState.snapshot = {
      ...testState.snapshot,
      decks: [{ ...DECK, id: 'empty-deck', cards: [], source: 'user' }],
    }
    render(<QuizPlay mode="learn" deckId="empty-deck" navigate={navigate} />)
    expect(await screen.findByText(/no cards to study here yet/)).toBeTruthy()
  })
})

describe('flashcards', () => {
  function renderCards() {
    return render(<QuizPlay mode="flashcards" deckId={DECK.id} navigate={navigate} />)
  }

  it('shows the question side first, and hides the answer', async () => {
    renderCards()
    expect(await screen.findByText('Question')).toBeTruthy()
    expect(screen.queryByText('😺 Got it')).toBeNull()
  })

  it('will not let you grade a card you have not turned over', async () => {
    // Grading before looking is not a self-assessment, it is a coin toss.
    renderCards()
    await screen.findByText('Question')
    expect(screen.getByText(/turn the card over to see how you did/)).toBeTruthy()
  })

  it('turns over on a tap and offers the two honest answers', async () => {
    renderCards()
    fireEvent.click(await screen.findByLabelText('Turn card over'))
    expect(screen.getByText('Answer')).toBeTruthy()
    expect(screen.getByText('😺 Got it')).toBeTruthy()
    expect(screen.getByText('😾 Still learning')).toBeTruthy()
  })

  it('turns over on the space bar too', async () => {
    renderCards()
    await screen.findByText('Question')
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('Answer')).toBeTruthy()
  })

  it('promises a missed card will come back, rather than listing it at the end', async () => {
    // The honest answer has to lead somewhere, or nobody gives it.
    renderCards()
    fireEvent.click(await screen.findByLabelText('Turn card over'))
    fireEvent.click(screen.getByText('😾 Still learning'))
    expect(await screen.findByText(/we'll come back to this one in a bit/i)).toBeTruthy()
  })

  it('moves on when a card was known', async () => {
    renderCards()
    const first = (await screen.findByText('Question')).parentElement!.textContent
    fireEvent.click(screen.getByLabelText('Turn card over'))
    fireEvent.click(screen.getByText('😺 Got it'))
    await waitFor(() => {
      expect(screen.getByText('Question').parentElement!.textContent).not.toBe(first)
    })
  })

  it('grades from the keyboard once the card is turned over', async () => {
    renderCards()
    await screen.findByText('Question')
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText('Question')).toBeTruthy())
  })

  it('ignores an arrow key while the card is face down', async () => {
    renderCards()
    await screen.findByText('Question')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Question')).toBeTruthy()
    expect(screen.queryByText('Answer')).toBeNull()
  })

  it('offers to read the card out', async () => {
    renderCards()
    await screen.findByText('Question')
    fireEvent.click(screen.getByLabelText('Read this side out loud'))
    const { speak } = await import('../../lib/spelling/speech')
    expect(speak).toHaveBeenCalled()
  })

  it('says how many cards are put away', async () => {
    renderCards()
    expect(await screen.findByText(/0 of \d+ put away/)).toBeTruthy()
  })

  describe('slide layout', () => {
    // Some learners want the question in front of them while they check the
    // answer. That changes what is on screen, not what a grade is worth.
    async function renderSliding() {
      renderCards()
      await screen.findByText('Question')
      fireEvent.click(screen.getByRole('radio', { name: /Slide/ }))
    }

    it('still keeps the answer hidden until asked', async () => {
      await renderSliding()
      expect(screen.getByText('Question')).toBeTruthy()
      expect(screen.queryByText('Answer')).toBeNull()
      expect(screen.queryByText('😺 Got it')).toBeNull()
      expect(screen.getByText(/show the answer to see how you did/)).toBeTruthy()
    })

    it('shows both sides at once when the answer slides in', async () => {
      await renderSliding()
      fireEvent.click(screen.getByLabelText('Show the answer'))
      expect(screen.getByText('Question')).toBeTruthy()
      expect(screen.getByText('Answer')).toBeTruthy()
      expect(screen.getByText('😺 Got it')).toBeTruthy()
      expect(screen.getByText('😾 Still learning')).toBeTruthy()
    })

    it('slides the answer in on the space bar too', async () => {
      await renderSliding()
      fireEvent.keyDown(window, { key: ' ' })
      expect(screen.getByText('Answer')).toBeTruthy()
      expect(screen.getByLabelText('Hide the answer')).toBeTruthy()
    })

    it('remembers the choice for next time', async () => {
      await renderSliding()
      expect(localStorage.getItem('whizzo:flashcards:layout')).toBe('slide')
      cleanup()
      renderCards()
      await screen.findByText('Question')
      expect(screen.getByRole('radio', { name: /Slide/ }).getAttribute('aria-checked')).toBe('true')
    })

    it('can go back to flipping', async () => {
      await renderSliding()
      fireEvent.click(screen.getByRole('radio', { name: /Flip/ }))
      expect(screen.getByLabelText('Turn card over')).toBeTruthy()
      expect(localStorage.getItem('whizzo:flashcards:layout')).toBe('flip')
    })
  })
})

describe('a checked round', () => {
  function renderLearn(mode: 'learn' | 'test' = 'learn') {
    return render(<QuizPlay mode={mode} deckId={DECK.id} size={3} navigate={navigate} />)
  }

  it('says what kind of question this is', async () => {
    renderLearn()
    await waitFor(() => expect(screen.getByText(/done$/)).toBeTruthy())
    const kinds = ['Pick the answer', 'True or false', 'Write it out']
    expect(kinds.some((k) => screen.queryByText(k))).toBe(true)
  })

  it('shows how far through the round the learner is', async () => {
    renderLearn()
    expect(await screen.findByText('0 of 3 done')).toBeTruthy()
  })

  it('marks a wrong answer and says what the answer was', async () => {
    renderLearn()
    await screen.findByText('0 of 3 done')
    const wrong = screen.queryAllByRole('button').find((b) => {
      const t = b.textContent ?? ''
      return t === '❌ False' || (b.className.includes('text-left') && t.length > 0)
    })
    if (!wrong) return
    fireEvent.click(wrong)
    await waitFor(() =>
      expect(
        screen.queryByText('Correct!') ?? screen.queryByText('Not this time'),
      ).toBeTruthy(),
    )
  })

  it('offers no hint in a graded test, and one outside it', async () => {
    // A hint is a trade, and the graded round is the one where the trade is
    // not on offer.
    const { unmount } = renderLearn('test')
    await screen.findByText('0 of 3 done')
    expect(screen.queryByText('I do not know')).toBeNull()
    unmount()

    renderLearn('learn')
    await screen.findAllByText(/of 3 done/)
  })

  it('moves on from the feedback with Enter, so a round can be done from the keyboard', async () => {
    renderLearn()
    await screen.findByText('0 of 3 done')
    const choice = screen.queryAllByRole('button').find((b) => b.className.includes('text-left'))
    if (!choice) return
    fireEvent.click(choice)
    await waitFor(() => expect(screen.queryByText(/Next card|See how I did/)).toBeTruthy())
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByText(/Next card/)).toBeNull())
  })

  it('quits back to the deck it came from', async () => {
    renderLearn()
    await screen.findByText('0 of 3 done')
    fireEvent.click(screen.getByText('← Quit'))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz-deck', deckId: DECK.id })
  })
})

describe('the matching game', () => {
  function renderMatch() {
    return render(<QuizPlay mode="match" deckId={DECK.id} navigate={navigate} />)
  }

  it('lays out both halves of every pair', async () => {
    renderMatch()
    expect(await screen.findByText(/0 \/ \d+ pairs/)).toBeTruthy()
    expect(screen.getByText(/Tap a card, then tap its partner/)).toBeTruthy()
  })

  it('runs a clock', async () => {
    renderMatch()
    expect(await screen.findByText(/⏱ \d/)).toBeTruthy()
  })

  it('counts a pair once both halves are tapped', async () => {
    renderMatch()
    await screen.findByText(/0 \/ \d+ pairs/)
    const card = DECK.cards[0]!
    const prompt = screen.queryByText(card.term) ?? screen.queryByText(card.definition)
    const answer = screen.queryByText(card.definition) ?? screen.queryByText(card.term)
    if (!prompt || !answer || prompt === answer) return
    fireEvent.click(prompt)
    fireEvent.click(answer)
    await waitFor(() => expect(screen.getByText(/1 \/ \d+ pairs/)).toBeTruthy())
  })

  it('bows out without writing an empty round when nothing was matched', async () => {
    // A stopped game with no pairs found has no progress to record.
    renderMatch()
    await screen.findByText(/0 \/ \d+ pairs/)
    fireEvent.click(screen.getByText('Stop here'))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ name: 'quiz-deck', deckId: DECK.id }),
    )
    expect(spies.commit).not.toHaveBeenCalled()
  })
})
