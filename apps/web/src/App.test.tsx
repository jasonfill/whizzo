// The router.
//
// Two things matter here beyond "the right screen appears". A newly signed-up
// grown-up owns no learners, and `home` is the *child's* screen — dropping them
// there makes the account look like a student one and quietly writes their
// practice to localStorage, because there is no learner to attribute it to. So
// they are sent to set someone up. Once only: bouncing them back after they
// deliberately navigated away would trap them.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth/AuthProvider', async () => (await import('./test/mockProviders')).authMock())
vi.mock('./lib/learners/LearnerProvider', async () =>
  (await import('./test/mockProviders')).learnersMock(),
)
vi.mock('./lib/progress/ProgressProvider', async () =>
  (await import('./test/mockProviders')).progressMock(),
)
vi.mock('./lib/theme/ThemeProvider', async () =>
  (await import('./test/mockProviders')).themeMock(),
)
vi.mock('./hooks/useAssignments', async () =>
  (await import('./test/mockProviders')).assignmentsMock(),
)

vi.mock('./lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAssignments: vi.fn(async () => []),
  listAssignmentSets: vi.fn(async () => []),
  familyOverview: vi.fn(async () => []),
}))
vi.mock('./lib/assignments/library', () => ({
  loadLibrary: vi.fn(async () => ({ decks: [], customLists: [] })),
  getLibraryDeck: vi.fn(async () => null),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))
vi.mock('./lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listGuardians: vi.fn(async () => []),
  listConnectionCodes: vi.fn(async () => []),
}))

vi.mock('./lib/spelling/speech', () => ({
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

import App from './App'
import { routeToPath } from './paths'
import type { Route } from './routes'
import { signIn, testState } from './test/state'

beforeEach(() => {
  signIn()
})

/** Nobody signed in, on a build that has accounts. */
function signedOut(): void {
  testState.authStatus = 'signed-out'
  testState.user = null
  testState.profile = null
  testState.learners = []
  testState.active = null
  testState.learnerStatus = 'unavailable'
}

describe('the first screen', () => {
  it('is the child’s home when there is a learner', async () => {
    render(<App />)
    expect(await screen.findByText('🎨 Cats')).toBeTruthy()
  })

  it('sends a grown-up who owns nobody to set someone up', async () => {
    // Otherwise their practice is written to this browser, unattributed.
    testState.learners = []
    testState.active = null
    render(<App />)
    expect(await screen.findByText('Who is learning?')).toBeTruthy()
  })

  it('is the marketing site for anyone not signed in', async () => {
    signedOut()
    render(<App />)
    expect(
      await screen.findByText('Practice that knows what your child can actually do.'),
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Who is learning?')).toBeNull())
  })

  it('waits rather than guessing while the learner list is still loading', async () => {
    testState.learners = []
    testState.active = null
    testState.learnerStatus = 'loading'
    render(<App />)
    await waitFor(() => expect(screen.queryByText('Who is learning?')).toBeNull())
  })
})

describe('every route reachable from the home screen', () => {
  // A route that throws is a blank screen with no way back, so each door out
  // of the home screen is opened here at least once and the screen behind it
  // is checked for something recognizable.
  const doors: Array<[string, RegExp]> = [
    ['📊 Progress', /Progress|History|nothing/i],
    ['🏆 Trophies', /Troph|collect|achiev/i],
    ['✏️ My lists', /word lists/i],
    ['🃏 My decks', /deck/i],
    ['⚙️ Settings', /Settings|Sound|name/i],
    ['👨‍👩‍👧 Family', /Family/i],
    ['✅ Tasks', /Tasks/i],
  ]

  for (const [label, expected] of doors) {
    it(`opens ${label}`, async () => {
      render(<App />)
      fireEvent.click(await screen.findByText(label))
      await waitFor(() => expect(document.body.textContent).toMatch(expected))
    })
  }

  it('opens the three subjects', async () => {
    for (const [label, expected] of [
      ['Spelling', /Spelling/i],
      ['Typing', /Typing|lesson/i],
      ['Quiz', /deck|Quiz/i],
    ] as const) {
      const view = render(<App />)
      fireEvent.click(view.getAllByText(label)[0]!.closest('button')!)
      await waitFor(() => expect(document.body.textContent).toMatch(expected))
      view.unmount()
      // Navigation is a real history push now, so the next mount would open on
      // the subject this one walked to rather than back at home.
      window.history.replaceState(null, '', '/')
    }
  })

  it('opens the world the theme names, and the picker for changing it', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('🎨 Cats'))
    await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(0))
  })

  it('reaches the typing screens through the typing home', async () => {
    render(<App />)
    fireEvent.click(screen.getAllByText('Typing')[0]!.closest('button')!)
    for (const label of [/Word Rain|🌧/, /Practice/]) {
      const button = screen.queryAllByRole('button').find((b) => label.test(b.textContent ?? ''))
      if (!button) continue
      fireEvent.click(button)
      await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(0))
      break
    }
  })

  it('scrolls back to the top on every move, for small screens', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<App />)
    fireEvent.click(await screen.findByText('⚙️ Settings'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    scrollTo.mockRestore()
  })

  it('never shows a blank screen while progress is loading', () => {
    render(<App />)
    expect(document.body.textContent!.length).toBeGreaterThan(0)
  })
})

describe('the door', () => {
  // Practice only counts when it is attributed to a learner, so there is no
  // longer a way to reach an activity without signing in first.
  it('offers nothing playable to a visitor', async () => {
    signedOut()
    render(<App />)
    await screen.findByText('Practice that knows what your child can actually do.')
    for (const label of ['🎨 Cats', '📊 Progress', '🏆 Trophies', '✅ Tasks']) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })

  it('takes a visitor from the marketing site to the way in, and back', async () => {
    signedOut()
    render(<App />)
    fireEvent.click((await screen.findAllByText('Create a free account'))[0]!)
    expect(await screen.findByText('Who is setting this up?')).toBeTruthy()

    fireEvent.click(screen.getByText('← Back'))
    expect(
      await screen.findByText('Practice that knows what your child can actually do.'),
    ).toBeTruthy()
  })

  it('shows the app the moment they are signed in', async () => {
    render(<App />)
    expect(await screen.findByText('🎨 Cats')).toBeTruthy()
    expect(screen.queryByText('Practice that knows what your child can actually do.')).toBeNull()
  })

  it('waits rather than flashing the marketing site at somebody already signed in', () => {
    testState.authStatus = 'loading'
    render(<App />)
    expect(screen.queryByText('Practice that knows what your child can actually do.')).toBeNull()
  })

  it('still opens the app in a build with no accounts behind it', async () => {
    // Signing in is impossible there, so gating on it would leave a developer
    // with a locked door and no key.
    signedOut()
    testState.configured = false
    render(<App />)
    expect(await screen.findByText('🎨 Cats')).toBeTruthy()
  })
})

describe('the address bar', () => {
  /** Put the browser on a URL before the app mounts, the way a deep link does. */
  function startAt(path: string): void {
    window.history.replaceState(null, '', path)
  }

  it('names the screen you are looking at', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('✅ Tasks'))
    await waitFor(() => expect(window.location.pathname).toBe('/tasks'))
  })

  it('opens a deep link straight onto that screen', async () => {
    startAt('/quiz')
    render(<App />)
    // The quiz home, not the child's home.
    await waitFor(() => expect(screen.queryByText('🎨 Cats')).toBeNull())
    expect(window.location.pathname).toBe('/quiz')
  })

  it('identifies what a screen is about in the path', async () => {
    startAt('/quiz/deck/starter-capitals')
    render(<App />)
    expect(await screen.findByText('US State Capitals')).toBeTruthy()
  })

  it('carries a round’s settings in the query string', async () => {
    startAt('/quiz/play/flashcards?deck=starter-capitals&direction=mixed&size=5')
    render(<App />)
    // Five of the fifty, because the URL said five.
    await waitFor(() => expect(document.body.textContent).toMatch(/of 5\b/))
  })

  it('goes back to where you came from', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('⚙️ Settings'))
    await waitFor(() => expect(window.location.pathname).toBe('/settings'))

    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByText('🎨 Cats')).toBeTruthy()
  })

  it('sends a path that names no screen home rather than showing nothing', async () => {
    startAt('/not-a-screen')
    render(<App />)
    expect(await screen.findByText('🎨 Cats')).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('refuses a round whose rules the URL invented', async () => {
    // A hand-edited link must not start a session under a mode nobody defined.
    startAt('/spelling/play/karaoke/adaptive')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/spelling'))
  })

  it('leaves a signed-out visitor on the marketing site, not on a URL they cannot see', async () => {
    signedOut()
    startAt('/library')
    render(<App />)
    expect(
      await screen.findByText('Practice that knows what your child can actually do.'),
    ).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  // Every screen, once: a route whose path the tree does not match would be
  // silently redirected home, which is the failure this catches.
  const everyScreen: Route[] = [
    { name: 'marketing' },
    { name: 'auth' },
    { name: 'home' },
    { name: 'account' },
    { name: 'family' },
    { name: 'upgrade' },
    { name: 'progress' },
    { name: 'custom-lists' },
    { name: 'tasks' },
    { name: 'library' },
    { name: 'library-deck', deckId: 'd1' },
    { name: 'library-edit' },
    { name: 'library-edit', deckId: 'd1' },
    { name: 'theme' },
    { name: 'world' },
    { name: 'settings' },
    { name: 'typing' },
    { name: 'map' },
    { name: 'lesson', id: 'home-row-1' },
    { name: 'practice' },
    { name: 'rain' },
    { name: 'trophies' },
    { name: 'spelling' },
    { name: 'spell-lists' },
    { name: 'spell-play', activity: 'study', mode: 'adaptive' },
    { name: 'quiz' },
    { name: 'quiz-deck', deckId: 'starter-capitals' },
    { name: 'quiz-edit' },
    { name: 'quiz-edit', deckId: 'starter-capitals' },
    { name: 'quiz-play', mode: 'flashcards', deckId: 'starter-capitals' },
  ]

  for (const route of everyScreen) {
    const path = routeToPath(route)
    it(`stays put on ${path}`, async () => {
      startAt(path)
      render(<App />)
      await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(0))
      expect(window.location.pathname + window.location.search).toBe(path)
    })
  }

  // The marketing site is signed-out only, so it needs its own pass: a page
  // whose path the tree does not match would be silently redirected to the
  // front page, which looks identical to "the visitor changed their mind".
  const everyMarketingPage: Route[] = [
    { name: 'features' },
    { name: 'how' },
    { name: 'pricing' },
    { name: 'privacy' },
    { name: 'faq' },
    { name: 'audience', who: 'parents' },
    { name: 'audience', who: 'teachers' },
    { name: 'audience', who: 'tutors' },
    { name: 'audience', who: 'homeschool' },
  ]

  for (const route of everyMarketingPage) {
    const path = routeToPath(route)
    it(`serves ${path} to a visitor`, async () => {
      signedOut()
      startAt(path)
      render(<App />)
      await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(0))
      expect(window.location.pathname).toBe(path)
    })
  }

  it('has no page for an audience nobody wrote one for', async () => {
    signedOut()
    startAt('/for/pirates')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('keeps the sales pitch out of a signed-in grown-up’s way', async () => {
    // They have `/upgrade`, which can answer "what does this cost?" about
    // their own children rather than in general.
    startAt('/pricing')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('gives the way in its own address', async () => {
    signedOut()
    render(<App />)
    fireEvent.click((await screen.findAllByText('Create a free account'))[0]!)
    await waitFor(() => expect(window.location.pathname).toBe('/signin'))
  })
})
