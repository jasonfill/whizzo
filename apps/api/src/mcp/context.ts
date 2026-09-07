// What every tool call runs with: the grant behind the token, the learners it
// may act for, and which one this call is about.
//
// Every tool runs in the context of one child (docs/mcp-tutor-spec.md). With
// one child nothing is asked; with several, the parent names one, or names one
// once with `select_learner` and the grant remembers.

import { bandForGrade, type Learner, type MaturityBand } from '@whizzo/shared'
import { withAdmin, withUser, type Queryable } from '../db.js'
import { toLearner } from '../mappers.js'

export interface Grant {
  id: string
  userId: string
  clientId: string
  clientLabel: 'claude' | 'chatgpt' | 'other'
  learnerIds: string[]
  currentLearnerId: string | null
  scope: string
}

export interface ToolContext {
  grant: Grant
  /** The assistant's own name for itself, when it said. */
  clientName: string | null
  /** Where a tool notes something worth a human's attention, e.g. a discarded round. */
  log?: (msg: string, err?: unknown) => void
}

/**
 * A tool that needs a learner and was not told which. Not an error: the
 * result is a question, and the assistant asks it.
 */
export class NeedsLearner extends Error {
  constructor(readonly options: Array<{ id: string; name: string }>) {
    super('Which learner?')
    this.name = 'NeedsLearner'
  }
}

/** A tool refused something. Reported to the assistant as text, never as a crash. */
export class ToolRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRefused'
  }
}

export async function loadGrant(grantId: string): Promise<Grant | null> {
  return withAdmin(async (db) => {
    const { rows } = await db.query(
      `select g.id, g.user_id, g.client_id, g.client_label, g.learner_ids, g.current_learner_id, g.scope
         from public.mcp_grants g
        where g.id = $1 and g.revoked_at is null`,
      [grantId],
    )
    const row = rows[0] as
      | { id: string; user_id: string; client_id: string; client_label: string; learner_ids: string[]; current_learner_id: string | null; scope: string }
      | undefined
    if (!row) return null
    // Once a minute, not once a call: this row is read on every tool call and
    // a write per read would double the endpoint's cost for a timestamp.
    await db.query(
      `update public.mcp_grants set last_used_at = now()
        where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
      [grantId],
    )
    return {
      id: row.id,
      userId: row.user_id,
      clientId: row.client_id,
      clientLabel: (row.client_label as Grant['clientLabel']) ?? 'other',
      learnerIds: row.learner_ids,
      currentLearnerId: row.current_learner_id,
      scope: row.scope,
    }
  })
}

export interface LearnerInContext {
  learner: Learner
  band: MaturityBand
  firstName: string
}

/**
 * The learners this grant may act for that the caller can still reach. Both
 * halves matter: the grant narrows to what was agreed at consent, and RLS
 * narrows to what the account can see today — a child removed from a tutor's
 * link disappears from the tutor's assistant without this code knowing.
 */
export async function grantedLearners(db: Queryable, grant: Grant): Promise<Learner[]> {
  const { rows } = await db.query(
    `select l.*, public.is_learner_covered(l.id) as covered
       from public.learners l
      where l.id = any($1::uuid[])
      order by l.created_at asc`,
    [grant.learnerIds],
  )
  return rows.map(toLearner)
}

function firstName(learner: Learner): string {
  return learner.displayName.trim().split(/\s+/)[0] || learner.displayName
}

export function inContext(learner: Learner): LearnerInContext {
  return { learner, band: bandForGrade(learner.gradeHint), firstName: firstName(learner) }
}

/**
 * Which learner this call is about.
 *
 * By name when one was given ("Maya", "may", or an id); otherwise the grant's
 * remembered choice; otherwise the only one there is. When none of those
 * settles it, the assistant is handed the question to ask.
 */
export async function resolveLearner(
  db: Queryable,
  grant: Grant,
  named: string | null | undefined,
): Promise<LearnerInContext> {
  const learners = await grantedLearners(db, grant)
  if (!learners.length) throw new ToolRefused('This connection no longer reaches any learner. Reconnect from Whizzo.')

  if (named?.trim()) {
    const needle = named.trim().toLowerCase()
    const byId = learners.find((l) => l.id === needle)
    if (byId) return inContext(byId)
    const exact = learners.filter((l) => l.displayName.toLowerCase() === needle || firstName(l).toLowerCase() === needle)
    if (exact.length === 1 && exact[0]) return inContext(exact[0])
    const prefix = learners.filter((l) => firstName(l).toLowerCase().startsWith(needle))
    if (prefix.length === 1 && prefix[0]) return inContext(prefix[0])
    throw new NeedsLearner(learners.map((l) => ({ id: l.id, name: l.displayName })))
  }

  if (grant.currentLearnerId) {
    const current = learners.find((l) => l.id === grant.currentLearnerId)
    if (current) return inContext(current)
  }
  if (learners.length === 1 && learners[0]) return inContext(learners[0])
  throw new NeedsLearner(learners.map((l) => ({ id: l.id, name: l.displayName })))
}

export async function rememberLearner(grantId: string, learnerId: string): Promise<void> {
  await withAdmin(async (db) => {
    await db.query('update public.mcp_grants set current_learner_id = $2 where id = $1', [grantId, learnerId])
  })
}

/** Run `fn` as the grant's user, with RLS in force — the same path every route takes. */
export function asUser<T>(grant: Grant, fn: (db: Queryable) => Promise<T>): Promise<T> {
  return withUser(grant.userId, fn)
}
