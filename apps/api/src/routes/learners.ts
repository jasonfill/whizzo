// Learners and their guardians.
//
// Every handler runs through `withUser`, so RLS has already decided what the
// caller can see before a single line here executes. That is why a "not found"
// and a "not yours" collapse into the same 404: from inside the transaction
// they are genuinely the same thing, and telling them apart would leak the
// existence of other people's children.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withUser } from '../db.js'
import { badRequest, notFound } from '../errors.js'
import { bandForGrade, PLANNER_BAND, type GuardianRole } from '@whizzo/shared'
import { toGuardian, toLearner } from '../mappers.js'

const uuid = z.string().uuid('That is not a valid id')

/** The invite alphabet: eight characters, no look-alikes. */
const codeString = z
  .string()
  .trim()
  .min(6)
  .max(12)
  .transform((c) => c.toUpperCase())

const newConnectionCodeSchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  role: z.enum(['parent', 'teacher', 'tutor']).default('tutor'),
  canManageContent: z.boolean().default(true),
  /** Absent means it does not expire — a code on a tutor's page should keep working. */
  ttlHours: z.number().int().min(1).max(24 * 365).nullable().optional(),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
})

function toConnectionCode(row: Record<string, unknown>) {
  return {
    code: row.code as string,
    label: (row.label as string | null) ?? null,
    role: row.role as GuardianRole,
    canManageContent: row.can_manage_content as boolean,
    expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
    maxUses: (row.max_uses as number | null) ?? null,
    uses: row.uses as number,
    createdAt: new Date(row.created_at as string).getTime(),
  }
}

const newLearnerSchema = z.object({
  displayName: z.string().trim().min(1, 'A name is required').max(40),
  avatarEmoji: z.string().trim().min(1).max(8).optional(),
  gradeHint: z.number().int().min(0).max(12).nullable().optional(),
  birthYear: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear())
    .nullable()
    .optional(),
})

const patchLearnerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    avatarEmoji: z.string().trim().min(1).max(8).optional(),
    gradeHint: z.number().int().min(0).max(12).nullable().optional(),
    // Not an enum: the set of worlds is a client concept and will grow, and an
    // unknown id already falls back to the default rather than breaking a
    // screen. The column's length check is the backstop.
    theme: z.string().trim().min(1).max(32).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })

const inviteSchema = z.object({
  role: z.enum(['parent', 'teacher']).default('parent'),
  purpose: z.enum(['guardian', 'self_login']).default('guardian'),
  ttlHours: z.number().int().min(1).max(168).default(24),
})

const guardianPatchSchema = z.object({
  canManageContent: z.boolean(),
})

/**
 * How many days this week carry more open minutes than this learner's limit —
 * the learner's own if set, else the band's. The same rule `weekLoad` applies
 * on the planner, so the Family line and the grid agree.
 */
function heavyDays(row: { grade_hint: number | null; daily_minutes: number | null; planner_days: unknown }): number {
  const limit = row.daily_minutes ?? PLANNER_BAND[bandForGrade(row.grade_hint)].dailyMinutes
  const days = Array.isArray(row.planner_days) ? (row.planner_days as Array<{ minutes: number }>) : []
  return days.filter((d) => Number(d.minutes) > limit).length
}

// Input pinned to `unknown` so T binds to the schema's output type.
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message ?? 'That request was not valid')
  }
  return result.data
}

export async function learnerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  // Everyone this caller can see: owned, guarded, or themselves. No filter —
  // the policy is the filter.
  app.get('/learners', async (request) => {
    const caller = callerOf(request)
    const learners = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        // Coverage comes back with the learner because every gate in the app
        // asks about it, and asking per learner per screen would be a query
        // per row on the family dashboard.
        `select l.*, public.is_learner_covered(l.id) as covered
           from public.learners l
          order by l.created_at asc`,
      )
      return rows.map(toLearner)
    })
    return { learners }
  })

  /**
   * One row per child, for the family dashboard.
   *
   * Aggregated here rather than in the browser because the alternative is
   * loading every child's whole progress snapshot to count two things, and a
   * grown-up with four children should not pay for that to see who still has
   * homework.
   *
   * RLS scopes it: the query says "every learner", and the caller gets the ones
   * they are linked to.
   */
  app.get('/learners/overview', async (request) => {
    const caller = callerOf(request)

    const learners = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select
           l.id                                        as learner_id,
           l.display_name,
           l.avatar_emoji,
           coalesce(a.open_count, 0)                   as open_assignments,
           coalesce(a.overdue_count, 0)                as overdue_assignments,
           coalesce(a.done_week, 0)                    as done_this_week,
           s.last_active_at,
           coalesce(d.seconds, 0)                      as seconds_this_week,
           coalesce(d.items, 0)                        as items_this_week,
           v.verified_total,
           v.verified_correct,
           coalesce(k.streak_days, 0)                  as streak_days,
           public.planner_overview(l.id)               as planner,
           l.grade_hint,
           pp.daily_minutes                            as daily_minutes,
           coalesce(h.days, '[]'::jsonb)               as planner_days
         from public.learners l
         left join public.planner_prefs pp on pp.learner_id = l.id

         -- The due date lives on the shared set since 0009, so the count has
         -- to reach through to it.
         left join lateral (
           select
             count(*) filter (where a.status = 'open')                           as open_count,
             count(*) filter (where a.status = 'open'
                                and t.due_on is not null
                                and t.due_on < current_date)                     as overdue_count,
             count(*) filter (where a.status = 'done'
                                and a.completed_at >= now() - interval '7 days') as done_week
           from public.assignments a
           join public.assignment_sets t on t.id = a.set_id
           where a.learner_id = l.id
         ) a on true

         left join lateral (
           select max(ended_at) as last_active_at
           from public.sessions where learner_id = l.id
         ) s on true

         left join lateral (
           select sum(seconds)::int as seconds, sum(items)::int as items
           from public.daily_activity
           where learner_id = l.id and day >= current_date - 6
         ) d on true

         -- Accuracy over checked answers only, so a week of self-graded
         -- flashcards does not read as a week of demonstrated accuracy.
         left join lateral (
           select
             sum(verified_items_total)::int   as verified_total,
             sum(verified_items_correct)::int as verified_correct
           from public.sessions
           where learner_id = l.id and ended_at >= now() - interval '7 days'
         ) v on true

         left join lateral (
           select max(streak_days)::int as streak_days
           from public.skill_states where learner_id = l.id
         ) k on true

         -- Open minutes per day this week. Which days are heavy is decided
         -- below with the shared band table and the learner's own limit, so
         -- Family and the planner never disagree about it.
         left join lateral (
           select jsonb_agg(jsonb_build_object('day', d.on_day, 'minutes', d.mins)) as days
             from (
               select on_day, sum(coalesce(minutes, 0))::int as mins
                 from public.planner_items
                where learner_id = l.id
                  and week_start = current_date - (extract(isodow from current_date)::int - 1)
                  and deleted_at is null and status = 'open'
                  and kind <> 'event' and on_day is not null
                group by on_day
             ) d
         ) h on true

         order by l.created_at asc`,
      )

      return rows.map((row) => ({
        learnerId: row.learner_id,
        displayName: row.display_name,
        avatarEmoji: row.avatar_emoji,
        openAssignments: Number(row.open_assignments),
        overdueAssignments: Number(row.overdue_assignments),
        doneThisWeek: Number(row.done_this_week),
        lastActiveAt: row.last_active_at ? new Date(row.last_active_at).getTime() : null,
        minutesThisWeek: Math.round(Number(row.seconds_this_week) / 60),
        itemsThisWeek: Number(row.items_this_week),
        verifiedAccuracyThisWeek:
          Number(row.verified_total) > 0
            ? Math.round((Number(row.verified_correct) / Number(row.verified_total)) * 100)
            : null,
        currentStreakDays: Number(row.streak_days),
        planner: row.planner ? { ...(row.planner as Record<string, unknown>), heavyDays: heavyDays(row) } : null,
      }))
    })

    return { learners }
  })

  // --- connection codes ----------------------------------------------------
  //
  // A tutor mints one code that stands for them and hands it to families; each
  // family redeems it against a child they own. Minting grants nothing, which
  // is why anyone with an account may do it — the consent is the redeeming.

  app.get('/connection-codes', async (request) => {
    const caller = callerOf(request)
    const codes = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select * from public.connection_codes
          where owner_id = $1 and revoked_at is null
          order by created_at desc`,
        [caller.id],
      )
      return rows.map(toConnectionCode)
    })
    return { codes }
  })

  app.post('/connection-codes', async (request, reply) => {
    const caller = callerOf(request)
    const body = parse(newConnectionCodeSchema, request.body)

    const code = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        'select public.mint_connection_code($1, $2, $3, $4, $5) as code',
        [
          body.label ?? null,
          body.role,
          body.canManageContent,
          body.ttlHours ? `${body.ttlHours} hours` : null,
          body.maxUses ?? null,
        ],
      )
      const { rows: full } = await db.query(
        'select * from public.connection_codes where code = $1',
        [rows[0].code],
      )
      return toConnectionCode(full[0])
    })

    reply.code(201)
    return { code }
  })

  /** Withdraw a code. Families already connected stay connected. */
  app.delete('/connection-codes/:code', async (request, reply) => {
    const caller = callerOf(request)
    const { code } = parse(z.object({ code: codeString }), request.params)

    await withUser(caller.id, async (db) => {
      await db.query(
        `update public.connection_codes set revoked_at = now()
          where code = $1 and owner_id = $2 and revoked_at is null`,
        [code, caller.id],
      )
    })

    reply.code(204)
    return null
  })


  app.post('/learners', async (request, reply) => {
    const caller = callerOf(request)
    const body = parse(newLearnerSchema, request.body)

    const learner = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `insert into public.learners (owner_id, display_name, avatar_emoji, grade_hint, birth_year)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [
          caller.id,
          body.displayName,
          body.avatarEmoji ?? '🐱',
          body.gradeHint ?? null,
          body.birthYear ?? null,
        ],
      )
      const row = rows[0]
      if (!row) throw badRequest('The learner could not be created')
      return toLearner(row)
    })

    reply.code(201)
    return { learner }
  })

  app.patch('/learners/:id', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const body = parse(patchLearnerSchema, request.body)

    const learner = await withUser(caller.id, async (db) => {
      // Built as a sparse update so an absent key means "leave it alone" while
      // an explicit null means "clear it".
      const sets: string[] = []
      const values: unknown[] = []
      const set = (column: string, value: unknown) => {
        values.push(value)
        sets.push(`${column} = $${values.length}`)
      }
      if (body.displayName !== undefined) set('display_name', body.displayName)
      if (body.avatarEmoji !== undefined) set('avatar_emoji', body.avatarEmoji)
      if (body.gradeHint !== undefined) set('grade_hint', body.gradeHint)
      if (body.theme !== undefined) set('theme', body.theme)

      values.push(id)
      const { rows } = await db.query(
        `update public.learners set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      )
      const row = rows[0]
      if (!row) throw notFound('No such learner')
      return toLearner(row)
    })

    return { learner }
  })

  app.delete('/learners/:id', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)

    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query('delete from public.learners where id = $1', [id])
      // Only the owner has a delete policy, so a guardian gets 404 here rather
      // than a 403 — which is the right answer: they cannot delete it, and
      // saying "forbidden" would confirm it exists.
      if (!rowCount) throw notFound('No such learner')
    })

    reply.code(204)
    return null
  })

  // --- guardians -----------------------------------------------------------

  app.get('/learners/:id/guardians', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)

    const guardians = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select g.*, p.display_name
           from public.guardian_links g
           left join public.profiles p on p.id = g.guardian_id
          where g.learner_id = $1
          order by g.created_at asc`,
        [id],
      )
      return rows.map(toGuardian)
    })

    return { guardians }
  })

  app.patch('/learners/:id/guardians/:guardianId', async (request) => {
    const caller = callerOf(request)
    const { id, guardianId } = parse(
      z.object({ id: uuid, guardianId: uuid }),
      request.params,
    )
    const body = parse(guardianPatchSchema, request.body)

    const guardian = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.guardian_links set can_manage_content = $1
          where learner_id = $2 and guardian_id = $3
          returning *`,
        [body.canManageContent, id, guardianId],
      )
      const row = rows[0]
      if (!row) throw notFound('No such guardian link')
      return toGuardian(row)
    })

    return { guardian }
  })

  app.delete('/learners/:id/guardians/:guardianId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, guardianId } = parse(
      z.object({ id: uuid, guardianId: uuid }),
      request.params,
    )

    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query(
        'delete from public.guardian_links where learner_id = $1 and guardian_id = $2',
        [id, guardianId],
      )
      if (!rowCount) throw notFound('No such guardian link')
    })

    reply.code(204)
    return null
  })

  // --- invites -------------------------------------------------------------

  app.post('/learners/:id/invites', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const body = parse(inviteSchema, request.body ?? {})

    const invite = await withUser(caller.id, async (db) => {
      // The RPC is owner-only and raises insufficient_privilege otherwise,
      // which the error mapper turns into a 403.
      const { rows } = await db.query(
        'select public.mint_link_invite($1, $2, $3, $4::interval) as code',
        [id, body.role, body.purpose, `${body.ttlHours} hours`],
      )
      const code = rows[0]?.code as string | undefined
      if (!code) throw badRequest('Could not create an invite')

      const { rows: detail } = await db.query(
        'select expires_at from public.link_invites where code = $1',
        [code],
      )
      return { code, expiresAt: detail[0]?.expires_at ?? null, purpose: body.purpose }
    })

    reply.code(201)
    return { invite }
  })
}

/**
 * Resolving and redeeming a code somebody handed you.
 *
 * Separate from learnerRoutes for one reason: these take a short code typed by
 * a person, which makes them a guess surface, and server.ts registers them
 * behind the same strict limiter as invite redemption. Left where they were,
 * resolving an invite would have been ~300x cheaper to brute-force than
 * redeeming one, which is not a distinction worth offering.
 *
 * The code travels in the body rather than the path, so a live code never
 * reaches an access log, a proxy, or browser history.
 */
export async function codeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  /**
   * Who is behind a code, before anybody accepts it.
   *
   * A person typing eight characters and hoping is not consent, so this says
   * whose code it is and what accepting would actually do. It reveals nothing
   * about the tutor's other students.
   *
   * It resolves every kind of code — a tutor's connection code, an invite to
   * help with a child, a 13+ learner's own account-linking code — because they
   * are indistinguishable on paper, and asking somebody to know which one they
   * were handed is asking them to know something only we know. `kind` tells the
   * client which way to redeem it, and which promise it is allowed to make.
   */
  app.post('/codes/describe', async (request) => {
    const caller = callerOf(request)
    const { code } = parse(z.object({ code: codeString }), request.body)

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.describe_any_code($1)', [code])
      const row = rows[0]
      // No row at all is a fault, not an answer — but it must still read as
      // something a person can act on. A row that says `valid` carries no
      // reason, and must not inherit one.
      if (!row) {
        return {
          kind: 'unknown',
          valid: false,
          reason: 'That code does not exist',
          ownerName: null,
          label: null,
          role: null,
          canManageContent: null,
        }
      }
      return {
        kind: row.kind ?? 'unknown',
        valid: row.valid ?? false,
        reason: row.reason ?? null,
        ownerName: row.owner_name ?? null,
        label: row.label ?? null,
        role: row.role ?? null,
        canManageContent: row.can_manage_content ?? null,
      }
    })
  })

  /**
   * The consent step for a tutor's code: grant them access to one learner.
   *
   * Refused unless the caller owns that learner, which the database checks —
   * a parent for their child, or a 13+ learner acting for themselves.
   */
  app.post('/codes/redeem', async (request) => {
    const caller = callerOf(request)
    const { code, learnerIds } = parse(
      z.object({ code: codeString, learnerIds: z.array(uuid).min(1).max(20) }),
      request.body,
    )

    await withUser(caller.id, async (db) => {
      for (const learnerId of learnerIds) {
        await db.query('select public.redeem_connection_code($1, $2)', [code, learnerId])
      }
    })

    return { connected: learnerIds.length }
  })
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  app.post('/invites/redeem', async (request) => {
    const caller = callerOf(request)
    const { code } = parse(
      z.object({ code: z.string().trim().min(4).max(32) }),
      request.body,
    )

    const learnerId = await withUser(caller.id, async (db) => {
      // A connection code sent here is the commonest way this fails, and
      // "not valid any more" is a lie about a code that is perfectly good —
      // it is simply redeemed the other way round. The app's own code box
      // resolves the kind first and never lands here, so this is for anything
      // else holding the old shape of this endpoint.
      const { rows: kinds } = await db.query(
        'select kind from public.describe_any_code($1)',
        [code.toUpperCase()],
      )
      if (kinds[0]?.kind === 'connection') {
        throw badRequest(
          'That is a tutor or teacher asking to see one of your learners, not an ' +
            'invite to join one. Enter it on the Family screen and choose who they ' +
            'can see.',
          'wrong_code_kind',
        )
      }

      const { rows } = await db.query('select public.redeem_link_invite($1) as learner_id', [
        code.toUpperCase(),
      ])
      return rows[0]?.learner_id as string | undefined
    })

    if (!learnerId) throw badRequest('That code is not valid any more')
    return { learnerId }
  })
}
