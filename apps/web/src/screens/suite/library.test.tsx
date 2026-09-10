// The library and the two code flows around it.
//
// A library is material that belongs to a grown-up rather than to any one
// child — the thing that makes tutoring possible at all. Two rules hold it
// together and are asserted below: copying a learner's deck leaves theirs
// alone, and a student cannot reach anything in a library until it has been
// set as work.
//
// The connection codes sit here for the same reason they exist: minting one
// grants nothing. Access happens when a family accepts, for the children they
// name, and never for the rest.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const lib = vi.hoisted(() => ({
  loadLibrary: vi.fn(async () => ({ decks: [] as unknown[], customLists: [] as unknown[] })),
  getLibraryDeck: vi.fn(async () => null),
  acceptLibraryDeck: vi.fn(async () => 1),
  saveLibraryDecks: vi.fn(async () => []),
  saveLibraryLists: vi.fn(async () => []),
  deleteLibraryDeck: vi.fn(async () => {}),
  deleteLibraryList: vi.fn(async () => {}),
}))
vi.mock('../../lib/assignments/library', () => lib)

const net = vi.hoisted(() => ({
  listAssignmentSets: vi.fn(async () => []),
  deleteAssignmentSet: vi.fn(async () => {}),
  createAssignments: vi.fn(async () => []),
}))
vi.mock('../../lib/assignments/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...net,
}))

const codes = vi.hoisted(() => ({
  listConnectionCodes: vi.fn(async () => [] as unknown[]),
  mintConnectionCode: vi.fn(async () => ({ code: 'TUT12345' })),
  revokeConnectionCode: vi.fn(async () => {}),
  describeCode: vi.fn(async () => ({
    kind: 'connection',
    valid: true,
    reason: null,
    ownerName: 'Mrs Patel',
    label: 'Tuesday math',
    role: 'teacher',
    canManageContent: false,
  })),
  redeemConnectionCode: vi.fn(async () => 1),
  redeemInvite: vi.fn(async () => 'l1'),
}))
vi.mock('../../lib/learners/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...codes,
}))

import { spies } from '../../test/mockProviders'
import { aLearner, signIn, testState } from '../../test/state'
import { emptySnapshot } from '../../lib/progress/types'
import { ApiError } from '../../lib/api/client'
import HaveACode from '../../components/suite/HaveACode'
import MyTutorCode from '../../components/suite/MyTutorCode'
import LibraryScreen from './LibraryScreen'

const navigate = spies.navigate

function deck(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    title: 'Capitals',
    description: '',
    tags: [],
    cards: [{ id: 'c1', term: 'Paris', definition: 'France', hint: null, difficulty: 3 }],
    source: 'user' as const,
    termLabel: 'Term',
    definitionLabel: 'Definition',
    acceptedAt: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
  for (const fn of [...Object.values(lib), ...Object.values(net), ...Object.values(codes)]) {
    fn.mockClear()
  }
  lib.loadLibrary.mockResolvedValue({ decks: [], customLists: [] })
  codes.listConnectionCodes.mockResolvedValue([])
  net.listAssignmentSets.mockResolvedValue([])
})

describe('a library with nobody signed in', () => {
  it('explains what a library is for, and offers a way in', () => {
    testState.authStatus = 'signed-out'
    render(<LibraryScreen navigate={navigate} />)
    expect(screen.getByText(/decks and word lists that are yours/)).toBeTruthy()
    fireEvent.click(screen.getByText('Sign in'))
    expect(navigate).toHaveBeenCalledWith({ name: 'auth' })
  })

  it('does not even try to load one', () => {
    testState.authStatus = 'signed-out'
    render(<LibraryScreen navigate={navigate} />)
    expect(lib.loadLibrary).not.toHaveBeenCalled()
  })
})

describe('an empty library', () => {
  it('says how to fill it rather than showing an empty grid', async () => {
    render(<LibraryScreen navigate={navigate} />)
    expect(await screen.findByText(/Copy one in from below/)).toBeTruthy()
    expect(screen.getByText('No word lists of your own yet.')).toBeTruthy()
  })

  it('reads the same when the library would not load at all', async () => {
    lib.loadLibrary.mockRejectedValue(new Error('offline'))
    render(<LibraryScreen navigate={navigate} />)
    expect(await screen.findByText(/Copy one in from below/)).toBeTruthy()
  })
})

describe('a library with material in it', () => {
  beforeEach(() => {
    lib.loadLibrary.mockResolvedValue({
      decks: [deck()],
      customLists: [{ id: 'l1', title: 'Week 1', subject: 'spelling', grade: 4, words: [{ w: 'cat', s: '' }] }],
    })
  })

  it('says a student cannot open a deck until it has been set for them', async () => {
    render(<LibraryScreen navigate={navigate} />)
    expect(await screen.findByText(/only open one after you have set it for them/)).toBeTruthy()
  })

  it('counts what is in each deck and list', async () => {
    render(<LibraryScreen navigate={navigate} />)
    expect(await screen.findByText('1 cards')).toBeTruthy()
    expect(screen.getByText('1 words')).toBeTruthy()
  })

  it('opens the assign form from the material, not from a child', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('Set as work'))
    expect(screen.getByText('Set some work')).toBeTruthy()
  })

  it('closes the assign form again', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('Set as work'))
    fireEvent.click(screen.getByText('Never mind'))
    expect(screen.queryByText('Set some work')).toBeNull()
  })

  it('opens a deck from its title — owning one you could not read was the gap', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('Capitals'))
    expect(navigate).toHaveBeenCalledWith({ name: 'library-deck', deckId: 'd1' })
  })

  it('opens the editor on a deck', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Capitals')
    const deckCard = screen.getByText('Capitals').closest('li')!
    fireEvent.click(within(deckCard).getByText('✏️ Edit'))
    expect(navigate).toHaveBeenCalledWith({ name: 'library-edit', deckId: 'd1' })
  })

  it('starts a new deck straight into the library', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('➕ New deck'))
    expect(navigate).toHaveBeenCalledWith({ name: 'library-edit' })
  })

  it('deletes a deck and reloads', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Capitals')
    const deckCard = screen.getByText('Capitals').closest('li')!
    fireEvent.click(within(deckCard).getByText('🗑️'))
    await waitFor(() => expect(lib.deleteLibraryDeck).toHaveBeenCalledWith('d1'))
    expect(lib.loadLibrary).toHaveBeenCalledTimes(2)
  })

  it('deletes a word list', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Week 1')
    const listCard = screen.getByText('Week 1').closest('li')!
    fireEvent.click(within(listCard).getByText('🗑️'))
    await waitFor(() => expect(lib.deleteLibraryList).toHaveBeenCalledWith('l1'))
  })
})

// A draft is a set somebody else wrote — an assistant over the tutor
// connection, or ingestion from a document. The database refuses to set one
// as work, so the library has to say which ones those are and lead to the
// review instead of to a button that fails.
describe('a draft in the library', () => {
  beforeEach(() => {
    lib.loadLibrary.mockResolvedValue({
      decks: [
        deck({ id: 'draft-1', title: 'Coordinate plane', acceptedAt: null }),
        deck({ id: 'd2', title: 'Planets' }),
      ],
      customLists: [],
    })
  })

  it('is marked as one', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Coordinate plane')
    const draftRow = screen.getByText('Coordinate plane').closest('li')!
    expect(within(draftRow).getByText('Draft')).toBeTruthy()
    const otherRow = screen.getByText('Planets').closest('li')!
    expect(within(otherRow).queryByText('Draft')).toBeNull()
  })

  it('offers a review instead of a set-as-work that would be refused', async () => {
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Coordinate plane')
    const draftRow = screen.getByText('Coordinate plane').closest('li')!
    expect(within(draftRow).queryByText('Set as work')).toBeNull()
    fireEvent.click(within(draftRow).getByText('Review'))
    expect(navigate).toHaveBeenCalledWith({ name: 'library-deck', deckId: 'draft-1' })
    const otherRow = screen.getByText('Planets').closest('li')!
    expect(within(otherRow).getByText('Set as work')).toBeTruthy()
  })

  it('will not set a whole document while any part of it is a draft', async () => {
    lib.loadLibrary.mockResolvedValue({
      decks: [
        deck({ id: 'p1', title: 'Part 1', sourceId: 's1', sourceTitle: 'Chapter 7', acceptedAt: null }),
        deck({ id: 'p2', title: 'Part 2', sourceId: 's1', sourceTitle: 'Chapter 7' }),
      ],
      customLists: [],
    })
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText('Part 1')
    expect((screen.getByText('Set the whole thing') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('copying a learner’s material in', () => {
  beforeEach(() => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [deck({ id: 'kid-deck', title: "Ada's deck" })],
      customLists: [
        { id: 'kid-list', title: "Ada's words", subject: 'spelling', grade: 4, words: [], updatedAt: 0 },
      ],
    }
  })

  it('offers what the children own', async () => {
    render(<LibraryScreen navigate={navigate} />)
    expect(await screen.findByText(/Ada's deck/)).toBeTruthy()
    expect(screen.getByText(/Ada's words/)).toBeTruthy()
    expect(screen.getByText(/Copying leaves theirs alone/)).toBeTruthy()
  })

  it('copies rather than moves — a new id, so the child keeps theirs', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText(/Ada's deck/))
    await waitFor(() => expect(lib.saveLibraryDecks).toHaveBeenCalled())
    const saved = (lib.saveLibraryDecks.mock.calls as unknown as Array<
      [Array<{ id: string; title: string }>]
    >)[0]![0]
    expect(saved[0]!.title).toBe("Ada's deck")
    expect(saved[0]!.id).not.toBe('kid-deck')
  })

  it('copies a word list the same way', async () => {
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText(/Ada's words/))
    await waitFor(() => expect(lib.saveLibraryLists).toHaveBeenCalled())
    const saved = (lib.saveLibraryLists.mock.calls as unknown as Array<[Array<{ id: string }>]>)[0]![0]
    expect(saved[0]!.id).not.toBe('kid-list')
  })

  it('offers nothing to copy when the children own nothing', async () => {
    testState.snapshot = emptySnapshot()
    render(<LibraryScreen navigate={navigate} />)
    await screen.findByText(/Copy one in from below/)
    expect(screen.queryByText('Copy into your library')).toBeNull()
  })
})

describe('the code a tutor hands out', () => {
  it('stays folded away for a parent who has never tutored', async () => {
    render(<MyTutorCode />)
    await waitFor(() => expect(codes.listConnectionCodes).toHaveBeenCalled())
    expect(screen.getByText(/Working with someone else/)).toBeTruthy()
    expect(screen.queryByText('Your connection code')).toBeNull()
  })

  it('unfolds when asked for', async () => {
    render(<MyTutorCode />)
    await waitFor(() => expect(codes.listConnectionCodes).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Get a code'))
    expect(screen.getByText('Your connection code')).toBeTruthy()
  })

  it('says plainly that nobody is added until a family accepts', async () => {
    // Minting grants nothing. That is the whole consent model.
    render(<MyTutorCode />)
    await waitFor(() => expect(codes.listConnectionCodes).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Get a code'))
    expect(screen.getByText(/Nobody is added until they accept/)).toBeTruthy()
  })

  it('mints one, with the label it was given', async () => {
    render(<MyTutorCode />)
    await waitFor(() => expect(codes.listConnectionCodes).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Get a code'))
    fireEvent.change(screen.getByPlaceholderText(/What is it for/), {
      target: { value: 'Tuesday math' },
    })
    fireEvent.click(screen.getByText('Create a code'))
    await waitFor(() =>
      expect(codes.mintConnectionCode).toHaveBeenCalledWith({ label: 'Tuesday math' }),
    )
  })

  it('sends no label at all rather than an empty one', async () => {
    render(<MyTutorCode />)
    await waitFor(() => expect(codes.listConnectionCodes).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Get a code'))
    fireEvent.click(screen.getByText('Create a code'))
    await waitFor(() => expect(codes.mintConnectionCode).toHaveBeenCalledWith({ label: null }))
  })

  it('shows an existing code, who has joined, and how to withdraw it', async () => {
    codes.listConnectionCodes.mockResolvedValue([
      { code: 'TUT12345', label: 'Tuesday math', uses: 2, role: 'teacher', canManageContent: false },
    ])
    render(<MyTutorCode />)
    expect(await screen.findByText('TUT12345')).toBeTruthy()
    expect(screen.getByText('2 families joined')).toBeTruthy()
    expect(screen.getByText(/Anyone already connected stays connected/)).toBeTruthy()
  })

  it('says one family in the singular', async () => {
    codes.listConnectionCodes.mockResolvedValue([
      { code: 'TUT12345', label: null, uses: 1, role: 'teacher', canManageContent: false },
    ])
    render(<MyTutorCode />)
    expect(await screen.findByText('1 family joined')).toBeTruthy()
  })

  it('withdraws a code', async () => {
    codes.listConnectionCodes.mockResolvedValue([
      { code: 'TUT12345', label: null, uses: 0, role: 'teacher', canManageContent: false },
    ])
    render(<MyTutorCode />)
    fireEvent.click(await screen.findByText('Withdraw'))
    await waitFor(() => expect(codes.revokeConnectionCode).toHaveBeenCalledWith('TUT12345'))
  })

  it('copies a code to the clipboard', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    codes.listConnectionCodes.mockResolvedValue([
      { code: 'TUT12345', label: null, uses: 0, role: 'teacher', canManageContent: false },
    ])
    render(<MyTutorCode />)
    fireEvent.click(await screen.findByText('Copy'))
    expect(writeText).toHaveBeenCalledWith('TUT12345')
    expect(await screen.findByText('Copied ✓')).toBeTruthy()
  })

  it('shows the folded card when the codes could not be loaded', async () => {
    codes.listConnectionCodes.mockRejectedValue(new Error('offline'))
    render(<MyTutorCode />)
    expect(await screen.findByText(/Working with someone else/)).toBeTruthy()
  })
})

describe('letting a tutor in', () => {
  const onConnected = vi.fn(async () => {})
  const ada = aLearner({ id: 'l1', displayName: 'Ada' })
  const ben = aLearner({ id: 'l2', displayName: 'Ben', avatarEmoji: '🐯' })

  beforeEach(() => onConnected.mockClear())

  it('is offered even to somebody who owns no children', () => {
    // An invite hands them a learner and needs none of their own. Hiding the
    // box left exactly that person with nowhere to type their code.
    render(<HaveACode ownedLearners={[]} onChanged={onConnected} />)
    expect(screen.getByLabelText('Pairing code')).toBeTruthy()
  })

  it('explains a tutor code to somebody who has no learner to point it at', async () => {
    render(<HaveACode ownedLearners={[]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/Add a learner first/)).toBeTruthy()
    expect(codes.redeemConnectionCode).not.toHaveBeenCalled()
  })

  it('looks a code up before asking for consent to anything', async () => {
    // Typing eight characters and hoping is not consent.
    render(<HaveACode ownedLearners={[ada, ben]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/Mrs Patel — Tuesday math/)).toBeTruthy()
    expect(codes.redeemConnectionCode).not.toHaveBeenCalled()
  })

  it('says what accepting would allow, and what it would not', async () => {
    render(<HaveACode ownedLearners={[ada, ben]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/They will not see anyone else in your family/)).toBeTruthy()
  })

  it('says so when the code also lets them set work', async () => {
    codes.describeCode.mockResolvedValueOnce({
      kind: 'connection',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: null,
      role: 'teacher',
      canManageContent: true,
    } as never)
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/and set them work/)).toBeTruthy()
  })

  it('will not check a code too short to be one', () => {
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    const button = screen.getByText('Check code') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'AB' } })
    expect(button.disabled).toBe(true)
  })

  it('preselects the only child there is, but never presumes with several', async () => {
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    await screen.findByText('Who can they see?')
    expect(screen.getByText('Ada').closest('button')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('grants access only to the children named', async () => {
    render(<HaveACode ownedLearners={[ada, ben]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    await screen.findByText('Who can they see?')
    expect((screen.getByText('Give them access') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Ada').closest('button')!)
    fireEvent.click(screen.getByText('Give them access'))
    await waitFor(() =>
      expect(codes.redeemConnectionCode).toHaveBeenCalledWith('TUT12345', ['l1']),
    )
    expect(onConnected).toHaveBeenCalled()
  })

  it('confirms afterwards how many were connected', async () => {
    codes.redeemConnectionCode.mockResolvedValueOnce(2)
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Give them access'))
    expect(await screen.findByText(/They can now see 2 learners/)).toBeTruthy()
  })

  it('says why a code did not work', async () => {
    codes.describeCode.mockResolvedValueOnce({
      kind: 'connection',
      valid: false,
      reason: 'That code has been withdrawn.',
      ownerName: null,
      label: null,
      role: null,
      canManageContent: null,
    } as never)
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'NOPE1234' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText('That code has been withdrawn.')).toBeTruthy()
  })

  it('says so when the lookup itself failed', async () => {
    codes.describeCode.mockRejectedValueOnce(new Error('offline'))
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText('Could not check that code.')).toBeTruthy()
  })

  it('takes an invite in the same box, and joins rather than grants', async () => {
    // The bug this box exists to kill: an invite typed where a connection code
    // was expected used to come back "that code is not valid any more".
    codes.describeCode.mockResolvedValueOnce({
      kind: 'invite',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: 'Ada',
      role: 'parent',
      canManageContent: true,
    } as never)
    render(<HaveACode ownedLearners={[]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'INV12345' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/Mrs Patel shared Ada with you/)).toBeTruthy()
    fireEvent.click(screen.getByText('Join'))
    await waitFor(() => expect(codes.redeemInvite).toHaveBeenCalledWith('INV12345'))
    expect(codes.redeemConnectionCode).not.toHaveBeenCalled()
    expect(onConnected).toHaveBeenCalled()
  })

  it('describes a linking code as becoming the learner, not as helping them', async () => {
    // A self_login code hands over the learner profile. Described as an
    // ordinary invite it told a teenager they were gaining oversight of
    // somebody, when that somebody is who they are about to become.
    codes.describeCode.mockResolvedValueOnce({
      kind: 'self_login',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: 'Ada',
      role: 'parent',
      canManageContent: false,
    } as never)
    render(<HaveACode ownedLearners={[]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'SELF1234' } })
    fireEvent.click(screen.getByText('Check code'))
    expect(await screen.findByText(/This links Ada to the account you are signed in with/)).toBeTruthy()
    expect(screen.queryByText(/shared Ada with you/)).toBeNull()
    expect(screen.queryByText(/set them work/)).toBeNull()
    expect(screen.getByText(/cannot be undone here/)).toBeTruthy()
  })

  it('confirms a linking code in its own words', async () => {
    codes.describeCode.mockResolvedValueOnce({
      kind: 'self_login',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: 'Ada',
      role: 'parent',
      canManageContent: false,
    } as never)
    render(<HaveACode ownedLearners={[]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'SELF1234' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Yes, that is me'))
    await waitFor(() => expect(codes.redeemInvite).toHaveBeenCalledWith('SELF1234'))
    expect(await screen.findByText(/Signing in with this account/)).toBeTruthy()
  })

  it('still confirms when the refresh afterwards fails', async () => {
    // The code is spent the moment the server accepts it. Reporting a failed
    // refresh as a failed redemption sent people back to re-enter something
    // that had already worked, and the second attempt genuinely fails.
    const onChanged = vi.fn(async () => {
      throw new Error('offline')
    })
    codes.describeCode.mockResolvedValueOnce({
      kind: 'invite',
      valid: true,
      reason: null,
      ownerName: 'Mrs Patel',
      label: 'Ada',
      role: 'parent',
      canManageContent: true,
    } as never)
    render(<HaveACode ownedLearners={[]} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'INV12345' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Join'))
    expect(await screen.findByText(/You can see their progress now/)).toBeTruthy()
    expect(screen.queryByText(/It may have been used since/)).toBeNull()
  })

  it('passes the server\u2019s own reason through when redeeming fails', async () => {
    // "That is your own code" is something a person can act on; the house
    // sentence about withdrawal is not.
    codes.redeemConnectionCode.mockRejectedValueOnce(
      new ApiError(400, 'That is your own code', 'rejected'),
    )
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Give them access'))
    expect(await screen.findByText('That is your own code')).toBeTruthy()
  })

  it('says so when the code was withdrawn between looking and accepting', async () => {
    codes.redeemConnectionCode.mockRejectedValueOnce(new Error('gone'))
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Give them access'))
    expect(await screen.findByText(/may have been withdrawn since/)).toBeTruthy()
  })

  it('can be backed out of after looking', async () => {
    render(<HaveACode ownedLearners={[ada]} onChanged={onConnected} />)
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'TUT12345' } })
    fireEvent.click(screen.getByText('Check code'))
    fireEvent.click(await screen.findByText('Never mind'))
    expect(screen.queryByText('Who can they see?')).toBeNull()
    expect(codes.redeemConnectionCode).not.toHaveBeenCalled()
  })
})

describe('the door into the library', () => {
  it('offers handing over a document, which is the thing a grown-up will do', async () => {
    // Typing forty rows is the thing they will not.
    signIn()
    render(<LibraryScreen navigate={navigate} />)
    fireEvent.click(await screen.findByText('Add a document'))
    expect(navigate).toHaveBeenCalledWith({ name: 'content-new' })
  })
})
