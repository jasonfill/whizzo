import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GRADES, gradeAt, wordsInGrade, type CurriculumWord } from '../data/spelling'
import { newlyUnlocked, type SpellingAchievement } from '../data/spellingAchievements'
import {
  applyAttemptToMastery,
  evaluateLevel,
  expectedCorrect,
  masteryBand,
  placeLevel,
  updateAbility,
  updateStreak,
  type LevelDecision,
} from '../lib/adaptive'
import { useProgress } from '../lib/progress/ProgressProvider'
import { useLiveRound } from './useLiveRound'
import { applyChange, type ProgressChange } from '../lib/progress/repo'
import {
  defaultSkillState,
  listKey,
  masteryKey,
  todayString,
  type Attempt,
  type ItemMastery,
  type ListProgress,
  type SessionRecord,
  type SkillState,
} from '../lib/progress/types'
import { activity as activityDef, type ActivityId } from '../lib/spelling/activities'
import { planSession, type PlannedWord, type SessionMode } from '../lib/spelling/session'

export interface ItemResult {
  word: PlannedWord
  given: string
  correct: boolean
  responseMs: number
  hintsUsed: number
}

export interface SessionSummary {
  activity: ActivityId
  mode: SessionMode
  listId: string | null
  results: ItemResult[]
  itemsTotal: number
  itemsCorrect: number
  accuracy: number
  /** What the model expected the learner to score on this word set, 0-100. */
  predictedAccuracy: number
  score: number
  stars: number
  durationMs: number
  abilityBefore: number
  abilityAfter: number
  level: LevelDecision
  gradeBefore: number
  gradeAfter: number
  newAchievements: SpellingAchievement[]
}

export interface StartOptions {
  activity: ActivityId
  mode: SessionMode
  listId?: string
  customWords?: CurriculumWord[]
  size?: number
}

/**
 * Stars are graded on a curve against what the model predicted for this exact
 * set of words. A learner practicing at their frontier is meant to miss things —
 * scoring them against a flat 90% would hand out one star forever and teach them
 * that working at their level is failure. Beating your own prediction earns the
 * third star, whatever your grade.
 */
function starsFor(accuracy: number, predicted: number): number {
  if (accuracy >= 95 || accuracy >= predicted + 10) return 3
  if (accuracy >= 75 || accuracy >= predicted - 5) return 2
  return 1
}

/** Harder words are worth more, and a clean streak compounds. */
function scoreFor(results: ItemResult[]): number {
  let score = 0
  let streak = 0
  for (const r of results) {
    if (!r.correct) {
      streak = 0
      continue
    }
    streak += 1
    const difficultyBonus = Math.round(r.word.difficulty * 6)
    const streakBonus = Math.min(streak, 8) * 5
    const hintPenalty = r.hintsUsed * 4
    score += Math.max(5, 20 + difficultyBonus + streakBonus - hintPenalty)
  }
  return score
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * The sentence a word is read out in, with the word itself taken out.
 *
 * A watching grown-up needs something to follow — "word 4 of 12" alone is not
 * enough to talk about — but the sentence contains the answer, and handing that
 * over before the learner has tried breaks the rule the rest of the app works
 * under. So the word is blanked until they answer, and the answer travels with
 * the outcome.
 */
function maskWord(sentence: string, word: string): string {
  if (!sentence || !word) return sentence
  return sentence.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____')
}

export function useSpellingSession() {
  const { snapshot, skill, commit } = useProgress()
  // Anybody working through this list from another screen. Silent and free when
  // nobody is: see useLiveRound.
  const live = useLiveRound()
  const roundIdRef = useRef<string | null>(null)

  const [plan, setPlan] = useState<PlannedWord[]>([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<ItemResult[]>([])
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [options, setOptions] = useState<StartOptions | null>(null)

  const startedAtRef = useRef(0)
  const itemStartedAtRef = useRef(0)
  const state = skill('spelling')

  const start = useCallback(
    (opts: StartOptions) => {
      const words = planSession(snapshot, state, {
        mode: opts.mode,
        listId: opts.listId,
        customWords: opts.customWords,
        size: opts.size,
      })
      setOptions(opts)
      setPlan(words)
      setIndex(0)
      setResults([])
      setSummary(null)
      startedAtRef.current = Date.now()
      itemStartedAtRef.current = Date.now()

      const roundId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      roundIdRef.current = roundId
      live.begin({
        roundId,
        activity: opts.activity,
        subject: 'spelling',
        title: words[0]?.listTitle ?? 'Spelling',
        cards: words.length,
      })
      return words
    },
    [live, snapshot, state],
  )

  /** Call as the learner is shown each word, so response time is honest. */
  const beginItem = useCallback(() => {
    itemStartedAtRef.current = Date.now()
  }, [])

  const submit = useCallback(
    (given: string, correct: boolean, hintsUsed = 0): ItemResult | null => {
      const word = plan[index]
      if (!word) return null
      const result: ItemResult = {
        word,
        given,
        correct,
        responseMs: Math.max(0, Date.now() - itemStartedAtRef.current),
        hintsUsed,
      }
      setResults((prev) => [...prev, result])
      if (roundIdRef.current) {
        live.card({
          roundId: roundIdRef.current,
          at: index + 1,
          cards: plan.length,
          prompt: maskWord(word.s, word.w),
          outcome: correct ? 'right' : 'wrong',
          // Now that they have answered, the word itself.
          answer: word.w,
          // Spelling has no self-graded mode: every answer here was typed and
          // checked against the word.
          selfGraded: false,
          responseMs: result.responseMs,
        })
      }
      return result
    },
    [index, live, plan],
  )

  const advance = useCallback(() => {
    setIndex((i) => i + 1)
    itemStartedAtRef.current = Date.now()
  }, [])

  const current = plan[index] ?? null
  const isLast = index >= plan.length - 1
  const isComplete = index >= plan.length && plan.length > 0

  /**
   * The word they are on, sent as they arrive at it.
   *
   * `watched` is a dependency on purpose: somebody joining part-way through
   * gets the current word straight away rather than a blank screen until the
   * learner moves on.
   */
  const showCard = live.card
  const watched = live.watched
  useEffect(() => {
    if (!roundIdRef.current || !current) return
    showCard({
      roundId: roundIdRef.current,
      at: index + 1,
      cards: plan.length,
      prompt: maskWord(current.s, current.w),
      outcome: null,
      answer: null,
      selfGraded: false,
      responseMs: null,
    })
  }, [current, index, plan.length, showCard, watched])

  /** What is in the answer box, held until typing pauses. */
  const draft = useCallback(
    (text: string) => {
      if (roundIdRef.current) live.draft(roundIdRef.current, index + 1, text)
    },
    [index, live],
  )

  /**
   * Turn the round into progress. Everything downstream — ability, mastery,
   * the schedule, the level, achievements — is computed here from the actual
   * results, then written as one change.
   */
  const finish = useCallback(
    async (finalResults?: ItemResult[]): Promise<SessionSummary | null> => {
      const rows = finalResults ?? results
      if (!options || rows.length === 0) return null

      const def = activityDef(options.activity)
      const now = Date.now()
      const today = todayString()
      const endedAt = now
      const durationMs = Math.max(0, endedAt - startedAtRef.current)

      let working: SkillState = { ...state }
      const abilityBefore = working.ability

      const attempts: Attempt[] = []
      const masteryUpdates = new Map<string, ItemMastery>()

      for (const r of rows) {
        const attempt: Attempt = {
          subject: 'spelling',
          itemKey: r.word.w,
          activity: options.activity,
          // Only unaided, graded work moves the ability estimate. A word the
          // learner unscrambled with the letters in front of them is practice,
          // not evidence of independent spelling.
          isTest: def.isTest && r.hintsUsed === 0,
          // Spelling has no self-graded mode: every answer here was typed and
          // checked against the word.
          verified: true,
          correct: r.correct,
          responseMs: r.responseMs,
          hintsUsed: r.hintsUsed,
          difficulty: r.word.difficulty,
          given: r.given,
          at: now,
        }
        attempts.push(attempt)

        if (attempt.isTest) {
          const update = updateAbility(working, r.word.difficulty, r.correct)
          working = {
            ...working,
            ability: update.ability,
            abilitySd: update.abilitySd,
            totalAttempts: working.totalAttempts + 1,
            totalCorrect: working.totalCorrect + (r.correct ? 1 : 0),
          }
        }

        const key = masteryKey('spelling', r.word.w)
        const previous = masteryUpdates.get(key) ?? snapshot.mastery[key]
        const next = applyAttemptToMastery(previous, attempt, {
          today,
          ability: working.ability,
        })
        masteryUpdates.set(key, { ...next, listId: r.word.listId })
      }

      working = updateStreak(working, today)

      // Placement: the first graded round sets the starting grade band rather
      // than making a strong speller crawl up from second grade.
      if (!working.placed && def.isTest) {
        working = {
          ...working,
          placed: true,
          levelIndex:
            options.mode === 'placement'
              ? placeLevel(
                  working.ability,
                  GRADES.map((g) => g.grade),
                )
              : working.levelIndex,
        }
      }

      // Level decision, using the freshly updated mastery numbers.
      const mergedMastery = { ...snapshot.mastery }
      for (const [k, v] of masteryUpdates) mergedMastery[k] = v

      const gradeBefore = gradeAt(working.levelIndex).grade
      const levelWords = wordsInGrade(gradeBefore)
      const levelMastered =
        levelWords.filter(
          (w) => masteryBand(mergedMastery[masteryKey('spelling', w.w)]) === 'mastered',
        ).length / Math.max(1, levelWords.length)
      const levelAttempts = levelWords.reduce(
        (n, w) => n + (mergedMastery[masteryKey('spelling', w.w)]?.reps ?? 0),
        0,
      )
      const gradedRows = rows.filter((r) => def.isTest && r.hintsUsed === 0)
      const roundAccuracy =
        gradedRows.length > 0
          ? gradedRows.filter((r) => r.correct).length / gradedRows.length
          : rows.filter((r) => r.correct).length / rows.length

      const decision = evaluateLevel({
        state: working,
        levelDifficulty: gradeBefore,
        levelCount: GRADES.length,
        levelMastered,
        levelAttempts,
        recentAccuracy: roundAccuracy,
      })
      working = { ...working, levelIndex: decision.levelIndex }

      // Round metrics.
      const itemsTotal = rows.length
      const itemsCorrect = rows.filter((r) => r.correct).length
      const accuracy = Math.round((itemsCorrect / itemsTotal) * 100)
      const score = scoreFor(rows)
      const predictedAccuracy = Math.round(
        (rows.reduce((sum, r) => sum + expectedCorrect(abilityBefore, r.word.difficulty), 0) /
          rows.length) *
          100,
      )
      const stars = starsFor(accuracy, predictedAccuracy)

      const sessionRecord: SessionRecord = {
        id: newSessionId(),
        subject: 'spelling',
        activity: options.activity,
        listId: options.listId ?? null,
        isTest: def.isTest,
        itemsTotal,
        itemsCorrect,
        accuracy,
        score,
        wpm: null,
        durationMs,
        abilityBefore,
        abilityAfter: working.ability,
        meta: { mode: options.mode, level: decision.direction, predictedAccuracy },
        startedAt: startedAtRef.current,
        endedAt,
      }

      // Unit progress, when the learner picked a specific list.
      let listProgress: ListProgress | undefined
      if (options.listId) {
        const existing = snapshot.lists[listKey('spelling', options.listId)]
        const listWords = plan.map((w) => w.w)
        const allMastered = listWords.every(
          (w) => masteryBand(mergedMastery[masteryKey('spelling', w)]) === 'mastered',
        )
        listProgress = {
          subject: 'spelling',
          listId: options.listId,
          plays: (existing?.plays ?? 0) + 1,
          testsTaken: (existing?.testsTaken ?? 0) + (def.isTest ? 1 : 0),
          bestScore: Math.max(existing?.bestScore ?? 0, score),
          bestAccuracy: Math.max(existing?.bestAccuracy ?? 0, accuracy),
          stars: Math.max(existing?.stars ?? 0, stars),
          masteredAt: existing?.masteredAt ?? (allMastered ? now : null),
        }
      }

      const change: ProgressChange = {
        skill: working,
        mastery: [...masteryUpdates.values()],
        attempts,
        session: sessionRecord,
        list: listProgress,
        daily: {
          subject: 'spelling',
          seconds: Math.round(durationMs / 1000),
          items: itemsTotal,
          correct: itemsCorrect,
        },
      }

      // Achievements are checked against the snapshot as it will be after this
      // change lands, so an award never lags a round behind.
      const projected = applyChange(snapshot, change, now)
      const owned = new Set(projected.achievements.map((a) => a.achievementId))
      const unlocked = newlyUnlocked(projected, working, owned)
      if (unlocked.length) {
        change.achievements = unlocked.map((a) => ({
          achievementId: a.id,
          subject: 'spelling',
          unlockedAt: now,
        }))
      }

      await commit(change)

      if (roundIdRef.current) {
        live.end({
          roundId: roundIdRef.current,
          cards: rows.length,
          correct: rows.filter((r) => r.correct).length,
        })
        roundIdRef.current = null
      }

      const built: SessionSummary = {
        activity: options.activity,
        mode: options.mode,
        listId: options.listId ?? null,
        results: rows,
        itemsTotal,
        itemsCorrect,
        accuracy,
        predictedAccuracy,
        score,
        stars,
        durationMs,
        abilityBefore,
        abilityAfter: working.ability,
        level: decision,
        gradeBefore,
        gradeAfter: gradeAt(decision.levelIndex).grade,
        newAchievements: unlocked,
      }
      setSummary(built)
      return built
    },
    [commit, live, options, plan, results, snapshot, state],
  )

  const reset = useCallback(() => {
    setPlan([])
    setIndex(0)
    setResults([])
    setSummary(null)
    setOptions(null)
  }, [])

  return useMemo(
    () => ({
      plan,
      index,
      current,
      results,
      summary,
      options,
      isLast,
      isComplete,
      state: state ?? defaultSkillState('spelling'),
      start,
      beginItem,
      submit,
      advance,
      finish,
      reset,
      draft,
      /** True while somebody else is following this round from another screen. */
      watched: live.watched,
      watcherNames: live.watcherNames,
    }),
    [
      plan,
      index,
      current,
      results,
      summary,
      options,
      isLast,
      isComplete,
      state,
      start,
      beginItem,
      submit,
      advance,
      finish,
      reset,
      draft,
      live.watched,
      live.watcherNames,
    ],
  )
}

export type SpellingSessionApi = ReturnType<typeof useSpellingSession>
