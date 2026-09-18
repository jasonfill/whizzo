// The reward rule is the one place in the theme system where getting it wrong
// costs a child something real, so it is the one place worth pinning hardest.
//
// Three invariants these tests exist to defend:
//
//   1. Earn rate is identical across all ten themes. If it ever is not,
//      switching theme becomes a way to farm easy wins.
//   2. Nothing a learner merely *claims* can buy a collectible. Only rounds
//      the system checked count.
//   3. One predicate decides. `earnedFor` and the per-round answer a results
//      screen gives come from the same rule, so they cannot disagree.

import { describe, expect, it } from 'vitest'
import { earnedFor, earnsCollectible, findRound, roundCollectible, TYPING_ACCURACY_BAR } from './rewards'
import { slotLabels, THEMES, themeById } from '../themes'
import type { ProgressSnapshot, SessionRecord } from '../progress/types'

let clock = 0

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  const itemsTotal = over.itemsTotal ?? 10
  clock += 1000
  return {
    id: Math.random().toString(36).slice(2),
    subject: 'spelling',
    activity: 'test',
    listId: null,
    isTest: true,
    itemsTotal,
    itemsCorrect: itemsTotal,
    accuracy: 90,
    score: 100,
    wpm: null,
    durationMs: 1000,
    abilityBefore: 2,
    abilityAfter: 2,
    meta: { predictedAccuracy: 70 },
    startedAt: clock,
    endedAt: clock + 500,
    evidence: 'attempts',
    verifiedItemsTotal: itemsTotal,
    verifiedItemsCorrect: itemsTotal,
    ...over,
  }
}

/** A typing lesson round, app-checked keystroke by keystroke. */
function typing(over: Partial<SessionRecord> = {}): SessionRecord {
  const itemsTotal = over.itemsTotal ?? 120
  return session({
    subject: 'typing',
    activity: 'lesson',
    listId: 'home-fj',
    accuracy: 95,
    wpm: 22,
    meta: { stars: 3 },
    itemsTotal,
    itemsCorrect: Math.round(itemsTotal * 0.95),
    verifiedItemsTotal: itemsTotal,
    verifiedItemsCorrect: Math.round(itemsTotal * 0.95),
    ...over,
  })
}

/** Newest first, the way the snapshot keeps them. */
function snapshot(sessions: SessionRecord[]): ProgressSnapshot {
  return {
    skills: {},
    mastery: {},
    lists: {},
    sessions: [...sessions].reverse(),
    achievements: [],
    highScores: [],
    daily: [],
    customLists: [],
    decks: [],
  } as unknown as ProgressSnapshot
}

const cats = themeById('cats')

describe('what earns a collectible', () => {
  it('counts a graded round that cleared its prediction', () => {
    const e = earnedFor(snapshot([session({ accuracy: 90, meta: { predictedAccuracy: 70 } })]), cats)
    expect(e.owned).toBe(1)
  })

  it('counts a round that exactly meets its prediction', () => {
    const e = earnedFor(snapshot([session({ accuracy: 70, meta: { predictedAccuracy: 70 } })]), cats)
    expect(e.owned).toBe(1)
  })

  it('does not count a graded round that missed its prediction', () => {
    const e = earnedFor(snapshot([session({ accuracy: 69, meta: { predictedAccuracy: 70 } })]), cats)
    expect(e.owned).toBe(0)
  })

  it('does not count practice, however well it went', () => {
    const e = earnedFor(
      snapshot([session({ isTest: false, accuracy: 100, meta: { predictedAccuracy: 10 } })]),
      cats,
    )
    expect(e.owned).toBe(0)
  })

  it('counts a level promotion', () => {
    const e = earnedFor(snapshot([session({ meta: { level: 'promote' }, accuracy: 50 })]), cats)
    expect(e.owned).toBe(1)
  })

  it('ignores a round with no prediction recorded to beat', () => {
    const e = earnedFor(snapshot([session({ meta: {} })]), cats)
    expect(e.owned).toBe(0)
  })

  it('pays a round once, even when it both beat its prediction and promoted', () => {
    const e = earnedFor(
      snapshot([session({ accuracy: 95, meta: { predictedAccuracy: 70, level: 'promote' } })]),
      cats,
    )
    expect(e.owned).toBe(1)
  })
})

describe('typing joins on its own bar', () => {
  it(`counts a lesson cleared at ${TYPING_ACCURACY_BAR}%+`, () => {
    expect(earnsCollectible(typing({ accuracy: TYPING_ACCURACY_BAR }), [])).toBe(true)
    expect(earnedFor(snapshot([typing()]), cats).owned).toBe(1)
  })

  it('does not count a lesson under the bar', () => {
    expect(earnsCollectible(typing({ accuracy: TYPING_ACCURACY_BAR - 1 }), [])).toBe(false)
  })

  it('pays each lesson once, however many times it is replayed', () => {
    const first = typing({ listId: 'home-fj' })
    const again = typing({ listId: 'home-fj', accuracy: 100 })
    expect(earnsCollectible(again, [first])).toBe(false)
    expect(earnedFor(snapshot([first, again, typing({ listId: 'home-fj' })]), cats).owned).toBe(1)
  })

  it('pays a different lesson separately', () => {
    const first = typing({ listId: 'home-fj' })
    const other = typing({ listId: 'home-dk' })
    expect(earnsCollectible(other, [first])).toBe(true)
    expect(earnedFor(snapshot([first, other]), cats).owned).toBe(2)
  })

  it('pays the first clear, not a later one, when an earlier try missed', () => {
    const missed = typing({ accuracy: 80 })
    const cleared = typing({ accuracy: 92 })
    expect(earnsCollectible(missed, [])).toBe(false)
    expect(earnsCollectible(cleared, [missed])).toBe(true)
  })

  it('does not let a round count itself as its own predecessor', () => {
    const round = typing()
    expect(earnsCollectible(round, [round])).toBe(true)
  })

  it('reads prior in either order — the snapshot keeps newest first', () => {
    const first = typing({ listId: 'home-fj' })
    const again = typing({ listId: 'home-fj' })
    expect(earnedFor(snapshot([first, again]), cats).owned).toBe(1)
    expect(earnedFor({ ...snapshot([]), sessions: [first, again] }, cats).owned).toBe(1)
  })

  it('does not apply the typing bar to arcade rounds', () => {
    expect(earnsCollectible(typing({ activity: 'word-rain', listId: null }), [])).toBe(false)
  })

  it('treats a typing lesson as checked even when the row carries no verified counts', () => {
    // Typing has no self-graded mode and its rounds written before it carried
    // verified counts sit at zero; those lessons were checked all the same.
    expect(earnsCollectible(typing({ verifiedItemsTotal: 0 }), [])).toBe(true)
  })

  it('still refuses a legacy row with no provenance at all', () => {
    expect(earnsCollectible(typing({ evidence: 'legacy' }), [])).toBe(false)
  })
})

describe('a claim never buys a reward', () => {
  it('rejects a graded round where some answers were self-graded', () => {
    // The shape a flashcard self-grade would take if a graded mode ever
    // allowed one: isTest true, but not every item was checked by the app.
    const e = earnedFor(
      snapshot([session({ itemsTotal: 10, verifiedItemsTotal: 4, verifiedItemsCorrect: 4 })]),
      cats,
    )
    expect(e.owned).toBe(0)
  })

  it('rejects a self-graded round even when it claims a promotion', () => {
    const e = earnedFor(
      snapshot([session({ meta: { level: 'promote' }, itemsTotal: 10, verifiedItemsTotal: 0 })]),
      cats,
    )
    expect(e.owned).toBe(0)
  })

  it('rejects legacy rows with no provenance at all', () => {
    const e = earnedFor(
      snapshot([session({ evidence: 'legacy', verifiedItemsTotal: undefined })]),
      cats,
    )
    expect(e.owned).toBe(0)
  })
})

describe('earn rate is fixed across all ten themes', () => {
  const history = snapshot([
    session({ accuracy: 90, meta: { predictedAccuracy: 70 } }),
    session({ accuracy: 60, meta: { predictedAccuracy: 80 } }), // missed
    session({ isTest: false, accuracy: 100, meta: { predictedAccuracy: 10 } }), // practice
    session({ meta: { level: 'promote' } }),
    typing(), // cleared lesson
    typing(), // the same lesson again
  ])

  it('awards the same number of items whichever theme is on', () => {
    const counts = THEMES.map((t) => earnedFor(history, t).owned)
    expect(new Set(counts).size).toBe(1)
    expect(counts[0]).toBe(3) // one cleared round, one promotion, one lesson
  })

  it('differs only in the size of the set, never in what was earned', () => {
    for (const t of THEMES) {
      const e = earnedFor(history, t)
      expect(e.owned).toBe(3)
      expect(e.total).toBe(t.total)
    }
  })
})

describe('what one round is told', () => {
  it('names the next unfilled slot, in the order the collection fills', () => {
    const earlier = session()
    const now = session()
    const r = roundCollectible(snapshot([earlier, now]), cats, now)
    expect(r.earned).toBe(true)
    expect(r.slot).toBe(1)
    expect(r.name).toBe(slotLabels(cats)[1])
  })

  it('agrees with the count on the wall once the round is in the snapshot', () => {
    const rounds = [session(), session(), session()]
    const snap = snapshot(rounds)
    const r = roundCollectible(snap, cats, rounds[2]!)
    expect(r.slot).toBe(earnedFor(snap, cats).owned - 1)
  })

  it('names the same slot whether or not the snapshot already holds the round', () => {
    const earlier = session()
    const now = session()
    const stored = roundCollectible(snapshot([earlier, now]), cats, now)
    const pending = roundCollectible(snapshot([earlier]), cats, now)
    expect(pending).toEqual(stored)
  })

  it('says a missed round earned nothing', () => {
    const now = session({ accuracy: 50 })
    expect(roundCollectible(snapshot([now]), cats, now).earned).toBe(false)
  })

  it('never names a slot past the end of the set', () => {
    const many = Array.from({ length: cats.total + 5 }, () => session())
    const r = roundCollectible(snapshot(many), cats, many[many.length - 1]!)
    expect(r.slot).toBe(cats.total - 1)
  })
})

describe('finding the round a summary describes', () => {
  it('finds the newest stored session that matches', () => {
    const older = session({ activity: 'test', itemsCorrect: 8, accuracy: 80 })
    const newer = session({ activity: 'test', itemsCorrect: 8, accuracy: 80 })
    const found = findRound(snapshot([older, newer]), {
      subject: 'spelling',
      activity: 'test',
      listId: null,
      itemsTotal: 10,
      itemsCorrect: 8,
      accuracy: 80,
    })
    expect(found?.id).toBe(newer.id)
  })

  it('finds nothing rather than something close', () => {
    const found = findRound(snapshot([session({ accuracy: 80 })]), {
      subject: 'spelling',
      activity: 'test',
      listId: null,
      itemsTotal: 10,
      itemsCorrect: 10,
      accuracy: 90,
    })
    expect(found).toBeUndefined()
  })
})

describe('bounds', () => {
  it('never reports more owned than the set holds', () => {
    const many = snapshot(Array.from({ length: 200 }, () => session()))
    for (const t of THEMES) {
      const e = earnedFor(many, t)
      expect(e.owned).toBe(t.total)
      expect(e.fraction).toBeLessThanOrEqual(1)
    }
  })

  it('reports nothing owned for a learner who has done nothing', () => {
    const e = earnedFor(snapshot([]), cats)
    expect(e).toMatchObject({ owned: 0, fraction: 0 })
  })
})
