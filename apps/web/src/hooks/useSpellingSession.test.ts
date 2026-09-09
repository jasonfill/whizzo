// A spelling round, end to end.
//
// This is where a set of answers becomes everything downstream: the ability
// estimate, each word's mastery and schedule, the level decision, the stars,
// and the row a parent reads later. It writes all of that as one change, so
// these tests mostly assert the shape and honesty of that change.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpellingSession, type ItemResult } from './useSpellingSession'
import { defaultSkillState, emptySnapshot } from '../lib/progress/types'
import type { ProgressChange } from '../lib/progress/repo'

const commit = vi.fn(async (_change: ProgressChange) => {})
let snapshot = emptySnapshot()
let spelling = defaultSkillState('spelling')

vi.mock('../lib/progress/ProgressProvider', () => ({
  useProgress: () => ({ snapshot, skill: () => spelling, commit }),
}))

// A round now tells anybody following it where it has got to. None of that is
// this file's subject, but it has to be able to run: these stand in for the
// providers it reads and the socket it would otherwise open. `sent` is here so
// the cases that do care can look.
const sent = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }))
vi.mock('../lib/learners/LearnerProvider', () => ({
  useLearners: () => ({ active: { id: 'learner-1', displayName: 'Ada' } }),
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'grown-up-1' } }) }))
vi.mock('../lib/live/client', () => ({ openLive: () => () => {} }))
vi.mock('../lib/api/client', () => ({
  ORIGIN_ID: 'origin-under-test',
  api: {
    post: async (_path: string, body: Record<string, unknown>) => {
      sent.bodies.push(body)
    },
  },
}))

/** Play a whole round, answering each word by the rule given. */
function play(
  result: { current: ReturnType<typeof useSpellingSession> },
  answer: (index: number) => { correct: boolean; hints?: number },
) {
  const rows: ItemResult[] = []
  const total = result.current.plan.length
  for (let i = 0; i < total; i++) {
    const word = result.current.current!
    const { correct, hints = 0 } = answer(i)
    act(() => {
      const row = result.current.submit(correct ? word.w : 'zzz', correct, hints)
      if (row) rows.push(row)
    })
    act(() => result.current.advance())
  }
  return rows
}

function lastChange(): ProgressChange {
  return commit.mock.calls.at(-1)![0]
}

beforeEach(() => {
  commit.mockClear()
  snapshot = emptySnapshot()
  spelling = { ...defaultSkillState('spelling'), placed: true, levelIndex: 0 }
})

describe('starting a round', () => {
  it('plans a set of words', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 8 })
    })
    expect(result.current.plan.length).toBeGreaterThan(0)
    expect(result.current.current).not.toBeNull()
  })

  it('honors the size asked for', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 5 })
    })
    expect(result.current.plan).toHaveLength(5)
  })

  it('starts at the first word with nothing recorded', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 5 })
    })
    expect(result.current.index).toBe(0)
    expect(result.current.results).toEqual([])
    expect(result.current.summary).toBeNull()
  })

  it('plans only words from the list when one is named', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({
        activity: 'test',
        mode: 'list',
        listId: 'g2-short-vowels',
        size: 6,
      })
    })
    expect(result.current.plan.length).toBeGreaterThan(0)
  })
})

describe('answering', () => {
  it('records what was typed and whether it was right', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 3 })
    })
    let row: ItemResult | null = null
    act(() => {
      row = result.current.submit('zzz', false, 0)
    })
    expect(row).toMatchObject({ given: 'zzz', correct: false, hintsUsed: 0 })
  })

  it('records how many hints were taken', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'missing-letters', mode: 'adaptive', size: 3 })
    })
    let row: ItemResult | null = null
    act(() => {
      row = result.current.submit('cat', true, 2)
    })
    expect(row!.hintsUsed).toBe(2)
  })

  it('times each answer from when the word was shown', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 3 })
    })
    act(() => result.current.beginItem())
    let row: ItemResult | null = null
    act(() => {
      row = result.current.submit('cat', true)
    })
    expect(row!.responseMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(row!.responseMs)).toBe(true)
  })

  it('returns nothing once the plan is exhausted', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 1 })
    })
    act(() => {
      result.current.submit('cat', true)
    })
    act(() => result.current.advance())
    let extra: ItemResult | null = null
    act(() => {
      extra = result.current.submit('more', true)
    })
    expect(extra).toBeNull()
  })

  it('knows when it is on the last word and when it is done', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 2 })
    })
    expect(result.current.isLast).toBe(false)
    act(() => result.current.advance())
    expect(result.current.isLast).toBe(true)
    act(() => result.current.advance())
    expect(result.current.isComplete).toBe(true)
  })
})

describe('finishing — what gets written', () => {
  async function playAndFinish(
    answer: (i: number) => { correct: boolean; hints?: number },
    activity: 'test' | 'missing-letters' = 'test',
  ) {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity, mode: 'adaptive', size: 6 })
    })
    const rows = play(result, answer)
    let summary!: NonNullable<Awaited<ReturnType<typeof result.current.finish>>>
    await act(async () => {
      summary = (await result.current.finish(rows))!
    })
    return { summary, rows }
  }

  it('writes one change carrying the round, the answers and the new state', async () => {
    const { summary } = await playAndFinish(() => ({ correct: true }))
    expect(summary).not.toBeNull()
    const change = lastChange()
    expect(change.session).toBeDefined()
    expect(change.attempts?.length).toBe(6)
    expect(change.skill).toBeDefined()
    expect(change.mastery?.length).toBe(6)
  })

  it('reports the accuracy the learner actually scored', async () => {
    const { summary } = await playAndFinish((i) => ({ correct: i < 3 }))
    expect(summary.itemsTotal).toBe(6)
    expect(summary.itemsCorrect).toBe(3)
    expect(summary.accuracy).toBe(50)
  })

  it('counts Listen & Spell, which the home screen labels as counting', async () => {
    await playAndFinish(() => ({ correct: true }), 'listen-spell' as never)
    expect(lastChange().session?.isTest).toBe(true)
  })

  it('marks a graded activity as counting and a practice one as not', async () => {
    await playAndFinish(() => ({ correct: true }), 'test')
    expect(lastChange().session?.isTest).toBe(true)
    commit.mockClear()
    await playAndFinish(() => ({ correct: true }), 'missing-letters')
    expect(lastChange().session?.isTest).toBe(false)
  })

  it('records every attempt as system-checked', async () => {
    // Spelling is typed and compared. Nothing here is a self-report, and a
    // reward depends on that being true.
    await playAndFinish(() => ({ correct: true }))
    expect(lastChange().attempts?.every((a) => a.verified)).toBe(true)
  })

  it('marks a hinted word as not graded, whatever the round was', async () => {
    // "Hint — this word stops counting" has to be true in the stored row, not
    // only on the button.
    await playAndFinish((i) => ({ correct: true, hints: i === 0 ? 1 : 0 }))
    const attempts = lastChange().attempts!
    expect(attempts[0]!.hintsUsed).toBe(1)
    expect(attempts[0]!.isTest).toBe(false)
    expect(attempts[1]!.isTest).toBe(true)
  })

  it('keeps what the learner typed, so a grown-up can see the actual mistake', async () => {
    await playAndFinish(() => ({ correct: false }))
    expect(lastChange().attempts?.every((a) => a.given === 'zzz')).toBe(true)
  })

  it('records the prediction it graded against', async () => {
    const { summary } = await playAndFinish((i) => ({ correct: i < 4 }))
    expect(summary.predictedAccuracy).toBeGreaterThanOrEqual(0)
    expect(summary.predictedAccuracy).toBeLessThanOrEqual(100)
    expect(lastChange().session?.meta).toMatchObject({
      predictedAccuracy: summary.predictedAccuracy,
    })
  })

  it('says nothing at all for a round with no answers', async () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 4 })
    })
    let summary: unknown
    await act(async () => {
      summary = await result.current.finish([])
    })
    expect(summary).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('stars are graded on a curve', () => {
  async function starsFor(correctCount: number) {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 10 })
    })
    const rows = play(result, (i) => ({ correct: i < correctCount }))
    let stars = 0
    await act(async () => {
      stars = (await result.current.finish(rows))!.stars
    })
    return stars
  }

  it('gives more stars for a better round', async () => {
    expect(await starsFor(10)).toBeGreaterThanOrEqual(await starsFor(3))
  })

  it('never gives fewer than one, however the round went', async () => {
    // Working at the edge of your ability is the system working, not failing.
    expect(await starsFor(0)).toBeGreaterThanOrEqual(1)
  })

  it('never gives more than three', async () => {
    expect(await starsFor(10)).toBeLessThanOrEqual(3)
  })
})

describe('the level decision', () => {
  it('reports a direction and never leaves the curriculum', async () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 8 })
    })
    const rows = play(result, () => ({ correct: true }))
    let summary!: NonNullable<Awaited<ReturnType<typeof result.current.finish>>>
    await act(async () => {
      summary = (await result.current.finish(rows))!
    })
    expect(['promote', 'demote', 'hold']).toContain(summary.level.direction)
    expect(summary.gradeAfter).toBeGreaterThanOrEqual(2)
    expect(summary.level.reason).toBeTruthy()
  })

  it('does not move the level on a practice round', async () => {
    // Only unaided, graded work moves the level. This is the promise the
    // parent screen makes in words.
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'missing-letters', mode: 'adaptive', size: 8 })
    })
    const rows = play(result, () => ({ correct: true }))
    let summary!: NonNullable<Awaited<ReturnType<typeof result.current.finish>>>
    await act(async () => {
      summary = (await result.current.finish(rows))!
    })
    expect(summary.level.direction).toBe('hold')
    expect(summary.abilityAfter).toBe(summary.abilityBefore)
  })
})

describe('reset', () => {
  it('clears the round', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 4 })
    })
    act(() => {
      result.current.submit('zzz', false)
    })
    act(() => result.current.reset())
    expect(result.current.plan).toEqual([])
    expect(result.current.results).toEqual([])
    expect(result.current.summary).toBeNull()
    expect(result.current.index).toBe(0)
  })
})

// --- what a round tells anybody following it --------------------------------
//
// Spelling is the awkward case for the rule the rest of the app works under:
// the prompt a learner hears is a sentence *containing* the word, so sending it
// as-is would hand the answer to a watcher before the learner has tried. It is
// masked until they answer, and travels with the outcome afterwards.
describe('following a spelling round', () => {
  beforeEach(() => {
    sent.bodies = []
  })

  const kinds = () => sent.bodies.map((b) => b.kind)
  const ticks = () => sent.bodies.filter((b) => b.kind === 'round.tick')

  it('announces the round when it starts', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 4 })
    })

    expect(kinds()).toContain('round.begin')
    const begin = sent.bodies.find((b) => b.kind === 'round.begin')!
    expect(begin).toMatchObject({ activity: 'test', subject: 'spelling', cards: 4 })
  })

  // Nobody is following in this test, so only the round's two ends go out —
  // the shown-word ticks are the part that costs nothing when unwatched.
  it('says nothing about the words while nobody is following', () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 3 })
    })
    play(result, () => ({ correct: true }))

    expect(ticks()).toHaveLength(0)
  })

  it('reports the round when it finishes', async () => {
    const { result } = renderHook(() => useSpellingSession())
    act(() => {
      result.current.start({ activity: 'test', mode: 'adaptive', size: 3 })
    })
    const rows = play(result, (i) => ({ correct: i !== 0 }))
    await act(async () => {
      await result.current.finish(rows)
    })

    const end = sent.bodies.find((b) => b.kind === 'round.end')
    expect(end).toMatchObject({ cards: 3, correct: 2 })
  })
})
