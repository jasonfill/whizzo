import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newlyUnlocked, type QuizAchievement } from '../data/quizAchievements'
import {
  applyAttemptToMastery,
  expectedCorrect,
  updateAbility,
  updateStreak,
} from '../lib/adaptive'
import { useProgress } from '../lib/progress/ProgressProvider'
import { useLiveRound } from './useLiveRound'
import { applyChange, type ProgressChange } from '../lib/progress/repo'
import {
  cardKey,
  listKey,
  masteryKey,
  todayString,
  type Attempt,
  type HighScoreRow,
  type ItemMastery,
  type ListProgress,
  type QuizDeck,
  type SessionRecord,
  type SkillState,
} from '../lib/progress/types'
import { skillKey } from '@whizzo/shared'
import { buildQuestion, type Grade, type Question, type QuestionKind } from '../lib/quiz/questions'

/**
 * Which rung a question kind asks at.
 *
 * Kept here rather than in the catalog because it is about a *question*, not
 * an activity: one round of Learn contains several of these.
 */
function askedRung(kind: QuestionKind): 0 | 1 | 2 | 3 {
  switch (kind) {
    case 'multiple-choice':
    case 'true-false':
      return 1
    case 'letter-hint':
    case 'word-bank':
      return 2
    case 'written':
      return 3
  }
  // Exhaustive on purpose rather than defaulted. A `default: return 3` would
  // read any future question kind as unaided recall and promote items on
  // evidence that does not exist — a mistake that fails toward numbers looking
  // good. This way adding a kind is a compile error until it is classified.
  const unclassified: never = kind
  throw new Error(`Unclassified question kind: ${String(unclassified)}`)
}
import {
  modeDef,
  planStudy,
  requeuePolicy,
  type DirectionSetting,
  type PlannedCard,
  type StudyMode,
} from '../lib/quiz/session'

export interface QuizItemResult {
  planned: PlannedCard
  question: Question
  given: string
  /** 'close' is a near miss — credited, but counted separately in the summary. */
  grade: Grade
  correct: boolean
  /**
   * How long the answer took. Null where there is no per-card time to record —
   * free recall is one box for the whole set, and inventing a number would put
   * noise into the fluency reading.
   */
  responseMs: number | null
  hintsUsed: number
  /** False when the learner graded themselves, which is flashcards and only flashcards. */
  verified: boolean
  /** Which try at this card this was, within this round. 1 is the first sighting. */
  pass: number
  /** True when the miss put the card back in the queue to be seen again. */
  requeued: boolean
}

export interface QuizSummary {
  mode: StudyMode
  deckId: string | null
  deckTitle: string
  /** Every attempt in the round, in order — a requeued card appears more than once. */
  results: QuizItemResult[]
  /**
   * The cards the learner did not resolve: still wrong on their last try, or
   * parked after too many attempts. This is what "worth another look" means
   * now that a miss gets a second chance inside the round.
   */
  unresolved: QuizItemResult[]
  /** Distinct cards, and how many were right *first time* — repeats do not dilute it. */
  itemsTotal: number
  itemsCorrect: number
  /** Missed at first sight, then got right before the round was out. */
  retiredAfterMiss: number
  nearMisses: number
  accuracy: number
  predictedAccuracy: number
  score: number
  stars: number
  durationMs: number
  abilityBefore: number
  abilityAfter: number
  /** Cards that went from "not mastered" to "mastered" in this round. */
  newlyMastered: string[]
  newAchievements: QuizAchievement[]
}

export interface StartQuizOptions {
  mode: StudyMode
  decks: QuizDeck[]
  deckId?: string
  size?: number
  direction?: DirectionSetting
}

/**
 * Stars are graded against what the model predicted for this exact set of
 * cards, not a flat percentage — the same reasoning as the spelling module.
 * A learner working through brand new material is meant to miss things.
 */
function starsFor(accuracy: number, predicted: number): number {
  if (accuracy >= 95 || accuracy >= predicted + 10) return 3
  if (accuracy >= 75 || accuracy >= predicted - 5) return 2
  return 1
}

/**
 * Harder cards and unaided recall are worth more, and streaks compound.
 *
 * **A self-graded answer scores nothing.** Flashcards are the one mode where
 * the learner grades themselves, and a score is a payout surface: it feeds
 * high scores, stars and — once rewards ship — things a parent actually hands
 * over. A learner tapping "Got it" through a deck they do not know must not be
 * able to score their way to a prize. Flashcards still award the thing they are
 * for, which is having practiced.
 */
export function scoreFor(results: QuizItemResult[]): number {
  let score = 0
  let streak = 0
  for (const r of results) {
    if (!r.verified) continue
    if (!r.correct) {
      streak = 0
      continue
    }
    streak += 1
    const difficultyBonus = Math.round(r.planned.card.difficulty * 6)
    const recallBonus = r.question.kind === 'written' ? 12 : r.question.kind === 'true-false' ? 2 : 6
    const streakBonus = Math.min(streak, 8) * 5
    const hintPenalty = r.hintsUsed * 4
    score += Math.max(5, 15 + difficultyBonus + recallBonus + streakBonus - hintPenalty)
  }
  return score
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useQuizSession() {
  // Anybody working through this set from another screen. Silent and free when
  // nobody is: see useLiveRound.
  const live = useLiveRound()
  const roundIdRef = useRef<string | null>(null)

  const { snapshot, skill, commit } = useProgress()

  const [plan, setPlan] = useState<PlannedCard[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [results, setResults] = useState<QuizItemResult[]>([])
  const [summary, setSummary] = useState<QuizSummary | null>(null)
  const [options, setOptions] = useState<StartQuizOptions | null>(null)

  /**
   * A round is a queue of plan indices, not a walk from 0 to the end.
   *
   * When a card is missed it goes back into the queue a few places ahead, so
   * the round finishes when every card has been retired rather than when the
   * cards run out. Showing somebody the answer and then never asking again is
   * the one thing a study app should not do.
   *
   * The queue lives in refs because a screen submits an answer and then asks
   * "is there another card?" inside the same event handler — React state would
   * still be describing the previous question. `walk` is the render-visible
   * copy, published from the refs whenever they move, so what is drawn and what
   * the handlers act on can never disagree.
   */
  const queueRef = useRef<number[]>([])
  const cursorRef = useRef(0)
  /** Tries so far per plan index, which is what caps the requeue loop. */
  const passesRef = useRef(new Map<number, number>())
  const [walk, setWalk] = useState<{ queue: number[]; cursor: number }>({ queue: [], cursor: 0 })
  const publish = useCallback(
    () => setWalk({ queue: queueRef.current, cursor: cursorRef.current }),
    [],
  )

  const startedAtRef = useRef(0)
  const itemStartedAtRef = useRef(0)
  const state = skill('quiz')

  const start = useCallback(
    (opts: StartQuizOptions) => {
      const planned = planStudy(snapshot, {
        mode: opts.mode,
        decks: opts.decks,
        deckId: opts.deckId,
        size: opts.size,
        direction: opts.direction,
      })

      // Questions are built once, up front. Building them per render would
      // reshuffle the multiple-choice options on every keystroke.
      const byDeck = new Map(opts.decks.map((d) => [d.id, d]))
      const built = planned.map((p) =>
        buildQuestion(p.card, byDeck.get(p.deckId)?.cards ?? [], p.kind, p.direction),
      )

      setOptions(opts)
      setPlan(planned)
      setQuestions(built)
      setResults([])
      setSummary(null)
      queueRef.current = planned.map((_, i) => i)
      cursorRef.current = 0
      passesRef.current = new Map()
      publish()
      startedAtRef.current = Date.now()
      itemStartedAtRef.current = Date.now()

      const roundId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      roundIdRef.current = roundId
      live.begin({
        roundId,
        activity: opts.mode,
        subject: 'quiz',
        title: opts.decks.length === 1 ? (opts.decks[0]?.title ?? 'a deck') : `${opts.decks.length} decks`,
        cards: planned.length,
      })
      return planned
    },
    [live, publish, snapshot],
  )

  const beginItem = useCallback(() => {
    itemStartedAtRef.current = Date.now()
  }, [])

  /**
   * Record an answer, and put the card back in the queue if it was missed and
   * the mode works that way.
   *
   * `verified` defaults to true because every mode but flashcards checks the
   * answer itself. Flashcards passes false, and that one flag is what stops a
   * learner grading their way to mastery — see blendSelfReport in adaptive.ts.
   */
  const submit = useCallback(
    (
      given: string,
      grade: Grade,
      opts: { hintsUsed?: number; verified?: boolean } = {},
    ): QuizItemResult | null => {
      const planIndex = queueRef.current[cursorRef.current]
      const planned = plan[planIndex]
      const question = questions[planIndex]
      if (!planned || !question) return null

      const pass = (passesRef.current.get(planIndex) ?? 0) + 1
      passesRef.current.set(planIndex, pass)

      // A near miss counts. The learner recalled the answer; penalizing a
      // transposed letter on a biology deck tests typing, not biology.
      const correct = grade !== 'wrong'
      const policy = options ? requeuePolicy(options.mode) : null
      const requeued = !correct && policy !== null && pass < policy.maxPasses

      if (requeued && policy) {
        // Far enough ahead that the answer has left short-term memory. Slotting
        // it in rather than appending keeps the round from ending on a run of
        // nothing but the cards they found hardest.
        const at = Math.min(cursorRef.current + policy.gap, queueRef.current.length)
        const next = [...queueRef.current]
        next.splice(at, 0, planIndex)
        queueRef.current = next
      }

      const result: QuizItemResult = {
        planned,
        question,
        given,
        grade,
        correct,
        responseMs: Math.max(0, Date.now() - itemStartedAtRef.current),
        hintsUsed: opts.hintsUsed ?? 0,
        verified: opts.verified ?? true,
        pass,
        requeued,
      }
      setResults((prev) => [...prev, result])
      // The answer, and how it went. `verified: false` is flashcards marking
      // its own work, which is worth showing a watcher as exactly that.
      if (roundIdRef.current) {
        live.card({
          roundId: roundIdRef.current,
          at: cursorRef.current + 1,
          cards: plan.length,
          prompt: question.prompt,
          outcome: grade === 'correct' ? 'right' : grade,
          answer: question.answer,
          selfGraded: !result.verified,
          responseMs: result.responseMs,
        })
      }
      publish()
      return result
    },
    [live, options, plan, publish, questions],
  )

  /**
   * Record a whole free-recall round at once.
   *
   * Recall does not walk a queue — the learner writes what they can and every
   * card in the set is judged against it — so this turns that one answer into
   * one result per card. The misses matter most: a card nobody could bring to
   * mind is exactly the signal the review schedule exists to catch, and
   * dropping them would make the format feel gentler and teach less.
   */
  const submitRecall = useCallback(
    (recall: { matched: Array<{ card: { id: string }; exact: boolean }>; missed: Array<{ id: string }> }) => {
      const got = new Map(recall.matched.map((m) => [m.card.id, m]))
      const rows: QuizItemResult[] = []

      plan.forEach((planned, i) => {
        const question = questions[i]
        if (!question) return
        const hit = got.get(planned.card.id)
        rows.push({
          planned,
          question,
          given: hit ? planned.card.definition : '',
          grade: hit ? (hit.exact ? 'correct' : 'close') : 'wrong',
          correct: Boolean(hit),
          responseMs: null,
          hintsUsed: 0,
          verified: true,
          pass: 1,
          requeued: false,
        })
      })

      setResults(rows)
      publish()
      return rows
    },
    [plan, publish, questions],
  )

  /** Move to the next card. Returns false when that was the last one. */
  const advance = useCallback(() => {
    cursorRef.current += 1
    itemStartedAtRef.current = Date.now()
    publish()
    return cursorRef.current < queueRef.current.length
  }, [publish])

  const { queue, cursor } = walk
  const index = queue[cursor] ?? -1
  const current = plan[index] ?? null
  const currentQuestion = questions[index] ?? null
  const isLast = cursor >= queue.length - 1
  const isComplete = plan.length > 0 && cursor >= queue.length

  /**
   * The card on screen, sent as the learner arrives at it.
   *
   * A watcher's view mirrors theirs — same card, same position — which is what
   * makes talking about it possible from two screens. The answer is withheld
   * until the learner has answered, the same rule the voice tutor works under:
   * nobody gets the answer before the person whose turn it is.
   */
  const showCard = live.card
  useEffect(() => {
    if (!roundIdRef.current || !currentQuestion) return
    showCard({
      roundId: roundIdRef.current,
      at: cursor + 1,
      cards: plan.length,
      prompt: currentQuestion.prompt,
      outcome: null,
      answer: null,
      selfGraded: false,
      responseMs: null,
    })
  }, [cursor, currentQuestion, showCard, plan.length])

  /**
   * What the learner sees as progress. Cards retired out of the deck, not
   * questions ticked off a list — under a requeue those are different numbers,
   * and the honest one is how many cards they have actually put away.
   */
  const progress = useMemo(() => {
    const remaining = new Set(queue.slice(cursor)).size
    return {
      retired: plan.length - remaining,
      total: plan.length,
      remaining,
      /**
       * Which sighting of this card the learner is looking at. Counted from
       * the queue rather than from attempts recorded, so that answering does
       * not tick it over while the answer is still on screen.
       */
      pass: queue.slice(0, cursor + 1).filter((i) => i === index).length,
    }
  }, [cursor, index, plan.length, queue])

  /**
   * Turn a finished round into progress.
   *
   * Two different flags are at work and they are deliberately not the same one:
   *   * mastery and the review schedule move on every honest attempt, because
   *     recognizing a card is still evidence about that card;
   *   * the learner's overall ability only moves on unaided recall — a written
   *     answer with no hint. Multiple choice is recognition, and a run of lucky
   *     four-way guesses should not read as getting cleverer.
   */
  const finish = useCallback(
    async (
      finalResults?: QuizItemResult[],
      extra?: { highScore?: Omit<HighScoreRow, 'id' | 'createdAt'>; meta?: Record<string, unknown> },
    ): Promise<QuizSummary | null> => {
      const rows = finalResults ?? results
      if (!options || rows.length === 0) return null

      const def = modeDef(options.mode)
      const now = Date.now()
      const today = todayString()
      const durationMs = Math.max(0, now - startedAtRef.current)

      // One ability estimate per pool touched. A round pinned to one deck
      // moves one; a review round crosses decks and moves each card's own,
      // because a Spanish answer is not evidence about biology and averaging
      // them is the exact problem tracks were added to fix.
      const pools = new Map<string, SkillState>()
      const poolFor = (track: string): SkillState => {
        const key = track
        const existing = pools.get(key)
        if (existing) return existing
        const seeded: SkillState =
          snapshot.skills[skillKey('quiz', track)] ??
          // A pool nobody has worked in yet starts from the learner's existing
          // whole-subject estimate rather than from the default — the same
          // seeding `seed_track_ability` does server-side. Nobody restarts
          // from zero the day their decks get filed.
          ({ ...state, track } as SkillState)
        const copy = { ...seeded, track }
        pools.set(key, copy)
        return copy
      }

      let working: SkillState = { ...state }
      const abilityBefore = working.ability

      const attempts: Attempt[] = []
      const masteryUpdates = new Map<string, ItemMastery>()
      const newlyMastered: string[] = []

      // Which pool this work counts toward, per card. A review round crosses
      // decks, so this is looked up per attempt rather than once per round —
      // a Spanish card and a biology card in the same sitting belong to
      // different pools and must not be averaged together.
      const trackOfDeck = new Map(options.decks.map((d) => [d.id, d.track ?? null]))

      for (const r of rows) {
        const key = cardKey(r.planned.deckId, r.planned.card.id)
        const graded = r.hintsUsed === 0

        const attempt: Attempt = {
          subject: 'quiz',
          itemKey: key,
          activity: options.mode,
          isTest: graded,
          verified: r.verified,
          correct: r.correct,
          responseMs: r.responseMs,
          hintsUsed: r.hintsUsed,
          difficulty: r.planned.card.difficulty,
          given: r.given,
          at: now,
          // What was actually asked, not just which mode was running. Learn
          // asks each card at its own rung, so the mode alone would read a
          // scaffolded answer back as unaided recall.
          askedAt: askedRung(r.question.kind),
          track: trackOfDeck.get(r.planned.deckId) ?? null,
        }
        attempts.push(attempt)

        // Unaided, checked, written recall is the only thing that moves the
        // estimate. `verified` is redundant with `def.isTest` today — no graded
        // mode self-reports — but the rule belongs where it is enforced.
        // Unaided production only. A scaffolded answer is real practice and
        // moves the card's mastery and its schedule; it does not move the
        // learner's level, because half the answer was on the screen.
        const movesAbility = graded && r.verified && def.isTest && r.question.kind === 'written'
        if (movesAbility) {
          // Unfiled work has no pool of its own — the whole-subject estimate
          // below already is that pool, so there is nothing extra to move.
          const track = trackOfDeck.get(r.planned.deckId) ?? null
          if (track) {
            const pool = poolFor(track)
            const poolUpdate = updateAbility(pool, r.planned.card.difficulty, r.correct)
            pools.set(track, {
              ...pool,
              ability: poolUpdate.ability,
              abilitySd: poolUpdate.abilitySd,
              totalAttempts: pool.totalAttempts + 1,
              totalCorrect: pool.totalCorrect + (r.correct ? 1 : 0),
            })
          }

          const update = updateAbility(working, r.planned.card.difficulty, r.correct)
          working = {
            ...working,
            ability: update.ability,
            abilitySd: update.abilitySd,
            totalAttempts: working.totalAttempts + 1,
            totalCorrect: working.totalCorrect + (r.correct ? 1 : 0),
          }
        }

        const masteryStoreKey = masteryKey('quiz', key)
        const previous = masteryUpdates.get(masteryStoreKey) ?? snapshot.mastery[masteryStoreKey]
        const next = applyAttemptToMastery(previous, attempt, {
          today,
          ability: working.ability,
        })
        masteryUpdates.set(masteryStoreKey, { ...next, listId: r.planned.deckId })

        if ((previous?.mastery ?? 0) < 0.8 && next.mastery >= 0.8) {
          newlyMastered.push(r.planned.card.term)
        }
      }

      working = updateStreak(working, today)
      // Quiz has no curriculum ladder to be placed on, but the flag still marks
      // "this learner has done graded work", which the home screen reads.
      if (!working.placed && def.isTest) working = { ...working, placed: true }

      // A card can appear more than once now, so the headline is scored on
      // first sight of each card. Otherwise a learner who missed one and then
      // drilled it three times would read as worse than one who never went
      // back to it, which would punish exactly the behavior this is for.
      const firstAttempts: QuizItemResult[] = []
      const lastAttempt = new Map<string, QuizItemResult>()
      const seen = new Set<string>()
      for (const r of rows) {
        const key = cardKey(r.planned.deckId, r.planned.card.id)
        if (!seen.has(key)) {
          seen.add(key)
          firstAttempts.push(r)
        }
        lastAttempt.set(key, r)
      }

      const itemsTotal = firstAttempts.length
      const itemsCorrect = firstAttempts.filter((r) => r.correct).length
      const unresolved = [...lastAttempt.values()].filter((r) => !r.correct)
      const retiredAfterMiss = firstAttempts.filter((r) => {
        if (r.correct) return false
        const key = cardKey(r.planned.deckId, r.planned.card.id)
        return lastAttempt.get(key)?.correct === true
      }).length
      const nearMisses = firstAttempts.filter((r) => r.grade === 'close').length
      const accuracy = Math.round((itemsCorrect / itemsTotal) * 100)
      const score = scoreFor(rows)
      const predictedAccuracy = Math.round(
        (firstAttempts.reduce(
          (sum, r) => sum + expectedCorrect(abilityBefore, r.planned.card.difficulty),
          0,
        ) /
          itemsTotal) *
          100,
      )
      const stars = starsFor(accuracy, predictedAccuracy)
      const deckId = options.deckId ?? null
      const deckTitle = options.deckId
        ? (options.decks.find((d) => d.id === options.deckId)?.title ?? 'Deck')
        : 'Review'

      // A round pinned to one deck belongs to that deck's pool. A review round
      // crosses decks by design, so it belongs to none and says so rather than
      // picking one of them arbitrarily.
      const sessionTrack = deckId ? (trackOfDeck.get(deckId) ?? null) : null

      const sessionRecord: SessionRecord = {
        id: newSessionId(),
        subject: 'quiz',
        track: sessionTrack,
        activity: options.mode,
        listId: deckId,
        isTest: def.isTest,
        itemsTotal,
        itemsCorrect,
        accuracy,
        score,
        wpm: null,
        durationMs,
        abilityBefore,
        abilityAfter: working.ability,
        meta: {
          predictedAccuracy,
          nearMisses,
          deckTitle,
          // Distinct cards vs. tries taken: the gap between them is how much
          // work the requeue actually did.
          attemptsTotal: rows.length,
          retiredAfterMiss,
          unresolved: unresolved.length,
          ...extra?.meta,
        },
        startedAt: startedAtRef.current,
        endedAt: now,
      }

      // Per-deck progress, so a deck can show stars and a best score.
      let listProgress: ListProgress | undefined
      if (deckId) {
        const existing = snapshot.lists[listKey('quiz', deckId)]
        const deck = options.decks.find((d) => d.id === deckId)
        const allMastered =
          !!deck &&
          deck.cards.length > 0 &&
          deck.cards.every((c) => {
            const k = masteryKey('quiz', cardKey(deckId, c.id))
            return ((masteryUpdates.get(k) ?? snapshot.mastery[k])?.mastery ?? 0) >= 0.8
          })
        listProgress = {
          subject: 'quiz',
          listId: deckId,
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
        // Every pool this round moved. The whole-subject estimate above is
        // kept as well: spelling and typing read it, the home screen quotes
        // it, and a learner who has filed nothing has only that one.
        skills: [...pools.values()],
        mastery: [...masteryUpdates.values()],
        attempts,
        session: sessionRecord,
        list: listProgress,
        daily: {
          subject: 'quiz',
          seconds: Math.round(durationMs / 1000),
          items: itemsTotal,
          correct: itemsCorrect,
        },
      }

      if (extra?.highScore) {
        change.highScore = {
          ...extra.highScore,
          id: newSessionId(),
          createdAt: now,
        }
      }

      const projected = applyChange(snapshot, change, now)
      const owned = new Set(projected.achievements.map((a) => a.achievementId))
      const unlocked = newlyUnlocked(projected, working, owned)
      if (unlocked.length) {
        change.achievements = unlocked.map((a) => ({
          achievementId: a.id,
          subject: 'quiz',
          unlockedAt: now,
        }))
      }

      await commit(change)

      if (roundIdRef.current) {
        live.end({ roundId: roundIdRef.current, cards: itemsTotal, correct: itemsCorrect })
        roundIdRef.current = null
      }

      const built: QuizSummary = {
        mode: options.mode,
        deckId,
        deckTitle,
        results: rows,
        unresolved,
        itemsTotal,
        itemsCorrect,
        retiredAfterMiss,
        nearMisses,
        accuracy,
        predictedAccuracy,
        score,
        stars,
        durationMs,
        abilityBefore,
        abilityAfter: working.ability,
        newlyMastered,
        newAchievements: unlocked,
      }
      setSummary(built)
      return built
    },
    [commit, live, options, results, snapshot, state],
  )

  const reset = useCallback(() => {
    setPlan([])
    setQuestions([])
    setResults([])
    setSummary(null)
    setOptions(null)
    queueRef.current = []
    cursorRef.current = 0
    passesRef.current = new Map()
    publish()
  }, [publish])

  /**
   * What is in the answer box, for anybody working through this with them.
   *
   * Call it freely on every change — useLiveRound holds it until typing pauses,
   * and drops it entirely when nobody is there.
   */
  const draft = useCallback(
    (text: string) => {
      if (roundIdRef.current) live.draft(roundIdRef.current, cursorRef.current + 1, text)
    },
    [live],
  )

  return useMemo(
    () => ({
      plan,
      questions,
      /** Index into `plan` of the card on screen. */
      index,
      /** Position in the round's queue. Strictly increasing, so it is the effect key. */
      cursor,
      progress,
      current,
      currentQuestion,
      results,
      summary,
      options,
      isLast,
      isComplete,
      state,
      start,
      beginItem,
      submit,
      submitRecall,
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
      questions,
      index,
      cursor,
      progress,
      current,
      currentQuestion,
      results,
      summary,
      options,
      isLast,
      isComplete,
      state,
      start,
      beginItem,
      submit,
      submitRecall,
      advance,
      finish,
      reset,
      draft,
      live.watched,
      live.watcherNames,
    ],
  )
}

export type QuizSessionApi = ReturnType<typeof useQuizSession>
