// Where a linked card's Start goes.
//
// A card the app can run names its work in the vocabulary the database
// records it in — subject, activity, target — which is what lets a finished
// round close it. This turns those three fields into the screen that does the
// work, by way of the same function assignments use.

import type { Route } from '../../routes'
import { routeForAssignment } from '../assignments/routing'
import type { Assignment, PlannerItem, Subject } from '@whizzo/shared'

export function routeForTarget(target: PlannerItem['target']): Route | null {
  if (!target) return null
  return routeForAssignment({
    subject: target.subject as Subject,
    activity: target.activity,
    targetId: target.targetId,
    size: null,
  } as Assignment)
}

/** The purposes of a session and the deck it runs, as a `target`. */
export function targetFor(subject: Subject, activity: string, targetId: string): PlannerItem['target'] {
  return { subject, activity, targetId }
}
