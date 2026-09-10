// The deck-editing surface: finding a deck the assistant made, and changing it.
//
// `create_deck` files into the grown-up's library, which no learner reaches
// until it is set as work — so `search` and `fetch` have to look there too, or
// the assistant can make a deck it can never find again. `update_deck` matches
// cards by term, because the question side is all the assistant is ever shown
// of a card it did not write, and a matched card keeps its id and every field
// the assistant did not send, so the learner's progress and the card's
// enrichment survive the correction.
//
// The reach rule is scoped to the learners ticked at consent: a library deck
// a sibling outside the grant is working on is out of reach for reading and
// for editing alike.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn())
const withUser = vi.hoisted(() => vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })))
const withAdmin = vi.hoisted(() => vi.fn(async (fn: (db: unknown) => Promise<unknown>) => fn({ query })))

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  withAdmin: (...a: Parameters<typeof withAdmin>) => withAdmin(...a),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    MCP_TOKEN_SECRET: 'an-mcp-secret-that-is-at-least-thirty-two-characters',
    APP_URL: 'https://whizzo.test',
    WEB_ORIGINS: '',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false, webOrigins: [] }))

const { callTool, TOOL_DEFS } = await import('./tools.js')
import type { ToolContext } from './context.js'

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const GRANT = '22222222-3333-4444-8555-666666666666'
const LIBRARY_DECK = '44444444-5555-4666-8777-888888888888'
const LEARNER_DECK = '55555555-6666-4777-8888-999999999999'

const ctx: ToolContext = {
  grant: { id: GRANT, userId: CALLER, clientId: 'c', clientLabel: 'claude', learnerIds: [LEARNER], currentLearnerId: LEARNER, scope: 'tutor' },
  clientName: 'Claude',
}

const learnerRow = { id: LEARNER, owner_id: CALLER, display_name: 'Maya', avatar_emoji: '🐱', grade_hint: 4, birth_year: null, auth_kind: 'none', auth_user_id: null, created_at: new Date().toISOString(), theme: null, covered: false }

const cells = [
  { id: 'card-1', term: 'Mitochondria', definition: 'Powerhouse of the cell', hint: 'Starts with m', difficulty: 2, category: 'organelle', altAnswers: ['powerhouse'] },
  { id: 'card-2', term: 'Nucleus', definition: 'Holds the DNA', hint: null, difficulty: 3 },
  { id: 'card-3', term: 'What is a ribosome?', definition: 'Makes proteins', hint: null, difficulty: 2 },
]
const deckRow = (id: string, owner: 'library' | 'learner', extra: Record<string, unknown> = {}) => ({
  id,
  owner_user_id: owner === 'library' ? CALLER : null,
  learner_id: owner === 'learner' ? LEARNER : null,
  title: 'Cells',
  description: '',
  tags: ['mine'],
  cards: cells,
  term_label: 'Term',
  definition_label: 'Definition',
  track: 'science.biology',
  objectives: [],
  accepted_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...extra,
})

/** Route each SQL statement to canned rows by a substring of it. */
function respond(routes: Array<[string, unknown[] | ((params: unknown[]) => unknown[])]>) {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    for (const [needle, rows] of routes) {
      if (sql.includes(needle)) {
        const out = typeof rows === 'function' ? rows(params) : rows
        return { rows: out, rowCount: out.length }
      }
    }
    return { rows: [], rowCount: 0 }
  })
}

// The SQL each reach rule carries, so a test names the rule and not a line.
const LEARNER_DECKS = 'where learner_id = $1'
const LIBRARY_DECKS = 'd.owner_user_id = $1 and not exists'
const EDITABLE_DECK = 'd.learner_id = any($2::uuid[]) or'
const LEARNERS = 'from public.learners l'

/** The one `update public.decks` statement a call made, as its SET clause and parameters. */
function theUpdate(): { sql: string; params: unknown[] } {
  const call = query.mock.calls.find(([sql]) => String(sql).includes('update public.decks'))
  expect(call, 'expected an update').toBeDefined()
  return { sql: String(call![0]), params: call![1] as unknown[] }
}
type SavedCard = { id: string; term: string; definition: string; difficulty: number; hint: string | null; category?: string; altAnswers?: string[]; generated?: string[] }
/** The cards the update wrote: always the parameter after the five fixed ones. */
function savedCards(): SavedCard[] {
  const { sql, params } = theUpdate()
  expect(sql).toContain('cards = $6')
  return JSON.parse(params[5] as string) as SavedCard[]
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('the tool list', () => {
  it('offers update_deck right after create_deck, as a destructive write', () => {
    const names = TOOL_DEFS.map((t) => t.name)
    expect(names.indexOf('update_deck')).toBe(names.indexOf('create_deck') + 1)
    const def = TOOL_DEFS.find((t) => t.name === 'update_deck')!
    expect(def.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect((def.inputSchema as { required: string[] }).required).toEqual(['deckId'])
  })

  it('is twelve tools, as the header comment and the spec say', () => {
    expect(TOOL_DEFS).toHaveLength(12)
  })
})

describe('finding a deck', () => {
  it('search reaches the library, where create_deck files its drafts, scoped to the learners on the grant', async () => {
    respond([
      [LEARNERS, [learnerRow]],
      [LEARNER_DECKS, [deckRow(LEARNER_DECK, 'learner', { title: 'Spanish food' })]],
      [LIBRARY_DECKS, [deckRow(LIBRARY_DECK, 'library')]],
    ])
    const res = await callTool(ctx, 'search', { query: 'cells' })
    expect(res.isError).toBeFalsy()
    const results = res.data.results as Array<{ id: string; library: boolean; learner: string | null; url: string }>
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: LIBRARY_DECK, library: true, learner: null, url: 'https://whizzo.test/library' })
    expect(res.data.total).toBe(1)
    expect(res.say).toBe('1 matching deck, 1 in your library.')
    // The library query carries the consented learners, so a deck a sibling
    // outside the grant holds is filtered out in SQL, not in prose.
    const library = query.mock.calls.find(([sql]) => String(sql).includes(LIBRARY_DECKS))!
    expect(library[1]).toEqual([CALLER, [LEARNER]])
  })

  it('search lists a deck once when the learner has it as work, and says it is in the library too', async () => {
    respond([
      [LEARNERS, [learnerRow]],
      [LEARNER_DECKS, [deckRow(LIBRARY_DECK, 'library')]],
      [LIBRARY_DECKS, [deckRow(LIBRARY_DECK, 'library')]],
    ])
    const res = await callTool(ctx, 'search', { query: '' })
    const results = res.data.results as Array<{ id: string; learner: string | null; library: boolean }>
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: LIBRARY_DECK, learner: 'Maya', library: true })
  })

  it('search puts a draft no learner holds first, so the cap never hides it', async () => {
    const many = Array.from({ length: 25 }, (_, i) => deckRow(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'learner', { title: `Cells ${i}` }))
    respond([
      [LEARNERS, [learnerRow]],
      [LEARNER_DECKS, many],
      [LIBRARY_DECKS, [deckRow(LIBRARY_DECK, 'library', { title: 'Cells draft' })]],
    ])
    const res = await callTool(ctx, 'search', { query: 'cells' })
    const results = res.data.results as Array<{ id: string; library: boolean }>
    expect(results).toHaveLength(20)
    expect(results[0]).toMatchObject({ id: LIBRARY_DECK, library: true })
    expect(res.data.total).toBe(26)
    expect(res.say).toBe('26 matching decks, 1 in your library; the first 20 are listed.')
  })

  it('fetch reaches a library deck by id and still withholds the answers', async () => {
    respond([
      [LEARNERS, [learnerRow]],
      ['d.id = $3 and d.owner_user_id = $1', [deckRow(LIBRARY_DECK, 'library')]],
    ])
    const res = await callTool(ctx, 'fetch', { id: LIBRARY_DECK })
    expect(res.isError).toBeFalsy()
    expect(res.data.text).toContain('- Mitochondria')
    expect(res.data.text).not.toContain('Powerhouse')
    expect(res.data.metadata).toMatchObject({ library: true, cards: 3 })
    expect(res.say).toBe('"Cells", 3 cards, in your library.')
  })
})

describe('update_deck', () => {
  function withDeck(owner: 'library' | 'learner' = 'library', extra: Record<string, unknown> = {}) {
    respond([
      [EDITABLE_DECK, [deckRow(owner === 'library' ? LIBRARY_DECK : LEARNER_DECK, owner, extra)]],
      ['update public.decks', [{ id: LIBRARY_DECK }]],
    ])
  }

  it('looks the deck up under the consent-scoped reach rule', async () => {
    withDeck()
    await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, title: 'Cell parts' })
    const lookup = query.mock.calls.find(([sql]) => String(sql).includes(EDITABLE_DECK))!
    expect(lookup[1]).toEqual([CALLER, [LEARNER], LIBRARY_DECK])
  })

  it('adds new cards and corrects a matched one, keeping its id and every field not sent', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', {
      deckId: LIBRARY_DECK,
      cards: [
        { term: 'mitochondria ', definition: 'Where the cell makes its energy' },
        { term: 'Cell membrane', definition: 'Controls what goes in and out' },
      ],
    })
    expect(res.isError).toBeFalsy()
    const cards = savedCards()
    expect(cards.map((c) => c.term)).toEqual(['mitochondria', 'Nucleus', 'What is a ribosome?', 'Cell membrane'])
    // The correction: same id, new definition, and the hint, category and
    // alternates the assistant never saw are still there.
    expect(cards[0]).toMatchObject({
      id: 'card-1',
      definition: 'Where the cell makes its energy',
      difficulty: 2,
      hint: 'Starts with m',
      category: 'organelle',
      altAnswers: ['powerhouse'],
    })
    expect(cards[0]!.generated).toEqual(['definition'])
    expect(cards[3]!.id).not.toBe('card-1')
    expect(res.data).toMatchObject({ added: 1, corrected: 1, removed: [], draft: true, url: 'https://whizzo.test/library' })
    expect(res.say).toBe('Updated "Cells": added 1 card, corrected 1. It has 4 cards now.')
  })

  it('a field the assistant does send replaces the old one', async () => {
    withDeck()
    await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, cards: [{ term: 'Mitochondria', definition: 'Makes energy', hint: 'Think power' }] })
    expect(savedCards()[0]).toMatchObject({ id: 'card-1', hint: 'Think power', category: 'organelle', generated: ['definition', 'hint'] })
  })

  it('matches terms the way ingestion dedupes them: case and punctuation aside', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, cards: [{ term: 'what is a ribosome', definition: 'Builds proteins' }] })
    const cards = savedCards()
    expect(cards).toHaveLength(3)
    expect(cards[2]).toMatchObject({ id: 'card-3', definition: 'Builds proteins' })
    expect(res.data).toMatchObject({ added: 0, corrected: 1 })
  })

  it('keeps a rich term over the plain echo the assistant got from fetch', async () => {
    withDeck('library', { cards: [{ id: 'card-m', term: 'Half of $\\frac{3}{4}$', definition: '3/8', hint: null, difficulty: 2 }] })
    await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, cards: [{ term: 'Half of 3/4', definition: 'three eighths' }] })
    expect(savedCards()[0]).toMatchObject({ id: 'card-m', term: 'Half of $\\frac{3}{4}$', definition: 'three eighths' })
  })

  it('removes cards by term and says which terms matched nothing, once each', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, remove: ['nucleus', 'Nucleus', 'Golgi body'] })
    expect(savedCards().map((c) => c.id)).toEqual(['card-1', 'card-3'])
    expect(res.data).toMatchObject({ removed: ['Nucleus'], notFound: ['Golgi body'] })
    expect(res.say).toBe('Updated "Cells": removed 1. It has 2 cards now. No card matched "Golgi body".')
  })

  it('treats a term both removed and re-sent as a correction, so its progress survives', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', {
      deckId: LIBRARY_DECK,
      remove: ['Mitochondria'],
      cards: [{ term: 'Mitochondria', definition: 'A better answer' }],
    })
    const cards = savedCards()
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ id: 'card-1', definition: 'A better answer' })
    expect(res.data).toMatchObject({ added: 0, corrected: 1, removed: [], notFound: [] })
  })

  it('retitles, moves tracks and relabels without touching the cards or the review state', async () => {
    withDeck('library', { accepted_at: '2026-09-01T00:00:00Z' })
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, title: 'Cell parts', track: '', termLabel: 'Part', definitionLabel: 'Job' })
    const { sql, params } = theUpdate()
    expect(params).toEqual([LIBRARY_DECK, 'Cell parts', null, 'Part', 'Job'])
    expect(sql).not.toContain('cards')
    expect(sql).not.toContain('accepted_at')
    expect(res.data).toMatchObject({ draft: false })
    expect(res.say).toBe('Updated "Cell parts": renamed it "Cell parts", took it off its track, relabeled the sides. It has 3 cards now.')
  })

  it('replaces the whole set, keeping the id and fields of every card whose term stayed', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', {
      deckId: LIBRARY_DECK,
      replaceCards: true,
      cards: [
        { term: 'Nucleus', definition: 'Holds the DNA' },
        { term: 'Vacuole', definition: 'Stores water' },
      ],
    })
    const cards = savedCards()
    expect(cards.map((c) => c.term)).toEqual(['Nucleus', 'Vacuole'])
    expect(cards[0]).toMatchObject({ id: 'card-2', difficulty: 3 })
    expect(res.data).toMatchObject({ corrected: 1, added: 1, removed: ['Mitochondria', 'What is a ribosome?'], notFound: [] })
    expect(res.say).toBe('Updated "Cells": replaced the cards, 1 of them keeping their progress. It has 2 cards now.')
  })

  it('in replace mode, remove only reports terms the deck never had', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', {
      deckId: LIBRARY_DECK,
      replaceCards: true,
      cards: [{ term: 'Nucleus', definition: 'Holds the DNA' }],
      remove: ['Mitochondria', 'Golgi body'],
    })
    expect(res.data).toMatchObject({ removed: ['Mitochondria', 'What is a ribosome?'], notFound: ['Golgi body'] })
    expect(res.say).not.toContain('"Mitochondria"')
  })

  it('makes a reviewed deck a draft again when its cards change, and stamps who wrote them', async () => {
    withDeck('library', { accepted_at: '2026-09-01T00:00:00Z' })
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, cards: [{ term: 'Vacuole', definition: 'Stores water' }] })
    const { sql, params } = theUpdate()
    expect(sql).toContain('accepted_at = null')
    expect(sql).toContain('tags = $7')
    expect(params[6]).toEqual(['mine', 'generated', 'claude'])
    expect(res.say).toBe('Updated "Cells": added 1 card. It has 4 cards now. It is a draft again: look it over in the app before it is set as work.')
  })

  it("points a learner's own deck at its screen", async () => {
    withDeck('learner')
    const res = await callTool(ctx, 'update_deck', { deckId: LEARNER_DECK, title: 'Cells, again' })
    expect(res.data.url).toBe(`https://whizzo.test/quiz/deck/${LEARNER_DECK}`)
  })

  it('refuses a call that changes nothing', async () => {
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK })
    expect(res.isError).toBe(true)
    expect(res.say).toMatch(/^Nothing to change/)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses replaceCards without cards, and a track that does not exist', async () => {
    expect((await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, replaceCards: true })).say).toMatch(/^replaceCards needs cards/)
    expect((await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, track: 'science.alchemy' })).say).toMatch(/^No track called science.alchemy/)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a deck the connection cannot reach', async () => {
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, title: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.say).toMatch(/^No deck with that id can be changed/)
  })

  it('refuses when the row is visible but RLS lets nothing through on the write', async () => {
    respond([[EDITABLE_DECK, [deckRow(LEARNER_DECK, 'learner')]]])
    const res = await callTool(ctx, 'update_deck', { deckId: LEARNER_DECK, title: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.say).toBe('This connection can see that deck but may not change it.')
  })

  it('will not leave a deck empty', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, remove: ['Mitochondria', 'Nucleus', 'What is a ribosome'] })
    expect(res.isError).toBe(true)
    expect(res.say).toMatch(/no cards/)
    expect(query.mock.calls.some(([sql]) => String(sql).includes('update public.decks'))).toBe(false)
  })

  it('refuses when none of the cards offered are usable', async () => {
    withDeck()
    const res = await callTool(ctx, 'update_deck', { deckId: LIBRARY_DECK, cards: [{ term: ' ', definition: 'x' }] })
    expect(res.isError).toBe(true)
    expect(res.say).toMatch(/^None of those cards were usable/)
  })
})

describe('create_deck', () => {
  it('refuses an unknown track the same way update_deck does, rather than filing a trackless deck', async () => {
    const res = await callTool(ctx, 'create_deck', { title: 'Cells', track: 'science.biolgy', cards: [{ term: 'Nucleus', definition: 'Holds the DNA' }] })
    expect(res.isError).toBe(true)
    expect(res.say).toMatch(/^No track called science.biolgy/)
    expect(query).not.toHaveBeenCalled()
  })
})
