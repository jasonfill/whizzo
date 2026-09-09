// Turning a task into somewhere to go.
//
// An assignment names work in the same vocabulary the database records it in —
// subject, activity, target — because that is what lets a finished round close
// a task without anybody matching up names by hand. This is the other end of
// that: the same three fields, turned into the screen that does the work.

import { CURRICULUM } from '../../data/lessons'
import { GRADES } from '../../data/spelling'
import type { Route } from '../../routes'
import type { Assignment, Subject } from '../progress/types'
import { assignableActivities } from '@whizzo/shared'
import { MODES, type StudyMode } from '../quiz/session'
import { ACTIVITIES, type ActivityId } from '../spelling/activities'

/** What a grown-up can set, described the way they think about it. */
export interface AssignableActivity {
  subject: Subject
  activity: string
  name: string
  emoji: string
  /** Whether the app checks the answers, which is what a score bar needs. */
  graded: boolean
  /** What `targetId` means here. */
  target: 'deck' | 'spelling-list' | 'typing-lesson'
}

/** What `targetId` points at, per subject. */
const TARGET_OF: Record<Subject, AssignableActivity['target']> = {
  quiz: 'deck',
  spelling: 'spelling-list',
  typing: 'typing-lesson',
}

/**
 * Generated from the shared catalog rather than hand-kept.
 *
 * This used to be three lists welded together, and every activity added meant
 * remembering to edit it — which is exactly the kind of thing nobody remembers.
 * The catalog knows what each activity is; this only has to say how a
 * grown-up reads it.
 *
 * Only genuinely startable rounds appear. The scaffolded question kinds are
 * chosen per card by the ladder inside Learn, so "do twenty word-banks" is not
 * a thing to set and a task pointing at one would have nowhere to go.
 */
export const ASSIGNABLE: AssignableActivity[] = (['quiz', 'spelling', 'typing'] as const).flatMap(
  (subject) =>
    assignableActivities(subject).map((a) => ({
      subject,
      activity: a.id,
      name: a.name,
      emoji: a.emoji,
      graded: a.isTest,
      target: TARGET_OF[subject],
    })),
)

export function assignableFor(
  subject: Subject,
  activity: string,
): AssignableActivity | undefined {
  return ASSIGNABLE.find((a) => a.subject === subject && a.activity === activity)
}

/** The human name of whatever the task points at. */
export function targetName(assignment: Assignment, deckTitles: Map<string, string>): string {
  const { subject, targetId } = assignment
  if (!targetId) return 'whatever is due'
  if (subject === 'quiz') return deckTitles.get(targetId) ?? 'a deck that has been deleted'
  if (subject === 'spelling') {
    for (const grade of GRADES) {
      const list = grade.lists.find((l) => l.id === targetId)
      if (list) return list.title
    }
    return 'a word list'
  }
  return CURRICULUM.find((l) => l.id === targetId)?.title ?? 'a lesson'
}

/**
 * Where "Start" goes.
 *
 * Null when the task cannot be started as written — a deck deleted since it was
 * set, say. The caller says so plainly rather than navigating somewhere
 * confusing.
 */
export function routeForAssignment(assignment: Assignment): Route | null {
  const { subject, activity, targetId, size } = assignment

  // A goal is walked by the path, not by one round of one thing. It routes to
  // Learn on the set, which is where the planner lives — the learner presses
  // Continue and the app decides what that means today.
  if (activity === 'mastery-path') {
    if (!targetId) return null
    return { name: 'quiz-play', mode: 'learn', deckId: targetId, size: size ?? undefined }
  }

  if (subject === 'quiz') {
    const mode = MODES.find((m) => m.id === activity)
    if (!mode) return null
    return {
      name: 'quiz-play',
      mode: mode.id as StudyMode,
      deckId: targetId ?? undefined,
      size: size ?? undefined,
    }
  }

  if (subject === 'spelling') {
    const known = ACTIVITIES.find((a) => a.id === activity)
    if (!known) return null
    return {
      name: 'spell-play',
      activity: known.id as ActivityId,
      // A task pinned to a list plays that list; one without plays the adaptive
      // mix, which is what "just do some spelling" means.
      mode: targetId ? 'list' : 'adaptive',
      listId: targetId ?? undefined,
      size: size ?? undefined,
    }
  }

  if (subject === 'typing' && targetId) return { name: 'lesson', id: targetId }
  return null
}
