// The typing game's state.
//
// All of it follows the account: what a screen shows comes from the progress
// snapshot and the learner's settings, and every finished round, score and
// badge is written there. The thing worth testing is that the two agree — a
// round that shows on the results screen but never reaches progress would
// vanish from the parent's report, from the streak, and from the same child's
// other device.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameState } from './useGameState'
import {
  defaultSkillState,
  emptySnapshot,
  type ProgressChange,
  type ProgressSnapshot,
} from '../lib/progress/types'
import { applyChange } from '../lib/progress/repo'
import type { RoundResult } from '../lib/stats'

// A stand-in store that folds each commit the way the real one does, so the
// hook is tested against the snapshot it will actually be handed.
let snapshot: ProgressSnapshot = emptySnapshot()
let typingSkill = defaultSkillState('typing')
let sync: 'idle' | 'loading' = 'idle'
const commit = vi.fn(async (change: ProgressChange) => {
  snapshot = applyChange(snapshot, change)
})

vi.mock('../lib/progress/ProgressProvider', () => ({
  useProgress: () => ({ commit, skill: () => typingSkill, snapshot, sync }),
}))
// The switches are read off the active learner and written back through the
// provider's `update`.
vi.mock('../lib/learners/LearnerProvider', async () =>
  (await import('../test/mockProviders')).learnersMock(),
)

import { spies } from '../test/mockProviders'
import { aLearner, signIn, testState } from '../test/state'
import { clearGuestSettings } from '../lib/learners/useLearnerSettings'

function round(over: Partial<RoundResult> = {}): RoundResult {
  return {
    wpm: 30,
    accuracy: 95,
    correct: 100,
    incorrect: 5,
    totalTyped: 105,
    elapsedMs: 60_000,
    maxCombo: 20,
    score: 500,
    ...over,
  }
}

beforeEach(() => {
  commit.mockClear()
  snapshot = emptySnapshot()
  typingSkill = defaultSkillState('typing')
  sync = 'idle'
  localStorage.clear()
  clearGuestSettings()
  signIn()
})

describe('a finished lesson', () => {
  it('records the round against the lesson', () => {
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    expect(result.current.state.lessons['home-fj']).toMatchObject({
      plays: 1,
      bestWpm: 30,
      bestAccuracy: 95,
      bestScore: 500,
    })
  })

  it('keeps the learner’s best, not their latest', () => {
    // A bad round after a good one must not take a star away.
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round({ wpm: 40, accuracy: 99, score: 900 }))
    })
    act(() => {
      result.current.recordLesson('home-fj', round({ wpm: 5, accuracy: 20, score: 10 }))
    })
    expect(result.current.state.lessons['home-fj']).toMatchObject({
      plays: 2,
      bestWpm: 40,
      bestAccuracy: 99,
      bestScore: 900,
    })
  })

  it('sends the account the folded list entry, not just this round', () => {
    // The store replaces a list entry rather than adding to it, so a second
    // round that only said "plays: 1" would erase the first.
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round({ score: 900 }))
    })
    act(() => {
      result.current.recordLesson('home-fj', round({ score: 10 }))
    })
    const change = commit.mock.calls.at(-1)![0]
    expect(change.list).toMatchObject({
      subject: 'typing',
      listId: 'home-fj',
      plays: 2,
      testsTaken: 2,
      bestScore: 900,
    })
  })

  it('shows what the account already holds, on a browser that has never seen it', () => {
    // The whole point: a lesson done on the iPad is done on the laptop.
    snapshot = applyChange(emptySnapshot(), {
      list: {
        subject: 'typing',
        listId: 'home-dk',
        plays: 4,
        testsTaken: 4,
        bestScore: 800,
        bestAccuracy: 97,
        stars: 3,
        masteredAt: 1,
      },
      session: {
        id: 's1',
        subject: 'typing',
        activity: 'lesson',
        listId: 'home-dk',
        isTest: true,
        itemsTotal: 100,
        itemsCorrect: 97,
        accuracy: 97,
        score: 800,
        wpm: 42,
        durationMs: 60_000,
        abilityBefore: null,
        abilityAfter: null,
        meta: { stars: 3 },
        startedAt: 0,
        endedAt: 1,
      },
    })
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.lessons['home-dk']).toEqual({
      plays: 4,
      stars: 3,
      bestScore: 800,
      bestAccuracy: 97,
      bestWpm: 42,
    })
    expect(result.current.state.totalStars).toBe(3)
  })

  it('does not count a round twice once the account has it', () => {
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    // The commit folded it into the snapshot; the optimistic copy must agree.
    expect(snapshot.lists['typing:home-fj']?.plays).toBe(1)
    expect(result.current.state.lessons['home-fj']?.plays).toBe(1)
  })

  it('keeps the running star total in step with the lessons', () => {
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round({ accuracy: 99, wpm: 30 }))
    })
    act(() => {
      result.current.recordLesson('home-dk', round({ accuracy: 99, wpm: 30 }))
    })
    const summed = Object.values(result.current.state.lessons).reduce((n, l) => n + l.stars, 0)
    expect(result.current.state.totalStars).toBe(summed)
    expect(summed).toBeGreaterThan(0)
  })

  it('unlocks a badge once and never again', () => {
    const { result } = renderHook(() => useGameState())
    let firstRun: string[] = []
    let secondRun: string[] = []
    act(() => {
      firstRun = result.current.recordLesson('home-fj', round()).newAchievements.map((a) => a.id)
    })
    act(() => {
      secondRun = result.current.recordLesson('home-dk', round()).newAchievements.map((a) => a.id)
    })
    expect(firstRun).toContain('first-steps')
    expect(secondRun).not.toContain('first-steps')
  })

  it('writes a new badge to the account, as a typing badge', () => {
    // The trophy room reads badges from the snapshot like every other
    // subject's, so an unlock that stayed in memory would be gone on reload.
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    const change = commit.mock.calls.at(-1)![0]
    expect(change.achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ achievementId: 'first-steps', subject: 'typing' }),
      ]),
    )
    expect(change.achievements!.every((a) => a.subject === 'typing')).toBe(true)
    expect(snapshot.achievements.map((a) => a.achievementId)).toContain('first-steps')
    expect(result.current.state.achievements).toContain('first-steps')
  })

  it('does not unlock again a badge the account already holds', () => {
    snapshot = applyChange(emptySnapshot(), {
      achievements: [{ achievementId: 'first-steps', subject: 'typing', unlockedAt: 1 }],
    })
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.achievements).toContain('first-steps')
    let unlocked: string[] = []
    act(() => {
      unlocked = result.current.recordLesson('home-fj', round()).newAchievements.map((a) => a.id)
    })
    expect(unlocked).not.toContain('first-steps')
    const written = (commit.mock.calls.at(-1)![0].achievements ?? []).map((a) => a.achievementId)
    expect(written).not.toContain('first-steps')
  })

  it('shows a badge unlocked on this page before the snapshot has it', () => {
    // The results screen must not wait on the store. But a store that never
    // folds it in (a failed sync) must not leave a ghost either: a fresh load
    // for another learner clears it.
    const slow = vi.fn(async () => {})
    commit.mockImplementationOnce(slow)
    const { result, rerender } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    expect(snapshot.achievements).toEqual([])
    expect(result.current.state.achievements).toContain('first-steps')
    sync = 'loading'
    rerender()
    sync = 'idle'
    rerender()
    expect(result.current.state.achievements).not.toContain('first-steps')
  })

  it('writes the round to the shared progress store too', () => {
    // Otherwise it never reaches the streak or the parent's report.
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    expect(commit).toHaveBeenCalled()
    const change = commit.mock.calls.at(-1)![0]
    expect(change).toHaveProperty('session')
    expect(change).toHaveProperty('skill')
  })

  it('marks the round as typing, and as checked by the app', () => {
    // Every keystroke was checked, so the whole round is evidence. Without
    // this the reward rule would rightly refuse to pay for it.
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    const change = commit.mock.calls.at(-1)![0]
    expect(change.session).toMatchObject({
      subject: 'typing',
      isTest: true,
      itemsTotal: 105,
      verifiedItemsTotal: 105,
      verifiedItemsCorrect: 100,
    })
  })

  it('says whether the round earned a collectible, by the shared rule', () => {
    // A clean first round earns one; the same lesson again does not.
    const { result } = renderHook(() => useGameState())
    let first = false
    let again = false
    act(() => {
      first = result.current.recordLesson('home-fj', round({ accuracy: 96 })).earnedCollectible
    })
    act(() => {
      again = result.current.recordLesson('home-fj', round({ accuracy: 96 })).earnedCollectible
    })
    expect(first).toBe(true)
    expect(again).toBe(false)
  })

  it('earns nothing for a sloppy round', () => {
    const { result } = renderHook(() => useGameState())
    let earned = true
    act(() => {
      earned = result.current.recordLesson('home-fj', round({ accuracy: 70 })).earnedCollectible
    })
    expect(earned).toBe(false)
  })

  it('forgets a round still pending when a different learner’s progress loads', () => {
    const { result, rerender } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round())
    })
    // A parent switches child: the store reloads and the snapshot is theirs.
    snapshot = emptySnapshot()
    sync = 'loading'
    rerender()
    sync = 'idle'
    rerender()
    expect(result.current.state.lessons['home-fj']).toBeUndefined()
  })
})

describe('the typing ability estimate', () => {
  it('starts from the round when there is no history', () => {
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round({ wpm: 30, accuracy: 100 }))
    })
    const change = commit.mock.calls.at(-1)![0]
    expect(change.skill!.ability).toBeCloseTo(3, 1)
  })

  it('blends with what came before once there is history', () => {
    // One fast round should not relabel a learner as an expert.
    typingSkill = { ...defaultSkillState('typing'), ability: 2, totalAttempts: 500 }
    const { result } = renderHook(() => useGameState())
    act(() => {
      result.current.recordLesson('home-fj', round({ wpm: 120, accuracy: 100 }))
    })
    const change = commit.mock.calls.at(-1)![0]
    expect(change.skill!.ability).toBeGreaterThan(2)
    expect(change.skill!.ability).toBeLessThan(12)
  })

  it('stays on the shared 0-12 scale however extreme the round', () => {
    const { result } = renderHook(() => useGameState())
    for (const r of [round({ wpm: 0, accuracy: 0 }), round({ wpm: 9999, accuracy: 100 })]) {
      act(() => {
        result.current.recordLesson('home-fj', r)
      })
      const change = commit.mock.calls.at(-1)![0]
      expect(change.skill!.ability).toBeGreaterThanOrEqual(0.5)
      expect(change.skill!.ability).toBeLessThanOrEqual(12)
    }
  })
})

describe('settings', () => {
  it('fills in the defaults for a learner who has set nothing', () => {
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.settings).toEqual({
      sound: true,
      showHands: true,
      showKeyboard: true,
      flashcardLayout: 'flip',
      strikeOutChoices: true,
    })
  })

  it('reads what the learner has set, on a browser that never set it', () => {
    signIn(aLearner({ settings: { sound: false, flashcardLayout: 'slide' } }))
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.settings.sound).toBe(false)
    expect(result.current.state.settings.flashcardLayout).toBe('slide')
    expect(result.current.state.settings.showHands).toBe(true)
  })

  it('toggles one setting without disturbing the others, and writes it to the learner', () => {
    const { result } = renderHook(() => useGameState())
    const before = result.current.state.settings.showHands
    act(() => result.current.setSetting('sound', false))
    // At once, not after the round trip.
    expect(result.current.state.settings.sound).toBe(false)
    expect(result.current.state.settings.showHands).toBe(before)
    // And only the key that changed goes over the wire; the API merges.
    expect(spies.updateLearner).toHaveBeenCalledWith('l1', { settings: { sound: false } })
  })

  it('keeps nothing on this device once there is a learner', () => {
    const { result } = renderHook(() => useGameState())
    act(() => result.current.setSetting('sound', false))
    expect(localStorage.length).toBe(0)
  })

  it('ignores an old per-device save', () => {
    // The fields that used to live here are the account's now. An old save
    // is left alone and never read, not migrated: it was one browser's guess
    // about a learner it could not name.
    localStorage.setItem(
      'keyboard-cats:v1',
      JSON.stringify({ settings: { sound: false }, highScores: [{ score: 9 }], achievements: ['x'] }),
    )
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.settings.sound).toBe(true)
    expect(result.current.state.highScores).toEqual([])
    expect(result.current.state.achievements).toEqual([])
  })

  it('falls back to this device when nobody is signed in', () => {
    // The guest build has no learner row, so a small local record stands in.
    testState.active = null
    const first = renderHook(() => useGameState())
    act(() => first.result.current.setSetting('showKeyboard', false))
    expect(first.result.current.state.settings.showKeyboard).toBe(false)
    expect(spies.updateLearner).not.toHaveBeenCalled()
    first.unmount()
    const second = renderHook(() => useGameState())
    expect(second.result.current.state.settings.showKeyboard).toBe(false)
  })
})

describe('high scores', () => {
  const entry = { score: 900, wpm: 40, accuracy: 98, mode: 'Word Rain', date: 1 }

  it('shows the board the account holds, best first', () => {
    // A score set on the iPad is on the laptop's board.
    snapshot = applyChange(emptySnapshot(), {
      highScore: { id: 'h1', subject: 'typing', mode: 'Practice', score: 300, wpm: 20, accuracy: 90, createdAt: 5 },
    })
    snapshot = applyChange(snapshot, {
      highScore: { id: 'h2', subject: 'typing', mode: 'Word Rain', score: 700, wpm: null, accuracy: null, createdAt: 6 },
    })
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.highScores).toEqual([
      { score: 700, wpm: 0, accuracy: 0, mode: 'Word Rain', date: 6 },
      { score: 300, wpm: 20, accuracy: 90, mode: 'Practice', date: 5 },
    ])
  })

  it('leaves other subjects’ scores off the typing board', () => {
    snapshot = applyChange(emptySnapshot(), {
      highScore: { id: 'h1', subject: 'spelling', mode: 'Test', score: 999, wpm: null, accuracy: 100, createdAt: 1 },
    })
    const { result } = renderHook(() => useGameState())
    expect(result.current.state.highScores).toEqual([])
  })

  it('returns the unlocks on a second call, not only the first', () => {
    // Both of these used to build their return value inside a state updater,
    // which only worked while React happened to evaluate it eagerly. The
    // second call in a row returned undefined and the caller read through it.
    const { result } = renderHook(() => useGameState())
    let second: unknown
    act(() => {
      result.current.addHighScore(entry)
    })
    act(() => {
      second = result.current.addHighScore({ ...entry, score: 950 })
    })
    expect(Array.isArray(second)).toBe(true)
  })

  it('keeps the best twenty, ranked', () => {
    // The board is read from the snapshot, so the stub store's fold has to be
    // rendered the way the real provider would render it.
    const { result, rerender } = renderHook(() => useGameState())
    act(() => {
      for (let i = 0; i < 25; i++) result.current.addHighScore({ ...entry, score: i })
    })
    rerender()
    const scores = result.current.state.highScores.map((h) => h.score)
    expect(scores).toHaveLength(20)
    expect(scores[0]).toBe(24)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('keeps the score and writes it to progress as a typing score', () => {
    const { result, rerender } = renderHook(() => useGameState())
    act(() => {
      result.current.addHighScore(entry)
    })
    rerender()
    expect(result.current.state.highScores.some((h) => h.score === 900)).toBe(true)
    const change = commit.mock.calls.at(-1)![0]
    expect(change.highScore).toMatchObject({
      subject: 'typing',
      mode: 'Word Rain',
      score: 900,
      wpm: 40,
      accuracy: 98,
      createdAt: 1,
    })
    expect(change.highScore).not.toHaveProperty('name')
  })

  it('unlocks the high-scorer badge and writes it with the score', () => {
    const { result } = renderHook(() => useGameState())
    let unlocked: string[] = []
    act(() => {
      unlocked = result.current.addHighScore({ ...entry, score: 1200 }).map((a) => a.id)
    })
    expect(unlocked).toContain('high-scorer')
    const change = commit.mock.calls.at(-1)![0]
    expect(change.achievements).toEqual([
      expect.objectContaining({ achievementId: 'high-scorer', subject: 'typing', unlockedAt: 1 }),
    ])
    expect(result.current.state.achievements).toContain('high-scorer')
  })
})
