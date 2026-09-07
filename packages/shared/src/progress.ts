// Types shared by every learning objective in the suite. Adding a subject means
// adding a string here, not a new set of tables.

import type { TrackId } from './tracks.js'
import type { PlannerOverview } from './planner.js'

export type Subject = 'spelling' | 'typing' | 'quiz'

export const SUBJECTS: Subject[] = ['spelling', 'typing', 'quiz']

/** ISO calendar day, e.g. '2026-08-19'. */
export type DayString = string

/**
 * The adaptive engine's persistent state for one learner in one subject.
 * `ability` and item `difficulty` live on the same scale so they can be
 * compared directly; for spelling that scale is roughly "school grade".
 */
export interface SkillState {
  subject: Subject
  /**
   * Which ability pool this is. Empty string means the learner's whole-subject
   * state, which is what every row was before tracks existed — spelling and
   * typing keep using it, because their curriculum *is* the track.
   */
  track?: TrackId
  ability: number
  abilitySd: number
  levelIndex: number
  placed: boolean
  totalAttempts: number
  totalCorrect: number
  streakDays: number
  bestStreakDays: number
  lastActiveOn: DayString | null
  settings: Record<string, unknown>
}

/** What the learner knows about one word (or one key), and when to show it next. */
export interface ItemMastery {
  subject: Subject
  itemKey: string
  listId: string | null
  difficulty: number
  /** 0..1, recency-weighted share of graded attempts answered correctly. */
  mastery: number
  reps: number
  lapses: number
  correctStreak: number
  totalAttempts: number
  totalCorrect: number
  intervalDays: number
  dueOn: DayString | null
  firstSeenAt: number
  lastSeenAt: number
}

/** One graded or practised item. The append-only record everything derives from. */
export interface Attempt {
  subject: Subject
  itemKey: string
  activity: string
  /** Only test-quality attempts (no hints, spelled from scratch) move ability. */
  isTest: boolean
  /**
   * Did the system check this answer, or did the learner tell us how they did?
   *
   * Flashcard self-grades are the only unverified attempts in the app. The
   * distinction is orthogonal to `isTest` (which only means "no hints were
   * shown") and it has to survive all the way to the database, because
   * anything that hands out a reward has to be able to ask for evidence
   * rather than a claim.
   */
  verified: boolean
  correct: boolean
  responseMs: number | null
  hintsUsed: number
  difficulty: number
  /** What the learner actually typed, kept so mistakes can be reviewed. */
  given: string | null
  at: number
  /** The round this belongs to. Set by whoever stores it, not by the caller. */
  sessionId?: string | null
  /**
   * Which pool this work counted toward.
   *
   * Denormalised on purpose. It could be recovered by joining through `decks`,
   * and that would be wrong twice: a deleted deck takes its track with it, and
   * — more importantly — it breaks the property the whole schema rests on,
   * that `attempts` alone can rebuild every other table.
   */
  track?: TrackId | null
  /**
   * Which rung this question was actually asked at, 0-3.
   *
   * `activity` records the *mode* — a round of Learn records `learn` on every
   * attempt in it — but Learn asks a card at whatever rung that card is on, so
   * the mode does not say what happened. Without this, a scaffolded question
   * inside Learn would be read back as unaided recall and would promote the
   * item on evidence that does not exist.
   *
   * Optional because attempts recorded before the ladder have none; the ladder
   * falls back to the mode's own rung, which is what those rounds meant at the
   * time.
   */
  askedAt?: number | null
}

export interface SessionRecord {
  id: string
  subject: Subject
  activity: string
  listId: string | null
  isTest: boolean
  itemsTotal: number
  itemsCorrect: number
  accuracy: number
  score: number
  wpm: number | null
  durationMs: number
  abilityBefore: number | null
  abilityAfter: number | null
  meta: Record<string, unknown>
  startedAt: number
  endedAt: number
  /**
   * Where this session's counts came from. Derived, never sent by a client:
   * whoever stores the row works it out from the attempts that came with it.
   *
   *   'attempts' — counts recomputed from the submitted attempts
   *   'client'   — no attempts accompanied the session, so the summary is the
   *                finest grain there is (typing rounds count keystrokes)
   *   'legacy'   — recorded before provenance was tracked
   */
  evidence?: SessionEvidenceKind
  /** Of the distinct items here, how many were system-checked rather than self-graded. */
  verifiedItemsTotal?: number
  verifiedItemsCorrect?: number
  /** Which pool this round counted toward. See `Attempt.track`. */
  track?: TrackId | null
}

export interface ListProgress {
  subject: Subject
  listId: string
  plays: number
  testsTaken: number
  bestScore: number
  bestAccuracy: number
  stars: number
  masteredAt: number | null
}

export interface UnlockedAchievement {
  achievementId: string
  subject: string
  unlockedAt: number
}

export interface HighScoreRow {
  id: string
  subject: Subject
  mode: string
  score: number
  wpm: number | null
  accuracy: number | null
  createdAt: number
}

export interface DailyActivityRow {
  day: DayString
  subject: Subject
  seconds: number
  items: number
  correct: number
  sessions: number
}

/**
 * One side-by-side pair on a study deck. `term` is the prompt side and
 * `definition` the answer side, but every activity can run the pair backwards,
 * so neither is privileged beyond which one shows first.
 */
export interface QuizCard {
  id: string
  term: string
  definition: string
  hint: string | null
  /**
   * Roughly 1-5, on the same scale as the learner's quiz ability. Derived from
   * the answer's shape when a deck is saved rather than asked of the author,
   * because nobody making a deck at 10pm wants to rate 40 cards by hand.
   */
  difficulty: number

  // --- Enrichment ---------------------------------------------------------
  //
  // Every field below is optional, and every one of them unlocks an activity
  // that cannot run without it. They are the whole mechanism behind "load
  // content once, practise it many ways": the capability matrix reads what is
  // present and offers what the content can actually support, and an activity
  // whose field is missing degrades to the nearest one that works rather than
  // disappearing. See docs/learning-activities-spec.md, *The item model*.
  //
  // Nothing here is required of an author. A pasted two-column list still
  // makes a working deck; these are filled in by import, by enrichment, or
  // not at all.

  /** Bucket this item belongs to. Unlocks Sort and Odd One Out. */
  category?: string | null
  /** A sentence or scenario using the term. Unlocks Fill the Blank and Apply. */
  example?: string | null
  /** Position in an ordered set. Unlocks Put It In Order. */
  order?: number | null
  /**
   * Photographs and recorded audio only. Anything drawable — charts, shapes,
   * number lines, geometry — is a `[[figure {…}]]` inside the text instead,
   * per docs/card-formatting.md. Two ways to carry a diagram would be one too
   * many, and the figure is the better one: it is data, it is describable, and
   * a model can write it.
   */
  media?: QuizCardMedia | null
  /**
   * How a typed answer is graded. `numeric` switches off the edit-distance
   * tolerance entirely: a transposition in a number is a wrong answer, not a
   * typo. Defaults to `text` when absent.
   */
  answerKind?: QuizAnswerKind
  /** Numeric answers only: the acceptable absolute error. */
  tolerance?: number | null
  /**
   * Extra acceptable answers, beyond the `/` and `;` splitting that
   * `acceptableAnswers` already does on the definition itself.
   */
  altAnswers?: string[]
  /**
   * Why the answer is the answer. Shown after a miss, never after every
   * answer: explanatory feedback beats corrective feedback, and feedback
   * nobody reads beats neither.
   */
  explanation?: string | null
  /** Pages of the source document this card came from, when it came from one. */
  sourcePages?: number[]
  /**
   * Which fields were machine-derived rather than written by a person, so the
   * UI can say so. A generated example is a prompt; it is never an authority.
   */
  generated?: string[]
}

export type QuizAnswerKind = 'text' | 'numeric' | 'set'

export interface QuizCardMedia {
  kind: 'image' | 'audio'
  url: string
  alt: string
}

/**
 * A study set. Decks are content, not progress: what the learner *knows* about
 * each card lives in `mastery` under the item key `deckId:cardId`, which is why
 * a deck can be edited without resetting anything the learner has earned.
 */
export interface QuizDeck {
  id: string
  /**
   * The ability pool this set belongs to. Null means General — filing is an
   * upgrade, never a gate, and a parent pasting twenty words is asked nothing.
   */
  track?: TrackId | null
  /**
   * What this set teaches, as stable objective ids. Written now and read by
   * nothing: it is the join key that lets two people's independently made
   * content be recognised as alternatives for the same goal, and backfilling
   * it later would mean revisiting every set anyone ever made.
   */
  objectives?: string[]
  /**
   * The document this set was made from, when it was made from one.
   *
   * A twenty-page chapter comes back as six sets. Without this they are six
   * loose decks in a list of thirty, and the parent who uploaded the chapter
   * has to remember which six and in what order — so the one thing the upload
   * actually established, that these belong together, is thrown away at the
   * moment it would be useful.
   */
  sourceId?: string | null
  /** What that document was called, for the heading above its sets. */
  sourceTitle?: string | null
  /** The learner's course this deck belongs to. Learner-owned decks only. */
  courseId?: string | null
  title: string
  description: string
  tags: string[]
  cards: QuizCard[]
  /** Starter decks ship with the app and are copied, not edited, in place. */
  source: 'user' | 'starter'
  /** What to call each side, e.g. 'Spanish' / 'English'. Purely cosmetic. */
  termLabel: string
  definitionLabel: string
  createdAt: number
  updatedAt: number
}

export interface CustomWordList {
  id: string
  track?: TrackId | null
  objectives?: string[]
  title: string
  subject: Subject
  grade: number | null
  words: Array<{ w: string; s: string }>
  updatedAt: number
}

/** Everything the app needs in memory to render and to plan a session. */
export interface ProgressSnapshot {
  skills: Record<string, SkillState>
  mastery: Record<string, ItemMastery> // key: `${subject}:${itemKey}`
  lists: Record<string, ListProgress> // key: `${subject}:${listId}`
  achievements: UnlockedAchievement[]
  highScores: HighScoreRow[]
  daily: DailyActivityRow[]
  sessions: SessionRecord[] // most recent first, capped
  customLists: CustomWordList[]
  decks: QuizDeck[]
}

export function masteryKey(subject: Subject, itemKey: string): string {
  return `${subject}:${itemKey}`
}

/**
 * The key for one learner's ability in one pool.
 *
 * Spelling and typing pass no track: their curriculum *is* the pool, and an
 * absolute scale that means something outside the app cannot be split without
 * ceasing to mean it. Study sets pass theirs, which is the whole point — one
 * number spanning Spanish and biology was an average of unrelated things.
 */
export function skillKey(subject: Subject, track?: TrackId | null): string {
  return track ? `${subject}:${track}` : subject
}

export function listKey(subject: Subject, listId: string): string {
  return `${subject}:${listId}`
}

/**
 * The mastery key for one card. Deck-scoped on purpose: the same term on two
 * different decks is two different things to learn, and merging them would let
 * a card the learner has never seen arrive pre-mastered.
 */
export function cardKey(deckId: string, cardId: string): string {
  return `${deckId}:${cardId}`
}

export function emptySnapshot(): ProgressSnapshot {
  return {
    skills: {},
    mastery: {},
    lists: {},
    achievements: [],
    highScores: [],
    daily: [],
    sessions: [],
    customLists: [],
    decks: [],
  }
}

export function defaultSkillState(subject: Subject, track?: TrackId | null): SkillState {
  return {
    subject,
    ...(track ? { track } : {}),
    // Spelling starts the learner at second grade, as requested; typing and
    // quiz have no grade band so they just track a relative ability number.
    // Quiz starts mid-scale because deck difficulty is relative to the deck.
    ability: subject === 'spelling' ? 2.0 : subject === 'quiz' ? 2.0 : 1.0,
    abilitySd: 1.2,
    levelIndex: 0,
    placed: false,
    totalAttempts: 0,
    totalCorrect: 0,
    streakDays: 0,
    bestStreakDays: 0,
    lastActiveOn: null,
    settings: {},
  }
}

export function todayString(now: Date = new Date()): DayString {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(day: DayString, days: number): DayString {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + Math.round(days))
  return todayString(date)
}

export function daysBetween(from: DayString, to: DayString): number {
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  const a = Date.UTC(ay, am - 1, ad)
  const b = Date.UTC(by, bm - 1, bd)
  return Math.round((b - a) / 86400000)
}

/**
 * One atomic unit of progress, produced at the end of a round of practice.
 *
 * This is a wire shape as well as a domain shape: the web app posts one of
 * these to the API, which is the only thing that turns it into rows.
 */
export interface ProgressChange {
  /**
   * The learner's own calendar day when the round ended. The planner closes a
   * study card on the day the learner saw it happen; the server's clock may
   * already be tomorrow.
   */
  today?: DayString
  skill?: SkillState
  /**
   * Ability moved in more than one pool.
   *
   * A round pinned to one deck touches one pool, and `skill` says it. A review
   * round crosses decks by design, and each answer is evidence about its own
   * subject — folding them into one number is the averaging problem tracks
   * exist to fix. Both fields are applied; `skill` is kept because every
   * caller that only ever touches one pool should not have to build an array.
   */
  skills?: SkillState[]
  mastery?: ItemMastery[]
  session?: SessionRecord
  attempts?: Attempt[]
  list?: ListProgress
  achievements?: UnlockedAchievement[]
  highScore?: HighScoreRow
  daily?: { subject: Subject; seconds: number; items: number; correct: number }
  /** Full replacement of the learner's custom lists. */
  customLists?: CustomWordList[]
  /** Full replacement of the learner's study decks. */
  decks?: QuizDeck[]
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------
//
// A session summary is a convenience. The attempts are the record. These two
// helpers are the single definition of how you get from one to the other, and
// they live here because both sides need to agree: the API applies them to
// every round a signed-in learner posts, and guest storage applies them to
// every round played without an account.

export type SessionEvidenceKind = 'attempts' | 'client' | 'legacy'

/**
 * Modes where the learner grades themselves.
 *
 * Whether an answer was checked is a property of the mode it was answered in,
 * not something a caller gets to assert — so this is applied server-side to
 * every attempt that arrives, and a claim of `verified: true` on a self-graded
 * mode is corrected rather than believed.
 */
export const SELF_GRADED_ACTIVITIES: readonly string[] = ['flashcards']

export function isSelfGraded(activity: string): boolean {
  return SELF_GRADED_ACTIVITIES.includes(activity)
}

/** Apply the mode rule to one attempt, so `verified` reflects how it was answered. */
export function withVerifiedFlag(attempt: Attempt): Attempt {
  const verified = attempt.verified && !isSelfGraded(attempt.activity)
  return verified === attempt.verified ? attempt : { ...attempt, verified }
}

export interface DerivedSessionCounts {
  itemsTotal: number
  itemsCorrect: number
  accuracy: number
  verifiedItemsTotal: number
  verifiedItemsCorrect: number
  evidence: SessionEvidenceKind
}

/**
 * Recompute a session's counts from the attempts it was played with.
 *
 * Scored on the *first* attempt at each item, in the order they were played.
 * A round can ask the same card more than once — a missed card comes back
 * before the round is out — and a learner who goes back over something they
 * missed should not be scored worse than one who never returned to it.
 *
 * Returns null when there are no attempts to derive from, which is a real
 * case rather than an error: a typing round's items are keystrokes and its
 * summary is already the finest grain available.
 */
export function deriveSessionCounts(attempts: Attempt[]): DerivedSessionCounts | null {
  if (!attempts.length) return null

  const first = new Map<string, Attempt>()
  for (const attempt of attempts) {
    const key = masteryKey(attempt.subject, attempt.itemKey)
    if (!first.has(key)) first.set(key, withVerifiedFlag(attempt))
  }

  const firsts = [...first.values()]
  const itemsTotal = firsts.length
  const itemsCorrect = firsts.filter((a) => a.correct).length
  const verified = firsts.filter((a) => a.verified)

  return {
    itemsTotal,
    itemsCorrect,
    accuracy: Math.round((itemsCorrect / itemsTotal) * 100),
    verifiedItemsTotal: verified.length,
    verifiedItemsCorrect: verified.filter((a) => a.correct).length,
    evidence: 'attempts',
  }
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
//
// Work a grown-up sets for a learner. A task names one piece of work and is
// closed by the round that satisfied it — never by anyone ticking it off — so
// `sessionId` on a finished task is the evidence, and the history screen can
// open it.

export type AssignmentStatus = 'open' | 'done' | 'cancelled'

/**
 * One learner's copy of a piece of work.
 *
 * Flattened for the client: the definition lives on the set and the state on
 * the row, but nothing above the API cares — what a task list wants is one
 * object per line it draws. `setId` is what makes two children's copies of the
 * same work recognisable as the same work.
 */
export interface Assignment {
  id: string
  setId: string
  /** Present when this is a goal. Closed by a state, never by one session. */
  goal?: AssignmentGoal | null
  learnerId: string
  createdBy: string | null
  subject: Subject
  /** Quiz mode, spelling activity, or 'lesson' for typing. */
  activity: string
  /** Deck, spelling list, or typing lesson. Null lets the activity choose. */
  targetId: string | null
  size: number | null
  title: string
  note: string | null
  /**
   * An optional bar to clear, judged on answers the app checked rather than on
   * the headline score. A self-graded mode has no checked answers and so can
   * never clear one — which is why the UI only offers this on graded work.
   */
  minAccuracy: number | null
  dueOn: DayString | null
  sortOrder: number
  /** The learner's course this was filed under, if any. Per learner, never on the set. */
  courseId?: string | null
  status: AssignmentStatus
  completedAt: number | null
  /** The round that closed this task. Always set when status is 'done'. */
  sessionId: string | null
  createdAt: number
}

/**
 * One piece of work and everyone it was given to.
 *
 * The author's view — a tutor asking "who has done this yet?". `learners` holds
 * only the rows the caller is allowed to see, so a parent who shares work with
 * another family sees their own child on it and nobody else's.
 */
export interface AssignmentSetSummary {
  setId: string
  subject: Subject
  activity: string
  targetId: string | null
  title: string
  note: string | null
  minAccuracy: number | null
  dueOn: DayString | null
  createdAt: number
  learners: Array<{
    assignmentId: string
    learnerId: string
    displayName: string
    avatarEmoji: string
    status: AssignmentStatus
    completedAt: number | null
    sessionId: string | null
  }>
}

/** What a grown-up sends to set a task. Everything else is decided here or by evidence. */
/**
 * A goal, rather than an activity.
 *
 * "Master this set" instead of "do Learn on this deck" — which stops a parent
 * having to choose between Learn and Test, a pedagogical decision they should
 * never have been handed.
 */
export interface AssignmentGoal {
  kind: 'mastery'
  /** Share of the set that must be mastered. Defaults to 0.9. */
  fraction?: number
}

export interface AssignmentDraft {
  subject: Subject
  activity: string
  goal?: AssignmentGoal | null
  targetId?: string | null
  size?: number | null
  title: string
  note?: string | null
  minAccuracy?: number | null
  dueOn?: DayString | null
  sortOrder?: number
}

/** One child's line on the family dashboard. */
export interface LearnerOverview {
  learnerId: string
  displayName: string
  avatarEmoji: string
  /** Tasks still to do, and how many of those are past their due date. */
  openAssignments: number
  overdueAssignments: number
  /** Tasks finished in the last week. */
  doneThisWeek: number
  /** The most recent round of any kind, for "last seen practising". */
  lastActiveAt: number | null
  /** Practice in the last seven days. */
  minutesThisWeek: number
  itemsThisWeek: number
  /** Accuracy over the last seven days, counting only answers the app checked. */
  verifiedAccuracyThisWeek: number | null
  currentStreakDays: number
  /** The planner line: planned or not, the next test, heavy days. */
  planner?: PlannerOverview | null
}
