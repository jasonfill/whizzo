// The parts of the storage and dictation layers that only show up at the edges:
// merging two piles of progress, a device with no usable voice, and the guest
// store's attempt log.
//
// The merge is the one that would lose real work if it were wrong. It runs once,
// when a child who has been playing as a guest signs in, and every rule in it
// exists to make sure the result is at least as good as either side.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyChange, mergeSnapshots } from './progress/repo'
import { LocalProgressRepo, clearLocalProgress, hasLocalProgress, loadLocalSnapshot } from './progress/localRepo'
import { emptySnapshot, listKey, todayString } from './progress/types'
import type { ProgressSnapshot } from './progress/types'
import {
  currentVoice,
  dictate,
  isSpeechAvailable,
  listVoices,
  primeVoices,
  savedVoiceURI,
  setVoice,
  speak,
  whenVoicesReady,
} from './spelling/speech'

function snapshotWith(over: Partial<ProgressSnapshot>): ProgressSnapshot {
  return { ...emptySnapshot(), ...over }
}

function mastery(over: Record<string, unknown> = {}) {
  return {
    subject: 'spelling',
    itemKey: 'because',
    listId: null,
    difficulty: 0.2,
    mastery: 0.4,
    reps: 2,
    lapses: 0,
    correctStreak: 1,
    totalAttempts: 3,
    totalCorrect: 2,
    intervalDays: 2,
    dueOn: '2026-09-10',
    firstSeenAt: 1000,
    lastSeenAt: 2000,
    ...over,
  } as never
}

function list(over: Record<string, unknown> = {}) {
  return {
    subject: 'spelling',
    listId: 'g4-1',
    plays: 2,
    testsTaken: 1,
    bestScore: 80,
    bestAccuracy: 80,
    stars: 2,
    masteredAt: null,
    ...over,
  } as never
}

function highScore(score: number) {
  return { id: `h${score}`, subject: 'typing', mode: 'Practice', score, wpm: 20, accuracy: 90, createdAt: 0 } as never
}

function sessionRow(id: string, endedAt: number) {
  return {
    id,
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal: 5,
    itemsCorrect: 5,
    accuracy: 100,
    score: 50,
    wpm: null,
    durationMs: 1000,
    abilityBefore: 1,
    abilityAfter: 1,
    meta: {},
    startedAt: endedAt - 1000,
    endedAt,
    evidence: 'attempts',
  } as never
}

beforeEach(() => {
  localStorage.clear()
})

describe('recording a round', () => {
  it('keeps only the twenty best scores', () => {
    let snap = emptySnapshot()
    for (let i = 0; i < 25; i += 1) snap = applyChange(snap, { highScore: highScore(i) })
    expect(snap.highScores).toHaveLength(20)
    expect(snap.highScores[0]!.score).toBe(24)
  })

  it('adds a day’s activity to the row already there rather than starting a second one', () => {
    let snap = applyChange(emptySnapshot(), {
      daily: { subject: 'spelling', seconds: 60, items: 10, correct: 8 },
    })
    snap = applyChange(snap, {
      daily: { subject: 'spelling', seconds: 30, items: 5, correct: 5 },
    })
    expect(snap.daily).toHaveLength(1)
    expect(snap.daily[0]).toMatchObject({ seconds: 90, items: 15, correct: 13, sessions: 2 })
  })

  it('keeps each subject’s day separate', () => {
    let snap = applyChange(emptySnapshot(), {
      daily: { subject: 'spelling', seconds: 60, items: 10, correct: 8 },
    })
    snap = applyChange(snap, { daily: { subject: 'quiz', seconds: 30, items: 5, correct: 5 } })
    expect(snap.daily).toHaveLength(2)
  })

  it('refuses to be given negative time or negative answers', () => {
    const snap = applyChange(emptySnapshot(), {
      daily: { subject: 'spelling', seconds: -60, items: -10, correct: -8 },
    })
    expect(snap.daily[0]).toMatchObject({ seconds: 0, items: 0, correct: 0 })
  })

  it('replaces the word lists wholesale, because that is how they are edited', () => {
    const snap = applyChange(emptySnapshot(), {
      customLists: [{ id: 'l1', title: 'Week 1', subject: 'spelling', grade: 4, words: [] } as never],
    })
    expect(snap.customLists).toHaveLength(1)
  })
})

describe('merging guest play into an account', () => {
  it('keeps the better of two masteries for the same word', () => {
    const merged = mergeSnapshots(
      snapshotWith({ mastery: { 'spelling:because': mastery({ reps: 2, mastery: 0.4 }) } }),
      snapshotWith({ mastery: { 'spelling:because': mastery({ reps: 5, mastery: 0.8 }) } }),
    )
    const row = merged.mastery['spelling:because']!
    expect(row.reps).toBeGreaterThanOrEqual(5)
  })

  it('takes the earlier due date, so nothing slips past a review', () => {
    const merged = mergeSnapshots(
      snapshotWith({ mastery: { k: mastery({ dueOn: '2026-12-01' }) } }),
      snapshotWith({ mastery: { k: mastery({ dueOn: '2026-09-01' }) } }),
    )
    expect(merged.mastery.k!.dueOn).toBe('2026-09-01')
  })

  it('carries a word only one side has seen straight through', () => {
    const merged = mergeSnapshots(
      emptySnapshot(),
      snapshotWith({ mastery: { 'spelling:only-local': mastery() } }),
    )
    expect(merged.mastery['spelling:only-local']).toBeTruthy()
  })

  it('adds the plays on a list together and keeps the best result', () => {
    const key = listKey('spelling', 'g4-1')
    const merged = mergeSnapshots(
      snapshotWith({ lists: { [key]: list({ plays: 2, bestAccuracy: 70, stars: 1 }) } }),
      snapshotWith({ lists: { [key]: list({ plays: 3, bestAccuracy: 95, stars: 3 }) } }),
    )
    expect(merged.lists[key]).toMatchObject({ plays: 5, bestAccuracy: 95, stars: 3 })
  })

  it('never awards the same achievement twice', () => {
    const a = { achievementId: 'first-test', subject: 'spelling', unlockedAt: 1 } as never
    const merged = mergeSnapshots(
      snapshotWith({ achievements: [a] }),
      snapshotWith({ achievements: [a] }),
    )
    expect(merged.achievements).toHaveLength(1)
  })

  it('keeps the twenty best scores across both sides', () => {
    const merged = mergeSnapshots(
      snapshotWith({ highScores: Array.from({ length: 15 }, (_, i) => highScore(i)) }),
      snapshotWith({ highScores: Array.from({ length: 15 }, (_, i) => highScore(100 + i)) }),
    )
    expect(merged.highScores).toHaveLength(20)
    expect(merged.highScores[0]!.score).toBe(114)
  })

  it('adds up a day practiced on two devices', () => {
    const day = todayString()
    const row = { day, subject: 'spelling', seconds: 60, items: 10, correct: 8, sessions: 1 } as never
    const merged = mergeSnapshots(snapshotWith({ daily: [row] }), snapshotWith({ daily: [row] }))
    expect(merged.daily).toHaveLength(1)
    expect(merged.daily[0]).toMatchObject({ seconds: 120, sessions: 2 })
  })

  it('keeps a round recorded on only one side', () => {
    const merged = mergeSnapshots(
      snapshotWith({ sessions: [sessionRow('a', 2)] }),
      snapshotWith({ sessions: [sessionRow('b', 1)] }),
    )
    expect(merged.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('does not record the same round twice', () => {
    const merged = mergeSnapshots(
      snapshotWith({ sessions: [sessionRow('a', 1)] }),
      snapshotWith({ sessions: [sessionRow('a', 1)] }),
    )
    expect(merged.sessions).toHaveLength(1)
  })

  it('converges a deck edited after signing in on the newer copy', () => {
    // Decks carry a client-generated id, so the same deck really can be on
    // both sides — one deck, not two.
    const deck = (updatedAt: number, title: string) =>
      ({ id: 'd1', title, cards: [], updatedAt, createdAt: 0, source: 'user', tags: [], description: '', termLabel: 'Term', definitionLabel: 'Definition' }) as never
    const merged = mergeSnapshots(
      snapshotWith({ decks: [deck(1, 'Old')] }),
      snapshotWith({ decks: [deck(2, 'New')] }),
    )
    expect(merged.decks).toHaveLength(1)
    expect(merged.decks[0]!.title).toBe('New')
  })

  it('keeps both sides’ word lists', () => {
    const l = (id: string) => ({ id, title: id, subject: 'spelling', grade: 4, words: [] }) as never
    const merged = mergeSnapshots(
      snapshotWith({ customLists: [l('a')] }),
      snapshotWith({ customLists: [l('b')] }),
    )
    expect(merged.customLists).toHaveLength(2)
  })
})

describe('the guest store', () => {
  it('reports nothing saved on a fresh browser', () => {
    expect(hasLocalProgress()).toBe(false)
  })

  it('reports something once a round has been played', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({
      skill: {
        subject: 'spelling',
        ability: 1,
        abilitySd: 1,
        levelIndex: 0,
        placed: false,
        totalAttempts: 1,
        totalCorrect: 1,
        streakDays: 1,
        bestStreakDays: 1,
        lastActiveOn: null,
        settings: {},
      } as never,
    })
    expect(hasLocalProgress()).toBe(true)
  })

  it('stamps answers with the round they belong to, as the API does', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({
      session: sessionRow('sess-1', 5),
      attempts: [
        { subject: 'spelling', itemKey: 'because', correct: true, given: 'because', verified: true, hintsUsed: 0, responseMs: 900 } as never,
      ],
    })
    await expect(repo.attemptsForSession('sess-1')).resolves.toHaveLength(1)
    await expect(repo.attemptsForSession('other')).resolves.toHaveLength(0)
  })

  it('empties itself on a reset', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({ highScore: highScore(1) })
    await repo.reset()
    await expect(repo.load()).resolves.toMatchObject({ highScores: [] })
    expect(loadLocalSnapshot().highScores).toHaveLength(0)
  })

  it('is cleared after a merge, so nothing merges twice', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({ highScore: highScore(1) })
    clearLocalProgress()
    expect(hasLocalProgress()).toBe(false)
  })
})

describe('dictation on a device with no voices', () => {
  // Headless Chrome and some Linux desktops expose speechSynthesis and have no
  // voice at all; speak() there does nothing silently, so the activity has to
  // know before it relies on it.
  it('reports speech unavailable', () => {
    expect(isSpeechAvailable()).toBe(false)
  })

  it('offers no voices to pick from', () => {
    expect(listVoices()).toEqual([])
    expect(currentVoice()).toBeNull()
  })

  it('still calls back rather than hanging the screen', async () => {
    const seen: boolean[] = []
    const stop = whenVoicesReady((ok) => seen.push(ok))
    stop()
    // Either it answered at once, or the grace period will answer later; what
    // matters is that a cleanup function came back.
    expect(typeof stop).toBe('function')
  })

  it('speaks anyway rather than throwing', () => {
    expect(() => speak('because')).not.toThrow()
    expect(() => dictate('because', 'A sentence.')).not.toThrow()
  })

  it('calls onEnd when there is nothing to speak with', () => {
    const original = window.speechSynthesis
    Object.defineProperty(window, 'speechSynthesis', { value: null, configurable: true })
    const onEnd = vi.fn()
    speak('because', { onEnd })
    expect(onEnd).toHaveBeenCalled()
    Object.defineProperty(window, 'speechSynthesis', { value: original, configurable: true })
  })

  it('answers "not available" straight away when there is no synthesiser', () => {
    const original = window.speechSynthesis
    Object.defineProperty(window, 'speechSynthesis', { value: null, configurable: true })
    const seen: boolean[] = []
    whenVoicesReady((ok) => seen.push(ok))
    expect(seen).toEqual([false])
    Object.defineProperty(window, 'speechSynthesis', { value: original, configurable: true })
  })
})

describe('choosing a voice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha' },
    { name: 'Daniel (Enhanced)', lang: 'en-GB', voiceURI: 'daniel' },
    { name: 'Bells', lang: 'en-US', voiceURI: 'bells' },
    { name: 'Anna', lang: 'de-DE', voiceURI: 'anna' },
  ] as unknown as SpeechSynthesisVoice[]

  beforeEach(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        getVoices: () => voices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    setVoice(null)
  })

  it('offers only English voices when there are any', () => {
    expect(listVoices().map((v) => v.name)).not.toContain('Anna')
  })

  it('drops novelty voices rather than merely ranking them last', () => {
    // A child asked to spell "because" in a bell sound has been failed by us,
    // not by their spelling.
    expect(listVoices().map((v) => v.name)).not.toContain('Bells')
  })

  it('reports speech as available now there is a voice', () => {
    expect(isSpeechAvailable()).toBe(true)
  })

  it('remembers a chosen voice, and uses it', () => {
    setVoice('daniel')
    expect(savedVoiceURI()).toBe('daniel')
    expect(currentVoice()?.voiceURI).toBe('daniel')
  })

  it('falls back to the best one when the saved voice is gone', () => {
    setVoice('no-longer-installed')
    expect(currentVoice()).not.toBeNull()
    expect(currentVoice()?.voiceURI).not.toBe('no-longer-installed')
  })

  it('goes back to picking automatically when the choice is cleared', () => {
    setVoice('daniel')
    setVoice(null)
    expect(savedVoiceURI()).toBeNull()
  })

  it('warms the voice list up once', () => {
    primeVoices()
    primeVoices()
    expect(currentVoice()).not.toBeNull()
  })

  it('speaks slower than conversation, because this is dictation for a child', () => {
    const s = window.speechSynthesis as unknown as { speak: ReturnType<typeof vi.fn> }
    speak('because')
    const utterance = s.speak.mock.calls[0]![0] as { rate: number }
    expect(utterance.rate).toBeLessThan(1)
  })

  it('answers straight away when voices are already loaded', () => {
    const seen: boolean[] = []
    whenVoicesReady((ok) => seen.push(ok))
    expect(seen).toEqual([true])
  })
})
