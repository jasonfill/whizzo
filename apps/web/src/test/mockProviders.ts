// The `vi.mock` factories every screen test shares.
//
// Each test file still calls vi.mock itself — those calls are hoisted per
// module and cannot be wrapped — but the factory bodies live here, so a screen
// test is four one-line mocks and then the actual assertions.
//
// Every factory reads `testState` at call time rather than closing over a
// snapshot, so a test can change the world between renders.

import { vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const spies = {
  commit: vi.fn(async () => {}),
  saveCustomLists: vi.fn(async () => {}),
  deleteCustomList: vi.fn(async () => {}),
  saveDeck: vi.fn(async () => {}),
  deleteDeck: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  attemptsForSession: vi.fn(async () => [] as any[]),
  reloadMaterial: vi.fn(async () => {}),

  select: vi.fn(),
  create: vi.fn(async () => ({}) as any),
  refreshLearners: vi.fn(async () => {}),

  signOut: vi.fn(async () => {}),
  updateProfile: vi.fn(async () => {}),

  setTheme: vi.fn(),
  setThemeFor: vi.fn(async () => {}),

  navigate: vi.fn(),

  plannerAdd: vi.fn(async (_draft?: unknown) => null as unknown),
  plannerPatch: vi.fn(async (_item?: unknown, _patch?: unknown, _label?: unknown) => null as unknown),
  plannerMove: vi.fn(async (_item?: unknown, _day?: unknown, _index?: unknown) => {}),
  plannerTick: vi.fn(async (_item?: unknown) => {}),
  plannerSaveWeek: vi.fn(async (_patch?: unknown) => null as unknown),
}

export function resetSpies(): void {
  for (const spy of Object.values(spies)) spy.mockClear()
}

export async function authMock() {
  const { testState } = await import('./state')
  return {
    useAuth: () => ({
      status: testState.authStatus,
      user: testState.user,
      profile: testState.profile,
      configured: testState.configured,
      signOut: spies.signOut,
      updateProfile: spies.updateProfile,
      signIn: vi.fn(async () => {}),
      signUp: vi.fn(async () => ({ needsEmailConfirm: false })),
      signInWithGoogle: vi.fn(async () => {}),
      signInWithCode: vi.fn(async () => {}),
      sendPasswordReset: vi.fn(async () => {}),
      clearError: vi.fn(),
      error: null,
    }),
    AuthProvider: ({ children }: any) => children,
  }
}

export async function learnersMock() {
  const { testState } = await import('./state')
  return {
    useLearners: () => ({
      learners: testState.learners,
      active: testState.active,
      status: testState.learnerStatus,
      error: null,
      isOwner: testState.isOwner,
      select: spies.select,
      create: spies.create,
      refresh: spies.refreshLearners,
    }),
    LearnerProvider: ({ children }: any) => children,
  }
}

export async function progressMock() {
  const { testState } = await import('./state')
  const { defaultSkillState } = await import('../lib/progress/types')
  return {
    useProgress: () => ({
      snapshot: testState.snapshot,
      mode: testState.progressMode,
      sync: testState.sync,
      ready: true,
      skill: (subject: any) =>
        (testState.skills as Record<string, unknown>)[subject] ?? defaultSkillState(subject),
      commit: spies.commit,
      saveCustomLists: spies.saveCustomLists,
      deleteCustomList: spies.deleteCustomList,
      saveDeck: spies.saveDeck,
      deleteDeck: spies.deleteDeck,
      reset: spies.reset,
      attemptsForSession: spies.attemptsForSession,
      reloadMaterial: spies.reloadMaterial,
      materialLoading: false,
    }),
    ProgressProvider: ({ children }: any) => children,
  }
}

export async function themeMock() {
  const { testState } = await import('./state')
  const { THEMES } = await import('../lib/themes')
  return {
    useTheme: () => ({
      theme: testState.theme,
      themes: THEMES,
      setTheme: spies.setTheme,
      setThemeFor: spies.setThemeFor,
      source: testState.authStatus === 'signed-in' ? 'learner' : 'guest',
    }),
    ThemeProvider: ({ children }: any) => children,
  }
}

/** The assignments hook, fed from the shared store rather than the network. */
export async function assignmentsMock() {
  const { testState } = await import('./state')
  return {
    useAssignments: () => ({
      assignments: testState.assignments,
      open: testState.assignments.filter((a: any) => a.status === 'open'),
      done: testState.assignments.filter((a: any) => a.status === 'done'),
      loading: false,
      error: null,
      refresh: vi.fn(),
      learnerId: testState.active?.id ?? null,
    }),
  }
}

/** The planner hook, fed from the shared store rather than the network. */
export async function plannerMock() {
  const { testState } = await import('./state')
  return {
    usePlannerWeek: () => ({
      learnerId: testState.active?.id ?? null,
      learner: testState.active,
      today: '2026-09-07',
      weekStart: '2026-09-07',
      data: testState.plannerWeek,
      loading: false,
      error: null,
      clearError: vi.fn(),
      toast: null,
      dismissToast: vi.fn(),
      load: [],
      courseById: new Map((testState.plannerWeek?.courses ?? []).map((c: any) => [c.id, c])),
      refresh: vi.fn(async () => {}),
      add: spies.plannerAdd,
      patch: spies.plannerPatch,
      move: spies.plannerMove,
      tick: spies.plannerTick,
      skip: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      copy: vi.fn(async () => null),
      keep: vi.fn(async () => {}),
      letGo: vi.fn(async () => {}),
      saveWeek: spies.plannerSaveWeek,
      setData: vi.fn(),
      // The live channel is not exercised through the screen: these tests mock
      // the hook, so there is no subscription. `testState.watchers` lets a test
      // that cares about presence set it.
      liveStatus: 'open' as const,
      watchers: testState.watchers ?? [],
    }),
  }
}

/**
 * A stand-in for the typing game's state, for the screens that take it as a
 * prop rather than reading a provider.
 */
export function aGame(over: Record<string, unknown> = {}): any {
  // `state` is merged rather than replaced: a test that wants two collectibles
  // should not also have to restate every other field.
  const { state: stateOver, ...rest } = over
  return {
    state: {
      playerName: 'Ada',
      lessons: {},
      highScores: [],
      achievements: [],
      collectedCats: [],
      keyErrors: {},
      keyAttempts: {},
      settings: { sound: true, showHands: true, showKeyboard: true },
      totalStars: 0,
      ...(stateOver as object),
    },
    setPlayerName: vi.fn(),
    setSetting: vi.fn(),
    recordLesson: vi.fn(() => ({ stars: 3, newAchievements: [], collectedCat: null })),
    addHighScore: vi.fn(() => []),
    reset: vi.fn(),
    unlockedAchievements: [],
    ...rest,
  }
}
