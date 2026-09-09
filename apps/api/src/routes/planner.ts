// The weekly planner: courses, the week, tests planned backwards, and the
// history every card keeps.
//
// The shape of the surface follows the two rules the feature rests on:
//
//   * **The planner is the learner's.** Every write is allowed for the learner
//     themselves — the opposite of assignments — and RLS enforces it through
//     can_manage_learner_content(). Everything is attributed: the actor on a
//     card, a tick, a comment is whoever called.
//
//   * **Two kinds of done.** A card with a target is closed by the round that
//     satisfies it, in the round's own transaction, by
//     complete_matching_planner_items(). This file refuses `status: 'done'` on
//     such a card outright. An unlinked card is ticked here, with `done_by`
//     taken from the caller and never from the body.
//
// And the third: there is no route that writes history. planner_events is
// written by triggers; the routes here only read it.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  bandForGrade,
  isMonday,
  MAX_PRIORITIES,
  PLANNER_BAND,
  proposeStudyPlan,
  SORT_GAP,
  weekStartOf,
  activityForPurpose,
  type Assessment,
  type Course,
  type PlannerComment,
  type PlannerEvent,
  type PlannerItem,
  type PlannerPrefs,
  type PlannerWeek,
} from '@whizzo/shared'
import { callerOf, requireCaller } from '../auth.js'
import { publishLearner } from '../live/publish.js'
import { withUser, type Queryable } from '../db.js'
import { badRequest, notFound } from '../errors.js'
import { dayOf, toAssignment } from '../progressMappers.js'

const uuid = z.string().uuid('That is not a valid id')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day looks like 2026-09-07')

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw badRequest(`${where}${issue?.message ?? 'That request was not valid'}`)
  }
  return result.data
}

async function assertVisible(db: Queryable, learnerId: string): Promise<void> {
  const { rows } = await db.query('select 1 from public.learners where id = $1', [learnerId])
  if (!rows.length) throw notFound('No such learner')
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ms = (v: any): number | null => (v ? (v instanceof Date ? v.getTime() : Date.parse(String(v))) : null)

export function toCourse(row: any): Course {
  return {
    id: row.id,
    learnerId: row.learner_id,
    name: row.name,
    track: row.track ?? 'general',
    teacherName: row.teacher_name ?? null,
    period: row.period ?? null,
    color: row.color,
    emoji: row.emoji ?? null,
    termLabel: row.term_label ?? null,
    startsOn: dayOf(row.starts_on),
    endsOn: dayOf(row.ends_on),
    archivedAt: ms(row.archived_at),
    sortOrder: row.sort_order ?? 0,
    createdBy: row.created_by ?? null,
  }
}

export function toPlannerItem(row: any): PlannerItem {
  return {
    id: row.id,
    learnerId: row.learner_id,
    weekStart: dayOf(row.week_start)!,
    onDay: dayOf(row.on_day),
    kind: row.kind,
    title: row.title,
    courseId: row.course_id ?? null,
    assessmentId: row.assessment_id ?? null,
    minutes: row.minutes ?? null,
    purpose: row.purpose ?? null,
    proposed: Boolean(row.proposed),
    target: row.target_id
      ? { subject: row.target_subject, activity: row.target_activity, targetId: row.target_id }
      : null,
    status: row.status,
    doneAt: ms(row.done_at),
    doneBy: row.done_by ?? null,
    sessionId: row.session_id ?? null,
    deletedAt: ms(row.deleted_at),
    sortOrder: row.sort_order ?? 0,
    createdBy: row.created_by ?? null,
    createdAt: ms(row.created_at) ?? 0,
    updatedAt: ms(row.updated_at) ?? 0,
  }
}

export function toAssessment(row: any): Assessment {
  return {
    id: row.id,
    learnerId: row.learner_id,
    courseId: row.course_id ?? null,
    kind: row.kind,
    title: row.title,
    on: dayOf(row.on_day)!,
    difficulty: row.difficulty,
    target: row.target_id ? { subject: row.target_subject, targetId: row.target_id } : null,
    outcome: row.outcome ?? null,
    planGeneratedAt: ms(row.plan_generated_at),
    createdBy: row.created_by ?? null,
    createdAt: ms(row.created_at) ?? 0,
    updatedAt: ms(row.updated_at) ?? 0,
  }
}

export function toPlannerWeek(row: any): PlannerWeek {
  return {
    id: row.id,
    learnerId: row.learner_id,
    weekStart: dayOf(row.week_start)!,
    priorities: row.priorities ?? [],
    wins: row.wins ?? [],
    goals: row.goals ?? [],
    reflection: row.reflection ?? null,
    busyDays: (row.busy_days ?? []).map((d: any) => dayOf(d)!),
    plannedAt: ms(row.planned_at),
    wrappedAt: ms(row.wrapped_at),
  }
}

function toComment(row: any): PlannerComment {
  return {
    id: row.id,
    learnerId: row.learner_id,
    weekStart: dayOf(row.week_start)!,
    itemId: row.item_id ?? null,
    authorId: row.author_id,
    authorName: row.author_name ?? null,
    body: row.body,
    createdAt: ms(row.created_at) ?? 0,
  }
}

function toEvent(row: any): PlannerEvent {
  return {
    id: Number(row.id),
    learnerId: row.learner_id,
    entity: row.entity,
    entityId: row.entity_id,
    at: ms(row.at) ?? 0,
    actorId: row.actor_id ?? null,
    actorName: row.actor_name ?? null,
    kind: row.kind,
    before: row.before ?? null,
    after: row.after ?? null,
    sessionId: row.session_id ?? null,
  }
}

function toPrefs(learnerId: string, row: any): PlannerPrefs {
  return {
    learnerId,
    dailyMinutes: row?.daily_minutes ?? null,
    sessionsPerDay: row?.sessions_per_day ?? null,
    studyDays: row?.study_days ?? [1, 2, 3, 4, 5, 7],
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- schemas ----------------------------------------------------------------

const courseDraftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  track: z.string().max(60).nullable().optional(),
  teacherName: z.string().trim().max(80).nullable().optional(),
  period: z.string().trim().max(40).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().trim().max(8).nullable().optional(),
  termLabel: z.string().trim().max(40).nullable().optional(),
  startsOn: day.nullable().optional(),
  endsOn: day.nullable().optional(),
  sortOrder: z.number().int().optional(),
})

const targetSchema = z
  .object({
    subject: z.enum(['spelling', 'typing', 'quiz']),
    activity: z.string().max(40),
    targetId: z.string().max(120),
  })
  .nullable()

const itemDraftSchema = z.object({
  weekStart: day,
  onDay: day.nullable().optional(),
  kind: z.enum(['task', 'study', 'event']).default('task'),
  title: z.string().trim().min(1).max(200),
  courseId: uuid.nullable().optional(),
  assessmentId: uuid.nullable().optional(),
  minutes: z.number().int().min(0).max(600).nullable().optional(),
  purpose: z.enum(['organize', 'practice', 'prove', 'review']).nullable().optional(),
  proposed: z.boolean().optional(),
  target: targetSchema.optional(),
  sortOrder: z.number().int().optional(),
})

const itemPatchSchema = z
  .object({
    onDay: day.nullable().optional(),
    weekStart: day.optional(),
    sortOrder: z.number().int().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    courseId: uuid.nullable().optional(),
    minutes: z.number().int().min(0).max(600).nullable().optional(),
    status: z.enum(['open', 'done', 'skipped']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })

const weekPatchSchema = z.object({
  priorities: z
    .array(z.object({ text: z.string().trim().min(1).max(160), courseId: uuid.nullable().optional() }))
    .max(MAX_PRIORITIES)
    .optional(),
  wins: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        kind: z.enum(['own', 'verified']),
        evidence: z.record(z.unknown()).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  goals: z
    .array(z.object({ text: z.string().trim().min(1).max(160), courseId: uuid.nullable().optional() }))
    .max(5)
    .optional(),
  reflection: z.string().max(1000).nullable().optional(),
  busyDays: z.array(day).max(7).optional(),
  planned: z.boolean().optional(),
  wrapped: z.boolean().optional(),
})

const assessmentDraftSchema = z.object({
  courseId: uuid.nullable().optional(),
  kind: z.enum(['quiz', 'test', 'exam', 'project']),
  title: z.string().trim().min(1).max(120),
  on: day,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  target: z
    .object({ subject: z.enum(['spelling', 'typing', 'quiz']), targetId: z.string().max(120) })
    .nullable()
    .optional(),
})

const assessmentPatchSchema = assessmentDraftSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to change' },
)

const outcomeSchema = z.object({
  feltLike: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  score: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
})

const prefsPatchSchema = z.object({
  dailyMinutes: z.number().int().min(10).max(600).nullable().optional(),
  sessionsPerDay: z.number().int().min(1).max(6).nullable().optional(),
  studyDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
})

// --- helpers ----------------------------------------------------------------

const itemSelect = 'select i.* from public.planner_items i'
const eventSelect = `
  select e.*, p.display_name as actor_name
    from public.planner_events e
    left join public.profiles p on p.id = e.actor_id`

async function learnerBand(db: Queryable, learnerId: string) {
  const { rows } = await db.query(
    `select grade_hint, auth_user_id, public.can_manage_learner_content(id) as can_write
       from public.learners where id = $1`,
    [learnerId],
  )
  if (!rows.length) throw notFound('No such learner')
  return {
    band: bandForGrade(rows[0].grade_hint),
    authUserId: rows[0].auth_user_id as string | null,
    canWrite: Boolean(rows[0].can_write),
  }
}

async function readPrefs(db: Queryable, learnerId: string): Promise<PlannerPrefs> {
  const { rows } = await db.query('select * from public.planner_prefs where learner_id = $1', [learnerId])
  return toPrefs(learnerId, rows[0])
}

async function readItem(db: Queryable, learnerId: string, itemId: string): Promise<PlannerItem> {
  const { rows } = await db.query(`${itemSelect} where i.id = $1 and i.learner_id = $2`, [itemId, learnerId])
  if (!rows.length) throw notFound('No such card')
  return toPlannerItem(rows[0])
}

/** The week row, created on first write so a week always exists to hang cards on. */
async function ensureWeek(db: Queryable, learnerId: string, weekStart: string): Promise<PlannerWeek> {
  await db.query(
    `insert into public.planner_weeks (learner_id, week_start)
     values ($1, $2)
     on conflict (learner_id, week_start) do nothing`,
    [learnerId, weekStart],
  )
  const week = await readWeek(db, learnerId, weekStart)
  if (!week) throw notFound('No such learner')
  return week
}

/** The week row as it stands, or null when nobody has touched that week. */
async function readWeek(db: Queryable, learnerId: string, weekStart: string): Promise<PlannerWeek | null> {
  const { rows } = await db.query(
    'select * from public.planner_weeks where learner_id = $1 and week_start = $2',
    [learnerId, weekStart],
  )
  return rows.length ? toPlannerWeek(rows[0]) : null
}

/** A week nobody has written to yet, as a viewer sees it. Not persisted. */
function blankWeek(learnerId: string, weekStart: string): PlannerWeek {
  return {
    id: '',
    learnerId,
    weekStart,
    priorities: [],
    wins: [],
    goals: [],
    reflection: null,
    busyDays: [],
    plannedAt: null,
    wrappedAt: null,
  }
}

async function insertItem(
  db: Queryable,
  learnerId: string,
  callerId: string,
  d: z.infer<typeof itemDraftSchema>,
): Promise<PlannerItem> {
  const sortOrder =
    d.sortOrder ??
    Number(
      (
        await db.query(
          `select coalesce(max(sort_order), 0) + $3 as next from public.planner_items
            where learner_id = $1 and on_day is not distinct from $2::date and deleted_at is null`,
          [learnerId, d.onDay ?? null, SORT_GAP],
        )
      ).rows[0].next,
    )
  const { rows } = await db.query(
    `insert into public.planner_items
       (learner_id, week_start, on_day, kind, title, course_id, assessment_id, minutes, purpose,
        proposed, target_subject, target_activity, target_id, sort_order, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning *`,
    [
      learnerId, d.weekStart, d.onDay ?? null, d.kind, d.title, d.courseId ?? null,
      d.assessmentId ?? null, d.minutes ?? null, d.purpose ?? null, d.proposed ?? false,
      d.target?.subject ?? null, d.target?.activity ?? null, d.target?.targetId ?? null,
      sortOrder, callerId,
    ],
  )
  return toPlannerItem(rows[0])
}

export async function plannerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  // --- courses --------------------------------------------------------------

  app.get('/learners/:id/courses', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { archived } = parse(z.object({ archived: z.enum(['true', 'false']).default('false') }), request.query)
    const courses = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `select * from public.courses
          where learner_id = $1 and ($2 or archived_at is null)
          order by archived_at nulls first, sort_order, created_at`,
        [id, archived === 'true'],
      )
      return rows.map(toCourse)
    })
    return { courses }
  })

  app.post('/learners/:id/courses', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const d = parse(courseDraftSchema, request.body)
    const course = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `insert into public.courses
           (learner_id, name, track, teacher_name, period, color, emoji, term_label, starts_on, ends_on,
            sort_order, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 coalesce($11, (select coalesce(max(sort_order), 0) + 1 from public.courses where learner_id = $1)),
                 $12)
         returning *`,
        [
          id, d.name, d.track ?? null, d.teacherName ?? null, d.period ?? null, d.color ?? '#3F7FBF',
          d.emoji ?? null, d.termLabel ?? null, d.startsOn ?? null, d.endsOn ?? null,
          d.sortOrder ?? null, caller.id,
        ],
      )
      return toCourse(rows[0])
    })
    reply.code(201)
    return { course }
  })

  app.patch('/learners/:id/courses/:courseId', async (request) => {
    const caller = callerOf(request)
    const { id, courseId } = parse(z.object({ id: uuid, courseId: uuid }), request.params)
    const p = parse(courseDraftSchema.partial(), request.body)
    const course = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `update public.courses set
            name         = coalesce($3, name),
            track        = case when $4::boolean then $5 else track end,
            teacher_name = case when $6::boolean then $7 else teacher_name end,
            period       = case when $8::boolean then $9 else period end,
            color        = coalesce($10, color),
            emoji        = case when $11::boolean then $12 else emoji end,
            term_label   = case when $13::boolean then $14 else term_label end,
            starts_on    = case when $15::boolean then $16::date else starts_on end,
            ends_on      = case when $17::boolean then $18::date else ends_on end,
            sort_order   = coalesce($19, sort_order)
          where id = $2 and learner_id = $1
          returning *`,
        [
          id, courseId, p.name ?? null,
          'track' in p, p.track ?? null,
          'teacherName' in p, p.teacherName ?? null,
          'period' in p, p.period ?? null,
          p.color ?? null,
          'emoji' in p, p.emoji ?? null,
          'termLabel' in p, p.termLabel ?? null,
          'startsOn' in p, p.startsOn ?? null,
          'endsOn' in p, p.endsOn ?? null,
          p.sortOrder ?? null,
        ],
      )
      if (!rows.length) throw notFound('No such course')
      return toCourse(rows[0])
    })
    return { course }
  })

  app.post('/learners/:id/courses/:courseId/archive', async (request) => {
    const caller = callerOf(request)
    const { id, courseId } = parse(z.object({ id: uuid, courseId: uuid }), request.params)
    const { archived } = parse(z.object({ archived: z.boolean().default(true) }), request.body ?? {})
    const course = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.courses set archived_at = case when $3 then now() else null end
          where id = $2 and learner_id = $1 returning *`,
        [id, courseId, archived],
      )
      if (!rows.length) throw notFound('No such course')
      return toCourse(rows[0])
    })
    return { course }
  })

  app.delete('/learners/:id/courses/:courseId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, courseId } = parse(z.object({ id: uuid, courseId: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query('delete from public.courses where id = $1 and learner_id = $2', [
        courseId, id,
      ])
      if (!rowCount) throw notFound('No such course')
    })
    reply.code(204)
    return null
  })

  /** New term: copy every unarchived course with the dates cleared, archive the old ones. */
  app.post('/learners/:id/courses/rollover', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { termLabel } = parse(z.object({ termLabel: z.string().trim().max(40).nullable().optional() }), request.body ?? {})
    const courses = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `with old as (
           update public.courses set archived_at = now()
            where learner_id = $1 and archived_at is null
            returning *
         )
         insert into public.courses
           (learner_id, name, track, teacher_name, period, color, emoji, term_label, sort_order, created_by)
         select learner_id, name, track, teacher_name, period, color, emoji, $2, sort_order, $3 from old
         returning *`,
        [id, termLabel ?? null, caller.id],
      )
      return rows.map(toCourse)
    })
    return { courses }
  })

  // --- the week -------------------------------------------------------------

  /**
   * The assembled week: the stored cards plus everything the app already knows
   * for those days, read-only — assignments due, review falling due, tests.
   * Nothing pulled in is duplicated into planner_items.
   */
  app.get('/learners/:id/planner/weeks/:weekStart', async (request) => {
    const caller = callerOf(request)
    const { id, weekStart } = parse(z.object({ id: uuid, weekStart: day }), request.params)
    // The learner's own calendar day. Every day on the grid is local to them;
    // the database's current_date is not.
    const { today } = parse(z.object({ today: day.optional() }), request.query)
    if (!isMonday(weekStart)) throw badRequest('A week starts on a Monday', 'not_monday')

    return withUser(caller.id, async (db) => {
      const { band, canWrite } = await learnerBand(db, id)
      // A read must not write: a view-only guardian may not create the week
      // row, and should not need to in order to look at it.
      const week = canWrite
        ? await ensureWeek(db, id, weekStart)
        : ((await readWeek(db, id, weekStart)) ?? blankWeek(id, weekStart))
      const todayDay = today ?? dayOf(new Date())!

      const items = await db.query(
        `${itemSelect}
          where i.learner_id = $1 and i.week_start = $2 and i.deleted_at is null
          order by i.on_day nulls first, i.sort_order, i.created_at`,
        [id, weekStart],
      )
      // Open tasks from before today, still waiting. The "still?" strip.
      const carry = await db.query(
        `${itemSelect}
          where i.learner_id = $1 and i.deleted_at is null and i.status = 'open'
            and i.kind = 'task'
            and ((i.on_day is not null and i.on_day < $3::date and i.on_day >= $2::date - 14)
                 or (i.on_day is null and i.week_start < $2 and i.week_start >= $2::date - 14))
          order by i.on_day nulls first, i.sort_order`,
        [id, weekStart, todayDay],
      )
      const assessments = await db.query(
        `select * from public.assessments
          where learner_id = $1 and on_day >= $2::date - 7 and on_day < $2::date + 28
          order by on_day, created_at`,
        [id, weekStart],
      )
      const assignments = await db.query(
        `select a.id, a.set_id, a.learner_id, a.sort_order, a.status, a.completed_at,
                a.session_id, a.created_at, a.course_id,
                t.created_by, t.subject, t.activity, t.target_id, t.size, t.title,
                t.note, t.min_accuracy, t.due_on, t.goal
           from public.assignments a
           join public.assignment_sets t on t.id = a.set_id
          where a.learner_id = $1 and a.status <> 'canceled'
            and t.due_on >= $2::date and t.due_on < $2::date + 7
          order by t.due_on, a.sort_order`,
        [id, weekStart],
      )
      const review = await db.query(
        `select greatest(due_on, $3::date) as on_day, count(*)::int as n
           from public.item_mastery
          where learner_id = $1 and due_on is not null
            and due_on < $2::date + 7
            and (due_on >= $2::date or $3::date >= $2::date)
          group by 1`,
        [id, weekStart, todayDay],
      )
      const comments = await db.query(
        `select c.*, p.display_name as author_name
           from public.planner_comments c
           left join public.profiles p on p.id = c.author_id
          where c.learner_id = $1 and c.week_start = $2
          order by c.created_at`,
        [id, weekStart],
      )
      const courses = await db.query(
        `select * from public.courses where learner_id = $1 and archived_at is null
          order by sort_order, created_at`,
        [id],
      )
      const prefs = await readPrefs(db, id)

      const reviewDue: Record<string, number> = {}
      for (const r of review.rows) reviewDue[dayOf(r.on_day)!] = Number(r.n)

      // Sessions for each test in view, wherever they sit: a plan spans weeks
      // and "2 of 5 done" must count all five.
      const counts = await db.query(
        `select assessment_id,
                count(*) filter (where status = 'done')::int    as done,
                count(*) filter (where status <> 'skipped')::int as total
           from public.planner_items
          where learner_id = $1 and kind = 'study' and deleted_at is null
            and assessment_id = any($2::uuid[])
          group by assessment_id`,
        [id, assessments.rows.map((a) => a.id)],
      )
      const sessionCounts: Record<string, { done: number; total: number }> = {}
      for (const r of counts.rows) sessionCounts[r.assessment_id] = { done: Number(r.done), total: Number(r.total) }

      return {
        week,
        band,
        canWrite,
        items: items.rows.map(toPlannerItem),
        carryOver: carry.rows.map(toPlannerItem),
        assessments: assessments.rows.map(toAssessment),
        assignments: assignments.rows.map(toAssignment),
        reviewDue,
        sessionCounts,
        comments: comments.rows.map(toComment),
        courses: courses.rows.map(toCourse),
        prefs,
      }
    })
  })

  app.patch('/learners/:id/planner/weeks/:weekStart', async (request) => {
    const caller = callerOf(request)
    const { id, weekStart } = parse(z.object({ id: uuid, weekStart: day }), request.params)
    if (!isMonday(weekStart)) throw badRequest('A week starts on a Monday', 'not_monday')
    const p = parse(weekPatchSchema, request.body)

    const week = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      await ensureWeek(db, id, weekStart)
      const { rows } = await db.query(
        `update public.planner_weeks set
            priorities = coalesce($3::jsonb, priorities),
            wins       = coalesce($4::jsonb, wins),
            goals      = coalesce($5::jsonb, goals),
            reflection = case when $6::boolean then $7 else reflection end,
            busy_days  = coalesce($8::date[], busy_days),
            planned_at = case when $9::boolean then coalesce(planned_at, now()) else planned_at end,
            wrapped_at = case when $10::boolean then coalesce(wrapped_at, now()) else wrapped_at end
          where learner_id = $1 and week_start = $2
          returning *`,
        [
          id, weekStart,
          p.priorities ? JSON.stringify(p.priorities) : null,
          p.wins ? JSON.stringify(p.wins) : null,
          p.goals ? JSON.stringify(p.goals) : null,
          'reflection' in p, p.reflection ?? null,
          p.busyDays ?? null,
          p.planned ?? false,
          p.wrapped ?? false,
        ],
      )
      if (!rows.length) throw notFound('No such week')
      return toPlannerWeek(rows[0])
    })
    publishLearner(request, id, 'planner.week', week)
    return { week }
  })

  /** The week's timeline, newest first, filterable by who. */
  app.get('/learners/:id/planner/weeks/:weekStart/history', async (request) => {
    const caller = callerOf(request)
    const { id, weekStart } = parse(z.object({ id: uuid, weekStart: day }), request.params)
    const { actor } = parse(z.object({ actor: z.string().max(40).optional() }), request.query)
    const events = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `${eventSelect}
          where e.learner_id = $1
            and e.at >= $2::date - 1 and e.at < $2::date + 8
            and ($3::text is null or ($3 = 'system' and e.actor_id is null) or e.actor_id::text = $3)
          order by e.at desc, e.id desc
          limit 500`,
        [id, weekStart, actor ?? null],
      )
      return rows.map(toEvent)
    })
    return { events }
  })

  // --- items ----------------------------------------------------------------

  app.post('/learners/:id/planner/items', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const d = parse(itemDraftSchema, request.body)
    if (!isMonday(d.weekStart)) throw badRequest('A week starts on a Monday', 'not_monday')
    const item = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      await ensureWeek(db, id, d.weekStart)
      return insertItem(db, id, caller.id, d)
    })
    publishLearner(request, id, 'planner.item', item)
    reply.code(201)
    return { item }
  })

  /**
   * Move, edit, tick, skip.
   *
   * Refuses `done` on a linked card, the same way the assignments PATCH refuses
   * it outright: linked work is closed by complete_matching_planner_items() or
   * not at all. On a claim card, `done_by` is the caller — never the body —
   * and a grown-up's tick is accepted only in the two youngest bands.
   */
  app.patch('/learners/:id/planner/items/:itemId', async (request) => {
    const caller = callerOf(request)
    const { id, itemId } = parse(z.object({ id: uuid, itemId: uuid }), request.params)
    const p = parse(itemPatchSchema, request.body)

    const item = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const current = await readItem(db, id, itemId)
      if (current.deletedAt) throw notFound('That card was removed')

      if (p.status === 'done') {
        if (current.target) {
          throw badRequest('That one is closed by doing it. Start it instead.', 'linked_card')
        }
        if (current.kind === 'event') throw badRequest('A date is not something to tick.', 'event_card')
        const { band, authUserId } = await learnerBand(db, id)
        const isLearner = authUserId === caller.id
        if (!isLearner && band !== 'early' && band !== 'growing') {
          throw badRequest('Leave the box to the learner — they tick their own.', 'learner_ticks')
        }
      }

      let onDay = current.onDay
      let weekStart = current.weekStart
      if ('onDay' in p) {
        onDay = p.onDay ?? null
        if (onDay === null && current.kind !== 'task') {
          throw badRequest('Only tasks can wait on the shelf.', 'shelf_kinds')
        }
        weekStart = onDay ? weekStartOf(onDay) : (p.weekStart ?? current.weekStart)
        if (weekStart !== current.weekStart) await ensureWeek(db, id, weekStart)
      } else if (p.weekStart) {
        weekStart = p.weekStart
        if (onDay && weekStartOf(onDay) !== weekStart) throw badRequest('That day is not in that week', 'day_in_week')
        await ensureWeek(db, id, weekStart)
      }

      const status = p.status ?? current.status
      const { rows } = await db.query(
        `update public.planner_items set
            on_day     = $3,
            week_start = $4,
            sort_order = coalesce($5, sort_order),
            title      = coalesce($6, title),
            course_id  = case when $7::boolean then $8 else course_id end,
            minutes    = case when $9::boolean then $10 else minutes end,
            status     = $11,
            done_at    = case when $11 = 'done' and status <> 'done' then now()
                              when $11 <> 'done' then null else done_at end,
            done_by    = case when $11 = 'done' and status <> 'done' then $12
                              when $11 <> 'done' then null else done_by end
          where id = $2 and learner_id = $1
          returning *`,
        [
          id, itemId, onDay, weekStart, p.sortOrder ?? null, p.title ?? null,
          'courseId' in p, p.courseId ?? null,
          'minutes' in p, p.minutes ?? null,
          status, caller.id,
        ],
      )
      if (!rows.length) throw notFound('No such card')
      return toPlannerItem(rows[0])
    })
    publishLearner(request, id, 'planner.item', item)
    return { item }
  })

  /** Soft delete. The card leaves the grid; its history stays readable. */
  app.delete('/learners/:id/planner/items/:itemId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, itemId } = parse(z.object({ id: uuid, itemId: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query(
        `update public.planner_items set deleted_at = now(), deleted_by = $3
          where id = $2 and learner_id = $1 and deleted_at is null`,
        [id, itemId, caller.id],
      )
      if (!rowCount) throw notFound('No such card')
    })
    publishLearner(request, id, 'planner.item.removed', { itemId })
    reply.code(204)
    return null
  })

  app.post('/learners/:id/planner/items/:itemId/restore', async (request) => {
    const caller = callerOf(request)
    const { id, itemId } = parse(z.object({ id: uuid, itemId: uuid }), request.params)
    const item = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.planner_items set deleted_at = null, deleted_by = null
          where id = $2 and learner_id = $1 returning *`,
        [id, itemId],
      )
      if (!rows.length) throw notFound('No such card')
      return toPlannerItem(rows[0])
    })
    publishLearner(request, id, 'planner.item', item)
    return { item }
  })

  app.post('/learners/:id/planner/items/:itemId/duplicate', async (request, reply) => {
    const caller = callerOf(request)
    const { id, itemId } = parse(z.object({ id: uuid, itemId: uuid }), request.params)
    const { onDay } = parse(z.object({ onDay: day.nullable() }), request.body)
    const item = await withUser(caller.id, async (db) => {
      const src = await readItem(db, id, itemId)
      const weekStart = onDay ? weekStartOf(onDay) : src.weekStart
      await ensureWeek(db, id, weekStart)
      return insertItem(db, id, caller.id, {
        weekStart,
        onDay,
        kind: src.kind === 'study' ? 'task' : src.kind,
        title: src.title,
        courseId: src.courseId,
        minutes: src.minutes,
        target: null,
      })
    })
    publishLearner(request, id, 'planner.item', item)
    reply.code(201)
    return { item }
  })

  app.get('/learners/:id/planner/items/:itemId/history', async (request) => {
    const caller = callerOf(request)
    const { id, itemId } = parse(z.object({ id: uuid, itemId: uuid }), request.params)
    const events = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `${eventSelect} where e.learner_id = $1 and e.entity = 'item' and e.entity_id = $2
          order by e.at asc, e.id asc`,
        [id, itemId],
      )
      return rows.map(toEvent)
    })
    return { events }
  })

  // --- assessments ----------------------------------------------------------

  /** One body, an array of learners: a tutor sets the same test for several. */
  app.post('/assessments', async (request, reply) => {
    const caller = callerOf(request)
    const { assessment: d, learnerIds } = parse(
      z.object({ assessment: assessmentDraftSchema, learnerIds: z.array(uuid).min(1).max(60) }),
      request.body,
    )
    const created = await withUser(caller.id, async (db) => {
      const out: Assessment[] = []
      for (const learnerId of learnerIds) {
        await assertVisible(db, learnerId)
        const { rows } = await db.query(
          `insert into public.assessments
             (learner_id, course_id, kind, title, on_day, difficulty, target_subject, target_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [
            learnerId, d.courseId ?? null, d.kind, d.title, d.on, d.difficulty,
            d.target?.subject ?? null, d.target?.targetId ?? null, caller.id,
          ],
        )
        out.push(toAssessment(rows[0]))
      }
      return out
    })
    reply.code(201)
    return { assessments: created }
  })

  app.get('/learners/:id/assessments', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const assessments = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `select * from public.assessments where learner_id = $1 order by on_day desc limit 200`,
        [id],
      )
      return rows.map(toAssessment)
    })
    return { assessments }
  })

  app.patch('/assessments/:id', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const p = parse(assessmentPatchSchema, request.body)
    const assessment = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.assessments set
            course_id      = case when $2::boolean then $3 else course_id end,
            kind           = coalesce($4, kind),
            title          = coalesce($5, title),
            on_day         = coalesce($6::date, on_day),
            difficulty     = coalesce($7, difficulty),
            target_subject = case when $8::boolean then $9 else target_subject end,
            target_id      = case when $8::boolean then $10 else target_id end
          where id = $1 returning *`,
        [
          id, 'courseId' in p, p.courseId ?? null, p.kind ?? null, p.title ?? null, p.on ?? null,
          p.difficulty ?? null, 'target' in p, p.target?.subject ?? null, p.target?.targetId ?? null,
        ],
      )
      if (!rows.length) throw notFound('No such test')
      return toAssessment(rows[0])
    })
    return { assessment }
  })

  app.delete('/assessments/:id', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query('delete from public.assessments where id = $1', [id])
      if (!rowCount) throw notFound('No such test')
    })
    reply.code(204)
    return null
  })

  /**
   * The proposal. Stores nothing: the learner sees ghost cards and chooses.
   * Every constraint the proposer respects is read from the week as it stands.
   */
  app.post('/assessments/:id/propose', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { today } = parse(z.object({ today: day.optional() }), request.body ?? {})

    return withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.assessments where id = $1', [id])
      if (!rows.length) throw notFound('No such test')
      const a = toAssessment(rows[0])
      const { band } = await learnerBand(db, a.learnerId)
      const prefs = await readPrefs(db, a.learnerId)
      const todayDay = today ?? dayOf(new Date())!

      const busy = await db.query(
        `select unnest(busy_days) as d from public.planner_weeks
          where learner_id = $1 and week_start >= $2::date - 6 and week_start <= $3::date`,
        [a.learnerId, todayDay, a.on],
      )
      // Sessions already on each day, and how many of them are for this very
      // test. The rule is one session per test per day; keying it on the
      // course would make "no course" a course, and every unfiled session a
      // clash.
      const load = await db.query(
        `select on_day, count(*)::int as n,
                count(*) filter (where assessment_id = $2)::int as same_test
           from public.planner_items
          where learner_id = $1 and kind = 'study' and status = 'open' and deleted_at is null
            and on_day is not null and on_day >= $3::date and on_day <= $4::date
          group by on_day`,
        [a.learnerId, a.id, todayDay, a.on],
      )
      // Last time this course felt harder than expected: one more session.
      const calibration = a.courseId
        ? await db.query(
            `select 1 from public.assessments
              where learner_id = $1 and course_id = $2 and id <> $3 and outcome is not null
                and (outcome ->> 'feltLike')::int > difficulty
              order by on_day desc limit 1`,
            [a.learnerId, a.courseId, a.id],
          )
        : { rows: [] }

      const sessionsOnDay: Record<string, number> = {}
      const courseSessionsOnDay: Record<string, number> = {}
      for (const r of load.rows) {
        const d = dayOf(r.on_day)!
        sessionsOnDay[d] = Number(r.n)
        courseSessionsOnDay[d] = Number(r.same_test)
      }

      const extra = calibration.rows.length ? 1 : 0
      const result = proposeStudyPlan({
        assessment: a,
        band,
        today: todayDay,
        busyDays: busy.rows.map((r) => dayOf(r.d)!),
        sessionsOnDay,
        courseSessionsOnDay,
        studyDays: prefs.studyDays,
        sessionsPerDay: prefs.sessionsPerDay,
        sessionMinutes: null,
        extraSessions: extra,
      })
      return {
        ...result,
        calibrated: extra > 0,
        calibrationNote: extra > 0
          ? 'Last time this course felt harder than expected, so this plan has one extra session.'
          : null,
      }
    })
  })

  /** Accept the sessions kept. Creates the cards; replaces earlier proposed, undone ones. */
  app.post('/assessments/:id/accept', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { sessions, replace } = parse(
      z.object({
        sessions: z
          .array(
            z.object({
              onDay: day,
              purpose: z.enum(['organize', 'practice', 'prove', 'review']),
              minutes: z.number().int().min(0).max(600),
              title: z.string().trim().min(1).max(200),
            }),
          )
          .max(12),
        replace: z.boolean().default(true),
      }),
      request.body,
    )

    const items = await withUser(caller.id, async (db) => {
      const { rows } = await db.query('select * from public.assessments where id = $1', [id])
      if (!rows.length) throw notFound('No such test')
      const a = toAssessment(rows[0])

      if (replace) {
        // Proposed sessions not yet done go; ones the learner moved by hand or
        // finished stay. Soft-deleted so the log keeps them.
        await db.query(
          `update public.planner_items set deleted_at = now(), deleted_by = $2
            where assessment_id = $1 and kind = 'study' and proposed and status = 'open'
              and deleted_at is null and on_day >= current_date`,
          [id, caller.id],
        )
      }

      const out: PlannerItem[] = []
      for (const s of sessions) {
        const weekStart = weekStartOf(s.onDay)
        await ensureWeek(db, a.learnerId, weekStart)
        out.push(
          await insertItem(db, a.learnerId, caller.id, {
            weekStart,
            onDay: s.onDay,
            kind: 'study',
            title: s.title,
            courseId: a.courseId,
            assessmentId: a.id,
            minutes: s.minutes,
            purpose: s.purpose,
            proposed: true,
            target: a.target
              ? { subject: a.target.subject, activity: activityForPurpose(s.purpose, a.target.subject), targetId: a.target.targetId }
              : null,
          }),
        )
      }
      await db.query('update public.assessments set plan_generated_at = now() where id = $1', [id])
      return out
    })
    reply.code(201)
    return { items }
  })

  /** How it went. A claim, shown as one, and the calibration signal. */
  app.post('/assessments/:id/outcome', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const outcome = parse(outcomeSchema, request.body)
    const assessment = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `update public.assessments set outcome = $2 where id = $1 returning *`,
        [id, JSON.stringify({ feltLike: outcome.feltLike, score: outcome.score ?? null, note: outcome.note ?? null })],
      )
      if (!rows.length) throw notFound('No such test')
      return toAssessment(rows[0])
    })
    return { assessment }
  })

  app.get('/assessments/:id/history', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const events = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `${eventSelect} where e.entity = 'assessment' and e.entity_id = $1 order by e.at asc, e.id asc`,
        [id],
      )
      return rows.map(toEvent)
    })
    return { events }
  })

  // --- comments -------------------------------------------------------------

  app.post('/learners/:id/planner/comments', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { weekStart, itemId, body } = parse(
      z.object({ weekStart: day, itemId: uuid.nullable().optional(), body: z.string().trim().min(1).max(500) }),
      request.body,
    )
    const comment = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `with c as (
           insert into public.planner_comments (learner_id, week_start, item_id, author_id, body)
           values ($1,$2,$3,$4,$5) returning *
         )
         select c.*, p.display_name as author_name from c left join public.profiles p on p.id = c.author_id`,
        [id, weekStart, itemId ?? null, caller.id, body],
      )
      return toComment(rows[0])
    })
    publishLearner(request, id, 'planner.comment', comment)
    reply.code(201)
    return { comment }
  })

  app.delete('/planner/comments/:commentId', async (request, reply) => {
    const caller = callerOf(request)
    const { commentId } = parse(z.object({ commentId: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query('delete from public.planner_comments where id = $1', [commentId])
      if (!rowCount) throw notFound('No such note, or it is not yours')
    })
    reply.code(204)
    return null
  })

  // --- prefs ----------------------------------------------------------------

  app.get('/learners/:id/planner/prefs', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const prefs = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { band } = await learnerBand(db, id)
      return { ...(await readPrefs(db, id)), band, defaults: PLANNER_BAND[band] }
    })
    return { prefs }
  })

  app.patch('/learners/:id/planner/prefs', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const p = parse(prefsPatchSchema, request.body)
    const prefs = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const { rows } = await db.query(
        `insert into public.planner_prefs (learner_id, daily_minutes, sessions_per_day, study_days)
         values ($1, $2::int, $3::int, coalesce($4::int[], '{1,2,3,4,5,7}'::int[]))
         on conflict (learner_id) do update set
           daily_minutes    = case when $5::boolean then $2::int else planner_prefs.daily_minutes end,
           sessions_per_day = case when $6::boolean then $3::int else planner_prefs.sessions_per_day end,
           study_days       = coalesce($4::int[], planner_prefs.study_days),
           updated_at       = now()
         returning *`,
        [id, p.dailyMinutes ?? null, p.sessionsPerDay ?? null, p.studyDays ?? null,
         'dailyMinutes' in p, 'sessionsPerDay' in p],
      )
      return toPrefs(id, rows[0])
    })
    return { prefs }
  })
}
