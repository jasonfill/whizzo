// The register the app speaks in, on the screens a learner actually sees.
//
// The band is derived from the grade a grown-up already set, and it is paint:
// it changes how a round is *presented*, never what the round is worth. So the
// two things worth pinning are the difference — a sixth-former is not told they
// are a typing wizard — and the sameness underneath it: the same round, the
// same evidence, the same stars.

import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/theme/ThemeProvider', async () =>
  (await import('../test/mockProviders')).themeMock(),
)
vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)
vi.mock('../lib/progress/ProgressProvider', async () =>
  (await import('../test/mockProviders')).progressMock(),
)

import { aLearner, resetTestState, signIn, testState } from '../test/state'
import { feedbackLine } from '../lib/stats'
import ResultsCard from '../components/ResultsCard'
import { useBand } from '../lib/band/useBand'
import QuizResults from './quiz/QuizResults'
import type { QuizSummary } from '../hooks/useQuizSession'

beforeEach(() => {
  resetTestState()
})

/** A grade puts the learner in a band; nothing else does. */
function inGrade(grade: number | null) {
  signIn(aLearner({ gradeHint: grade }))
}

const aResult = {
  wpm: 42,
  accuracy: 94,
  correct: 94,
  incorrect: 6,
  totalTyped: 100,
  elapsedMs: 60_000,
  maxCombo: 30,
  score: 800,
}

/** The results screen with everything it needs but the band. */
function results(stars = 3) {
  return (
    <ResultsCard
      result={aResult}
      stars={stars}
      title="Lesson 3"
      soundOn={false}
      onReplay={() => {}}
      onMenu={() => {}}
    />
  )
}

describe('what a round is called back to the learner', () => {
  it('tells a seven-year-old they are a wizard', () => {
    expect(feedbackLine(99, 'early')).toContain('wizard')
  })

  it('tells a sixth-former the number', () => {
    const line = feedbackLine(99, 'upper')
    expect(line).toContain('99%')
    expect(line).not.toContain('!')
    // No emoji. The upper band is the one place in the app with none.
    expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('gives the same advice at both ends, in different words', () => {
    // Accuracy before speed is true whoever is reading it, so it survives the
    // change of register — a band that dropped the advice would be a band that
    // had started teaching differently.
    for (const band of ['early', 'growing', 'middle', 'upper'] as const) {
      expect(feedbackLine(40, band).toLowerCase()).toContain('accuracy')
    }
  })

  it('speaks to the middle without either extreme', () => {
    const line = feedbackLine(99, 'middle')
    expect(line).not.toContain('wizard')
    expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('the results screen, read by the learner it is for', () => {
  it('praises a young learner in their own register', () => {
    inGrade(1)
    render(results())
    expect(screen.getByText(/smooth and steady/i)).toBeInTheDocument()
  })

  it('reports to an older one instead', () => {
    inGrade(11)
    render(results())
    expect(screen.getByText(/94% accurate/)).toBeInTheDocument()
    expect(screen.queryByText(/smooth and steady/i)).not.toBeInTheDocument()
  })

  it('assumes the middle when no grade was ever set', () => {
    // A learner added in a hurry has no grade. Neither extreme is right for
    // someone we know nothing about, so they get the general register rather
    // than a mascot or a bare percentage.
    inGrade(null)
    render(results())
    expect(screen.getByText(/smooth and steady/i)).toBeInTheDocument()
  })
})

function aSummary(over: Partial<QuizSummary> = {}): QuizSummary {
  return {
    mode: 'learn',
    deckId: 'd1',
    deckTitle: 'Cells',
    results: [],
    unresolved: [],
    itemsTotal: 10,
    itemsCorrect: 9,
    retiredAfterMiss: 0,
    nearMisses: 0,
    accuracy: 90,
    predictedAccuracy: 70,
    score: 300,
    stars: 3,
    durationMs: 60_000,
    abilityBefore: 0,
    abilityAfter: 0.2,
    newlyMastered: [],
    newAchievements: [],
    ...over,
  }
}

describe('celebration, which is decoration', () => {
  it('throws confetti for a younger learner who earned it', () => {
    inGrade(2)
    const { container } = render(
      <QuizResults summary={aSummary()} onAgain={() => {}} onDone={() => {}} onHome={() => {}} />,
    )
    expect(container.querySelector('.animate-confetti-fall')).toBeTruthy()
  })

  it('does not for an older one', () => {
    inGrade(11)
    const { container } = render(
      <QuizResults summary={aSummary()} onAgain={() => {}} onDone={() => {}} onHome={() => {}} />,
    )
    expect(container.querySelector('.animate-confetti-fall')).toBeFalsy()
  })

  it('still gives them the three stars they earned', () => {
    // The whole point of the band: what changes is the paint. A round worth
    // three stars is worth three stars at sixteen.
    inGrade(11)
    render(
      <QuizResults summary={aSummary()} onAgain={() => {}} onDone={() => {}} onHome={() => {}} />,
    )
    expect(screen.getByText('9 / 10')).toBeInTheDocument()
    expect(screen.getByText(/you beat it/)).toBeInTheDocument()
  })
})

describe('how long a round is', () => {
  it('shortens with the band, and never changes what a card is worth', async () => {
    const { BAND_STYLE, bandForGrade } = await import('@whizzo/shared')
    expect(BAND_STYLE[bandForGrade(1)].roundSize).toBeLessThan(
      BAND_STYLE[bandForGrade(11)].roundSize,
    )
  })
})

describe('praise, said out loud', () => {
  it('cheers a young learner and times an older one', async () => {
    const { praise } = await import('@whizzo/shared')
    expect(praise('early', true)).toMatch(/wow/i)
    // The upper band's version of praise is evidence of their own competence:
    // a response time says more to a sixteen-year-old than "Amazing!" does.
    expect(praise('upper', true, 1400)).toBe('Correct · 1.4s')
    expect(praise('upper', true)).toBe('Correct.')
  })

  it('is the hook that decides, not each screen', () => {
    // Four screens each reading `celebrationMs` and drawing their own
    // conclusion is how two of them end up disagreeing.
    inGrade(1)
    const early = renderHook(() => useBand()).result.current
    inGrade(11)
    const upper = renderHook(() => useBand()).result.current
    expect(early.celebrates).toBe(true)
    expect(upper.celebrates).toBe(false)
    expect(early.say(true)).not.toBe(upper.say(true))
    expect(early.roundSize).toBeLessThan(upper.roundSize)
  })
})

describe('the band is derived, not stored', () => {
  it('follows the grade a grown-up already set', async () => {
    const { bandForGrade } = await import('@whizzo/shared')
    inGrade(11)
    expect(bandForGrade(testState.active!.gradeHint)).toBe('upper')
  })
})
