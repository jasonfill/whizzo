import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameState, HighScore } from '../lib/storage'
import { ACHIEVEMENTS, type Achievement } from '../data/achievements'
import { starRating } from '../lib/stats'
import type { RoundResult } from '../lib/stats'
import { useProgress } from '../lib/progress/ProgressProvider'
import { updateStreak } from '../lib/adaptive'
import { todayString, type SessionRecord, type UnlockedAchievement } from '../lib/progress/types'
import { earnsCollectible } from '../lib/theme/rewards'
import {
  foldRound,
  lessonsFromSnapshot,
  mergeLesson,
  totalStarsOf,
  typingListChange,
  type LessonProgress,
} from '../lib/typing/progress'
import { useLearnerSettings, type LearnerSettings } from '../lib/learners/useLearnerSettings'

export interface LessonOutcome extends RoundResult {
  lessonId: string
  stars: number
  newAchievements: Achievement[]
  /** Did this round earn one of the theme's collectibles? Same rule as everywhere else. */
  earnedCollectible: boolean
}

/** How many scores the trophy room keeps on the board. */
const HIGH_SCORE_LIMIT = 20

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Typing ability on the shared 0-12 scale, so the suite dashboard can put it
 * next to spelling. Roughly: 10 WPM at full accuracy is a 1, 60 WPM is a 6.
 */
function typingAbilityFrom(wpm: number, accuracy: number): number {
  return Math.max(0.5, Math.min(12, (wpm / 10) * (accuracy / 100)))
}

/** The board: typing scores only, best first, capped. */
function rankScores(scores: HighScore[]): HighScore[] {
  return [...scores].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORE_LIMIT)
}

/**
 * The typing game's state.
 *
 * All of it follows the account. Lesson progress, high scores and badges are
 * derived from the progress snapshot; the switches come from the learner's
 * settings. The same child sees the same course, board and badges on every
 * device, and two siblings on one browser do not share one. Nothing here is
 * written to this device; the old `keyboard-cats:v1` save is ignored.
 */
export function useGameState() {
  const { commit, skill, snapshot, sync } = useProgress()
  const { settings, set: setSettings } = useLearnerSettings()

  // Rounds finished on this page whose list entry has not yet come back from
  // the store. The snapshot is updated optimistically on commit so this is
  // normally caught up within a render, but the results screen must never
  // wait on it. Reconciled with the account by `mergeLesson` (bests win, the
  // higher play count is the true one), so nothing is ever counted twice.
  const [pending, setPending] = useState<Record<string, LessonProgress>>({})
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  // Badges unlocked on this page, for the same reason: the results screen
  // shows "New badge!" before the snapshot has folded the commit in.
  const [unlockedHere, setUnlockedHere] = useState<string[]>([])
  const unlockedHereRef = useRef(unlockedHere)
  unlockedHereRef.current = unlockedHere

  // A fresh load — signing in, or a parent switching from one child to
  // another — makes anything pending somebody else's round.
  useEffect(() => {
    if (sync === 'loading') {
      pendingRef.current = {}
      setPending({})
      unlockedHereRef.current = []
      setUnlockedHere([])
    }
  }, [sync])

  const accountLessons = useMemo(
    () => lessonsFromSnapshot(snapshot),
    // Only the two parts of the snapshot this reads; decks and word lists
    // change far more often and mean nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.lists, snapshot.sessions],
  )

  const lessons = useMemo(() => {
    const merged: Record<string, LessonProgress> = { ...accountLessons }
    for (const [id, local] of Object.entries(pending)) {
      merged[id] = mergeLesson(accountLessons[id], local)!
    }
    return merged
  }, [accountLessons, pending])

  const highScores = useMemo(
    () =>
      rankScores(
        snapshot.highScores
          .filter((h) => h.subject === 'typing')
          .map((h) => ({
            score: h.score,
            wpm: h.wpm ?? 0,
            accuracy: h.accuracy ?? 0,
            mode: h.mode,
            date: h.createdAt,
          })),
      ),
    [snapshot.highScores],
  )

  // Every subject's badges come out of one table. The typing list is what
  // makes an id a typing badge, so no subject filter is needed here.
  const achievements = useMemo(() => {
    const ids = new Set(snapshot.achievements.map((a) => a.achievementId))
    for (const id of unlockedHere) ids.add(id)
    return [...ids]
  }, [snapshot.achievements, unlockedHere])

  const state = useMemo<GameState>(
    () => ({ highScores, achievements, settings, lessons, totalStars: totalStarsOf(lessons) }),
    [highScores, achievements, settings, lessons],
  )
  const stateRef = useRef(state)
  stateRef.current = state

  const setSetting = useCallback(
    <K extends keyof LearnerSettings>(key: K, value: Required<LearnerSettings>[K]) => {
      setSettings({ [key]: value })
    },
    [setSettings],
  )

  /**
   * Which badges a state has just earned, and the rows that record them.
   * Remembered locally at once, so a back-to-back second round builds on the
   * first rather than unlocking the same badge twice.
   */
  const unlockAgainst = useCallback(
    (projected: GameState, now: number): { unlocked: Achievement[]; rows: UnlockedAchievement[] } => {
      const unlocked = ACHIEVEMENTS.filter(
        (a) => a.test(projected) && !projected.achievements.includes(a.id),
      )
      if (unlocked.length) {
        const next = [...unlockedHereRef.current, ...unlocked.map((a) => a.id)]
        unlockedHereRef.current = next
        setUnlockedHere(next)
      }
      return {
        unlocked,
        rows: unlocked.map((a) => ({ achievementId: a.id, subject: 'typing', unlockedAt: now })),
      }
    },
    [],
  )

  // Record a completed lesson round; returns stars + any new unlocks.
  const recordLesson = useCallback(
    (lessonId: string, result: RoundResult): LessonOutcome => {
      const stars = starRating(result.accuracy, result.wpm)

      // Computed from the ref rather than inside a state updater.
      //
      // This used to build `outcome` inside `setState` and return it
      // afterwards, which only worked because React eagerly evaluates an
      // updater when nothing else is pending. The moment a second round landed
      // before a re-render, the updater was deferred, `outcome` was still
      // undefined, and the caller read `.stars` off it. An updater has to be
      // pure and may be skipped, replayed, or run later; nothing outside is
      // allowed to depend on when it ran.
      const prev = stateRef.current
      const merged = foldRound(prev.lessons[lessonId], result, stars)
      const nextLessons = { ...prev.lessons, [lessonId]: merged }
      const withRound: GameState = {
        ...prev,
        lessons: nextLessons,
        totalStars: totalStarsOf(nextLessons),
      }
      const now = Date.now()
      const { unlocked, rows } = unlockAgainst(withRound, now)

      // Keep every ref in step so two rounds recorded back to back build on
      // each other rather than both starting from the same snapshot.
      const nextPending = { ...pendingRef.current, [lessonId]: merged }
      pendingRef.current = nextPending
      setPending(nextPending)
      stateRef.current = {
        ...withRound,
        achievements: [...withRound.achievements, ...unlocked.map((a) => a.id)],
      }

      const previous = skill('typing')
      const blended =
        previous.totalAttempts > 0
          ? previous.ability * 0.7 + typingAbilityFrom(result.wpm, result.accuracy) * 0.3
          : typingAbilityFrom(result.wpm, result.accuracy)
      const session: SessionRecord = {
        id: newSessionId(),
        subject: 'typing',
        activity: 'lesson',
        listId: lessonId,
        isTest: true,
        itemsTotal: result.totalTyped,
        itemsCorrect: result.correct,
        // Every keystroke was checked by the app, so the whole round is
        // evidence — which is what lets it earn a collectible.
        verifiedItemsTotal: result.totalTyped,
        verifiedItemsCorrect: result.correct,
        accuracy: result.accuracy,
        score: result.score,
        wpm: result.wpm,
        durationMs: result.elapsedMs,
        abilityBefore: previous.ability,
        abilityAfter: blended,
        meta: { stars, maxCombo: result.maxCombo },
        startedAt: now - result.elapsedMs,
        endedAt: now,
      }

      // Asked before the round is in the snapshot, so it is not its own
      // predecessor for the once-per-lesson rule.
      const earnedCollectible = earnsCollectible(session, snapshot.sessions)

      void commit({
        skill: updateStreak(
          {
            ...previous,
            ability: blended,
            totalAttempts: previous.totalAttempts + result.totalTyped,
            totalCorrect: previous.totalCorrect + result.correct,
          },
          todayString(),
        ),
        session,
        list: typingListChange(snapshot, lessonId, result, stars, now),
        daily: {
          subject: 'typing',
          seconds: Math.round(result.elapsedMs / 1000),
          items: result.totalTyped,
          correct: result.correct,
        },
        ...(rows.length ? { achievements: rows } : {}),
      })

      return {
        ...result,
        lessonId,
        stars,
        newAchievements: unlocked,
        earnedCollectible,
      }
    },
    [commit, skill, snapshot, unlockAgainst],
  )

  const addHighScore = useCallback(
    (entry: HighScore): Achievement[] => {
      // Same reasoning as recordLesson: what this returns cannot be assembled
      // inside the state updater, because nothing guarantees the updater has
      // run by the time the caller reads the result.
      const prev = stateRef.current
      const withScore: GameState = { ...prev, highScores: rankScores([...prev.highScores, entry]) }
      const { unlocked, rows } = unlockAgainst(withScore, entry.date)
      stateRef.current = {
        ...withScore,
        achievements: [...withScore.achievements, ...unlocked.map((a) => a.id)],
      }

      void commit({
        highScore: {
          id: newSessionId(),
          subject: 'typing',
          mode: entry.mode,
          score: entry.score,
          wpm: entry.wpm,
          accuracy: entry.accuracy,
          createdAt: entry.date,
        },
        ...(rows.length ? { achievements: rows } : {}),
      })

      return unlocked
    },
    [commit, unlockAgainst],
  )

  const unlockedAchievements = useMemo(
    () => ACHIEVEMENTS.filter((a) => state.achievements.includes(a.id)),
    [state.achievements],
  )

  return {
    state,
    setSetting,
    recordLesson,
    addHighScore,
    unlockedAchievements,
  }
}

export type GameApi = ReturnType<typeof useGameState>
