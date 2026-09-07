// Validation for everything the browser can write.
//
// This is the boundary where an optimistic client-side model becomes rows, so
// it is validated properly rather than trusted. RLS decides *whose* rows may be
// touched; these schemas decide whether the payload is a coherent piece of
// progress at all.

import { z } from 'zod'

export const subjectSchema = z.enum(['spelling', 'typing', 'quiz'])

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD day')

const epochMs = z.number().int().min(0)

/**
 * Which ability pool a row belongs to. Bounded rather than enumerated: the
 * registry lives in `@whizzo/shared` and grows without a schema change, and an
 * unknown track resolves to General rather than being rejected — a learner
 * must never lose work because a registry moved on.
 */
export const trackId = z.string().max(60)

export const skillStateSchema = z.object({
  subject: subjectSchema,
  track: trackId.optional(),
  ability: z.number().finite(),
  abilitySd: z.number().finite().nonnegative(),
  levelIndex: z.number().int().min(0),
  placed: z.boolean(),
  totalAttempts: z.number().int().min(0),
  totalCorrect: z.number().int().min(0),
  streakDays: z.number().int().min(0),
  bestStreakDays: z.number().int().min(0),
  lastActiveOn: dayString.nullable(),
  settings: z.record(z.unknown()).default({}),
})

export const itemMasterySchema = z.object({
  subject: subjectSchema,
  itemKey: z.string().min(1).max(200),
  listId: z.string().max(120).nullable(),
  difficulty: z.number().finite(),
  mastery: z.number().min(0).max(1),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  correctStreak: z.number().int().min(0),
  totalAttempts: z.number().int().min(0),
  totalCorrect: z.number().int().min(0),
  intervalDays: z.number().finite().min(0),
  dueOn: dayString.nullable(),
  firstSeenAt: epochMs,
  lastSeenAt: epochMs,
})

/**
 * A task a grown-up sets. `status`, `completedAt` and `sessionId` are absent on
 * purpose: a task is closed by the round that satisfied it, so they are never
 * something a caller supplies.
 */
export const assignmentGoalSchema = z.object({
  kind: z.literal('mastery'),
  fraction: z.number().min(0.1).max(1).optional(),
})

export const assignmentDraftSchema = z.object({
  goal: assignmentGoalSchema.nullable().optional(),
  subject: subjectSchema,
  activity: z.string().min(1).max(60),
  targetId: z.string().max(120).nullable().optional(),
  size: z.number().int().min(1).max(200).nullable().optional(),
  title: z.string().min(1).max(120),
  note: z.string().max(500).nullable().optional(),
  minAccuracy: z.number().int().min(1).max(100).nullable().optional(),
  dueOn: dayString.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})

/** Editing the work itself, which every learner given it will see. */
export const assignmentSetPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  note: z.string().max(500).nullable().optional(),
  minAccuracy: z.number().int().min(1).max(100).nullable().optional(),
  dueOn: dayString.nullable().optional(),
})

/** Editing one learner's copy: cancel, reopen, reorder. */
export const assignmentPatchSchema = z.object({
  sortOrder: z.number().int().min(0).max(10000).optional(),
  // 'done' is not offered: finishing work is something you do, not something
  // you declare.
  status: z.enum(['open', 'cancelled']).optional(),
})

export const attemptSchema = z.object({
  subject: subjectSchema,
  track: trackId.nullable().optional(),
  itemKey: z.string().min(1).max(200),
  activity: z.string().min(1).max(60),
  // Which rung the question was actually asked at. A mode is a container —
  // Learn asks each card at its own rung — so the activity alone would read a
  // scaffolded answer back as unaided recall.
  askedAt: z.number().int().min(0).max(3).nullable().optional(),
  isTest: z.boolean(),
  // Older clients predate the flag; they only ever sent system-checked
  // attempts, so defaulting to true keeps their rows honest.
  verified: z.boolean().default(true),
  correct: z.boolean(),
  responseMs: z.number().int().min(0).nullable(),
  hintsUsed: z.number().int().min(0),
  difficulty: z.number().finite(),
  given: z.string().max(400).nullable(),
  at: epochMs,
  // Accepted for round-tripping, ignored on write: the API links an attempt to
  // the session it arrived with rather than to whichever id the caller names.
  sessionId: z.string().uuid().nullable().optional(),
})

export const sessionRecordSchema = z.object({
  id: z.string().uuid(),
  subject: subjectSchema,
  track: trackId.nullable().optional(),
  activity: z.string().min(1).max(60),
  listId: z.string().max(120).nullable(),
  isTest: z.boolean(),
  itemsTotal: z.number().int().min(0),
  itemsCorrect: z.number().int().min(0),
  accuracy: z.number().min(0).max(100),
  score: z.number().int(),
  wpm: z.number().int().min(0).nullable(),
  durationMs: z.number().int().min(0),
  abilityBefore: z.number().finite().nullable(),
  abilityAfter: z.number().finite().nullable(),
  meta: z.record(z.unknown()).default({}),
  startedAt: epochMs,
  endedAt: epochMs,
  // Provenance is derived from the attempts on the way in, never taken from
  // the caller. Accepted so a snapshot can be round-tripped, then overwritten.
  evidence: z.enum(['attempts', 'client', 'legacy']).optional(),
  verifiedItemsTotal: z.number().int().min(0).optional(),
  verifiedItemsCorrect: z.number().int().min(0).optional(),
})

export const listProgressSchema = z.object({
  subject: subjectSchema,
  listId: z.string().min(1).max(120),
  plays: z.number().int().min(0),
  testsTaken: z.number().int().min(0),
  bestScore: z.number().int(),
  bestAccuracy: z.number().min(0).max(100),
  stars: z.number().int().min(0).max(3),
  masteredAt: epochMs.nullable(),
})

export const achievementSchema = z.object({
  achievementId: z.string().min(1).max(80),
  subject: z.string().min(1).max(20),
  unlockedAt: epochMs,
})

export const highScoreSchema = z.object({
  id: z.string().optional(),
  subject: subjectSchema,
  mode: z.string().min(1).max(40),
  score: z.number().int(),
  wpm: z.number().int().min(0).nullable(),
  accuracy: z.number().min(0).max(100).nullable(),
  createdAt: epochMs.optional(),
})

export const dailySchema = z.object({
  subject: subjectSchema,
  seconds: z.number().min(0),
  items: z.number().int().min(0),
  correct: z.number().int().min(0),
})

// Either side of a card may carry maths or a figure, and a figure is a JSON
// object inside the text — a labelled coordinate grid runs to a couple of
// thousand characters on its own. The ceiling is still there (a deck is read
// and written whole), just set where a real question can fit under it.
export const MAX_CARD_TEXT = 4000

// The enrichment fields are optional everywhere: a deck saved before they
// existed must still validate, and a two-column paste must still be a deck.
// Bounds are ceilings rather than guidance — each one is well past the point
// where the field stops being useful on a card.
export const quizCardSchema = z.object({
  id: z.string().min(1).max(80),
  term: z.string().min(1).max(MAX_CARD_TEXT),
  definition: z.string().min(1).max(MAX_CARD_TEXT),
  hint: z.string().max(1000).nullable(),
  difficulty: z.number().finite(),

  category: z.string().max(60).nullable().optional(),
  example: z.string().max(600).nullable().optional(),
  order: z.number().int().finite().nullable().optional(),
  media: z
    .object({
      kind: z.enum(['image', 'audio']),
      url: z.string().max(2000),
      alt: z.string().max(300),
    })
    .nullable()
    .optional(),
  answerKind: z.enum(['text', 'numeric', 'set']).optional(),
  tolerance: z.number().finite().nonnegative().nullable().optional(),
  altAnswers: z.array(z.string().max(200)).max(8).optional(),
  explanation: z.string().max(600).nullable().optional(),
  sourcePages: z.array(z.number().int().nonnegative()).max(8).optional(),
  generated: z.array(z.string().max(40)).max(12).optional(),
})

export const quizDeckSchema = z.object({
  id: z.string().uuid(),
  track: trackId.nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  objectives: z.array(z.string().max(80)).max(4).optional(),
  title: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(''),
  tags: z.array(z.string().max(40)).max(20).default([]),
  // Bounded deliberately: a deck is read and written whole, so an unbounded
  // card array is an unbounded request body.
  cards: z.array(quizCardSchema).max(500),
  source: z.enum(['user', 'starter']).default('user'),
  termLabel: z.string().max(40).default('Term'),
  definitionLabel: z.string().max(40).default('Definition'),
  createdAt: epochMs.optional(),
  updatedAt: epochMs.optional(),
})

export const customWordListSchema = z.object({
  id: z.string().uuid(),
  track: trackId.nullable().optional(),
  objectives: z.array(z.string().max(80)).max(4).optional(),
  title: z.string().trim().min(1).max(80),
  subject: subjectSchema,
  grade: z.number().int().min(0).max(12).nullable(),
  words: z
    .array(z.object({ w: z.string().min(1).max(60), s: z.string().max(400) }))
    .max(1000),
  updatedAt: epochMs.optional(),
})

export const progressChangeSchema = z
  .object({
    skill: skillStateSchema.optional(),
    // A review round crosses decks, so it moves several pools at once. Bounded
    // like everything else here: an unbounded array is an unbounded request.
    skills: z.array(skillStateSchema).max(40).optional(),
    mastery: z.array(itemMasterySchema).max(1000).optional(),
    session: sessionRecordSchema.optional(),
    attempts: z.array(attemptSchema).max(1000).optional(),
    list: listProgressSchema.optional(),
    achievements: z.array(achievementSchema).max(100).optional(),
    highScore: highScoreSchema.optional(),
    daily: dailySchema.optional(),
    customLists: z.array(customWordListSchema).max(200).optional(),
    decks: z.array(quizDeckSchema).max(200).optional(),
    // The learner's own calendar day, so a card closed by this round lands on
    // the day they saw it happen rather than the server's.
    today: dayString.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'That change was empty' })

export const snapshotSchema = z.object({
  skills: z.record(skillStateSchema),
  mastery: z.record(itemMasterySchema),
  lists: z.record(listProgressSchema),
  achievements: z.array(achievementSchema).max(500),
  highScores: z.array(highScoreSchema).max(500),
  daily: z.array(
    dailySchema.extend({ day: dayString, sessions: z.number().int().min(0) }),
  ).max(1000),
  sessions: z.array(sessionRecordSchema).max(500),
  customLists: z.array(customWordListSchema).max(200),
  decks: z.array(quizDeckSchema).max(200),
})

export type SkillStateInput = z.output<typeof skillStateSchema>
export type ItemMasteryInput = z.output<typeof itemMasterySchema>
export type ProgressChangeInput = z.output<typeof progressChangeSchema>
export type SnapshotInput = z.output<typeof snapshotSchema>
