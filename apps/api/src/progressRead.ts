// Reading a learner's material and state.
//
// The queries the snapshot loader and the tutor rounds share. One copy of the
// reach rule for decks — a learner's own, plus library decks set as work — so
// the assistant offers exactly the decks the app shows.

import { skillKey, type ItemMastery, type QuizDeck, type SkillState } from '@whizzo/shared'
import type { Queryable } from './db.js'
import { toDeck, toMastery, toSkill } from './progressMappers.js'

/**
 * The decks a learner can practise: their own, plus any library deck a
 * grown-up has set them as work. RLS allows exactly these rows; the where
 * clause says which of them this learner needs.
 */
export async function decksFor(db: Queryable, learnerId: string): Promise<QuizDeck[]> {
  const { rows } = await db.query(
    `select * from public.decks
      where learner_id = $1
         or (owner_user_id is not null and id in (
               select t.target_id::uuid
                 from public.assignment_sets t
                 join public.assignments a on a.set_id = t.id
                where a.learner_id = $1 and t.subject = 'quiz'
                  and t.target_id ~ '^[0-9a-f-]{36}$'
             ))
      order by updated_at desc`,
    [learnerId],
  )
  return rows.map(toDeck)
}

/** One deck by id, when the learner can reach it. */
export async function deckFor(db: Queryable, learnerId: string, deckId: string): Promise<QuizDeck | null> {
  const decks = await decksFor(db, learnerId)
  return decks.find((d) => d.id === deckId) ?? null
}

/** A learner's quiz mastery rows, by item key. */
export async function masteryFor(db: Queryable, learnerId: string): Promise<Map<string, ItemMastery>> {
  const { rows } = await db.query(
    `select * from public.item_mastery where learner_id = $1 and subject = 'quiz'`,
    [learnerId],
  )
  const map = new Map<string, ItemMastery>()
  for (const row of rows) {
    const m = toMastery(row)
    map.set(m.itemKey, m)
  }
  return map
}

/** A learner's quiz skill states, keyed the way the snapshot keys them. */
export async function skillsFor(db: Queryable, learnerId: string): Promise<Map<string, SkillState>> {
  const { rows } = await db.query(
    `select * from public.skill_states where learner_id = $1 and subject = 'quiz'`,
    [learnerId],
  )
  const map = new Map<string, SkillState>()
  for (const row of rows) {
    const s = toSkill(row)
    map.set(skillKey('quiz', s.track ?? null), s)
  }
  return map
}
