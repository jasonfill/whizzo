// Who pays and what it buys.
//
// Two rules run through every test here, and both are about trust rather than
// revenue: nothing a learner made is ever taken away for non-payment, and a
// parent is never billed for something they did not choose.

import { describe, expect, it } from 'vitest'
import {
  allows,
  canCreateAnother,
  CREDIT_FLOOR,
  CREDITS_TEACHER_MONTHLY,
  CREDITS_UNCOVERED_ONCE,
  creditsForPages,
  creditsWithSpeed,
  deckLimit,
  FREE_DECKS,
  FREE_HISTORY_DAYS,
  historyDays,
  isActiveStatus,
  monthlyCredits,
  monthlyPriceCents,
  planSpend,
  seatsOf,
  wordListLimit,
  type Gate,
} from './billing.js'

describe('coverage', () => {
  it('treats a failed card as covered, not as a reason to take the report away', () => {
    expect(isActiveStatus('past_due')).toBe(true)
    expect(isActiveStatus('active')).toBe(true)
    expect(isActiveStatus('canceled')).toBe(false)
  })
})

describe('seats', () => {
  it('counts the learners covered rather than trusting a stored number', () => {
    expect(seatsOf(['a', 'b', 'c'])).toBe(3)
    expect(seatsOf([])).toBe(0)
  })

  it('never double-counts the same child', () => {
    expect(seatsOf(['a', 'a', 'b'])).toBe(2)
  })
})

describe('price', () => {
  it('is four dollars for one child and eight for three', () => {
    expect(monthlyPriceCents(1)).toBe(400)
    expect(monthlyPriceCents(3)).toBe(800)
  })

  it('keeps scaling without a new plan', () => {
    expect(monthlyPriceCents(5)).toBe(1200)
  })

  it('charges nothing for nobody', () => {
    expect(monthlyPriceCents(0)).toBe(0)
    expect(monthlyPriceCents(-1)).toBe(0)
  })
})

describe('what is gated', () => {
  const GATES: Gate[] = [
    'fullHistory',
    'itemReport',
    'retentionReport',
    'rewards',
    'printableReports',
    'dataExport',
    'unlimitedContent',
    'trackAbility',
  ]

  it('opens everything for a covered learner', () => {
    for (const gate of GATES) expect(allows(true, gate), gate).toBe(true)
  })

  it('closes all of it for an uncovered one', () => {
    for (const gate of GATES) expect(allows(false, gate), gate).toBe(false)
  })

  it('gives an uncovered learner thirty days of history rather than none', () => {
    // The record is always kept. Coverage unlocks the view, not the keeping.
    expect(historyDays(false)).toBe(FREE_HISTORY_DAYS)
    expect(historyDays(true)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('limits apply to creating, never to keeping', () => {
  it('lets an uncovered learner make a few of their own', () => {
    expect(deckLimit(false)).toBe(FREE_DECKS)
    expect(wordListLimit(false)).toBe(1)
  })

  it('lifts the cap for a covered one', () => {
    expect(deckLimit(true)).toBe(Number.POSITIVE_INFINITY)
  })

  it('refuses the next one over the line', () => {
    expect(canCreateAnother(FREE_DECKS, FREE_DECKS)).toBe(false)
    expect(canCreateAnother(FREE_DECKS - 1, FREE_DECKS)).toBe(true)
  })

  it('never asks whether existing work may stay', () => {
    // A learner who made forty decks while covered keeps all forty. The only
    // question this function answers is whether to allow a forty-first.
    expect(canCreateAnother(40, FREE_DECKS)).toBe(false)
  })
})

describe('credits, not documents', () => {
  it('charges by the page, because a page is a unit of cost and a document is not', () => {
    expect(creditsForPages(24)).toBe(24)
    expect(creditsForPages(60)).toBe(60)
  })

  it('charges a floor, because even one page pays for a full read', () => {
    expect(creditsForPages(1)).toBe(CREDIT_FLOOR)
    expect(creditsForPages(0)).toBe(CREDIT_FLOOR)
    expect(creditsForPages(-5)).toBe(CREDIT_FLOOR)
  })

  it('rounds a part page up rather than giving it away', () => {
    expect(creditsForPages(24.2)).toBe(25)
  })

  it('halves the cost of work that can wait', () => {
    expect(creditsWithSpeed(40, true)).toBe(20)
    expect(creditsWithSpeed(40, false)).toBe(40)
  })

  it('never makes a job free by being patient', () => {
    expect(creditsWithSpeed(1, true)).toBe(1)
  })

  it('pools the allowance across a family', () => {
    expect(monthlyCredits(1)).toBe(30)
    expect(monthlyCredits(3)).toBe(60)
    expect(monthlyCredits(0)).toBe(0)
  })

  it('gives a teacher a standing allowance they never pay for', () => {
    // They are the people most likely to be holding a chapter PDF, and the
    // reason families arrive at all.
    expect(CREDITS_TEACHER_MONTHLY).toBeGreaterThan(0)
    expect(CREDITS_UNCOVERED_ONCE).toBeGreaterThan(0)
  })
})

describe('spending them', () => {
  const balance = (included: number, purchased: number) => ({
    included,
    purchased,
    total: included + purchased,
  })

  it('spends the included allowance first', () => {
    // The reverse order burns a parent's bought credits while free ones expire
    // underneath, which is the angriest email we would ever receive.
    expect(planSpend(balance(30, 100), 20)).toEqual({ included: 20, purchased: 0 })
  })

  it('falls through to purchased once the allowance is gone', () => {
    expect(planSpend(balance(10, 100), 40)).toEqual({ included: 10, purchased: 30 })
  })

  it('stops hard rather than billing an overage', () => {
    // A surprise bill on a product parents buy for children costs more in
    // trust than the credits are worth.
    expect(planSpend(balance(5, 5), 20)).toBeNull()
  })

  it('spends the last credit exactly', () => {
    expect(planSpend(balance(5, 5), 10)).toEqual({ included: 5, purchased: 5 })
  })

  it('charges nothing for nothing', () => {
    expect(planSpend(balance(0, 0), 0)).toEqual({ included: 0, purchased: 0 })
  })
})
