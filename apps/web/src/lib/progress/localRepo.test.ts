// Guest storage, and the CSV a grown-up can take away.
//
// The rule running through the local repo: storage being unavailable — a
// private window, a full disk — must never crash the app or stop a child
// practicing. Progress stays in memory for the session instead.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalProgress,
  hasLocalProgress,
  loadLocalAttempts,
  loadLocalSnapshot,
  LocalProgressRepo,
} from './localRepo'
import { buildProgressCsv } from './export'
import { defaultSkillState, emptySnapshot } from './types'
import type { ItemMastery, ProgressSnapshot } from './types'

function mastery(over: Partial<ItemMastery> = {}): ItemMastery {
  return {
    subject: 'spelling',
    itemKey: 'cat',
    listId: null,
    difficulty: 2,
    mastery: 0.5,
    reps: 1,
    lapses: 0,
    correctStreak: 1,
    totalAttempts: 2,
    totalCorrect: 1,
    intervalDays: 1,
    dueOn: '2026-01-20',
    firstSeenAt: 0,
    lastSeenAt: 1700000000000,
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('loading', () => {
  it('gives an empty snapshot on a fresh device', () => {
    expect(loadLocalSnapshot()).toMatchObject({ skills: {}, mastery: {}, sessions: [] })
  })

  it('reports no progress on a fresh device', () => {
    expect(hasLocalProgress()).toBe(false)
  })

  it('survives corrupted storage rather than crashing the app', () => {
    localStorage.setItem('cat-academy:progress:v1', '{not json')
    expect(() => loadLocalSnapshot()).not.toThrow()
    expect(loadLocalSnapshot()).toMatchObject({ skills: {} })
  })

  it('fills in fields a stored snapshot predates', () => {
    // An older save has fewer keys; reading it must not leave holes the
    // screens then read as undefined.
    localStorage.setItem('cat-academy:progress:v1', JSON.stringify({ skills: {} }))
    const snap = loadLocalSnapshot()
    expect(Array.isArray(snap.sessions)).toBe(true)
    expect(Array.isArray(snap.daily)).toBe(true)
  })

  it('returns no attempts rather than undefined on a fresh device', () => {
    expect(loadLocalAttempts()).toEqual([])
  })
})

describe('LocalProgressRepo', () => {
  it('reports itself as the local store', () => {
    expect(new LocalProgressRepo().kind).toBe('local')
  })

  it('keeps a committed change readable afterwards', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({ skill: { ...defaultSkillState('spelling'), ability: 4.5 } })
    expect(loadLocalSnapshot().skills.spelling?.ability).toBe(4.5)
  })

  it('does not throw when storage refuses the write', async () => {
    // A private window throws on setItem. Losing the save is survivable;
    // interrupting a child mid-round is not.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const repo = new LocalProgressRepo()
    await expect(
      repo.persist({ skill: { ...defaultSkillState('spelling'), ability: 3 } }),
    ).resolves.not.toThrow()
    spy.mockRestore()
  })

  it('reports progress once something has been stored', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({ skill: defaultSkillState('spelling') })
    expect(hasLocalProgress()).toBe(true)
  })

  it('clears everything on reset', async () => {
    const repo = new LocalProgressRepo()
    await repo.persist({ skill: defaultSkillState('spelling') })
    clearLocalProgress()
    expect(hasLocalProgress()).toBe(false)
  })
})

describe('buildProgressCsv', () => {
  function withRows(rows: ItemMastery[]): ProgressSnapshot {
    const map: Record<string, ItemMastery> = {}
    rows.forEach((r, i) => (map[`spelling:${r.itemKey}${i}`] = r))
    return { ...emptySnapshot(), mastery: map }
  }

  it('writes a header even when there is nothing to export', () => {
    const csv = buildProgressCsv(emptySnapshot())
    expect(csv.split('\n')[0]).toContain('subject')
    expect(csv.split('\n')[0]).toContain('mastery')
  })

  it('writes one row per item', () => {
    const csv = buildProgressCsv(withRows([mastery({ itemKey: 'cat' }), mastery({ itemKey: 'dog' })]))
    expect(csv.trim().split('\n')).toHaveLength(3) // header + two
  })

  it('quotes a value containing the delimiter, so the file still parses', () => {
    // A custom list can hold anything a grown-up typed, commas included.
    const csv = buildProgressCsv(withRows([mastery({ itemKey: 'well, actually' })]))
    expect(csv).toContain('"well, actually"')
  })

  it('writes a readable timestamp rather than raw milliseconds', () => {
    const csv = buildProgressCsv(withRows([mastery()]))
    expect(csv).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('leaves an absent due date blank rather than writing null', () => {
    const csv = buildProgressCsv(withRows([mastery({ dueOn: null })]))
    expect(csv).not.toContain('null')
  })
})
