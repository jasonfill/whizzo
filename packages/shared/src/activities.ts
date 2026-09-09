// One registry of every activity in the suite.
//
// There are two half-registries today — `ACTIVITIES` in the spelling module
// and `MODES` in the quiz module — plus a typing lesson that is neither. They
// disagree about what an activity even has: one carries `unaided`, the other
// carries `isTest`, and neither knows what rung it asks at or what a card must
// carry for it to run. Anything that wants to reason across subjects has to
// know about all three, which is why `ASSIGNABLE` in the web app is a hand-kept
// list that has to be edited every time an activity is added.
//
// This lives in `shared` rather than in the web app for one concrete reason:
// the acceptance test for generated content is *"does this set make the
// capability matrix read ready?"*, and that has to be answerable on the server,
// before a deck is written.

import { stageOf, type SupportLevel } from './ladder.js'

export type ActivitySubject = 'spelling' | 'quiz' | 'typing'

/**
 * What a card must carry for an activity to run on it.
 *
 * `plain-answer` is the one that is easy to miss and expensive to get wrong:
 * an activity that chops the answer into characters cannot run on an answer
 * that is an equation or a figure. See `activityRunsOn`.
 */
// Added one at a time, with the activity that needs it. A requirement nothing
// declares is a branch nothing exercises, and the capability matrix is the last
// place worth carrying speculative code: it decides what a learner is offered.
export type ContentRequirement = 'plain-answer' | 'example' | 'pool' | 'speakable'

export interface ActivityDef {
  id: string
  name: string
  emoji: string
  blurb: string
  subjects: ActivitySubject[]
  /** Which rung this asks at. The single source is `ACTIVITY_STAGE`. */
  stage: SupportLevel
  /** Graded activities move the learner's ability; practice ones do not. */
  isTest: boolean
  /**
   * Whether the app checks the answer, or the learner reports how they did.
   * A property of the mode, never of the caller — the same rule
   * `SELF_GRADED_ACTIVITIES` already enforces on attempts.
   */
  verified: boolean
  requires: ContentRequirement[]
  /** What to offer instead when the content cannot support this. */
  fallback: string | null
  /**
   * Whether a grown-up can set this as a piece of work.
   *
   * Not everything in this catalog is a round you can start. The scaffolded
   * kinds are how a *question* is asked inside Learn, chosen per card by the
   * ladder — "do twenty word-banks" is not a coherent thing to assign, and a
   * task pointing at one would have nowhere to go.
   */
  assignable: boolean
}

function def(
  d: Omit<ActivityDef, 'stage' | 'assignable'> & { stage?: SupportLevel; assignable?: boolean },
): ActivityDef {
  return { ...d, stage: d.stage ?? stageOf(d.id), assignable: d.assignable ?? true }
}

export const ACTIVITY_CATALOG: ActivityDef[] = [
  // --- Spelling -----------------------------------------------------------
  def({
    id: 'study',
    name: 'Study the List',
    emoji: '📖',
    blurb: 'See it, hear it, type it along with the word in front of you.',
    subjects: ['spelling'],
    isTest: false,
    verified: false,
    requires: [],
    fallback: null,
  }),
  def({
    id: 'proofread',
    name: 'Proofread',
    emoji: '🔍',
    blurb: 'Spot the correctly spelled word among the impostors.',
    subjects: ['spelling'],
    isTest: false,
    verified: true,
    requires: ['plain-answer'],
    fallback: null,
  }),
  def({
    id: 'missing-letters',
    name: 'Missing Letters',
    emoji: '🧩',
    blurb: 'Fill in the letters that fell out of the word.',
    subjects: ['spelling'],
    isTest: false,
    verified: true,
    requires: ['plain-answer'],
    fallback: 'first-letter',
  }),
  def({
    id: 'scramble',
    name: 'Word Scramble',
    emoji: '🔀',
    blurb: 'Untangle the letters to rebuild the word.',
    subjects: ['spelling'],
    isTest: false,
    verified: true,
    requires: ['plain-answer'],
    fallback: 'first-letter',
  }),
  def({
    id: 'listen-spell',
    name: 'Listen & Spell',
    emoji: '🎧',
    blurb: 'Hear the word in a sentence, then spell it from memory.',
    subjects: ['spelling'],
    isTest: true,
    verified: true,
    requires: [],
    fallback: null,
  }),
  def({
    id: 'test',
    name: 'Spelling Test',
    emoji: '📝',
    blurb: 'No hints, no second chances. This is the one that counts.',
    subjects: ['spelling', 'quiz'],
    isTest: true,
    verified: true,
    requires: [],
    fallback: null,
  }),

  // --- Quiz ---------------------------------------------------------------
  def({
    id: 'flashcards',
    name: 'Flashcards',
    emoji: '🃏',
    blurb: 'Flip through at your own pace and say how well you knew each one.',
    subjects: ['quiz'],
    isTest: false,
    verified: false,
    requires: [],
    fallback: null,
  }),
  def({
    id: 'match',
    name: 'Match',
    emoji: '⚡',
    blurb: 'Race the clock pairing every card with its answer.',
    subjects: ['quiz'],
    isTest: false,
    verified: true,
    requires: ['pool'],
    fallback: null,
  }),
  def({
    id: 'choice',
    name: 'Multiple Choice',
    emoji: '🎯',
    blurb: 'Every card as a quick four-way pick. Fast, checked, and a missed one comes back.',
    subjects: ['quiz'],
    isTest: false,
    verified: true,
    // Wrong answers are drawn from the rest of the deck, so a three-card set
    // has nothing to offer as a choice.
    requires: ['pool'],
    fallback: 'learn',
  }),
  def({
    id: 'learn',
    name: 'Learn',
    emoji: '🧠',
    blurb: 'Starts with multiple choice and works up to writing it from memory.',
    subjects: ['quiz'],
    isTest: true,
    verified: true,
    requires: [],
    fallback: null,
  }),

  def({
    id: 'recall',
    name: 'Everything You Know',
    emoji: '🧾',
    blurb: 'One box. Write down as much of the set as you can remember.',
    subjects: ['quiz'],
    stage: 3,
    isTest: true,
    verified: true,
    // Needs a set worth emptying your memory of; four cards is a list, not a
    // recall task.
    requires: ['pool'],
    fallback: 'test',
  }),

  // --- New: the free rungs ------------------------------------------------
  def({
    id: 'tutor',
    name: 'Tutor round',
    emoji: '🗣️',
    blurb: 'Practice out loud with the assistant you already use.',
    subjects: ['quiz'],
    stage: 3,
    isTest: true,
    verified: true,
    // Both sides have to be sayable: a figure cannot be read aloud and an
    // equation the plain-text projection cannot voice is not a question.
    requires: ['speakable'],
    fallback: 'learn',
    // Not a task a grown-up can set: a tutor round is how a Learn task gets
    // done out loud, and closes the same task (docs/mcp-tutor-spec.md).
    assignable: false,
  }),
  def({
    id: 'first-letter',
    assignable: false,
    name: 'Starts With…',
    emoji: '✏️',
    blurb: 'The first letter and the shape of the answer. The rest is yours.',
    subjects: ['spelling', 'quiz'],
    stage: 2,
    isTest: false,
    verified: true,
    // The missing rung: today a card goes from a four-way choice straight to a
    // blank page, and a learner who is not ready fails at a *format* rather
    // than at the content. Needs nothing, works on every deck that exists.
    requires: ['plain-answer'],
    fallback: 'word-bank',
  }),
  def({
    id: 'word-bank',
    assignable: false,
    name: 'With a Word Bank',
    emoji: '🗂️',
    blurb: 'Write it out, with every answer in the round listed beside you.',
    subjects: ['quiz'],
    stage: 2,
    isTest: false,
    verified: true,
    requires: ['pool'],
    fallback: null,
  }),
  def({
    id: 'cloze',
    assignable: false,
    name: 'Fill the Blank',
    emoji: '␣',
    blurb: 'The sentence, with the answer taken out of it.',
    subjects: ['spelling', 'quiz'],
    stage: 2,
    isTest: false,
    verified: true,
    requires: ['example'],
    fallback: 'first-letter',
  }),

  // --- Typing -------------------------------------------------------------
  def({
    id: 'lesson',
    name: 'Typing lesson',
    emoji: '⌨️',
    blurb: 'Learn the keys, one reach at a time.',
    subjects: ['typing'],
    isTest: true,
    verified: true,
    requires: [],
    fallback: null,
  }),
]

const BY_ID = new Map(ACTIVITY_CATALOG.map((a) => [a.id, a]))

export function activityDef(id: string): ActivityDef | undefined {
  return BY_ID.get(id)
}

export function activitiesFor(subject: ActivitySubject): ActivityDef[] {
  return ACTIVITY_CATALOG.filter((a) => a.subjects.includes(subject))
}

/** Every activity that asks at a given rung, for the learner's choice of how. */
export function activitiesAtLevel(subject: ActivitySubject, level: SupportLevel): ActivityDef[] {
  return activitiesFor(subject).filter((a) => a.stage === level)
}

/** Everything a grown-up can set as a piece of work, for one subject. */
export function assignableActivities(subject: ActivitySubject): ActivityDef[] {
  return activitiesFor(subject).filter((a) => a.assignable)
}
