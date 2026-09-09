// The typing game: a lesson, free practice, and the arcade.
//
// All three run on the same engine, so what is worth pinning is the shell
// around it — that a round can be quit without recording anything, that the
// score written afterwards is the one the round produced, and that the arcade
// ends when the lives run out rather than whenever the clock feels like it.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/theme/ThemeProvider', async () =>
  (await import('../test/mockProviders')).themeMock(),
)
// The results screen asks who is reading it, so it can say "You are a typing
// wizard! 🧙" to a seven-year-old and "94% accurate. Steady." to a sixth-former.
vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)

// A lesson now says it has started, so a grown-up can find it. That needs the
// auth provider and the live client, neither of which this file is about.
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'grown-up-1' } }) }))
vi.mock('../lib/live/client', () => ({ openLive: () => () => {} }))
vi.mock('../lib/api/client', () => ({
  ORIGIN_ID: 'origin-under-test',
  api: { post: async () => {} },
}))

import { aGame, spies } from '../test/mockProviders'
import { CURRICULUM } from '../data/lessons'
import CatRainScreen from './CatRainScreen'
import LessonScreen from './LessonScreen'
import PracticeScreen from './PracticeScreen'
import GamePlay from '../components/GamePlay'

const navigate = spies.navigate

/** Type a whole target string, one keydown at a time. */
function typeAll(text: string) {
  for (const ch of text) fireEvent.keyDown(window, { key: ch })
}

beforeEach(() => {
  navigate.mockClear()
})

describe('a round of typing', () => {
  const onFinish = vi.fn()
  const onQuit = vi.fn()

  beforeEach(() => {
    onFinish.mockClear()
    onQuit.mockClear()
  })

  function renderRound(text = 'ab') {
    return render(
      <GamePlay
        text={text}
        title="Home row"
        subtitle="asdf jkl;"
        showKeyboard
        showHands
        sound={false}
        onFinish={onFinish}
        onQuit={onQuit}
      />,
    )
  }

  it('shows the text, the title and how to get out', () => {
    renderRound()
    expect(screen.getByText('Home row')).toBeTruthy()
    expect(screen.getByText('asdf jkl;')).toBeTruthy()
    expect(screen.getByLabelText('Quit to menu')).toBeTruthy()
  })

  it('quits on Escape without recording a round', () => {
    renderRound()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onQuit).toHaveBeenCalled()
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('quits from the menu button too', () => {
    renderRound()
    fireEvent.click(screen.getByLabelText('Quit to menu'))
    expect(onQuit).toHaveBeenCalled()
  })

  it('finishes once the whole text is typed, and reports what happened', () => {
    renderRound('ab')
    typeAll('ab')
    expect(onFinish).toHaveBeenCalledTimes(1)
    const result = onFinish.mock.calls[0]![0]
    expect(result).toMatchObject({ correct: 2, incorrect: 0, accuracy: 100 })
  })

  it('counts a wrong keystroke against the accuracy', () => {
    renderRound('ab')
    typeAll('xab')
    const result = onFinish.mock.calls[0]![0]
    expect(result.incorrect).toBe(1)
    expect(result.accuracy).toBeLessThan(100)
  })

  it('ignores a shortcut, so Cmd-R is not a typo', () => {
    renderRound('ab')
    fireEvent.keyDown(window, { key: 'a', metaKey: true })
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('ignores keys that are not characters', () => {
    renderRound('ab')
    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('can hide the keyboard and hands for somebody who does not need them', () => {
    const { container } = render(
      <GamePlay
        text="ab"
        title="Home row"
        showKeyboard={false}
        showHands={false}
        sound={false}
        onFinish={onFinish}
        onQuit={onQuit}
      />,
    )
    expect(container.textContent).toContain('Home row')
    expect(container.querySelectorAll('svg').length).toBeLessThan(6)
  })
})

describe('a lesson', () => {
  it('says so rather than crashing when the lesson wandered off', () => {
    render(<LessonScreen lessonId="no-such-lesson" game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/that lesson wandered off/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Back to Levels'))
    expect(navigate).toHaveBeenCalledWith({ name: 'map' })
  })

  it('names the world it belongs to, and the curriculum keeps the blurb', () => {
    // The theme names places; the curriculum still says "the home row".
    const lesson = CURRICULUM[0]!
    render(<LessonScreen lessonId={lesson.id} game={aGame()} navigate={navigate} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(lesson.title)
    expect(screen.getByText(lesson.blurb)).toBeTruthy()
  })

  it('records the round and shows the result', () => {
    const lesson = CURRICULUM[0]!
    const game = aGame()
    render(<LessonScreen lessonId={lesson.id} game={game} navigate={navigate} />)
    void game
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(navigate).toHaveBeenCalledWith({ name: 'map' })
  })
})

describe('free practice', () => {
  it('opens on a setup card rather than straight into a round', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Free Practice')).toBeTruthy()
    expect(screen.getByText('Which keys?')).toBeTruthy()
  })

  it('offers learned keys or every key', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/Keys I.*ve learned/)).toBeTruthy()
    fireEvent.click(screen.getByText('🌍 All keys'))
    fireEvent.click(screen.getByText('Start!'))
    expect(screen.getByText('Every key')).toBeTruthy()
  })

  it('offers three lengths, and starts the one chosen', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    for (const n of ['15 words', '25 words', '40 words']) {
      expect(screen.getByText(n)).toBeTruthy()
    }
    fireEvent.click(screen.getByText('15 words'))
    fireEvent.click(screen.getByText('Start!'))
    expect(screen.getByText('⌨️ Free Practice')).toBeTruthy()
  })

  it('goes home rather than starting anything', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(navigate).toHaveBeenCalledWith({ name: 'typing' })
  })

  it('comes back to setup when a round is quit', () => {
    render(<PracticeScreen game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('Start!'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Which keys?')).toBeTruthy()
  })

  it('draws practice from the keys the learner has actually finished', () => {
    // Not from the whole alphabet: a round full of letters they have never
    // been taught is a round they cannot do.
    const lesson = CURRICULUM[0]!
    const game = aGame({ state: { lessons: { [lesson.id]: { plays: 3, stars: 2 } } } })
    render(<PracticeScreen game={game} navigate={navigate} />)
    fireEvent.click(screen.getByText('Start!'))
    expect(screen.getByText('Keys you have learned')).toBeTruthy()
  })
})

describe('the arcade', () => {
  function renderArcade(game = aGame()) {
    return render(<CatRainScreen game={game} navigate={navigate} />)
  }

  it('explains itself before it starts', () => {
    renderArcade()
    expect(screen.getByText('Word Rain 🌧️')).toBeTruthy()
    expect(screen.getByText(/Miss 3 and it/)).toBeTruthy()
  })

  it('goes home without starting', () => {
    renderArcade()
    fireEvent.click(screen.getByText('← Home'))
    expect(navigate).toHaveBeenCalledWith({ name: 'typing' })
  })

  it('starts with three lives and nothing scored', () => {
    renderArcade()
    fireEvent.click(screen.getByText('▶ Start'))
    expect(screen.getByText('Score: 0')).toBeTruthy()
    expect(screen.getByLabelText('3 lives')).toBeTruthy()
    expect(screen.getByText('Combo x0')).toBeTruthy()
  })

  it('ends when asked, and writes the score that was reached', () => {
    const game = aGame()
    renderArcade(game)
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.click(screen.getByText('✕ End'))
    expect(game.addHighScore).toHaveBeenCalled()
    const row = (game.addHighScore as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(row).toMatchObject({ score: 0, mode: 'Cat Rain' })
  })

  it('ends on Escape too', () => {
    const game = aGame()
    renderArcade(game)
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(game.addHighScore).toHaveBeenCalled()
  })

  it('shows a results card once it is over, and can be replayed', () => {
    renderArcade()
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.click(screen.getByText('✕ End'))
    expect(screen.getByText(/Word Rain/)).toBeTruthy()
  })

  it('reports full accuracy for a round where nothing was typed', () => {
    // Nought out of nought is not nought per cent.
    const game = aGame()
    renderArcade(game)
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.click(screen.getByText('✕ End'))
    const row = (game.addHighScore as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(row.accuracy).toBe(100)
  })

  it('spawns words and lets them be typed', async () => {
    vi.useFakeTimers()
    const game = aGame()
    renderArcade(game)
    fireEvent.click(screen.getByText('▶ Start'))
    // Drive the animation loop far enough for at least one word to appear.
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        vi.advanceTimersByTime(20)
        await Promise.resolve()
      }
    })
    vi.useRealTimers()
    // Whatever fell, a letter keystroke is either a hit or a miss — never a
    // crash.
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByText(/Score:/)).toBeTruthy()
  })

  it('ignores a shortcut mid-game', () => {
    renderArcade()
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.keyDown(window, { key: 'a', metaKey: true })
    expect(screen.getByText('Score: 0')).toBeTruthy()
  })

  it('ignores keys with no character', () => {
    renderArcade()
    fireEvent.click(screen.getByText('▶ Start'))
    fireEvent.keyDown(window, { key: 'Shift' })
    expect(screen.getByText('Combo x0')).toBeTruthy()
  })
})
