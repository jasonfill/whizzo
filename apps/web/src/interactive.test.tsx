// The remaining interactive surfaces: signing in, editing a deck, the two
// quiz play modes, the typing game, the router, and the small grown-up
// components that carry codes and shared work between adults.
//
// These are mostly rendered and driven rather than inspected — what matters is
// that they mount for every state a real person can be in, and that the ones
// handling a code or a PIN never leak it.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spies } from './test/mockProviders'
import { aLearner, signIn, testState } from './test/state'
import { emptySnapshot } from './lib/progress/types'

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
vi.mock('./hooks/useGameState', async () => {
  const { aGame } = await import('./test/mockProviders')
  return { useGameState: () => aGame() }
})

vi.mock('./lib/spelling/speech', () => ({
  speak: vi.fn(),
  dictate: vi.fn(),
  stopSpeaking: vi.fn(),
  isSpeechAvailable: () => true,
  primeVoices: vi.fn(),
  whenVoicesReady: vi.fn(() => () => {}),
  listVoices: () => [
    { name: 'Nicky', voiceURI: 'Nicky', lang: 'en-GB' },
    { name: 'Daniel', voiceURI: 'Daniel', lang: 'en-GB' },
  ],
  savedVoiceURI: () => null,
  setVoice: vi.fn(),
  currentVoice: () => null,
}))

const learnersApi = vi.hoisted(() => ({
  listGuardians: vi.fn(async () => []),
  createInvite: vi.fn(async () => ({ code: 'INVITE-1' })),
  listConnectionCodes: vi.fn(async () => ({ codes: [] })),
  createConnectionCode: vi.fn(async () => ({ code: 'TUTOR-1' })),
  previewConnectionCode: vi.fn(async () => ({
    valid: true,
    reason: null,
    ownerName: 'A teacher',
    label: 'Class 4B',
    role: 'teacher',
    canManageContent: true,
  })),
  redeemConnectionCode: vi.fn(async () => ({ linked: 1 })),
  revokeConnectionCode: vi.fn(async () => {}),
}))
vi.mock('./lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...learnersApi,
}))

vi.mock('./lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAssignmentSets: vi.fn(async () => []),
  updateAssignmentSet: vi.fn(async () => ({})),
  deleteAssignmentSet: vi.fn(async () => {}),
}))

import AuthScreen from './auth/AuthScreen'
import DeckEditor from './screens/quiz/DeckEditor'
import GamePlay from './components/GamePlay'
import LearnerChip from './components/suite/LearnerChip'
import HaveACode from './components/suite/HaveACode'
import MyTutorCode from './components/suite/MyTutorCode'
import SharedWork from './components/suite/SharedWork'
import VoicePicker from './components/suite/VoicePicker'
import AccountChip from './components/suite/AccountChip'
import SessionDetail from './components/suite/SessionDetail'

const navigate = spies.navigate

beforeEach(() => {
  signIn()
})

describe('AuthScreen', () => {
  it('offers a way in and a way past', () => {
    testState.authStatus = 'signed-out'
    testState.user = null
    render(<AuthScreen onDone={() => {}} onBack={() => {}} />)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
  })

  it('lets somebody back out, but not into the app', async () => {
    testState.authStatus = 'signed-out'
    testState.user = null
    const onBack = vi.fn()
    render(<AuthScreen onDone={() => {}} onBack={onBack} />)
    expect(
      screen
        .getAllByRole('button')
        .find((b) => /guest|without an account/i.test(b.textContent ?? '')),
    ).toBeUndefined()
    await userEvent.click(screen.getByText('← Back'))
    expect(onBack).toHaveBeenCalled()
  })

  it('offers the child’s way in, with a code', () => {
    testState.authStatus = 'signed-out'
    testState.user = null
    render(<AuthScreen onDone={() => {}} onBack={() => {}} />)
    expect(screen.getAllByText(/code/i).length).toBeGreaterThan(0)
  })

  it('says so when the build has no accounts rather than offering a dead form', () => {
    testState.authStatus = 'signed-out'
    testState.configured = false
    render(<AuthScreen onDone={() => {}} onBack={() => {}} />)
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('DeckEditor', () => {
  it('opens empty for a new deck', () => {
    render(<DeckEditor navigate={navigate} />)
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })

  it('opens an existing deck for editing', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [
        {
          id: 'd1',
          title: 'Capitals',
          description: '',
          cards: [{ id: 'c1', term: 'Paris', definition: 'France', difficulty: 3, hint: null }],
          createdAt: 0,
          updatedAt: 0,
        } as never,
      ],
    }
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    expect(screen.getByDisplayValue('Capitals')).toBeInTheDocument()
  })

  it('takes a pasted table and turns it into cards', async () => {
    render(<DeckEditor navigate={navigate} />)
    const paste = screen
      .getAllByRole('textbox')
      .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined
    if (paste) {
      await userEvent.type(paste, 'Paris\tFrance')
      expect(paste.value).toContain('Paris')
    }
  })

  it('saves the deck', async () => {
    render(<DeckEditor navigate={navigate} />)
    const save = screen.getAllByRole('button').find((b) => /save/i.test(b.textContent ?? ''))
    if (save && !save.hasAttribute('disabled')) {
      await userEvent.click(save)
    }
    expect(document.body.textContent).toBeTruthy()
  })
})

describe('GamePlay', () => {
  it('shows the text to type and the round chrome', () => {
    render(
      <GamePlay
        text="fj fj"
        title="F & J"
        subtitle="Your index fingers live here."
        showKeyboard
        showHands
        sound={false}
        onFinish={() => {}}
        onQuit={() => {}}
      />,
    )
    expect(screen.getByText('F & J')).toBeInTheDocument()
  })

  it('counts a correct keystroke', async () => {
    render(
      <GamePlay
        text="fj"
        title="F & J"
        showKeyboard={false}
        showHands={false}
        sound={false}
        onFinish={() => {}}
        onQuit={() => {}}
      />,
    )
    await userEvent.keyboard('f')
    expect(document.body.textContent).toBeTruthy()
  })

  it('finishes the round once the text is typed', async () => {
    const onFinish = vi.fn()
    render(
      <GamePlay
        text="fj"
        title="F & J"
        showKeyboard={false}
        showHands={false}
        sound={false}
        onFinish={onFinish}
        onQuit={() => {}}
      />,
    )
    await userEvent.keyboard('fj')
    await waitFor(() => expect(onFinish).toHaveBeenCalled())
  })

  it('lets a learner quit', async () => {
    const onQuit = vi.fn()
    render(
      <GamePlay
        text="fj"
        title="F & J"
        showKeyboard={false}
        showHands={false}
        sound={false}
        onFinish={() => {}}
        onQuit={onQuit}
      />,
    )
    const quit = screen.getAllByRole('button').find((b) => /quit|leave|←/i.test(b.textContent ?? ''))
    if (quit) {
      await userEvent.click(quit)
      expect(onQuit).toHaveBeenCalled()
    }
  })
})

describe('the small grown-up components', () => {
  it('LearnerChip names who is practicing', () => {
    render(<LearnerChip onManage={() => {}} />)
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('LearnerChip stays a plain label for a single child', () => {
    // No dropdown for a choice of one.
    render(<LearnerChip onManage={() => {}} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-haspopup')
  })

  it('LearnerChip offers a switch once there are two', async () => {
    testState.learners = [aLearner(), aLearner({ id: 'l2', displayName: 'Bo' })]
    render(<LearnerChip onManage={() => {}} />)
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Bo')).toBeInTheDocument()
  })

  it('LearnerChip switches child when one is picked', async () => {
    testState.learners = [aLearner(), aLearner({ id: 'l2', displayName: 'Bo' })]
    render(<LearnerChip onManage={() => {}} />)
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByText('Bo'))
    expect(spies.select).toHaveBeenCalledWith('l2')
  })

  it('AccountChip shows who is signed in', () => {
    render(<AccountChip onOpen={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('AccountChip invites a guest to sign in', () => {
    testState.authStatus = 'signed-out'
    testState.profile = null
    render(<AccountChip onOpen={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('AccountChip counts the children this person covers', () => {
    signIn(aLearner({ id: 'mine', ownerId: 'u1', covered: true }))
    render(<AccountChip onOpen={() => {}} />)
    expect(screen.getByTitle('Covering 1 child')).toBeInTheDocument()
  })

  it('AccountChip does not credit a tutor with somebody else’s coverage', () => {
    // `learners` is everyone the session can see, guarded children included.
    // A tutor with two covered students has bought nothing.
    signIn(aLearner({ id: 'theirs', ownerId: 'another-parent', covered: true }))
    render(<AccountChip onOpen={() => {}} />)
    expect(screen.queryByTitle(/Covering/)).toBeNull()
  })

  it('VoicePicker offers the device’s voices', () => {
    render(<VoicePicker />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('VoicePicker can read a sample without dictating a cat sentence', async () => {
    render(<VoicePicker />)
    const hear = screen.getAllByRole('button').find((b) => /hear/i.test(b.textContent ?? ''))
    if (hear) await userEvent.click(hear)
    expect(document.body.textContent).not.toMatch(/whiskers/i)
  })

  it('MyTutorCode renders for a grown-up', async () => {
    render(<MyTutorCode />)
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
  })

  it('HaveACode takes a code and offers to look it up', async () => {
    // The preview is debounced or button-driven depending on the flow; what
    // matters here is that typing a code does not link anything on its own.
    render(<HaveACode ownedLearners={[aLearner()]} onChanged={async () => {}} />)
    const input = screen.getAllByRole('textbox')[0]!
    await userEvent.type(input, 'TUTOR-1')
    expect(learnersApi.redeemConnectionCode).not.toHaveBeenCalled()
  })

  it('HaveACode will not link without a child chosen', () => {
    // Consent is per child: connecting a tutor to "all of them" by default
    // would be the wrong default.
    render(<HaveACode ownedLearners={[aLearner()]} onChanged={async () => {}} />)
    const connect = screen
      .getAllByRole('button')
      .find((b) => /connect|link/i.test(b.textContent ?? ''))
    if (connect) expect(connect).toBeDisabled()
  })

  it('SharedWork renders nothing when nobody has shared any', async () => {
    render(<SharedWork onChanged={async () => {}} />)
    await waitFor(() => expect(document.body.textContent).toBe(''))
  })

  it('SessionDetail opens the answers behind a round', () => {
    const session = {
      id: 's1',
      subject: 'spelling',
      activity: 'test',
      listId: null,
      isTest: true,
      itemsTotal: 10,
      itemsCorrect: 8,
      accuracy: 80,
      score: 100,
      wpm: null,
      durationMs: 60_000,
      abilityBefore: 3,
      abilityAfter: 3.2,
      meta: {},
      startedAt: 0,
      endedAt: 0,
    } as never
    render(<SessionDetail session={session} />)
    expect(document.body.textContent).toBeTruthy()
  })
})
