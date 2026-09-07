// Writing a round of practice.
//
// Lifted out of the progress route so a round recorded by the API itself — a
// tutor round run through an assistant (docs/mcp-tutor-spec.md) — goes through
// exactly the same code as a round the browser sends: the same verification
// rule, the same derived counts, the same append-only insert, and the same
// three functions that close tasks, goals and rewards in the same transaction.
// Two write paths would be two chances for the evidence to mean different
// things depending on where it came from.

import type { AttemptChannel } from '@whizzo/shared'
import { deriveSessionCounts, withVerifiedFlag } from '@whizzo/shared'
import type { Queryable } from './db.js'
import { notFound } from './errors.js'
import { iso } from './progressMappers.js'
import type { ItemMasteryInput, ProgressChangeInput, SkillStateInput } from './schemas.js'
import { insertMany } from './sql.js'

/**
 * Confirm the learner is visible to this caller before doing anything else.
 *
 * Without it a write for an invisible learner would simply affect no rows and
 * report success, which is a confusing lie. RLS still does the enforcing; this
 * only turns silence into a 404.
 */
export async function assertVisible(db: Queryable, learnerId: string): Promise<void> {
  const { rows } = await db.query('select 1 from public.learners where id = $1', [learnerId])
  if (!rows.length) throw notFound('No such learner')
}

export async function writeSkill(
  db: Queryable,
  learnerId: string,
  skill: SkillStateInput,
): Promise<void> {
  await db.query(
    `insert into public.skill_states
       (learner_id, subject, track, ability, ability_sd, level_index, placed,
        total_attempts, total_correct, streak_days, best_streak_days,
        last_active_on, settings, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     on conflict (learner_id, subject, track) do update set
       ability = excluded.ability,
       ability_sd = excluded.ability_sd,
       level_index = excluded.level_index,
       placed = excluded.placed,
       total_attempts = excluded.total_attempts,
       total_correct = excluded.total_correct,
       streak_days = excluded.streak_days,
       best_streak_days = excluded.best_streak_days,
       last_active_on = excluded.last_active_on,
       settings = excluded.settings,
       updated_at = now()`,
    [
      learnerId,
      skill.subject,
      // '' is the whole-subject pool, which is what every row meant before
      // tracks — and what spelling and typing still mean.
      skill.track ?? '',
      skill.ability,
      skill.abilitySd,
      skill.levelIndex,
      skill.placed,
      skill.totalAttempts,
      skill.totalCorrect,
      skill.streakDays,
      skill.bestStreakDays,
      skill.lastActiveOn,
      JSON.stringify(skill.settings ?? {}),
    ],
  )
}

export async function writeMastery(
  db: Queryable,
  learnerId: string,
  items: ItemMasteryInput[],
): Promise<void> {
  await insertMany(
    db,
    'public.item_mastery',
    [
      'learner_id', 'subject', 'item_key', 'list_id', 'difficulty', 'mastery', 'reps',
      'lapses', 'correct_streak', 'total_attempts', 'total_correct', 'interval_days',
      'due_on', 'first_seen_at', 'last_seen_at',
    ],
    items.map((m) => [
      learnerId, m.subject, m.itemKey, m.listId, m.difficulty, m.mastery, m.reps,
      m.lapses, m.correctStreak, m.totalAttempts, m.totalCorrect, m.intervalDays,
      m.dueOn, iso(m.firstSeenAt), iso(m.lastSeenAt),
    ]),
    `on conflict (learner_id, subject, item_key) do update set
       list_id = excluded.list_id,
       difficulty = excluded.difficulty,
       mastery = excluded.mastery,
       reps = excluded.reps,
       lapses = excluded.lapses,
       correct_streak = excluded.correct_streak,
       total_attempts = excluded.total_attempts,
       total_correct = excluded.total_correct,
       interval_days = excluded.interval_days,
       due_on = excluded.due_on,
       last_seen_at = excluded.last_seen_at`,
  )
}

/**
 * Store one round: the attempts, the session they belong to, and everything
 * the round changed. `channel` says where it came from, and is the server's
 * to set — a caller does not get to describe its own evidence.
 */
export async function writeProgressChange(
  db: Queryable,
  learnerId: string,
  change: ProgressChangeInput,
  channel: AttemptChannel,
): Promise<void> {
  // The attempts are the record; everything else in the payload is the
  // client's summary of them. Before anything is stored, the two are made to
  // agree — with the attempts winning.
  //
  // `verified` is settled first, because it is a property of the mode the
  // answer was given in rather than something a caller may assert: a
  // flashcard graded by the learner is self-reported however the request
  // describes it.
  const attempts = (change.attempts ?? []).map(withVerifiedFlag)
  const derived = deriveSessionCounts(attempts)
  const session = change.session
    ? {
        ...change.session,
        // A session that arrived without attempts keeps the counts it came
        // with — for typing rounds the summary really is the finest grain —
        // and is labelled so nothing downstream mistakes it for evidence.
        ...(derived ?? { evidence: 'client' as const }),
      }
    : undefined


    if (change.skill) await writeSkill(db, learnerId, change.skill)
    // A review round crosses decks and moves each card's own pool.
    for (const state of change.skills ?? []) await writeSkill(db, learnerId, state)
    if (change.mastery?.length) await writeMastery(db, learnerId, change.mastery)

    if (change.list) {
      const l = change.list
      await db.query(
        `insert into public.list_progress
           (learner_id, subject, list_id, plays, tests_taken, best_score,
            best_accuracy, stars, mastered_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (learner_id, subject, list_id) do update set
           plays = excluded.plays,
           tests_taken = excluded.tests_taken,
           best_score = excluded.best_score,
           best_accuracy = excluded.best_accuracy,
           stars = excluded.stars,
           mastered_at = excluded.mastered_at,
           updated_at = now()`,
        [learnerId, l.subject, l.listId, l.plays, l.testsTaken, l.bestScore,
         l.bestAccuracy, l.stars, iso(l.masteredAt)],
      )
    }

    if (session) {
      const s = session
      await db.query(
        `insert into public.sessions
           (id, learner_id, subject, activity, list_id, is_test, items_total,
            items_correct, accuracy, score, wpm, duration_ms, ability_before,
            ability_after, meta, started_at, ended_at,
            evidence, verified_items_total, verified_items_correct, track)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (id) do update set
           items_total = excluded.items_total,
           items_correct = excluded.items_correct,
           accuracy = excluded.accuracy,
           score = excluded.score,
           wpm = excluded.wpm,
           duration_ms = excluded.duration_ms,
           ability_after = excluded.ability_after,
           meta = excluded.meta,
           ended_at = excluded.ended_at,
           evidence = excluded.evidence,
           verified_items_total = excluded.verified_items_total,
           verified_items_correct = excluded.verified_items_correct`,
        [s.id, learnerId, s.subject, s.activity, s.listId, s.isTest, s.itemsTotal,
         s.itemsCorrect, s.accuracy, s.score, s.wpm, s.durationMs,
         s.abilityBefore, s.abilityAfter, JSON.stringify(s.meta ?? {}),
         iso(s.startedAt), iso(s.endedAt),
         s.evidence ?? 'client', s.verifiedItemsTotal ?? 0,
         s.verifiedItemsCorrect ?? 0, s.track ?? null],
      )
    }

    // Append-only, and enforced as such: 0007 revokes update and delete on
    // this table from everyone, so this insert is the only way a row ever
    // gets here and no later request can revise it.
    if (attempts.length) {
      await insertMany(
        db,
        'public.attempts',
        ['learner_id', 'session_id', 'subject', 'item_key', 'activity', 'is_test',
         'verified', 'correct', 'response_ms', 'hints_used', 'difficulty', 'given',
         'created_at', 'track', 'asked_at', 'channel'],
        attempts.map((a) => [
          learnerId, session?.id ?? null, a.subject, a.itemKey, a.activity, a.isTest,
          a.verified, a.correct, a.responseMs, a.hintsUsed, a.difficulty, a.given,
          iso(a.at), a.track ?? null, a.askedAt ?? null, channel,
        ]),
      )
    }

    // Close any task this round satisfied, in the same transaction that
    // recorded it. Done in the database rather than here because the check
    // has to read the session row it just wrote — and because "done" should
    // be impossible to say without one.
    if (session) {
      await db.query('select public.complete_matching_assignments($1, $2)', [learnerId, session.id])
      // And any goal this round tipped over. Separate because it is a
      // different question: an activity task asks "did they do it", a goal
      // asks "do they know it" — and one good afternoon must not answer the
      // second one.
      await db.query('select public.close_met_goals($1, $2)', [learnerId, session.id])
      // And any promise this round came good on. There is no endpoint for
      // this: earning is derived from evidence, never asserted by anybody.
      await db.query('select public.award_matching_rewards($1, $2)', [learnerId, session.id])
    }

    if (change.achievements?.length) {
      await insertMany(
        db,
        'public.achievements',
        ['learner_id', 'achievement_id', 'subject', 'unlocked_at'],
        change.achievements.map((a) => [learnerId, a.achievementId, a.subject, iso(a.unlockedAt)]),
        'on conflict (learner_id, achievement_id) do nothing',
      )
    }

    if (change.highScore) {
      const h = change.highScore
      await db.query(
        `insert into public.high_scores (learner_id, subject, mode, score, wpm, accuracy)
         values ($1,$2,$3,$4,$5,$6)`,
        [learnerId, h.subject, h.mode, h.score, h.wpm, h.accuracy],
      )
    }

    // The daily strip is a rollup of the same evidence, so it is corrected
    // the same way rather than being left to disagree with the session it
    // came from.
    if (change.daily && derived) {
      change.daily = {
        ...change.daily,
        items: derived.itemsTotal,
        correct: derived.itemsCorrect,
      }
    }

    if (change.daily) {
      const d = change.daily
      await db.query('select public.bump_daily_activity($1,$2,$3,$4,$5)', [
        learnerId, d.subject, Math.round(d.seconds), d.items, d.correct,
      ])
    }
}
