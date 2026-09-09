// Assignments — over the API.
//
// Note what is missing: there is no "mark done". A task is closed by the round
// that satisfied it, inside the same transaction that records the round, so
// finishing work is something a learner does rather than something anyone says.
// See complete_matching_assignments in migration 0008.

import type {
  Assignment,
  AssignmentDraft,
  AssignmentSetsResponse,
  AssignmentsResponse,
  FamilyOverviewResponse,
} from '@whizzo/shared'
import { api } from '../api/client'

export type {
  Assignment,
  AssignmentDraft,
  AssignmentSetSummary,
  AssignmentStatus,
  LearnerOverview,
} from '@whizzo/shared'

export async function listAssignments(
  learnerId: string,
  status: 'open' | 'done' | 'canceled' | 'all' = 'all',
  signal?: AbortSignal,
) {
  const { assignments } = await api.get<AssignmentsResponse>(
    `/learners/${learnerId}/assignments?status=${status}`,
    signal,
  )
  return assignments
}

/**
 * Set work for one learner or several.
 *
 * Plural on both axes: a grown-up planning a week sets several tasks, and the
 * same task often goes to more than one child. Each task becomes one shared
 * definition plus a copy per learner, so it can later be edited in one place
 * and answered "who has done this?" in one query.
 */
export async function createAssignments(
  learnerIds: string[],
  assignments: AssignmentDraft[],
): Promise<Assignment[]> {
  const res = await api.post<AssignmentsResponse>('/assignments', { assignments, learnerIds })
  return res.assignments
}

/** Work the caller has set, with everyone they can see who was given it. */
export async function listAssignmentSets(signal?: AbortSignal) {
  const { sets } = await api.get<AssignmentSetsResponse>('/assignments/sets', signal)
  return sets
}

/** Edit the work itself — changes what every learner given it sees. */
export async function updateAssignmentSet(
  setId: string,
  patch: { title?: string; note?: string | null; minAccuracy?: number | null; dueOn?: string | null },
): Promise<void> {
  await api.patch<{ setId: string }>(`/assignments/sets/${setId}`, patch)
}

/** Withdraw the work entirely — every learner's copy goes with it. */
export async function deleteAssignmentSet(setId: string): Promise<void> {
  await api.del<void>(`/assignments/sets/${setId}`)
}

/** Edit one learner's copy: cancel it, put it back, reorder their list. */
export async function updateAssignment(
  learnerId: string,
  assignmentId: string,
  patch: { sortOrder?: number; status?: 'open' | 'canceled' },
): Promise<Assignment> {
  const { assignment } = await api.patch<{ assignment: Assignment }>(
    `/learners/${learnerId}/assignments/${assignmentId}`,
    patch,
  )
  return assignment
}

export async function deleteAssignment(learnerId: string, assignmentId: string): Promise<void> {
  await api.del<void>(`/learners/${learnerId}/assignments/${assignmentId}`)
}

/** Every child the caller can see, with their outstanding work and week's activity. */
export async function familyOverview(signal?: AbortSignal) {
  const { learners } = await api.get<FamilyOverviewResponse>('/learners/overview', signal)
  return learners
}
