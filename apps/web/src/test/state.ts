// One mutable store the mocked providers read from.
//
// Screen tests need four providers and a handful of network calls stubbed. Each
// test file has to call `vi.mock` itself — the calls are hoisted per module —
// but every factory can reach this store, so a test sets the world it wants by
// assigning here rather than by rebuilding a mock.
//
// `reset()` runs in the shared setup, so nothing leaks between files.

import { defaultSkillState, emptySnapshot } from '../lib/progress/types'
import type { ProgressSnapshot, SkillState, Subject } from '../lib/progress/types'
import type { LiveWatcher } from '@whizzo/shared'
import type { Learner } from '../lib/learners'
import type { Assignment } from '../lib/assignments/api'
import type { PlannerWeekResponse } from '../lib/planner/api'
import { THEMES } from '../lib/themes'
import type { Theme } from '../lib/themes'

export interface TestState {
  authStatus: 'loading' | 'signed-in' | 'signed-out'
  configured: boolean
  user: { id: string; email: string } | null
  profile: {
    displayName: string
    avatarEmoji: string
    gradeHint: number | null
    plan: 'free' | 'pro'
  } | null

  learners: Learner[]
  active: Learner | null
  learnerStatus: 'loading' | 'ready' | 'unavailable' | 'error'
  isOwner: boolean

  snapshot: ProgressSnapshot
  skills: Partial<Record<Subject, SkillState>>
  progressMode: 'local' | 'cloud'
  sync: 'idle' | 'loading' | 'merging' | 'error'

  theme: Theme
  assignments: Assignment[]
  plannerWeek: PlannerWeekResponse | null
  /** Who else is in the week, for the presence line. */
  watchers: LiveWatcher[]
}

export const testState: TestState = createState()

function createState(): TestState {
  return {
    authStatus: 'signed-out',
    configured: true,
    user: null,
    profile: null,

    learners: [],
    active: null,
    learnerStatus: 'unavailable',
    isOwner: true,

    watchers: [],
    snapshot: emptySnapshot(),
    skills: {},
    progressMode: 'local',
    sync: 'idle',

    theme: THEMES[0]!,
    assignments: [],
    plannerWeek: null,
  }
}

export function resetTestState(): void {
  Object.assign(testState, createState())
}

// --- factories ------------------------------------------------------------

export function aLearner(over: Partial<Learner> = {}): Learner {
  return {
    id: 'l1',
    ownerId: 'u1',
    displayName: 'Ada',
    avatarEmoji: '🦊',
    gradeHint: 4,
    birthYear: 2016,
    authKind: 'none',
    authUserId: null,
    createdAt: 0,
    theme: 'cats',
    ...over,
  } as Learner
}

export function anAssignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    setId: 's1',
    learnerId: 'l1',
    subject: 'spelling',
    activity: 'test',
    targetId: null,
    size: null,
    title: 'Friday spelling',
    note: null,
    minAccuracy: null,
    dueOn: null,
    status: 'open',
    completedAt: null,
    sessionId: null,
    sortOrder: 0,
    createdAt: 0,
    ...over,
  } as Assignment
}

export function skill(subject: Subject, over: Partial<SkillState> = {}): SkillState {
  return { ...defaultSkillState(subject), ...over }
}

/**
 * Mark the selected child as paid for.
 *
 * Coverage is a property of the *learner*, not of whoever is looking — that is
 * the whole billing model — so a fixture that only set `profile.plan` was
 * testing a question the app no longer asks. `plan` is set too, because the
 * upgrade screen still reads it for its copy.
 */
export function goPro(): void {
  testState.profile = { ...testState.profile!, plan: 'pro' }
  const covered = testState.active ? { ...testState.active, covered: true } : null
  testState.active = covered
  testState.learners = covered ? [covered] : []
}

/** Sign in as a grown-up with one child selected. */
export function signIn(learner: Learner = aLearner()): void {
  testState.authStatus = 'signed-in'
  testState.user = { id: 'u1', email: 'grown-up@example.com' }
  testState.profile = {
    displayName: 'Grown-up',
    avatarEmoji: '🙂',
    gradeHint: null,
    plan: 'free',
  }
  testState.learners = [learner]
  testState.active = learner
  testState.learnerStatus = 'ready'
  testState.progressMode = 'cloud'
}
