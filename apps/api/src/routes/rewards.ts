// Promises a grown-up makes, and settling them.
//
// The route surface mirrors the one asymmetry the whole feature rests on:
// **there is no endpoint for marking a reward earned.** Earning happens in
// `award_matching_rewards`, in the same transaction as the round that caused
// it, from evidence the app checked. What a grown-up can do is offer one,
// withdraw one, and say they have handed it over — and that last one is
// recorded as a claim, with their name on it.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withUser } from '../db.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { checkCriterion, type Reward } from '@whizzo/shared'

const uuid = z.string().uuid('That is not a valid id')

const criterionSchema = z.object({
  type: z.enum([
    'assignment',
    'set_mastered',
    'mastery_count',
    'checkpoint',
    'streak',
    'verified_items',
    'minutes',
  ]),
  targetId: z.string().max(80).nullable().optional(),
  threshold: z.number().positive().max(100_000).optional(),
})

const newRewardSchema = z.object({
  learnerId: uuid,
  title: z.string().trim().min(1).max(80),
  note: z.string().max(300).nullable().optional(),
  kind: z.enum(['direct', 'store']).default('direct'),
  criterion: criterionSchema,
  maxAwards: z.number().int().min(1).max(52).default(1),
  period: z.enum(['week', 'month']).nullable().optional(),
  expiresOn: z.string().max(10).nullable().optional(),
})

/* eslint-disable @typescript-eslint/no-explicit-any */
function toReward(row: any): Reward {
  const ms = (v: unknown) => (v ? Date.parse(String(v)) : null)
  return {
    id: row.id,
    learnerId: row.learner_id,
    createdBy: row.created_by ?? null,
    title: row.title,
    note: row.note ?? null,
    kind: row.kind,
    criterion: row.criterion,
    maxAwards: row.max_awards,
    awardsMade: row.awards_made,
    status: row.status,
    offeredAt: ms(row.offered_at) ?? 0,
    expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
    earnedAt: ms(row.earned_at),
    sessionId: row.session_id ?? null,
    fulfilledAt: ms(row.fulfilled_at),
    fulfilledBy: row.fulfilled_by ?? null,
    fulfilledNote: row.fulfilled_note ?? null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function rewardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  /** Everything promised to one child, whoever promised it. */
  app.get('/learners/:id/rewards', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    return withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select * from public.rewards
          where learner_id = $1
          order by case status when 'earned' then 0 when 'claimed' then 0
                               when 'offered' then 1 else 2 end,
                   earned_at asc nulls last, offered_at desc`,
        [id],
      )
      return { rewards: rows.map(toReward) }
    })
  })

  /**
   * Offer one.
   *
   * The criterion is checked here rather than only in the form, because a form
   * is a suggestion and this is the boundary. The check that matters is whether
   * the learner could satisfy it with content they wrote themselves.
   */
  app.post('/rewards', async (request, reply) => {
    const caller = callerOf(request)
    const body = newRewardSchema.parse(request.body)

    return withUser(caller.id, async (db) => {
      // Is the target something the learner made? A set they wrote themselves
      // is not evidence of anything.
      let learnerOwnsTarget = false
      let targetItemCount: number | undefined
      if (body.criterion.targetId && body.criterion.type !== 'assignment') {
        const { rows } = await db.query(
          `select learner_id, jsonb_array_length(cards) as cards
             from public.decks where id::text = $1`,
          [body.criterion.targetId],
        )
        if (rows.length) {
          learnerOwnsTarget = rows[0].learner_id === body.learnerId
          targetItemCount = Number(rows[0].cards ?? 0)
        }
      }

      const problem = checkCriterion(body.criterion, { learnerOwnsTarget, targetItemCount })
      if (problem) throw badRequest(problem.reason, 'bad_criterion')

      const { rows } = await db.query(
        `insert into public.rewards
           (learner_id, created_by, title, note, kind, criterion, max_awards, period, expires_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning *`,
        [
          body.learnerId, caller.id, body.title, body.note ?? null, body.kind,
          JSON.stringify(body.criterion), body.maxAwards, body.period ?? null,
          body.expiresOn ?? null,
        ],
      )
      reply.code(201)
      return { reward: toReward(rows[0]) }
    })
  })

  /**
   * Say it has been handed over.
   *
   * The one place in the app where a grown-up asserts something the system
   * cannot check. It is recorded exactly like a learner's self-grade: with a
   * time and a name on it, so the record says who claimed what.
   */
  app.post('/rewards/:id/fulfill', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    const { note } = z
      .object({ note: z.string().max(200).nullable().optional() })
      .parse(request.body ?? {})

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.rewards where id = $1', [id])
      if (!rows.length) throw notFound('No such reward')
      const reward = toReward(rows[0])

      // The payer settles their own debt. A tutor cannot know whether a parent
      // bought the ice cream, and a parent cannot settle a tutor's promise.
      if (reward.createdBy !== caller.id) {
        throw forbidden('Only whoever promised this can mark it given.')
      }
      if (reward.status !== 'earned' && reward.status !== 'claimed') {
        throw badRequest('That has not been earned yet.', 'not_earned')
      }

      const updated = await db.query(
        `update public.rewards
            set status = 'fulfilled', fulfilled_at = now(),
                fulfilled_by = $2, fulfilled_note = $3, updated_at = now()
          where id = $1 returning *`,
        [id, caller.id, note ?? null],
      )
      return { reward: toReward(updated.rows[0]) }
    })
  })

  /**
   * Withdraw one.
   *
   * Only before it is earned. Once a promise has come due it cannot be taken
   * back — a child who watched an ice cream disappear has learned something
   * about this app we do not want them to learn.
   */
  app.post('/rewards/:id/cancel', async (request) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.rewards set status = 'canceled', updated_at = now()
          where id = $1 and status = 'offered' returning *`,
        [id],
      )
      if (!rows.length) {
        const existing = await db.query('select status from public.rewards where id = $1', [id])
        if (!existing.rows.length) throw notFound('No such reward')
        throw badRequest(
          'That one has already been earned. It cannot be taken back.',
          'already_earned',
        )
      }
      return { reward: toReward(rows[0]) }
    })
  })
}
