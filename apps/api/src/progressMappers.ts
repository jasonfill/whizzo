// Row shapes to domain shapes for everything under a learner's progress.
//
// This mapping used to live in the browser, next to the Supabase client. It
// belongs here now: the API is the only thing that sees a row, so it is the
// only thing that should know what a row looks like.

import type {
  Assignment,
  Attempt,
  CustomWordList,
  DailyActivityRow,
  HighScoreRow,
  ItemMastery,
  ListProgress,
  QuizDeck,
  SessionRecord,
  SkillState,
  UnlockedAchievement,
} from '@whizzo/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postgres hands back Date objects for timestamptz; the wire wants epoch ms. */
function epoch(value: any): number {
  if (!value) return 0
  return value instanceof Date ? value.getTime() : Date.parse(String(value)) || 0
}

function epochOrNull(value: any): number | null {
  if (!value) return null
  return epoch(value)
}

/** A `date` column arrives as a Date; the domain wants 'YYYY-MM-DD'. */
export function dayOf(value: any): string | null {
  return dayString(value)
}

function dayString(value: any): string | null {
  if (!value) return null
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

export function toSkill(row: any): SkillState {
  return {
    subject: row.subject,
    // The empty string is the whole-subject row, which is what every row meant
    // before tracks existed. Left off the domain object rather than sent as ''
    // so nothing downstream has to know that.
    ...(row.track ? { track: row.track } : {}),
    ability: Number(row.ability),
    abilitySd: Number(row.ability_sd),
    levelIndex: row.level_index,
    placed: row.placed,
    totalAttempts: row.total_attempts,
    totalCorrect: row.total_correct,
    streakDays: row.streak_days,
    bestStreakDays: row.best_streak_days,
    lastActiveOn: dayString(row.last_active_on),
    settings: row.settings ?? {},
  }
}

export function toMastery(row: any): ItemMastery {
  return {
    subject: row.subject,
    itemKey: row.item_key,
    listId: row.list_id,
    difficulty: Number(row.difficulty),
    mastery: Number(row.mastery),
    reps: row.reps,
    lapses: row.lapses,
    correctStreak: row.correct_streak,
    totalAttempts: row.total_attempts,
    totalCorrect: row.total_correct,
    intervalDays: Number(row.interval_days),
    dueOn: dayString(row.due_on),
    firstSeenAt: epoch(row.first_seen_at),
    lastSeenAt: epoch(row.last_seen_at),
  }
}

export function toList(row: any): ListProgress {
  return {
    subject: row.subject,
    listId: row.list_id,
    plays: row.plays,
    testsTaken: row.tests_taken,
    bestScore: row.best_score,
    bestAccuracy: Number(row.best_accuracy),
    stars: row.stars,
    masteredAt: epochOrNull(row.mastered_at),
  }
}

export function toSession(row: any): SessionRecord {
  return {
    id: row.id,
    subject: row.subject,
    activity: row.activity,
    listId: row.list_id,
    isTest: row.is_test,
    itemsTotal: row.items_total,
    itemsCorrect: row.items_correct,
    accuracy: Number(row.accuracy ?? 0),
    score: row.score,
    wpm: row.wpm,
    durationMs: row.duration_ms,
    abilityBefore: row.ability_before === null ? null : Number(row.ability_before),
    abilityAfter: row.ability_after === null ? null : Number(row.ability_after),
    meta: row.meta ?? {},
    startedAt: epoch(row.started_at),
    endedAt: epoch(row.ended_at),
    evidence: row.evidence ?? 'legacy',
    verifiedItemsTotal: row.verified_items_total ?? 0,
    verifiedItemsCorrect: row.verified_items_correct ?? 0,
    track: row.track ?? null,
  }
}

/**
 * One recorded answer. Read back so a grown-up can see what actually happened
 * in a round rather than the score it ended on.
 */
export function toAttempt(row: any): Attempt {
  return {
    subject: row.subject,
    track: row.track ?? null,
    itemKey: row.item_key,
    activity: row.activity,
    askedAt: row.asked_at ?? null,
    isTest: row.is_test,
    verified: row.verified,
    correct: row.correct,
    responseMs: row.response_ms,
    hintsUsed: row.hints_used,
    difficulty: row.difficulty === null ? 0 : Number(row.difficulty),
    given: row.given,
    at: epoch(row.created_at),
    sessionId: row.session_id,
    channel: row.channel ?? 'app',
  }
}

/** Reads a row of the assignments-joined-to-sets view; see assignmentSelect. */
export function toAssignment(row: any): Assignment {
  return {
    id: row.id,
    setId: row.set_id,
    learnerId: row.learner_id,
    createdBy: row.created_by,
    subject: row.subject,
    activity: row.activity,
    goal: row.goal ?? null,
    targetId: row.target_id,
    size: row.size,
    title: row.title,
    note: row.note,
    minAccuracy: row.min_accuracy,
    dueOn: dayString(row.due_on),
    sortOrder: row.sort_order,
    status: row.status,
    completedAt: epochOrNull(row.completed_at),
    sessionId: row.session_id,
    createdAt: epoch(row.created_at),
  }
}

export function toAchievement(row: any): UnlockedAchievement {
  return {
    achievementId: row.achievement_id,
    subject: row.subject,
    unlockedAt: epoch(row.unlocked_at),
  }
}

export function toHighScore(row: any): HighScoreRow {
  return {
    id: row.id,
    subject: row.subject,
    mode: row.mode,
    score: row.score,
    wpm: row.wpm,
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    createdAt: epoch(row.created_at),
  }
}

export function toDaily(row: any): DailyActivityRow {
  return {
    day: dayString(row.day) ?? '',
    subject: row.subject,
    seconds: row.seconds,
    items: row.items,
    correct: row.correct,
    sessions: row.sessions,
  }
}

export function toDeck(row: any): QuizDeck {
  return {
    id: row.id,
    track: row.track ?? null,
    objectives: row.objectives ?? [],
    sourceId: row.source_id ?? null,
    // Only present on the queries that join it; a set read on its own is not
    // worth a join for a heading nothing is about to draw.
    sourceTitle: row.source_title ?? null,
    title: row.title,
    description: row.description ?? '',
    tags: row.tags ?? [],
    cards: row.cards ?? [],
    source: 'user',
    termLabel: row.term_label ?? 'Term',
    definitionLabel: row.definition_label ?? 'Definition',
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  }
}

export function toCustomList(row: any): CustomWordList {
  return {
    id: row.id,
    track: row.track ?? null,
    objectives: row.objectives ?? [],
    title: row.title,
    subject: row.subject,
    grade: row.grade,
    words: row.words ?? [],
    updatedAt: epoch(row.updated_at),
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** ISO string from epoch ms, for writing back. */
export function iso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  return new Date(ms).toISOString()
}
