// The screens a round is actually played and finished on.
//
// These are the surfaces where the product's honesty is either kept or lost:
// what a learner is told a round costs before they start it, what a hint takes
// away, and what a results screen claims afterwards. The load-bearing copy is
// asserted verbatim because it is exactly the sort of thing a refactor
// rewords without noticing.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aGame, spies } from '../test/mockProviders'
import { aLearner, signIn, skill, testState } from '../test/state'
import { emptySnapshot } from '../lib/progress/types'

vi.mock('../auth/AuthProvider', async () => (await import('../test/mockProviders')).authMock())
vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)
vi.mock('../lib/progress/ProgressProvider', async () =>
  (await import('../test/mockProviders')).progressMock(),
)
vi.mock('../lib/theme/ThemeProvider', async () =>
  (await import('../test/mockProviders')).themeMock(),
)
vi.mock('../hooks/useAssignments', async () =>
  (await import('../test/mockProviders')).assignmentsMock(),
)

vi.mock('../lib/spelling/speech', () => ({
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

import SpellingPlay from './spelling/SpellingPlay'
import SpellingResults from './spelling/SpellingResults'
import QuizPlay from './quiz/QuizPlay'
import QuizResults from './quiz/QuizResults'
import DeckScreen from './quiz/DeckScreen'
import LessonScreen from './LessonScreen'
import PracticeScreen from './PracticeScreen'
import CatRainScreen from './CatRainScreen'
import { CURRICULUM } from '../data/lessons'

const navigate = spies.navigate

beforeEach(() => {
  signIn()
  testState.skills = { spelling: skill('spelling', { placed: true }) }
})

describe('SpellingPlay — a round in progress', () => {
  function play(activity: 'test' | 'listen-spell' | 'missing-letters' = 'missing-letters') {
    return render(
      <SpellingPlay activity={activity} mode="adaptive" size={6} navigate={navigate} />,
    )
  }

  it('says what the round costs before the learner starts it', () => {
    play('test')
    expect(screen.getByText('Counts toward your level')).toBeInTheDocument()
  })

  it('says plainly when a round does not count', () => {
    play('missing-letters')
    expect(screen.getByText(/Practice only · doesn’t affect level/)).toBeInTheDocument()
  })

  it('offers a way out that does not lose the round silently', () => {
    play()
    expect(screen.getByRole('button', { name: /← Leave/ })).toBeInTheDocument()
  })

  it('shows how far through the round the learner is', () => {
    play()
    expect(screen.getByText(/1 \/ 6/)).toBeInTheDocument()
  })

  it('names the grade and what trips the word up', () => {
    play()
    expect(screen.getAllByText(/Grade \d/).length).toBeGreaterThan(0)
  })

  it('says what a hint costs, on the hint button itself', () => {
    // Not in a note afterwards — before it is pressed. Listen & Spell is the
    // activity that offers one, and it is a graded activity, which is exactly
    // why the button has to say what taking one gives up.
    play('listen-spell')
    expect(
      screen.getByRole('button', { name: /Hint — this word stops counting/ }),
    ).toBeInTheDocument()
  })

  it('offers no hint at all in a graded test', () => {
    play('test')
    expect(screen.queryByRole('button', { name: /Hint/ })).not.toBeInTheDocument()
  })

  it('says the mascot is the only themed thing on the screen', () => {
    play()
    expect(
      screen.getByText(/The mascot is the only part of this screen your world changes/),
    ).toBeInTheDocument()
  })

  it('holds the theme’s praise back until there is something to praise', () => {
    // This test used to assert the opposite — that the cheer was on screen
    // "while the round is going" — which is how the bug survived: word one of a
    // placement check congratulated a brand-new learner before they had typed
    // anything, and told them the word "got you last Tuesday". The theme still
    // owns the words; it does not own when they are said.
    play()
    expect(screen.queryByText(testState.theme.cheer)).not.toBeInTheDocument()
    expect(screen.queryByText(testState.theme.cheerSub)).not.toBeInTheDocument()
  })

  it('leaves the round when asked', async () => {
    play()
    await userEvent.click(screen.getByRole('button', { name: /← Leave/ }))
    expect(navigate).toHaveBeenCalledWith({ name: 'spelling' })
  })

  it('marks a wrong answer without cheering it', async () => {
    play()
    const input = screen.getByLabelText(/your spelling/i)
    await userEvent.type(input, 'zzz')
    await userEvent.click(screen.getByRole('button', { name: /Check it/ }))
    await waitFor(() => expect(screen.getByText(/Not quite/)).toBeInTheDocument())
    // The themed cheer must not be showing over a miss.
    expect(screen.queryByText(testState.theme.cheer)).not.toBeInTheDocument()
  })

  it('drops the themed cheer for an older learner', async () => {
    // Same round, same words, same marking — the cat stops talking. A theme is
    // still theirs to pick; it just stops narrating.
    signIn(aLearner({ gradeHint: 11 }))
    play()
    const input = screen.getByLabelText(/your spelling/i)
    await userEvent.type(input, 'zzz')
    await userEvent.click(screen.getByRole('button', { name: /Check it/ }))
    await waitFor(() => expect(screen.getByText('Not right.')).toBeInTheDocument())
    expect(screen.queryByText(/goes back in the pile/)).not.toBeInTheDocument()
  })
})

describe('SpellingResults — what a round is worth', () => {
  function summary(over: Record<string, unknown> = {}) {
    return {
      activity: 'test',
      mode: 'adaptive',
      listId: null,
      results: [],
      itemsTotal: 10,
      itemsCorrect: 8,
      accuracy: 80,
      predictedAccuracy: 70,
      score: 100,
      stars: 3,
      durationMs: 60_000,
      abilityBefore: 3,
      abilityAfter: 3.2,
      level: { levelIndex: 0, direction: 'hold', reason: 'Keep practicing.' },
      gradeBefore: 2,
      gradeAfter: 2,
      newAchievements: [],
      ...over,
    } as never
  }

  it('explains the stars in terms of the prediction it graded against', () => {
    render(<SpellingResults summary={summary()} navigate={navigate} onAgain={() => {}} />)
    expect(screen.getByText(/beat what we predicted for this set by 10 points/)).toBeInTheDocument()
  })

  it('says so honestly when the round came in under the prediction', () => {
    render(
      <SpellingResults
        summary={summary({ accuracy: 50, itemsCorrect: 5, stars: 1 })}
        navigate={navigate}
        onAgain={() => {}}
      />,
    )
    expect(screen.getByText(/came in 20 points under/)).toBeInTheDocument()
  })

  it('promises that only graded work earns a collectible', () => {
    render(<SpellingResults summary={summary()} navigate={navigate} onAgain={() => {}} />)
    expect(
      screen.getByText(new RegExp(`A hinted word can’t buy a ${testState.theme.unitOne}`)),
    ).toBeInTheDocument()
  })

  it('withholds the collectible on a practice round however well it went', () => {
    render(
      <SpellingResults
        summary={summary({ activity: 'missing-letters', accuracy: 100, itemsCorrect: 10 })}
        navigate={navigate}
        onAgain={() => {}}
      />,
    )
    expect(screen.queryByText(/^New /)).not.toBeInTheDocument()
  })

  it('shows the lowest scorer no downcast mascot at all', () => {
    // The redesigned panel only draws a mascot on an earned collectible, so a
    // learner who earned nothing simply is not met with a face. Either way,
    // the thing that must never appear is a sad one.
    render(
      <SpellingResults
        summary={summary({ accuracy: 20, itemsCorrect: 2, stars: 1 })}
        navigate={navigate}
        onAgain={() => {}}
      />,
    )
    for (const img of screen.queryAllByRole('img')) {
      expect(img.getAttribute('aria-label')).not.toContain('sad')
    }
  })

  it('cheers only where something was actually earned', () => {
    render(<SpellingResults summary={summary()} navigate={navigate} onAgain={() => {}} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('cheer')
  })

  it('says only unaided answers move the level', () => {
    render(<SpellingResults summary={summary()} navigate={navigate} onAgain={() => {}} />)
    expect(screen.getByText(/no hints, change your level/i)).toBeInTheDocument()
  })
})

describe('QuizPlay and QuizResults', () => {
  it('starts a quiz round', () => {
    testState.snapshot = emptySnapshot()
    render(<QuizPlay mode="test" size={4} navigate={navigate} />)
    expect(document.body.textContent).toBeTruthy()
  })

  it('reports a finished round', () => {
    const summary = {
      mode: 'test',
      deckId: 'd1',
      results: [],
      itemsTotal: 10,
      itemsCorrect: 8,
      accuracy: 80,
      predictedAccuracy: 70,
      score: 100,
      stars: 3,
      durationMs: 1000,
      abilityBefore: 3,
      abilityAfter: 3,
      retiredAfterMiss: 0,
      nearMisses: [],
      newlyMastered: [],
      unresolved: [],
      newAchievements: [],
    } as never
    render(
      <QuizResults summary={summary} onAgain={() => {}} onDeck={() => {}} onHome={() => {}} />,
    )
    expect(screen.getByText(/80/)).toBeInTheDocument()
  })

  it('explains that first-go accuracy is what is scored', () => {
    const summary = {
      mode: 'learn',
      deckId: 'd1',
      results: [],
      itemsTotal: 10,
      itemsCorrect: 6,
      accuracy: 60,
      predictedAccuracy: 70,
      score: 60,
      stars: 2,
      durationMs: 1000,
      abilityBefore: 3,
      abilityAfter: 3,
      retiredAfterMiss: 2,
      nearMisses: [],
      newlyMastered: [],
      unresolved: [],
      newAchievements: [],
    } as never
    render(
      <QuizResults summary={summary} onAgain={() => {}} onDeck={() => {}} onHome={() => {}} />,
    )
    expect(screen.getByText(/first time/i)).toBeInTheDocument()
  })
})

describe('DeckScreen', () => {
  it('renders a starter deck', () => {
    render(<DeckScreen deckId="starter-capitals" navigate={navigate} />)
    expect(document.body.textContent).toBeTruthy()
  })

  it('says so rather than crashing when the deck is gone', () => {
    render(<DeckScreen deckId="no-such-deck" navigate={navigate} />)
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('the typing screens', () => {
  it('opens a lesson', () => {
    render(<LessonScreen game={aGame()} lessonId={CURRICULUM[0]!.id} navigate={navigate} />)
    expect(document.body.textContent).toBeTruthy()
  })

  it('says so rather than crashing on a lesson that does not exist', () => {
    render(<LessonScreen game={aGame()} lessonId="nope" navigate={navigate} />)
    expect(document.body.textContent).toBeTruthy()
  })

  it('opens free practice', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Warm up with a custom round/)).toBeInTheDocument()
  })

  it('opens Word Rain and calls it that', () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    expect(screen.getAllByText(/Word Rain/).length).toBeGreaterThan(0)
  })

  it('explains Word Rain without cats', () => {
    render(<CatRainScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Words fall from the sky/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/kitty|Cat-words/)
  })
})
