// A learner's progress: the snapshot the app boots from, and the writes that
// come back out of a round of practice.
//
// Everything here is scoped by `withUser`, so RLS has already decided whether
// this caller may touch this learner. That is why none of these handlers check
// ownership themselves — doing it twice, in two places, with two chances to
// drift, is how authorization bugs happen.

import type { FastifyInstance } from 'fastify'
import type { ProgressSnapshot } from '@whizzo/shared'
import { deckLimit, emptySnapshot, listKey, masteryKey } from '@whizzo/shared'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withUser, type Queryable } from '../db.js'
import { badRequest, notFound, overLimit } from '../errors.js'
import {
  iso,
  toAchievement,
  toCustomList,
  toDaily,
  toDeck,
  toHighScore,
  toList,
  dayOf,
  toAssignment,
  toAttempt,
  toMastery,
  toSession,
  toSkill,
} from '../progressMappers.js'
import { insertMany } from '../sql.js'
import { decksFor } from '../progressRead.js'
import { assertVisible, writeMastery, writeProgressChange, writeSkill } from '../progressWrite.js'
import {
  assignmentDraftSchema,
  assignmentPatchSchema,
  assignmentSetPatchSchema,
  customWordListSchema,
  progressChangeSchema,
  quizDeckSchema,
  snapshotSchema,
} from '../schemas.js'

/** Matches what the app keeps in memory; see SESSION_HISTORY_LIMIT on the web. */
const SESSION_FETCH_LIMIT = 100
const DAILY_FETCH_DAYS = 400

const uuid = z.string().uuid('That is not a valid id')

// Input pinned to `unknown` so T binds to the schema's *output* type; without
// it a schema carrying defaults infers its pre-default shape.
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw badRequest(`${where}${issue?.message ?? 'That request was not valid'}`)
  }
  return result.data
}

/**
 * The free-tier deck ceiling, enforced where it is actually enforceable.
 *
 * The browser has always blocked this, which made the cap a suggestion: the
 * same request sent twice, or sent at all by anything other than our own
 * screen, went straight past it. A paywall that only exists in the client is a
 * paywall for people who do not know it is there.
 *
 * Two rules the copy on the screens already promises, and which this has to
 * keep:
 *
 *  - It counts what would *newly exist*. Re-saving an edit to a deck already
 *    stored is never refused, however far over the line the learner is.
 *  - It never deletes and never blocks reading. A learner who made forty decks
 *    while covered keeps all forty after a lapse and is refused the
 *    forty-first. Taking a child's work away for non-payment is not a business
 *    model.
 */
async function assertUnderDeckLimit(
  db: Queryable,
  learnerId: string,
  incoming: ReadonlyArray<{ id: string }>,
): Promise<void> {
  const { rows } = await db.query(
    `select public.is_learner_covered($1) as covered,
            (select count(*) from public.decks where learner_id = $1) as held,
            (select count(*) from public.decks
              where learner_id = $1 and id = any($2::uuid[])) as updating`,
    [learnerId, incoming.map((d) => d.id)],
  )
  const row = rows[0]
  if (!row) return

  const limit = deckLimit(Boolean(row.covered))
  if (!Number.isFinite(limit)) return

  const held = Number(row.held)
  const updating = Number(row.updating)
  // If the count could not be read, let the save through. The worst case that
  // way is an uncovered learner keeps a fourth deck; the worst case the other
  // way is a paying family losing a child's work to a query that returned an
  // unexpected shape. Only one of those is worth risking.
  if (!Number.isFinite(held) || !Number.isFinite(updating)) return

  const creating = incoming.length - updating
  if (creating <= 0) return
  if (held + creating <= limit) return

  throw overLimit(
    `An uncovered learner can keep ${limit} decks, and this one has ${held}. ` +
      'Cover them to remove the limit, or delete one first.',
  )
}

async function loadSnapshot(db: Queryable, learnerId: string): Promise<ProgressSnapshot> {
  const [skills, mastery, lists, achievements, highScores, daily, sessions, customLists, decks] =
    await Promise.all([
      db.query('select * from public.skill_states where learner_id = $1', [learnerId]),
      db.query('select * from public.item_mastery where learner_id = $1', [learnerId]),
      db.query('select * from public.list_progress where learner_id = $1', [learnerId]),
      db.query('select * from public.achievements where learner_id = $1', [learnerId]),
      db.query(
        'select * from public.high_scores where learner_id = $1 order by score desc limit 200',
        [learnerId],
      ),
      db.query(
        `select * from public.daily_activity
          where learner_id = $1 and day >= current_date - $2::int
          order by day desc`,
        [learnerId, DAILY_FETCH_DAYS],
      ),
      db.query(
        `select * from public.sessions where learner_id = $1
          order by ended_at desc limit $2`,
        [learnerId, SESSION_FETCH_LIMIT],
      ),
      // Their own lists and decks, plus any library content a grown-up has set
      // them as work — without that second half a student cannot open the deck
      // their tutor assigned. RLS allows exactly these rows; the where clause
      // says which of them this learner needs.
      db.query(
        `select * from public.word_lists
          where learner_id = $1
             or (owner_user_id is not null and id in (
                   select t.target_id::uuid
                     from public.assignment_sets t
                     join public.assignments a on a.set_id = t.id
                    where a.learner_id = $1 and t.subject = 'spelling'
                      and t.target_id ~ '^[0-9a-f-]{36}$'
                 ))`,
        [learnerId],
      ),
      decksFor(db, learnerId),
    ])

  const snapshot = emptySnapshot()

  for (const row of skills.rows) {
    const skill = toSkill(row)
    snapshot.skills[skill.subject] = skill
  }
  for (const row of mastery.rows) {
    const item = toMastery(row)
    snapshot.mastery[masteryKey(item.subject, item.itemKey)] = item
  }
  for (const row of lists.rows) {
    const list = toList(row)
    snapshot.lists[listKey(list.subject, list.listId)] = list
  }
  snapshot.achievements = achievements.rows.map(toAchievement)
  snapshot.highScores = highScores.rows.map(toHighScore)
  snapshot.daily = daily.rows.map(toDaily)
  snapshot.sessions = sessions.rows.map(toSession)
  snapshot.customLists = customLists.rows.map(toCustomList)
  snapshot.decks = decks

  return snapshot
}

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  app.get('/learners/:id/progress', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)

    const snapshot = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      return loadSnapshot(db, id)
    })

    return { snapshot }
  })

  /**
   * Every answer given in one round.
   *
   * The snapshot carries session summaries because that is what the app needs
   * to boot; this is the level underneath, for a grown-up who wants to see
   * what a score was actually made of — which questions, what the child
   * answered, how long each one took, and whether the app checked it or the
   * child graded themselves.
   *
   * Ordered by the attempts' own identity column, which is insertion order:
   * the order the round was played, including a card that came round twice.
   */
  app.get('/learners/:id/sessions/:sessionId/attempts', async (request) => {
    const caller = callerOf(request)
    const { id, sessionId } = parse(
      z.object({ id: uuid, sessionId: uuid }),
      request.params,
    )

    const attempts = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const rows = await db.query(
        `select * from public.attempts
          where learner_id = $1 and session_id = $2
          order by id asc`,
        [id, sessionId],
      )
      return rows.rows.map(toAttempt)
    })

    return { attempts }
  })

  // One round of practice. Applied as a single transaction: a session and the
  // attempts that belong to it either both land or neither does, which is what
  // keeps `attempts` usable as the audit trail everything else derives from.
  app.post('/learners/:id/progress', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const change = parse(progressChangeSchema, request.body)

    await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      await writeProgressChange(db, id, change, 'app')
    })

    reply.code(204)
    return null
  })

  // The guest-to-account merge: a whole snapshot at once.
  app.put('/learners/:id/progress', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const snapshot = parse(snapshotSchema, request.body)

    await withUser(caller.id, async (db) => {
      await assertVisible(db, id)

      for (const skill of Object.values(snapshot.skills)) await writeSkill(db, id, skill)
      const mastery = Object.values(snapshot.mastery)
      if (mastery.length) await writeMastery(db, id, mastery)

      for (const l of Object.values(snapshot.lists)) {
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
          [id, l.subject, l.listId, l.plays, l.testsTaken, l.bestScore,
           l.bestAccuracy, l.stars, iso(l.masteredAt)],
        )
      }

      if (snapshot.achievements.length) {
        await insertMany(
          db,
          'public.achievements',
          ['learner_id', 'achievement_id', 'subject', 'unlocked_at'],
          snapshot.achievements.map((a) => [id, a.achievementId, a.subject, iso(a.unlockedAt)]),
          'on conflict (learner_id, achievement_id) do nothing',
        )
      }
    })

    reply.code(204)
    return null
  })

  app.delete('/learners/:id/progress', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)

    await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      // Attempts are append-only now, so this cannot be a loop of deletes: the
      // erase runs as a definer function gated on ownership. Deleting your own
      // data stays a right; a child clearing their own history does not.
      await db.query('select public.erase_learner_progress($1)', [id])
    })

    reply.code(204)
    return null
  })

  // --- assignments ---------------------------------------------------------

  /**
   * A learner's task list.
   *
   * Readable by anyone linked to them, because the child needs to see their own
   * work; writable only by a grown-up, which RLS enforces rather than this
   * handler. Open tasks first, in the order they were set.
   */
  /**
   * A task, as the client wants it: the work and this learner's state on it,
   * in one row. The split lives in the schema because two children can be given
   * the same work; nothing above the API needs to care.
   */
  const assignmentSelect = `
    select a.id, a.set_id, a.learner_id, a.sort_order, a.status, a.completed_at,
           a.session_id, a.created_at,
           t.created_by, t.subject, t.activity, t.target_id, t.size, t.title,
           t.note, t.min_accuracy, t.due_on
      from public.assignments a
      join public.assignment_sets t on t.id = a.set_id`

  app.get('/learners/:id/assignments', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { status } = parse(
      z.object({ status: z.enum(['open', 'done', 'cancelled', 'all']).default('all') }),
      request.query,
    )

    const assignments = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const rows = await db.query(
        `${assignmentSelect}
          where a.learner_id = $1
            and ($2 = 'all' or a.status = $2)
          order by case a.status when 'open' then 0 when 'done' then 1 else 2 end,
                   a.sort_order, a.created_at`,
        [id, status],
      )
      return rows.rows.map(toAssignment)
    })

    return { assignments }
  })

  /**
   * Set work, for one learner or several.
   *
   * Addressed to no learner in particular, because a piece of work is not the
   * property of one child: a parent sets the same thing for two siblings and a
   * tutor for a class. Each draft becomes one set plus a row per learner, and
   * RLS checks every learner named — so a caller entitled to two of three
   * children gets a clean refusal rather than a partial write, because the
   * whole thing is one transaction.
   */
  app.post('/assignments', async (request, reply) => {
    const caller = callerOf(request)
    const { assignments: drafts, learnerIds } = parse(
      z.object({
        assignments: z.array(assignmentDraftSchema).min(1).max(50),
        learnerIds: z.array(uuid).min(1).max(60),
      }),
      request.body,
    )

    const created = await withUser(caller.id, async (db) => {
      for (const learnerId of learnerIds) await assertVisible(db, learnerId)

      const out = []
      for (const [i, d] of drafts.entries()) {
        const set = await db.query(
          `insert into public.assignment_sets
             (created_by, subject, activity, target_id, size, title, note,
              min_accuracy, due_on, goal)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning id`,
          [caller.id, d.subject, d.activity, d.targetId ?? null, d.size ?? null,
           d.title, d.note ?? null, d.minAccuracy ?? null, d.dueOn ?? null,
           d.goal ? JSON.stringify(d.goal) : null],
        )
        const setId = set.rows[0].id

        for (const learnerId of learnerIds) {
          const row = await db.query(
            `insert into public.assignments (set_id, learner_id, sort_order)
             values ($1,$2,$3)
             on conflict (set_id, learner_id) do nothing
             returning id`,
            [setId, learnerId, d.sortOrder ?? i],
          )
          if (!row.rows[0]) continue
          const full = await db.query(`${assignmentSelect} where a.id = $1`, [row.rows[0].id])
          out.push(toAssignment(full.rows[0]))
        }
      }
      return out
    })

    reply.code(201)
    return { assignments: created }
  })

  /**
   * Work the caller has set, with everyone they can see who was given it —
   * "who has done this yet?", which is the question a tutor opens the app for.
   *
   * The learner rows come back filtered by RLS rather than by anything here, so
   * a parent who shares work with another family sees their own child on it and
   * learns nothing about the others.
   */
  app.get('/assignments/sets', async (request) => {
    const caller = callerOf(request)

    const sets = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select t.id as set_id, t.subject, t.activity, t.target_id, t.title,
                t.note, t.min_accuracy, t.due_on, t.created_at,
                coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'assignmentId', a.id,
                      'learnerId',    a.learner_id,
                      'displayName',  l.display_name,
                      'avatarEmoji',  l.avatar_emoji,
                      'status',       a.status,
                      'completedAt',  a.completed_at,
                      'sessionId',    a.session_id
                    )
                    order by l.display_name
                  ) filter (where a.id is not null),
                  '[]'::jsonb
                ) as learners
           from public.assignment_sets t
           left join public.assignments a on a.set_id = t.id
           left join public.learners l    on l.id = a.learner_id
          where t.created_by = $1
          group by t.id
          order by t.created_at desc
          limit 200`,
        [caller.id],
      )

      return rows.map((row: Record<string, unknown>) => ({
        setId: row.set_id,
        subject: row.subject,
        activity: row.activity,
        targetId: row.target_id,
        title: row.title,
        note: row.note,
        minAccuracy: row.min_accuracy,
        dueOn: dayOf(row.due_on),
        createdAt: new Date(row.created_at as string).getTime(),
        learners: (row.learners as Array<Record<string, unknown>>).map((l) => ({
          ...l,
          completedAt: l.completedAt ? new Date(l.completedAt as string).getTime() : null,
        })),
      }))
    })

    return { sets }
  })

  /**
   * Edit the work itself. Changes what every learner it was given to sees, so
   * RLS restricts it to whoever wrote it — a parent must not be able to rewrite
   * work another family's child is looking at.
   */
  app.patch('/assignments/sets/:setId', async (request) => {
    const caller = callerOf(request)
    const { setId } = parse(z.object({ setId: uuid }), request.params)
    const patch = parse(assignmentSetPatchSchema, request.body)

    const updated = await withUser(caller.id, async (db) => {
      const row = await db.query(
        `update public.assignment_sets
            set title        = coalesce($2, title),
                note         = case when $3::boolean then $4 else note end,
                min_accuracy = case when $5::boolean then $6 else min_accuracy end,
                due_on       = case when $7::boolean then $8 else due_on end
          where id = $1
          returning id`,
        [setId, patch.title ?? null,
         'note' in patch, patch.note ?? null,
         'minAccuracy' in patch, patch.minAccuracy ?? null,
         'dueOn' in patch, patch.dueOn ?? null],
      )
      return row.rows[0]?.id ?? null
    })

    if (!updated) throw notFound('No such assignment set, or it is not yours to edit')
    return { setId: updated }
  })

  /**
   * Edit one learner's copy: cancel it, put it back, or reorder their list.
   * Marking work done is deliberately absent — that only happens by playing a
   * round that satisfies it.
   */
  app.patch('/learners/:id/assignments/:assignmentId', async (request) => {
    const caller = callerOf(request)
    const { id, assignmentId } = parse(
      z.object({ id: uuid, assignmentId: uuid }),
      request.params,
    )
    const patch = parse(assignmentPatchSchema, request.body)

    const updated = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const row = await db.query(
        `update public.assignments
            set sort_order   = coalesce($3, sort_order),
                status       = coalesce($4, status),
                -- Reopening drops the evidence with the status, so a task can
                -- never point at a round that no longer closes it.
                completed_at = case when $4 is null then completed_at else null end,
                session_id   = case when $4 is null then session_id else null end
          where id = $2 and learner_id = $1
          returning id`,
        [id, assignmentId, patch.sortOrder ?? null, patch.status ?? null],
      )
      if (!row.rows[0]) return null
      const full = await db.query(`${assignmentSelect} where a.id = $1`, [row.rows[0].id])
      return toAssignment(full.rows[0])
    })

    if (!updated) throw notFound('No such assignment')
    return { assignment: updated }
  })

  /** Withdraw the work entirely — every learner's copy goes with it. */
  app.delete('/assignments/sets/:setId', async (request, reply) => {
    const caller = callerOf(request)
    const { setId } = parse(z.object({ setId: uuid }), request.params)

    await withUser(caller.id, async (db) => {
      await db.query('delete from public.assignment_sets where id = $1', [setId])
    })

    reply.code(204)
    return null
  })

  /** Take one learner off a piece of work, leaving it set for everyone else. */
  app.delete('/learners/:id/assignments/:assignmentId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, assignmentId } = parse(
      z.object({ id: uuid, assignmentId: uuid }),
      request.params,
    )

    await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      await db.query('delete from public.assignments where id = $1 and learner_id = $2', [
        assignmentId, id,
      ])
    })

    reply.code(204)
    return null
  })

  // --- the library ---------------------------------------------------------
  //
  // Content that belongs to a grown-up rather than to one child. A tutor builds
  // a deck once and sets it for every student they work with; a parent keeps
  // the spelling list they wrote for all three of theirs. The alternative —
  // filing material under whichever learner happened to be on screen — is what
  // this replaces.

  app.get('/library', async (request) => {
    const caller = callerOf(request)

    const library = await withUser(caller.id, async (db) => {
      const [decks, lists] = await Promise.all([
        db.query(
          `select d.*,
                  coalesce(nullif(s.source_map ->> 'title', ''), s.origin) as source_title
             from public.decks d
             left join public.content_sources s on s.id = d.source_id
            where d.owner_user_id = $1
            order by d.updated_at desc`,
          [caller.id],
        ),
        db.query(
          'select * from public.word_lists where owner_user_id = $1 order by updated_at desc',
          [caller.id],
        ),
      ])
      return {
        decks: decks.rows.map(toDeck),
        customLists: lists.rows.map(toCustomList),
      }
    })

    return library
  })

  app.post('/library/decks', async (request, reply) => {
    const caller = callerOf(request)
    const { decks } = parse(
      z.object({ decks: z.array(quizDeckSchema).min(1).max(50) }),
      request.body,
    )

    const saved = await withUser(caller.id, async (db) => {
      const out = []
      for (const deck of decks) {
        const { rows } = await db.query(
          `insert into public.decks
             (id, owner_user_id, title, description, tags, cards, term_label,
              definition_label, track, objectives, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           on conflict (id) do update set
             title = excluded.title,
             description = excluded.description,
             tags = excluded.tags,
             cards = excluded.cards,
             term_label = excluded.term_label,
             definition_label = excluded.definition_label,
             track = excluded.track,
             objectives = excluded.objectives,
             updated_at = now()
           returning *`,
          [deck.id, caller.id, deck.title, deck.description ?? '', deck.tags ?? [],
           JSON.stringify(deck.cards ?? []), deck.termLabel ?? 'Term',
           deck.definitionLabel ?? 'Definition', deck.track ?? null,
           deck.objectives ?? []],
        )
        out.push(toDeck(rows[0]))
      }
      return out
    })

    reply.code(201)
    return { decks: saved }
  })

  app.post('/library/word-lists', async (request, reply) => {
    const caller = callerOf(request)
    const { customLists } = parse(
      z.object({ customLists: z.array(customWordListSchema).min(1).max(50) }),
      request.body,
    )

    const saved = await withUser(caller.id, async (db) => {
      const out = []
      for (const list of customLists) {
        const { rows } = await db.query(
          `insert into public.word_lists
             (id, owner_user_id, title, subject, grade, words, updated_at)
           values ($1,$2,$3,$4,$5,$6, now())
           on conflict (id) do update set
             title = excluded.title,
             grade = excluded.grade,
             words = excluded.words,
             updated_at = now()
           returning *`,
          [list.id, caller.id, list.title, 'spelling', list.grade ?? null,
           JSON.stringify(list.words ?? [])],
        )
        out.push(toCustomList(rows[0]))
      }
      return out
    })

    reply.code(201)
    return { customLists: saved }
  })

  app.delete('/library/decks/:deckId', async (request, reply) => {
    const caller = callerOf(request)
    const { deckId } = parse(z.object({ deckId: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      await db.query('delete from public.decks where id = $1 and owner_user_id = $2', [
        deckId, caller.id,
      ])
    })
    reply.code(204)
    return null
  })

  app.delete('/library/word-lists/:listId', async (request, reply) => {
    const caller = callerOf(request)
    const { listId } = parse(z.object({ listId: uuid }), request.params)
    await withUser(caller.id, async (db) => {
      await db.query('delete from public.word_lists where id = $1 and owner_user_id = $2', [
        listId, caller.id,
      ])
    })
    reply.code(204)
    return null
  })

  // --- content -------------------------------------------------------------

  app.post('/learners/:id/word-lists', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { customLists } = parse(
      z.object({ customLists: z.array(customWordListSchema).min(1).max(200) }),
      request.body,
    )

    const saved = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      const out = []
      for (const list of customLists) {
        const { rows } = await db.query(
          `insert into public.word_lists (id, learner_id, title, subject, grade, words, created_by, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7, now())
           on conflict (id) do update set
             title = excluded.title,
             subject = excluded.subject,
             grade = excluded.grade,
             words = excluded.words,
             updated_at = now()
           returning *`,
          [list.id, id, list.title, list.subject, list.grade, JSON.stringify(list.words), caller.id],
        )
        const row = rows[0]
        if (row) out.push(toCustomList(row))
      }
      return out
    })

    return { customLists: saved }
  })

  app.delete('/learners/:id/word-lists/:listId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, listId } = parse(z.object({ id: uuid, listId: uuid }), request.params)

    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query(
        'delete from public.word_lists where id = $1 and learner_id = $2',
        [listId, id],
      )
      if (!rowCount) throw notFound('No such word list')
    })

    reply.code(204)
    return null
  })

  app.post('/learners/:id/decks', async (request) => {
    const caller = callerOf(request)
    const { id } = parse(z.object({ id: uuid }), request.params)
    const { decks } = parse(
      z.object({ decks: z.array(quizDeckSchema).min(1).max(200) }),
      request.body,
    )

    const saved = await withUser(caller.id, async (db) => {
      await assertVisible(db, id)
      await assertUnderDeckLimit(db, id, decks)
      const out = []
      for (const deck of decks) {
        const { rows } = await db.query(
          `insert into public.decks
             (id, learner_id, title, description, tags, cards, term_label,
              definition_label, created_by, track, objectives, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           on conflict (id) do update set
             title = excluded.title,
             description = excluded.description,
             tags = excluded.tags,
             cards = excluded.cards,
             term_label = excluded.term_label,
             definition_label = excluded.definition_label,
             track = excluded.track,
             objectives = excluded.objectives,
             updated_at = now()
           returning *`,
          [deck.id, id, deck.title, deck.description, deck.tags,
           JSON.stringify(deck.cards), deck.termLabel, deck.definitionLabel, caller.id,
           deck.track ?? null, deck.objectives ?? []],
        )
        const row = rows[0]
        if (row) out.push(toDeck(row))
      }
      return out
    })

    return { decks: saved }
  })

  app.delete('/learners/:id/decks/:deckId', async (request, reply) => {
    const caller = callerOf(request)
    const { id, deckId } = parse(z.object({ id: uuid, deckId: uuid }), request.params)

    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query(
        'delete from public.decks where id = $1 and learner_id = $2',
        [deckId, id],
      )
      if (!rowCount) throw notFound('No such deck')
    })

    reply.code(204)
    return null
  })
}
