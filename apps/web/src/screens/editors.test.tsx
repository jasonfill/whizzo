// The two editors — decks and word lists — and the deck screen they lead to.
//
// Both editors take the same shape because both have the same two users: the
// person pasting forty rows out of a study guide, and the person typing six
// cards for tomorrow. What is pinned below is the plan limit being *named*
// rather than silently enforced, and the fact that a deck cannot be saved into
// a state no round could use.

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

import { spies } from '../test/mockProviders'
import { signIn, testState } from '../test/state'
import { emptySnapshot, listKey } from '../lib/progress/types'
import { STARTER_DECKS } from '../data/quiz/starterDecks'
import CustomListsScreen from './suite/CustomListsScreen'
import DeckEditor from './quiz/DeckEditor'
import DeckScreen from './quiz/DeckScreen'

const navigate = spies.navigate

function deck(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    title: 'Capitals',
    description: 'European capitals',
    tags: [],
    cards: [
      { id: 'c1', term: 'Paris', definition: 'France', hint: null, difficulty: 3 },
      { id: 'c2', term: 'Rome', definition: 'Italy', hint: null, difficulty: 3 },
    ],
    source: 'user' as const,
    termLabel: 'City',
    definitionLabel: 'Country',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  signIn()
  navigate.mockClear()
})

describe('a new deck', () => {
  it('opens on the paste panel, because most decks arrive as a list', () => {
    render(<DeckEditor navigate={navigate} />)
    expect(screen.getByText('Paste a list 📥')).toBeTruthy()
    expect(screen.getByText('New deck 🃏')).toBeTruthy()
  })

  it('will not save without a name and two complete cards', () => {
    // A one-card deck is a deck no mode can run.
    render(<DeckEditor navigate={navigate} />)
    expect(screen.getByText(/A deck needs a name and at least two complete cards/)).toBeTruthy()
    expect((screen.getByText(/^Save deck/) as HTMLButtonElement).disabled).toBe(true)
  })

  it('previews a pasted list live, so a wrong separator shows up before importing', () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance\nRome\tItaly' } })
    expect(screen.getByText('2 cards found')).toBeTruthy()
    expect(screen.getByText('Paris')).toBeTruthy()
  })

  it('says which lines it had to skip, and why', () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance\njustonething' } })
    expect(screen.getByText('1 line skipped')).toBeTruthy()
    expect(screen.getByText(/nothing on the far side of the separator/)).toBeTruthy()
  })

  it('imports what was pasted', () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance\nRome\tItaly' } })
    fireEvent.click(screen.getByText(/Use these 2 cards/))
    expect(screen.getByText('Cards (2)')).toBeTruthy()
    expect(screen.getByDisplayValue('Paris')).toBeTruthy()
  })

  it('can add pasted cards to what is already there', () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance' } })
    fireEvent.click(screen.getByText('Add to what I have'))
    expect(screen.getByText('Cards (1)')).toBeTruthy()
  })

  it('lets a separator be chosen when the guess was wrong', () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris,France\nRome,Italy' } })
    fireEvent.click(screen.getByText('Comma'))
    expect(screen.getByText('2 cards found')).toBeTruthy()
  })

  it('can be closed in favour of typing rows by hand', () => {
    render(<DeckEditor navigate={navigate} />)
    fireEvent.click(screen.getAllByText('Cancel')[0]!)
    expect(screen.getByText('📥 Paste a list instead')).toBeTruthy()
    expect(screen.getByText(/No cards yet/)).toBeTruthy()
  })

  it('saves a finished deck and opens it', async () => {
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance\nRome\tItaly' } })
    fireEvent.click(screen.getByText(/Use these 2 cards/))
    fireEvent.change(screen.getByPlaceholderText(/Chapter 7/), {
      target: { value: 'Capitals' },
    })
    fireEvent.click(screen.getByText(/^Save deck/))
    await waitFor(() => expect(spies.saveDeck).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'quiz-deck' }))
  })

  it('says a save failed rather than pretending it worked', async () => {
    spies.saveDeck.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<DeckEditor navigate={navigate} />)
    const area = document.querySelector('textarea')!
    fireEvent.change(area, { target: { value: 'Paris\tFrance\nRome\tItaly' } })
    fireEvent.click(screen.getByText(/Use these 2 cards/))
    fireEvent.change(screen.getByPlaceholderText(/Chapter 7/), { target: { value: 'Capitals' } })
    fireEvent.click(screen.getByText(/^Save deck/))
    expect(await screen.findByText(/That did not save/)).toBeTruthy()
    warn.mockRestore()
  })

  it('names the deck limit rather than failing silently at it', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: Array.from({ length: 20 }, (_, i) => deck({ id: `d${i}` })),
    }
    render(<DeckEditor navigate={navigate} />)
    expect(screen.getByText(/decks for this learner are used/)).toBeTruthy()
    // "Covering them", not "Family Pro" — coverage is bought per child, and
    // there is no tier to be on.
    fireEvent.click(screen.getByText('Covering them'))
    expect(navigate).toHaveBeenCalledWith({ name: 'upgrade' })
  })

  it('backs out to the deck list', () => {
    render(<DeckEditor navigate={navigate} />)
    fireEvent.click(screen.getAllByText('Cancel').slice(-1)[0]!)
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })
})

describe('editing an existing deck', () => {
  beforeEach(() => {
    testState.snapshot = { ...emptySnapshot(), decks: [deck()] }
  })

  it('opens on the rows, not on the paste panel', () => {
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    expect(screen.getByText('Edit deck ✏️')).toBeTruthy()
    expect(screen.queryByText('Paste a list 📥')).toBeNull()
    expect(screen.getByDisplayValue('Capitals')).toBeTruthy()
  })

  it('keeps the deck’s own words for the two sides', () => {
    // A deck of capitals is not asking for a "Term" and a "Definition".
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    expect(screen.getByDisplayValue('City')).toBeTruthy()
    expect(screen.getByDisplayValue('Country')).toBeTruthy()
  })

  it('edits a card in place', () => {
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    fireEvent.change(screen.getByDisplayValue('Paris'), { target: { value: 'Madrid' } })
    expect(screen.getByDisplayValue('Madrid')).toBeTruthy()
  })

  it('adds and removes cards', () => {
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ Add a card'))
    expect(screen.getByText('Card 3')).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('Delete card')[0]!)
    expect(screen.queryByDisplayValue('Paris')).toBeNull()
  })

  it('reorders cards, and will not move the ends off the list', () => {
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    expect((screen.getAllByLabelText('Move up')[0] as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByLabelText('Move down').slice(-1)[0] as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getAllByLabelText('Move down')[0]!)
    // Card sides are textareas, not inputs: maths and figures need the room.
    const fields = [...document.querySelectorAll('textarea')].map((t) => t.value)
    expect(fields.indexOf('Rome')).toBeLessThan(fields.indexOf('Paris'))
  })

  it('does not count an existing deck against the new-deck limit', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [deck(), ...Array.from({ length: 25 }, (_, i) => deck({ id: `x${i}` }))],
    }
    render(<DeckEditor deckId="d1" navigate={navigate} />)
    expect(screen.queryByText(/You have used all/)).toBeNull()
  })
})

describe('a deck’s own screen', () => {
  beforeEach(() => {
    testState.snapshot = { ...emptySnapshot(), decks: [deck()] }
  })

  it('says so rather than crashing when the deck is gone', () => {
    render(<DeckScreen deckId="nope" navigate={navigate} />)
    expect(screen.getByText(/may have been deleted on another device/)).toBeTruthy()
  })

  it('summarises what has been learned so far', () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    expect(screen.getAllByText('Cards').length).toBeGreaterThan(0)
    expect(screen.getByText('Mastered')).toBeTruthy()
    expect(screen.getAllByText('Not seen').length).toBeGreaterThan(0)
  })

  it('marks which modes are graded', () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    expect(screen.getAllByText('Graded').length).toBeGreaterThan(0)
  })

  it('starts a mode, carrying the direction chosen', () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    fireEvent.click(screen.getByText('Flashcards').closest('button')!)
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quiz-play', deckId: 'd1', mode: 'flashcards' }),
    )
  })

  it('offers to run the whole deck through multiple choice, and only there', () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    const all = screen.getAllByText(/^Run through all \d+ cards$/)
    expect(all).toHaveLength(1)
    fireEvent.click(all[0]!)
    const cards = testState.snapshot.decks.find((d) => d.id === 'd1')!.cards.length
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quiz-play', deckId: 'd1', mode: 'choice', size: cards }),
    )
  })

  it('refuses to study a deck with fewer than two cards', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [deck({ cards: [{ id: 'c1', term: 'Paris', definition: 'France', hint: null, difficulty: 3 }] })],
    }
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    expect(screen.getByText(/needs at least two cards/)).toBeTruthy()
    expect(screen.queryByText('Flashcards')).toBeNull()
  })

  it('asks twice before deleting a deck', () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Delete for good')).toBeTruthy()
    fireEvent.click(screen.getByText('Keep it'))
    expect(screen.queryByText('Delete for good')).toBeNull()
    expect(spies.deleteDeck).not.toHaveBeenCalled()
  })

  it('deletes when confirmed, and leaves the screen', async () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete for good'))
    await waitFor(() => expect(spies.deleteDeck).toHaveBeenCalledWith('d1'))
    expect(navigate).toHaveBeenCalledWith({ name: 'quiz' })
  })

  it('offers a copy of a starter deck rather than letting it be edited', async () => {
    // The starters ship with the app; editing one in place would change it for
    // everybody who has practised against it.
    const starter = STARTER_DECKS[0]!
    render(<DeckScreen deckId={starter.id} navigate={navigate} />)
    expect(screen.getByText('📋 Make my own copy')).toBeTruthy()
    expect(screen.queryByText('✏️ Edit deck')).toBeNull()
    fireEvent.click(screen.getByText('📋 Make my own copy'))
    await waitFor(() => expect(spies.saveDeck).toHaveBeenCalled())
  })

  it('duplicates a deck of your own', async () => {
    render(<DeckScreen deckId="d1" navigate={navigate} />)
    fireEvent.click(screen.getByText('📋 Duplicate'))
    await waitFor(() => expect(spies.saveDeck).toHaveBeenCalled())
  })

  it('shows the stars the deck has earned', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      decks: [deck()],
      lists: {
        [listKey('quiz', 'd1')]: {
          subject: 'quiz',
          listId: 'd1',
          plays: 4,
          testsTaken: 2,
          bestScore: 90,
          bestAccuracy: 90,
          stars: 3,
          masteredAt: null,
        },
      },
    }
    const { container } = render(<DeckScreen deckId="d1" navigate={navigate} />)
    expect(container.textContent).toContain('Capitals')
  })
})

describe('word lists', () => {
  it('says how to make the first one rather than showing an empty list', () => {
    render(<CustomListsScreen navigate={navigate} />)
    expect(screen.getByText(/Paste one in and every spelling activity will use it/)).toBeTruthy()
  })

  it('takes a pasted list, with sentences after a tab, a pipe or a dash', async () => {
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ New word list'))
    fireEvent.change(screen.getByPlaceholderText(/Week 12/), { target: { value: 'Week 1' } })
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'because\nfriend\tMy friend sits next to me.\nthrough | Through the park.' },
    })
    expect(screen.getByText('Save 3 words')).toBeTruthy()
    fireEvent.click(screen.getByText('Save 3 words'))
    await waitFor(() => expect(spies.saveCustomLists).toHaveBeenCalled())
    const [saved] = (spies.saveCustomLists.mock.calls as unknown as Array<
      [Array<{ words: Array<{ w: string; s: string }> }>]
    >)[0]![0]
    expect(saved.words[1]).toEqual({ w: 'friend', s: 'My friend sits next to me.' })
  })

  it('writes a prompt for a word given without a sentence', async () => {
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ New word list'))
    fireEvent.change(screen.getByPlaceholderText(/Week 12/), { target: { value: 'Week 1' } })
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'because' } })
    fireEvent.click(screen.getByText('Save 1 words'))
    await waitFor(() => expect(spies.saveCustomLists).toHaveBeenCalled())
    const [saved] = (spies.saveCustomLists.mock.calls as unknown as Array<
      [Array<{ words: Array<{ w: string; s: string }> }>]
    >)[0]![0]
    expect(saved.words[0]!.s).toBe('Please spell the word because.')
  })

  it('will not save a list with no name or no words', () => {
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ New word list'))
    expect((screen.getByText('Save 0 words') as HTMLButtonElement).disabled).toBe(true)
  })

  it('can be abandoned', () => {
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('➕ New word list'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('➕ New word list')).toBeTruthy()
  })

  it('lists what is saved, and offers both a practice and a test', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        {
          id: 'l1',
          title: 'Week 1',
          subject: 'spelling',
          grade: 4,
          words: [{ w: 'because', s: '' }],
          updatedAt: Date.now(),
        },
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    expect(screen.getByText('Week 1')).toBeTruthy()
    expect(screen.getByText('1 words · updated ' + new Date().toLocaleDateString())).toBeTruthy()
    fireEvent.click(screen.getByText('📝 Test'))
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'spell-play', activity: 'test', customListId: 'l1' }),
    )
  })

  it('edits a saved list back into the box it came from', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        {
          id: 'l1',
          title: 'Week 1',
          subject: 'spelling',
          grade: 4,
          words: [{ w: 'because', s: 'A sentence.' }],
          updatedAt: Date.now(),
        },
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Edit'))
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'because\tA sentence.',
    )
  })

  it('deletes a list', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: [
        { id: 'l1', title: 'Week 1', subject: 'spelling', grade: 4, words: [], updatedAt: 0 },
      ],
    }
    render(<CustomListsScreen navigate={navigate} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(spies.deleteCustomList).toHaveBeenCalledWith('l1')
  })

  it('names the list limit rather than failing silently at it', () => {
    testState.snapshot = {
      ...emptySnapshot(),
      customLists: Array.from({ length: 10 }, (_, i) => ({
        id: `l${i}`,
        title: `List ${i}`,
        subject: 'spelling' as const,
        grade: 4,
        words: [],
        updatedAt: 0,
      })),
    }
    render(<CustomListsScreen navigate={navigate} />)
    expect(screen.getByText(/An uncovered learner saves/)).toBeTruthy()
    expect((screen.getByText('➕ New word list') as HTMLButtonElement).disabled).toBe(true)
  })
})

// Filing a set into a subject. The whole design rests on this being optional:
// a deck with no subject is a working deck, and anything that makes filing feel
// mandatory costs us the "paste it and go" promise.
describe('filing a set into a subject', () => {
  const renderEditor = () => render(<DeckEditor navigate={navigate} />)

  it('offers subjects, and defaults to not choosing one', () => {
    renderEditor()
    const picker = screen.getByLabelText(/Subject/) as HTMLSelectElement
    expect(picker.value).toBe('')
    expect(screen.getByText('Not sure yet')).toBeTruthy()
  })

  it('groups them by area so the list is readable', () => {
    renderEditor()
    const picker = screen.getByLabelText(/Subject/)
    expect(picker.querySelectorAll('optgroup').length).toBeGreaterThan(3)
  })

  it('does not offer General, because that is what not choosing means', () => {
    renderEditor()
    const values = [...screen.getByLabelText(/Subject/).querySelectorAll('option')].map(
      (o) => (o as HTMLOptionElement).value,
    )
    expect(values).not.toContain('general')
  })

  it('says why it is worth doing rather than just demanding it', () => {
    renderEditor()
    expect(screen.getByText(/keeps this set/i)).toBeTruthy()
  })

  it('records the choice on the deck', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'science.biology' } })
    expect((screen.getByLabelText(/Subject/) as HTMLSelectElement).value).toBe('science.biology')
  })
})
