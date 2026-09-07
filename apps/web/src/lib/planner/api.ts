// The planner — over the API.
//
// Note what is missing: there is no `markDone` for a linked card and no
// `writeEvent`. A card the app can run is closed by the round that satisfies
// it; history is written by the database. Both would be the feature undone.

import type {
  Assessment,
  AssessmentDraft,
  AssessmentOutcome,
  AssessmentResponse,
  AssessmentsResponse,
  Course,
  CourseDraft,
  CourseResponse,
  CoursesResponse,
  PlannerCommentResponse,
  PlannerEventsResponse,
  PlannerItem,
  PlannerItemDraft,
  PlannerItemResponse,
  PlannerItemsResponse,
  PlannerPrefs,
  PlannerPrefsResponse,
  PlannerWeekPatch,
  PlannerWeekResponse,
  PlannerWeekRowResponse,
  ProposeResponse,
  ProposedSession,
} from '@whizzo/shared'
import { api } from '../api/client'

export type {
  Assessment,
  AssessmentDraft,
  Course,
  CourseDraft,
  PlannerComment,
  PlannerEvent,
  PlannerItem,
  PlannerItemDraft,
  PlannerPrefs,
  PlannerWeek,
  PlannerWeekResponse,
  ProposedSession,
} from '@whizzo/shared'

// --- courses ----------------------------------------------------------------

export async function listCourses(learnerId: string, archived = false, signal?: AbortSignal) {
  const { courses } = await api.get<CoursesResponse>(
    `/learners/${learnerId}/courses?archived=${archived}`,
    signal,
  )
  return courses
}

export async function createCourse(learnerId: string, draft: CourseDraft): Promise<Course> {
  const { course } = await api.post<CourseResponse>(`/learners/${learnerId}/courses`, draft)
  return course
}

export async function updateCourse(
  learnerId: string,
  courseId: string,
  patch: Partial<CourseDraft>,
): Promise<Course> {
  const { course } = await api.patch<CourseResponse>(`/learners/${learnerId}/courses/${courseId}`, patch)
  return course
}

export async function archiveCourse(learnerId: string, courseId: string, archived = true): Promise<Course> {
  const { course } = await api.post<CourseResponse>(`/learners/${learnerId}/courses/${courseId}/archive`, {
    archived,
  })
  return course
}

export async function deleteCourse(learnerId: string, courseId: string): Promise<void> {
  await api.del<void>(`/learners/${learnerId}/courses/${courseId}`)
}

export async function rolloverCourses(learnerId: string, termLabel?: string | null): Promise<Course[]> {
  const { courses } = await api.post<CoursesResponse>(`/learners/${learnerId}/courses/rollover`, {
    termLabel: termLabel ?? null,
  })
  return courses
}

// --- the week ---------------------------------------------------------------

/** The assembled week. `today` is the learner's own calendar day, which the server cannot know. */
export function loadWeek(learnerId: string, weekStart: string, today: string, signal?: AbortSignal) {
  return api.get<PlannerWeekResponse>(
    `/learners/${learnerId}/planner/weeks/${weekStart}?today=${encodeURIComponent(today)}`,
    signal,
  )
}

export async function patchWeek(learnerId: string, weekStart: string, patch: PlannerWeekPatch) {
  const { week } = await api.patch<PlannerWeekRowResponse>(
    `/learners/${learnerId}/planner/weeks/${weekStart}`,
    patch,
  )
  return week
}

export async function weekHistory(learnerId: string, weekStart: string, actor?: string, signal?: AbortSignal) {
  const q = actor ? `?actor=${encodeURIComponent(actor)}` : ''
  const { events } = await api.get<PlannerEventsResponse>(
    `/learners/${learnerId}/planner/weeks/${weekStart}/history${q}`,
    signal,
  )
  return events
}

// --- cards ------------------------------------------------------------------

export async function createItem(learnerId: string, draft: PlannerItemDraft): Promise<PlannerItem> {
  const { item } = await api.post<PlannerItemResponse>(`/learners/${learnerId}/planner/items`, draft)
  return item
}

export interface ItemPatch {
  onDay?: string | null
  weekStart?: string
  sortOrder?: number
  title?: string
  courseId?: string | null
  minutes?: number | null
  status?: 'open' | 'done' | 'skipped'
}

export async function updateItem(learnerId: string, itemId: string, patch: ItemPatch): Promise<PlannerItem> {
  const { item } = await api.patch<PlannerItemResponse>(
    `/learners/${learnerId}/planner/items/${itemId}`,
    patch,
  )
  return item
}

/** Soft delete. The card leaves the grid; its history stays. */
export async function deleteItem(learnerId: string, itemId: string): Promise<void> {
  await api.del<void>(`/learners/${learnerId}/planner/items/${itemId}`)
}

export async function restoreItem(learnerId: string, itemId: string): Promise<PlannerItem> {
  const { item } = await api.post<PlannerItemResponse>(`/learners/${learnerId}/planner/items/${itemId}/restore`)
  return item
}

export async function duplicateItem(learnerId: string, itemId: string, onDay: string | null): Promise<PlannerItem> {
  const { item } = await api.post<PlannerItemResponse>(
    `/learners/${learnerId}/planner/items/${itemId}/duplicate`,
    { onDay },
  )
  return item
}

export async function itemHistory(learnerId: string, itemId: string, signal?: AbortSignal) {
  const { events } = await api.get<PlannerEventsResponse>(
    `/learners/${learnerId}/planner/items/${itemId}/history`,
    signal,
  )
  return events
}

// --- assessments ------------------------------------------------------------

export async function createAssessment(learnerIds: string[], draft: AssessmentDraft): Promise<Assessment[]> {
  const { assessments } = await api.post<AssessmentsResponse>('/assessments', { assessment: draft, learnerIds })
  return assessments
}

export async function updateAssessment(id: string, patch: Partial<AssessmentDraft>): Promise<Assessment> {
  const { assessment } = await api.patch<AssessmentResponse>(`/assessments/${id}`, patch)
  return assessment
}

export async function deleteAssessment(id: string): Promise<void> {
  await api.del<void>(`/assessments/${id}`)
}

/** The proposal. Stores nothing. */
export function proposeSessions(id: string, today?: string): Promise<ProposeResponse> {
  return api.post<ProposeResponse>(`/assessments/${id}/propose`, { today })
}

export async function acceptSessions(id: string, sessions: ProposedSession[], replace = true) {
  const { items } = await api.post<PlannerItemsResponse>(`/assessments/${id}/accept`, { sessions, replace })
  return items
}

export async function recordOutcome(id: string, outcome: AssessmentOutcome): Promise<Assessment> {
  const { assessment } = await api.post<AssessmentResponse>(`/assessments/${id}/outcome`, outcome)
  return assessment
}

export async function assessmentHistory(id: string, signal?: AbortSignal) {
  const { events } = await api.get<PlannerEventsResponse>(`/assessments/${id}/history`, signal)
  return events
}

// --- comments and prefs -----------------------------------------------------

export async function addComment(learnerId: string, weekStart: string, body: string, itemId?: string | null) {
  const { comment } = await api.post<PlannerCommentResponse>(`/learners/${learnerId}/planner/comments`, {
    weekStart,
    itemId: itemId ?? null,
    body,
  })
  return comment
}

export async function deleteComment(commentId: string): Promise<void> {
  await api.del<void>(`/planner/comments/${commentId}`)
}

export async function updatePrefs(learnerId: string, patch: Partial<Omit<PlannerPrefs, 'learnerId'>>) {
  const { prefs } = await api.patch<PlannerPrefsResponse>(`/learners/${learnerId}/planner/prefs`, patch)
  return prefs
}
