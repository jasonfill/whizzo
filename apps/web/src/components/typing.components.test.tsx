// The typing game's own components.
//
// These are the pieces a learner looks at while typing, so what is asserted is
// what they can see: which key is next, which one they just got wrong, and that
// the results screen reports the round rather than flattering it.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testState } from '../test/state'
import { THEMES } from '../lib/themes'

vi.mock('../lib/theme/ThemeProvider', async () =>
  (await import('../test/mockProviders')).themeMock(),
)
// The results screen asks who is reading it, so it can say "You are a typing
// wizard! 🧙" to a seven-year-old and "94% accurate. Steady." to a sixth-former.
vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)
// The results screen names the collectible a round filled from the same
// count the collection wall reads, so it needs the progress snapshot.
vi.mock('../lib/progress/ProgressProvider', async () =>
  (await import('../test/mockProviders')).progressMock(),
)

import Background from './Background'
import Confetti from './Confetti'
import Hands from './Hands'
import Hud from './Hud'
import Keyboard from './Keyboard'
import ResultsCard from './ResultsCard'
import TypingText from './TypingText'
import Wordmark from './Wordmark'
import ScreenHeader from './suite/ScreenHeader'

describe('Background', () => {
  it('is flat warm paper, with no floating decoration left', () => {
    const { container } = render(<Background />)
    expect(container.firstElementChild!.className).toContain('bg-paper')
    expect(container.textContent).toBe('')
  })
})

describe('Confetti', () => {
  it('drops the number of pieces asked for', () => {
    const { container } = render(<Confetti count={12} />)
    expect(container.querySelectorAll('span')).toHaveLength(12)
  })

  it('celebrates without cats', () => {
    const { container } = render(<Confetti count={40} />)
    expect(container.textContent).not.toMatch(/🐱|🐾|🧶|🐟/)
  })

  it('is decoration, so it is hidden from pointers', () => {
    const { container } = render(<Confetti />)
    expect(container.firstElementChild!.className).toContain('pointer-events-none')
  })
})

describe('TypingText', () => {
  it('renders every character of the target, so the learner sees what is left', () => {
    const { container } = render(<TypingText target="hello" cursor={2} hasError={false} />)
    expect(container.querySelectorAll('span').length).toBeGreaterThanOrEqual(5)
    expect(container.textContent?.replace(/\s/g, '')).toContain('hello')
  })

  it('marks the character just mistyped', () => {
    const clean = render(<TypingText target="cat" cursor={1} hasError={false} />).container.innerHTML
    const errored = render(<TypingText target="cat" cursor={1} hasError />).container.innerHTML
    expect(errored).not.toBe(clean)
  })
})

describe('Keyboard', () => {
  it('draws the keys', () => {
    const { container } = render(<Keyboard nextChar="f" />)
    expect(container.querySelectorAll('div').length).toBeGreaterThan(10)
  })

  it('highlights the key the learner should hit next', () => {
    const { container } = render(<Keyboard nextChar="f" />)
    expect(container.innerHTML).toContain('bg-accent')
  })

  it('marks the key they just got wrong', () => {
    const clean = render(<Keyboard nextChar="f" />).container.innerHTML
    const wrong = render(<Keyboard nextChar="f" lastWrong="d" />).container.innerHTML
    expect(wrong).not.toBe(clean)
  })

  it('copes with a capital, which needs a shift', () => {
    expect(() => render(<Keyboard nextChar="F" />)).not.toThrow()
  })

  it('copes with no next key at the end of a round', () => {
    expect(() => render(<Keyboard nextChar={null} />)).not.toThrow()
  })
})

describe('Hands', () => {
  it('draws both hands', () => {
    const { container } = render(<Hands />)
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('marks the finger that should move next', () => {
    const idle = render(<Hands />).container.innerHTML
    const active = render(<Hands activeFinger="L-index" />).container.innerHTML
    expect(active).not.toBe(idle)
  })
})

describe('Hud', () => {
  it('reports speed, accuracy and the running combo', () => {
    render(<Hud wpm={42} accuracy={95} combo={7} progress={0.5} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
    expect(screen.getByText('x7')).toBeInTheDocument()
  })

  it('shows a dash rather than a zero when no combo is running', () => {
    render(<Hud wpm={0} accuracy={100} combo={0} progress={0} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('runs its progress bar in pine, like every other progress bar', () => {
    const { container } = render(<Hud wpm={10} accuracy={90} combo={2} progress={0.4} />)
    expect(container.innerHTML).toContain('bg-pine')
    expect(container.innerHTML).not.toContain('from-lime')
  })
})

describe('ResultsCard', () => {
  const result = {
    wpm: 30,
    accuracy: 95,
    correct: 100,
    incorrect: 5,
    totalTyped: 105,
    elapsedMs: 60_000,
    maxCombo: 12,
    score: 500,
  }

  it('reports the round', () => {
    render(
      <ResultsCard
        result={result}
        stars={3}
        title="Nice round"
        soundOn={false}
        onReplay={() => {}}
        onMenu={() => {}}
      />,
    )
    expect(screen.getByText(/Nice round/)).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
  })

  it('shows a typing fact rather than a cat fact', () => {
    render(
      <ResultsCard result={result} stars={2} title="Done" soundOn={false} onReplay={() => {}} onMenu={() => {}} />,
    )
    expect(screen.getByText(/Typing fact:/)).toBeInTheDocument()
  })

  it('names a new collectible in the learner’s own world', () => {
    testState.theme = THEMES.find((t) => t.id === 'robots')!
    render(
      <ResultsCard
        result={result}
        stars={3}
        title="Done"
        soundOn={false}
        earnedCollectible
        onReplay={() => {}}
        onMenu={() => {}}
      />,
    )
    expect(screen.getByText(/New part!/i)).toBeInTheDocument()
    // The item it names is a real slot in the theme's set, with the name
    // the collection screen will show for it.
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('part')
  })

  it('says nothing about a collectible when none was earned', () => {
    render(
      <ResultsCard result={result} stars={1} title="Done" soundOn={false} onReplay={() => {}} onMenu={() => {}} />,
    )
    expect(screen.queryByText(/New /i)).not.toBeInTheDocument()
  })

  it('lists any achievement unlocked by the round', () => {
    render(
      <ResultsCard
        result={result}
        stars={3}
        title="Done"
        soundOn={false}
        newAchievements={[{ id: 'a', name: 'First Steps', emoji: '👣', description: '' } as never]}
        onReplay={() => {}}
        onMenu={() => {}}
      />,
    )
    expect(screen.getByText(/First Steps/)).toBeInTheDocument()
    // Badges are badges — never trophies, never achievements.
    expect(screen.getByText('New badge!')).toBeInTheDocument()
    expect(screen.queryByText(/Achievement:/)).not.toBeInTheDocument()
  })
})

describe('Wordmark', () => {
  it('is always lowercase', () => {
    render(<Wordmark />)
    expect(screen.getByText('whizzo')).toBeInTheDocument()
    expect(screen.queryByText('Whizzo')).not.toBeInTheDocument()
  })

  it('takes the theme accent on the glyph by default', () => {
    const { container } = render(<Wordmark />)
    const glyph = container.querySelectorAll('span')[1] as HTMLElement
    expect(glyph.style.color).toBe('rgb(124, 92, 255)')
  })

  it('can render in brand spark instead, for a theme-free surface', () => {
    const { container } = render(<Wordmark accent={false} />)
    expect((container.querySelectorAll('span')[1] as HTMLElement).style.color).toBe('rgb(255, 106, 43)')
  })

  it('keeps its proportions at any size', () => {
    const { container } = render(<Wordmark size={68} />)
    expect((container.querySelectorAll('span')[1] as HTMLElement).style.width).toBe('68px')
  })
})

describe('ScreenHeader', () => {
  it('shows the title and an optional subtitle', () => {
    render(<ScreenHeader title="Progress" subtitle="From words they attempted" />)
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()
    expect(screen.getByText('From words they attempted')).toBeInTheDocument()
  })

  it('offers a back button only when there is somewhere to go', () => {
    const { rerender } = render(<ScreenHeader title="Progress" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<ScreenHeader title="Progress" onBack={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('is brand chrome, never themed', () => {
    const { container } = render(<ScreenHeader title="Progress" />)
    expect(container.querySelector('h1')!.className).toContain('text-ink')
  })
})
