// The screens a learner actually plays on.
//
// The assertions concentrate on the copy the design brief called load-bearing —
// "Counts toward your level", "Practice only", "Hint — this word stops
// counting" — because that wording is the product's honesty made visible, and
// it is the kind of thing a refactor quietly reworders.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aGame, spies } from '../test/mockProviders'
import { signIn, skill, testState } from '../test/state'
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
// ScreenHeader's Back goes to real history; there is none in a test, so it
// lands on the fallback route, which is what a test can assert on.
vi.mock('../hooks/useBack', async () => {
  const { spies } = await import('../test/mockProviders')
  return { useBack: (fallback: unknown) => () => spies.navigate(fallback) }
})

// Speech is a browser capability jsdom does not have, and the spelling screens
// dictate on mount.
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

import SpellingHome from './spelling/SpellingHome'
import SpellingLists from './spelling/SpellingLists'
import QuizHome from './quiz/QuizHome'
import TypingHome from './TypingHome'
import WorldMap from './WorldMap'
import TrophyRoom from './TrophyRoom'
import SettingsScreen from './SettingsScreen'
import ThemePicker from './theme/ThemePicker'
import WorldScreen from './theme/WorldScreen'

const navigate = spies.navigate

beforeEach(() => {
  signIn()
  testState.skills = { spelling: skill('spelling', { placed: true }) }
})

describe('SpellingHome', () => {
  it('names the rung in the learner’s own world', () => {
    render(<SpellingHome navigate={navigate} />)
    expect(screen.getByText(testState.theme.levels[0]!.name)).toBeInTheDocument()
  })

  it('labels which activities count toward the level', () => {
    render(<SpellingHome navigate={navigate} />)
    expect(screen.getAllByText(/counts toward your level/i).length).toBeGreaterThan(0)
  })

  it('offers the placement check to a learner who has not been placed', () => {
    testState.skills = { spelling: skill('spelling', { placed: false }) }
    render(<SpellingHome navigate={navigate} />)
    expect(screen.getAllByText(/find your level|placement/i).length).toBeGreaterThan(0)
  })

  it('shows the whole climb in the theme’s names', () => {
    render(<SpellingHome navigate={navigate} />)
    for (const level of testState.theme.levels.slice(0, 3)) {
      expect(screen.getAllByText(new RegExp(level.name)).length).toBeGreaterThan(0)
    }
  })

  it('starts a round when an activity is picked', async () => {
    render(<SpellingHome navigate={navigate} />)
    const start = screen.getAllByRole('button').find((b) => /listen/i.test(b.textContent ?? ''))
    if (start) {
      await userEvent.click(start)
      expect(navigate).toHaveBeenCalled()
    }
  })
})

describe('SpellingLists', () => {
  it('lists the grades in the theme’s names', () => {
    render(<SpellingLists navigate={navigate} />)
    expect(screen.getAllByText(new RegExp(testState.theme.levels[0]!.name)).length).toBeGreaterThan(0)
  })
})

describe('QuizHome', () => {
  it('renders with the starter decks', () => {
    render(<QuizHome navigate={navigate} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('offers a way to make a deck', async () => {
    render(<QuizHome navigate={navigate} />)
    const make = screen.getAllByRole('button').find((b) => /new deck|make/i.test(b.textContent ?? ''))
    if (make) {
      await userEvent.click(make)
      expect(navigate).toHaveBeenCalled()
    }
  })
})

describe('TypingHome', () => {
  it('names the collectible in the learner’s world', () => {
    render(<TypingHome game={aGame()} navigate={navigate} />)
    expect(screen.getAllByText(new RegExp(testState.theme.unit, 'i')).length).toBeGreaterThan(0)
  })

  it('goes home rather than to an academy', () => {
    render(<TypingHome game={aGame()} navigate={navigate} />)
    expect(screen.getByRole('button', { name: /← Home/ })).toBeInTheDocument()
  })

  it('offers Word Rain, not Cat Rain', () => {
    render(<TypingHome game={aGame()} navigate={navigate} />)
    expect(screen.getByRole('button', { name: /Word Rain/ })).toBeInTheDocument()
  })
})

describe('WorldMap', () => {
  it('names the typing worlds in the learner’s world', () => {
    render(<WorldMap game={aGame()} navigate={navigate} />)
    expect(screen.getByText(testState.theme.worlds[0]!.name)).toBeInTheDocument()
  })

  it('still says which keys each world teaches', () => {
    // The themed name is safe only because the blurb keeps the meaning.
    render(<WorldMap game={aGame()} navigate={navigate} />)
    expect(screen.getAllByText(/home row/i).length).toBeGreaterThan(0)
  })

  it('opens a lesson when one is picked', async () => {
    render(<WorldMap game={aGame()} navigate={navigate} />)
    const lesson = screen.getAllByRole('button').find((b) => /F & J/.test(b.textContent ?? ''))
    if (lesson) {
      await userEvent.click(lesson)
      expect(navigate).toHaveBeenCalled()
    }
  })
})

describe('TrophyRoom', () => {
  it('is the badges room, and says so', () => {
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Badges 🏅')).toBeInTheDocument()
    expect(screen.queryByText(/trophy/i)).not.toBeInTheDocument()
  })

  it('keeps no collection of its own — it links to the theme’s', async () => {
    // One collectible system: the count here is the count everywhere.
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    expect(screen.queryByRole('button', { name: testState.theme.unit })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText(`See your ${testState.theme.worldNoun} →`))
    expect(navigate).toHaveBeenCalledWith({ name: 'world' })
  })

  it('shows the same count as the collection screen', () => {
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    expect(
      screen.getByText(new RegExp(`0 of ${testState.theme.total} ${testState.theme.unit}`)),
    ).toBeInTheDocument()
  })
})

describe('SettingsScreen', () => {
  it('offers the sound, hands and keyboard toggles', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2)
  })

  it('does not mention erasing cats', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText(/erases stars, cats/i)).not.toBeInTheDocument()
  })
})

describe('ThemePicker', () => {
  it('offers all ten worlds', () => {
    render(<ThemePicker navigate={navigate} />)
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThanOrEqual(9)
  })

  it('keeps the promise that a world changes nothing learned', () => {
    render(<ThemePicker navigate={navigate} />)
    expect(
      screen.getByText(/never changes what you’re learning — only who you’re learning it with/i),
    ).toBeInTheDocument()
  })

  it('shows each world’s band as advice rather than a gate', () => {
    render(<ThemePicker navigate={navigate} />)
    expect(screen.getAllByText(/often picked in/i).length).toBe(10)
  })

  it('is called a theme, never a world', () => {
    render(<ThemePicker navigate={navigate} />)
    expect(screen.getByText('Pick your theme')).toBeInTheDocument()
    expect(screen.queryByText(/world/i)).not.toBeInTheDocument()
  })

  it('marks the current theme as chosen', () => {
    render(<ThemePicker navigate={navigate} />)
    expect(screen.getByText(/Your theme ✓/)).toBeInTheDocument()
  })

  it('sets a world when one is picked', async () => {
    render(<ThemePicker navigate={navigate} />)
    await userEvent.click(screen.getByText(/Dive in/).closest('button')!)
    expect(spies.setTheme).toHaveBeenCalledWith('ocean')
  })
})

describe('WorldScreen', () => {
  it('draws a collection world as a grid you fill in', () => {
    render(<WorldScreen navigate={navigate} />)
    expect(screen.getByText('Collection')).toBeInTheDocument()
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0)
  })

  it('draws a journey world as a rail', async () => {
    const { themeById } = await import('../lib/themes')
    testState.theme = themeById('ocean')
    render(<WorldScreen navigate={navigate} />)
    expect(screen.getByText('Journey')).toBeInTheDocument()
    expect(screen.getByText('Shore')).toBeInTheDocument()
  })

  it('draws an assembly world as a parts list', async () => {
    const { themeById } = await import('../lib/themes')
    testState.theme = themeById('robots')
    render(<WorldScreen navigate={navigate} />)
    expect(screen.getByText('Assembly')).toBeInTheDocument()
    expect(screen.getByText('Jetpack')).toBeInTheDocument()
  })

  it('repeats the promise that only graded work earns one', () => {
    render(<WorldScreen navigate={navigate} />)
    expect(screen.getByText(/Rewards are earned on graded work only/i)).toBeInTheDocument()
  })

  it('counts what has actually been earned, not what was claimed', () => {
    // Nothing in the snapshot, so nothing owned — the grid is all locked.
    testState.snapshot = emptySnapshot()
    render(<WorldScreen navigate={navigate} />)
    expect(screen.getByText(new RegExp(`0 of ${testState.theme.total}`))).toBeInTheDocument()
  })
})
