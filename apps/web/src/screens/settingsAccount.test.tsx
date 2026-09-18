// Settings, the trophy room, and the account screen.
//
// Three screens that mostly say what is already true, with two exceptions worth
// pinning: every switch on the settings screen is written to the learner and
// nothing is kept on this device, and the library card shows a dash rather than
// a zero when it could not be read — "none" and "could not ask" are different
// answers.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
// ScreenHeader's Back goes to real history; there is none in a test, so it
// lands on the fallback route, which is what a test can assert on.
vi.mock('../hooks/useBack', async () => {
  const { spies } = await import('../test/mockProviders')
  return { useBack: (fallback: unknown) => () => spies.navigate(fallback) }
})
// Back goes to real history when there is one; here there is none, so it
// lands on the screen's natural parent — through the same navigate spy.
vi.mock('../hooks/useBack', async () => {
  const { spies } = await import('../test/mockProviders')
  return { useBack: (fallback: unknown) => () => spies.navigate(fallback) }
})

const lib = vi.hoisted(() => ({
  loadLibrary: vi.fn(async () => ({ decks: [], customLists: [] })),
}))
vi.mock('../lib/assignments/library', () => lib)

const codes = vi.hoisted(() => ({ listConnectionCodes: vi.fn(async () => []) }))
vi.mock('../lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...codes,
}))

import { aGame, spies } from '../test/mockProviders'
import { aLearner, goPro, signIn, testState } from '../test/state'
import { emptySnapshot } from '../lib/progress/types'
import AccountScreen from './suite/AccountScreen'
import SettingsScreen from './SettingsScreen'
import TrophyRoom from './TrophyRoom'

const navigate = spies.navigate

beforeEach(() => {
  signIn()
  navigate.mockClear()
  lib.loadLibrary.mockResolvedValue({ decks: [], customLists: [] })
  codes.listConnectionCodes.mockResolvedValue([])
})

describe('settings', () => {
  it('shows the three switches with their current state', () => {
    const game = aGame({ state: { settings: { sound: true, showHands: false, showKeyboard: true } } })
    render(<SettingsScreen game={game} navigate={navigate} />)
    const toggles = screen.getAllByRole('button', { pressed: true })
    expect(toggles.length).toBe(2)
  })

  it('groups them: sound for the suite, the helpers under typing, the layout under flashcards', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Sound')).toBeTruthy()
    expect(screen.getByText('Typing')).toBeTruthy()
    expect(screen.getByText('Flashcards')).toBeTruthy()
  })

  it('offers nothing to clear: nothing here is this device’s own', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText('This device')).toBeNull()
    expect(screen.queryByText(/Clear typing data/)).toBeNull()
  })

  it('turns sound off and on', () => {
    const game = aGame()
    render(<SettingsScreen game={game} navigate={navigate} />)
    fireEvent.click(screen.getByText('🔊 Sound effects').parentElement!.querySelector('button')!)
    expect(game.setSetting).toHaveBeenCalledWith('sound', false)
  })

  it('turns the keyboard and hand guide off', () => {
    const game = aGame()
    render(<SettingsScreen game={game} navigate={navigate} />)
    for (const [label, key] of [
      ['⌨️ Show on-screen keyboard', 'showKeyboard'],
      ['🖐️ Show hand guide', 'showHands'],
    ] as const) {
      fireEvent.click(screen.getByText(label).parentElement!.querySelector('button')!)
      expect(game.setSetting).toHaveBeenCalledWith(key, false)
    }
  })

  it('picks the flashcard layout, and shows which is chosen', () => {
    const game = aGame({ state: { settings: { flashcardLayout: 'slide' } } })
    render(<SettingsScreen game={game} navigate={navigate} />)
    expect(screen.getByRole('radio', { name: /Slide/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Flip/ }))
    expect(game.setSetting).toHaveBeenCalledWith('flashcardLayout', 'flip')
  })

  it('turns the strike-out on multiple choice off, and shows it under flashcards', () => {
    const game = aGame()
    render(<SettingsScreen game={game} navigate={navigate} />)
    const label = screen.getByText('✕ Strike out answers I have ruled out')
    const toggle = label.parentElement!.querySelector('button')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(game.setSetting).toHaveBeenCalledWith('strikeOutChoices', false)
  })

  it('no longer offers to reset all progress', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.queryByText(/Reset all progress/)).toBeNull()
  })

  it('says whose account the settings go to', () => {
    signIn(aLearner({ displayName: 'Ada' }))
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText("Settings and progress are saved to Ada's account.")).toBeTruthy()
  })

  it('says progress is in the account when there is no learner yet', () => {
    testState.active = null
    testState.progressMode = 'cloud'
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText('Progress is saved to your account.')).toBeTruthy()
  })

  it('says so when it is only in this browser', () => {
    testState.active = null
    testState.progressMode = 'local'
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/on this device until you sign in/)).toBeTruthy()
  })

  it('goes home', () => {
    render(<SettingsScreen game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(navigate).toHaveBeenCalledWith({ name: 'home' })
  })
})

describe('the trophy room', () => {
  it('opens on high scores, and says how to set one', () => {
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    expect(screen.getByText(/No scores yet/)).toBeTruthy()
  })

  it('lists the scores that have been set', () => {
    const game = aGame({
      state: {
        highScores: [
          { score: 1200, wpm: 30, accuracy: 95, mode: 'Word Rain', date: 0 },
          { score: 800, wpm: 0, accuracy: 90, mode: 'Practice', date: 0 },
        ],
      },
    })
    render(<TrophyRoom game={game} navigate={navigate} />)
    expect(screen.getByText('1,200')).toBeTruthy()
    expect(screen.getByText('30 wpm')).toBeTruthy()
    // A zero-WPM arcade score shows no speed rather than "0 wpm".
    expect(screen.queryByText('0 wpm')).toBeNull()
    // The board is the learner's own, so no row is signed.
    expect(screen.queryByText('Ada')).toBeNull()
  })

  it('shows the typing badges the account holds, on a browser that never earned them', () => {
    const game = aGame({ state: { achievements: ['first-steps'] } })
    render(<TrophyRoom game={game} navigate={navigate} />)
    fireEvent.click(screen.getByText('🎖️ Badges'))
    expect(screen.getByText('First Steps')).toBeTruthy()
  })

  it('names badges only once they are earned', () => {
    // An unearned badge shows its description but not its name — there is
    // something to find out, rather than a list already read.
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('🎖️ Badges'))
    expect(screen.getAllByText('???').length).toBeGreaterThan(0)
  })

  it('names one that has been earned', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      achievements: [{ achievementId: 'first-test', subject: 'spelling', unlockedAt: 1 } as never],
    }
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('🎖️ Badges'))
    expect(screen.getByText(/Typing ⌨️/)).toBeTruthy()
  })

  it('points at the theme’s collection instead of keeping its own', () => {
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText(`See your ${testState.theme.worldNoun} →`))
    expect(navigate).toHaveBeenCalledWith({ name: 'world' })
  })

  it('goes back, home when there is nowhere else', () => {
    render(<TrophyRoom game={aGame()} navigate={navigate} />)
    fireEvent.click(screen.getByText('← Back'))
    expect(navigate).toHaveBeenCalledWith({ name: 'home' })
  })
})

describe('the account screen', () => {
  it('has nothing to show when nobody is signed in, and says so', () => {
    testState.authStatus = 'signed-out'
    testState.profile = null
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText(/Nobody is signed in/)).toBeTruthy()
    fireEvent.click(screen.getByText('Sign in'))
    expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
  })

  it('says so instead when the build has no database at all', () => {
    testState.authStatus = 'signed-out'
    testState.configured = false
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText(/no database connected/)).toBeTruthy()
  })

  it('renames the account, but not to nothing and not to what it already is', async () => {
    render(<AccountScreen navigate={navigate} />)
    const save = screen.getByText('Save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const input = screen.getByDisplayValue('Grown-up')
    fireEvent.change(input, { target: { value: '  ' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'Sam' } })
    fireEvent.click(save)
    expect(spies.updateProfile).toHaveBeenCalledWith({ displayName: 'Sam' })
  })

  it('changes the avatar', () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('🦊'))
    expect(spies.updateProfile).toHaveBeenCalledWith({ avatarEmoji: '🦊' })
  })

  it('counts what is in the library', async () => {
    lib.loadLibrary.mockResolvedValue({
      decks: [{ id: 'd1' } as never],
      customLists: [{ id: 'l1' } as never, { id: 'l2' } as never],
    })
    render(<AccountScreen navigate={navigate} />)
    expect(await screen.findByText('🃏 1 decks')).toBeTruthy()
    expect(screen.getByText('✏️ 2 word lists')).toBeTruthy()
  })

  it('shows a dash rather than a zero when the library could not be read', async () => {
    // "None" and "could not ask" are different answers.
    lib.loadLibrary.mockRejectedValue(new Error('offline'))
    render(<AccountScreen navigate={navigate} />)
    expect(await screen.findByText('🃏 — decks')).toBeTruthy()
  })

  it('opens the library', async () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('Open library'))
    expect(navigate).toHaveBeenCalledWith({ name: 'library' })
  })

  it('points an account covering nobody at what covering a child adds', () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/See what covering a child adds/))
    expect(navigate).toHaveBeenCalledWith({ name: 'upgrade' })
  })

  it('thanks a paying account instead of selling to it again', () => {
    goPro()
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText(/Thank you for supporting the project/)).toBeTruthy()
    expect(screen.queryByText(/See what covering a child adds/)).toBeNull()
  })

  it('says who is covered and what that costs, not which tier they are on', () => {
    // The old card read `profiles.plan` and said "Family Pro". That flag says
    // "Pro" for a comped teacher who never paid, and "Free" for a parent whose
    // child somebody else covers — so it was wrong in both directions.
    goPro()
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText('What you cover')).toBeTruthy()
    expect(screen.getByText('1 child')).toBeTruthy()
    expect(screen.getByText(/Ada — \$4 a month/)).toBeTruthy()
  })

  it('says nobody rather than a plan name when no child is covered', () => {
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText('Nobody yet')).toBeTruthy()
  })

  it('does not bill a tutor for a child somebody else covers', () => {
    // Covered, visible to this session, and owned by another parent. Without
    // the ownership test this card reads "1 child · $4 a month" and thanks a
    // tutor for paying something they have never paid.
    signIn(aLearner({ id: 'theirs', ownerId: 'another-parent', covered: true }))
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText('Nobody yet')).toBeTruthy()
    expect(screen.queryByText(/Thank you for supporting/)).toBeNull()
  })

  it('marks the CSV export as a paid feature rather than hiding it', () => {
    render(<AccountScreen navigate={navigate} />)
    const button = screen.getByText(/Export as CSV/) as HTMLButtonElement
    expect(button.textContent).toContain('(Pro)')
    expect(button.disabled).toBe(true)
  })

  it('exports for a paying account', () => {
    goPro()
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText(/Export as CSV/))
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('asks twice before erasing progress', () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('🗑️ Erase my progress'))
    expect(screen.getByText('Really erase everything?')).toBeTruthy()
    expect(spies.reset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Never mind'))
    expect(screen.queryByText('Really erase everything?')).toBeNull()
  })

  it('erases when confirmed', () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('🗑️ Erase my progress'))
    fireEvent.click(screen.getByText('Really erase everything?'))
    expect(spies.reset).toHaveBeenCalled()
  })

  it('says when the last sync failed rather than looking fine', () => {
    testState.sync = 'error'
    render(<AccountScreen navigate={navigate} />)
    expect(screen.getByText(/the last sync failed/)).toBeTruthy()
  })

  it('signs out and goes home', async () => {
    render(<AccountScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(spies.signOut).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith({ name: 'home' })
  })
})
