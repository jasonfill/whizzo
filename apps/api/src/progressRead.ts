// Reading a learner's material and state.
//
// The queries the snapshot loader and the tutor rounds share. One copy of the
// reach rule for decks — a learner's own, plus library decks set as work — so
// the assistant offers exactly the decks the app shows.

import { skillKey, type ItemMastery, type QuizDeck, type SkillState } from '@whizzo/shared'
import type { Queryable } from './db.js'
import { toDeck, toMastery, toSkill } from './progressMappers.js'

/**
 * The decks a learner can practice: their own, plus any library deck a
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

/**
 * A library deck some learner outside `$2` has been set as work. A grown-up's
 * library is theirs, but a deck in a child's hands is that child's practice,
 * and a connection scoped to a sibling was not given it — so such a deck is
 * out of reach for reading and for editing alike. Any assignment counts,
 * open or done: the child has progress on it either way.
 */
const HELD_BY_OTHER_LEARNER = `exists (
      select 1 from public.assignment_sets t
        join public.assignments a on a.set_id = t.id
       where t.subject = 'quiz' and t.target_id = d.id::text
         and a.learner_id <> all($2::uuid[]))`

/**
 * The decks in a grown-up's library that a connection scoped to `learnerIds`
 * may reach: the account's own, minus any held by a learner outside the
 * scope. This is where an assistant's drafts land, reachable by no learner
 * until one is set as work.
 */
export async function libraryDecksFor(db: Queryable, userId: string, learnerIds: string[]): Promise<QuizDeck[]> {
  const { rows } = await db.query(
    `select * from public.decks d
      where d.owner_user_id = $1 and not ${HELD_BY_OTHER_LEARNER}
      order by d.updated_at desc`,
    [userId, learnerIds],
  )
  return rows.map(toDeck)
}

/** One library deck by id, under the same reach rule. */
export async function libraryDeckFor(db: Queryable, userId: string, learnerIds: string[], deckId: string): Promise<QuizDeck | null> {
  const { rows } = await db.query(
    `select * from public.decks d
      where d.id = $3 and d.owner_user_id = $1 and not ${HELD_BY_OTHER_LEARNER}`,
    [userId, learnerIds, deckId],
  )
  return rows[0] ? toDeck(rows[0]) : null
}

export interface EditableDeck {
  deck: QuizDeck
  /** Set when the deck is a learner's own rather than a library deck. */
  learnerId: string | null
  /** Whether a grown-up has reviewed and accepted it (never true of a hand-made deck). */
  accepted: boolean
}

/**
 * A deck a connection may change: a learner's own, or a library deck under
 * the reach rule above. A library deck another account shared with the
 * learner is reachable for practice but is not theirs to edit, and does not
 * come back here. RLS still has the last word on the write itself.
 */
export async function editableDeckFor(db: Queryable, userId: string, learnerIds: string[], deckId: string): Promise<EditableDeck | null> {
  const { rows } = await db.query(
    `select * from public.decks d
      where d.id = $3
        and (d.learner_id = any($2::uuid[]) or (d.owner_user_id = $1 and not ${HELD_BY_OTHER_LEARNER}))`,
    [userId, learnerIds, deckId],
  )
  const row = rows[0] as { learner_id: string | null; accepted_at: Date | string | null } | undefined
  if (!row) return null
  return { deck: toDeck(row), learnerId: row.learner_id ?? null, accepted: row.accepted_at != null }
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
