// The active learner's week, and every one-gesture change to it.
//
// Every write here is optimistic: the card moves, ticks or vanishes at once,
// the API is told, and a failure snaps it back with a message. That is what
// makes a drag feel like a drag rather than a request. The one thing this
// never does is close a linked card — the round does that, so `refresh` is
// called after one finishes and the database's answer replaces ours.
//
// Undo is a five-second stack of inverse operations. It is the reason every
// action can be a single tap: a wrong tap costs one more tap, not a form.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  dayOrder,
  SORT_GAP,
  todayString,
  weekLoad,
  weekStartOf,
  type DayLoad,
  type PlannerItem,
  type PlannerItemDraft,
  type PlannerWeekPatch,
} from '@whizzo/shared'
import { ApiError } from '../lib/api/client'
import { useLearners } from '../lib/learners/LearnerProvider'
import {
  createItem,
  deleteItem,
  duplicateItem,
  loadWeek,
  patchWeek,
  restoreItem,
  updateItem,
  type ItemPatch,
  type PlannerWeekResponse,
} from '../lib/planner/api'

export interface Toast {
  id: number
  text: string
  undo?: () => Promise<void> | void
}

const UNDO_MS = 5000

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

export function usePlannerWeek(weekStart?: string) {
  const { active } = useLearners()
  const learnerId = active?.id ?? null
  const today = todayString()
  const start = weekStart ?? weekStartOf(today)

  const [data, setData] = useState<PlannerWeekResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!learnerId) {
        setData(null)
        return
      }
      setLoading(true)
      try {
        const next = await loadWeek(learnerId, start, today, signal)
        if (!signal?.aborted) {
          setData(next)
          setError(null)
        }
      } catch (err) {
        if (!signal?.aborted) setError(messageOf(err))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [learnerId, start, today],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(() => load(), [load])

  const say = useCallback((text: string, undo?: Toast['undo']) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    const id = Date.now()
    setToast({ id, text, undo })
    toastTimer.current = window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), UNDO_MS)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  const setItems = useCallback((fn: (items: PlannerItem[]) => PlannerItem[]) => {
    setData((d) => (d ? { ...d, items: fn(d.items), carryOver: d.carryOver } : d))
  }, [])

  const replaceItem = useCallback((item: PlannerItem) => {
    setData((d) => {
      if (!d) return d
      const inWeek = item.weekStart === d.week.weekStart && !item.deletedAt
      const items = d.items.filter((i) => i.id !== item.id)
      const carryOver = d.carryOver.map((i) => (i.id === item.id ? item : i)).filter((i) => i.status === 'open' && !i.deletedAt)
      return { ...d, items: inWeek ? [...items, item] : items, carryOver }
    })
  }, [])

  // --- the operations -------------------------------------------------------

  const add = useCallback(
    async (draft: Omit<PlannerItemDraft, 'weekStart'> & { weekStart?: string }) => {
      if (!learnerId || !data) return null
      const weekStartFor = draft.onDay ? weekStartOf(draft.onDay) : (draft.weekStart ?? data.week.weekStart)
      const temp: PlannerItem = {
        id: `temp-${Date.now()}`,
        learnerId,
        weekStart: weekStartFor,
        onDay: draft.onDay ?? null,
        kind: draft.kind ?? 'task',
        title: draft.title,
        courseId: draft.courseId ?? null,
        assessmentId: draft.assessmentId ?? null,
        minutes: draft.minutes ?? null,
        purpose: draft.purpose ?? null,
        proposed: draft.proposed ?? false,
        target: draft.target ?? null,
        status: 'open',
        doneAt: null,
        doneBy: null,
        sessionId: null,
        deletedAt: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        createdBy: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      if (weekStartFor === data.week.weekStart) setItems((items) => [...items, temp])
      try {
        const saved = await createItem(learnerId, { ...draft, weekStart: weekStartFor })
        setItems((items) => items.filter((i) => i.id !== temp.id))
        replaceItem(saved)
        const where = !saved.onDay
          ? ' to the shelf'
          : weekStartFor === data.week.weekStart
            ? ''
            : weekStartFor > data.week.weekStart
              ? ` to ${dayLabel(saved.onDay)} next week`
              : ` to ${dayLabel(saved.onDay)} last week`
        say(`Added${where}`, async () => {
          await deleteItem(learnerId, saved.id)
          setItems((items) => items.filter((i) => i.id !== saved.id))
        })
        return saved
      } catch (err) {
        setItems((items) => items.filter((i) => i.id !== temp.id))
        setError(messageOf(err))
        return null
      }
    },
    [learnerId, data, setItems, replaceItem, say],
  )

  const patch = useCallback(
    async (item: PlannerItem, changes: ItemPatch, label?: string, undoable = true) => {
      if (!learnerId) return
      const before = item
      const optimistic: PlannerItem = {
        ...item,
        ...('onDay' in changes ? { onDay: changes.onDay ?? null } : {}),
        ...('weekStart' in changes && changes.weekStart ? { weekStart: changes.weekStart } : {}),
        ...('onDay' in changes && changes.onDay ? { weekStart: weekStartOf(changes.onDay) } : {}),
        ...('sortOrder' in changes && changes.sortOrder !== undefined ? { sortOrder: changes.sortOrder } : {}),
        ...('title' in changes && changes.title ? { title: changes.title } : {}),
        ...('courseId' in changes ? { courseId: changes.courseId ?? null } : {}),
        ...('minutes' in changes ? { minutes: changes.minutes ?? null } : {}),
        ...('status' in changes && changes.status ? { status: changes.status } : {}),
      }
      replaceItem(optimistic)
      try {
        const saved = await updateItem(learnerId, item.id, changes)
        replaceItem(saved)
        if (label) {
          say(
            label,
            undoable
              ? async () => {
                  const back = await updateItem(learnerId, item.id, inverse(before, changes))
                  replaceItem(back)
                }
              : undefined,
          )
        }
        return saved
      } catch (err) {
        replaceItem(before)
        setError(messageOf(err))
        return null
      }
    },
    [learnerId, replaceItem, say],
  )

  /**
   * Move a card to a day (or the shelf), landing just before `beforeId` — or
   * at the end when that is null. One drag, one PATCH.
   *
   * Neighbours are taken in the order the column shows them, without the card
   * being moved, so the drop lands where the pointer was rather than one slot
   * off.
   */
  const move = useCallback(
    async (item: PlannerItem, onDay: string | null, beforeId: string | null = null) => {
      if (!data) return
      const siblings = dayOrder(
        data.items.filter((i) => i.id !== item.id && i.onDay === onDay && !i.deletedAt),
      )
      const at = beforeId ? siblings.findIndex((i) => i.id === beforeId) : -1
      const sortOrder = positionAt(siblings, at < 0 ? null : at)
      const where = onDay ? dayLabel(onDay) : 'the shelf'
      await patch(item, { onDay, sortOrder }, `Moved to ${where}`)
    },
    [data, patch],
  )

  const tick = useCallback(
    async (item: PlannerItem) => {
      if (item.target) {
        say('That one is closed by doing it. Start it instead.')
        return
      }
      const next = item.status === 'done' ? 'open' : 'done'
      await patch(item, { status: next }, next === 'done' ? 'Done' : 'Put back')
    },
    [patch, say],
  )

  const skip = useCallback(
    async (item: PlannerItem) => {
      const next = item.status === 'skipped' ? 'open' : 'skipped'
      await patch(item, { status: next }, next === 'skipped' ? 'Skipped' : 'Un-skipped')
    },
    [patch],
  )

  const remove = useCallback(
    async (item: PlannerItem) => {
      if (!learnerId) return
      setItems((items) => items.filter((i) => i.id !== item.id))
      setData((d) => (d ? { ...d, carryOver: d.carryOver.filter((i) => i.id !== item.id) } : d))
      try {
        await deleteItem(learnerId, item.id)
        say('Removed', async () => {
          const back = await restoreItem(learnerId, item.id)
          replaceItem(back)
        })
      } catch (err) {
        replaceItem(item)
        setError(messageOf(err))
      }
    },
    [learnerId, setItems, replaceItem, say],
  )

  const copy = useCallback(
    async (item: PlannerItem, onDay: string | null) => {
      if (!learnerId) return null
      try {
        const made = await duplicateItem(learnerId, item.id, onDay)
        replaceItem(made)
        say('Copied', async () => {
          await deleteItem(learnerId, made.id)
          setItems((items) => items.filter((i) => i.id !== made.id))
        })
        return made
      } catch (err) {
        setError(messageOf(err))
        return null
      }
    },
    [learnerId, replaceItem, say, setItems],
  )

  /** Let a carried-over task go: it stays where it was, done with. */
  const letGo = useCallback(
    async (item: PlannerItem) => {
      await patch(item, { status: 'skipped' }, 'Let go')
      setData((d) => (d ? { ...d, carryOver: d.carryOver.filter((i) => i.id !== item.id) } : d))
    },
    [patch],
  )

  /** Bring a carried-over task onto today. */
  const keep = useCallback(
    async (item: PlannerItem) => {
      await patch(item, { onDay: today }, 'Moved to today')
      setData((d) => (d ? { ...d, carryOver: d.carryOver.filter((i) => i.id !== item.id) } : d))
    },
    [patch, today],
  )

  const saveWeek = useCallback(
    async (changes: PlannerWeekPatch) => {
      if (!learnerId || !data) return null
      const before = data.week
      setData((d) =>
        d
          ? {
              ...d,
              week: {
                ...d.week,
                ...(changes.priorities ? { priorities: changes.priorities } : {}),
                ...(changes.wins ? { wins: changes.wins } : {}),
                ...(changes.goals ? { goals: changes.goals } : {}),
                ...('reflection' in changes ? { reflection: changes.reflection ?? null } : {}),
                ...(changes.busyDays ? { busyDays: changes.busyDays } : {}),
              },
            }
          : d,
      )
      try {
        const week = await patchWeek(learnerId, data.week.weekStart, changes)
        setData((d) => (d ? { ...d, week } : d))
        return week
      } catch (err) {
        setData((d) => (d ? { ...d, week: before } : d))
        setError(messageOf(err))
        return null
      }
    },
    [learnerId, data],
  )

  const load7 = useMemo<DayLoad[]>(
    () => (data ? weekLoad(data.items, data.week.weekStart, data.band, data.prefs.dailyMinutes) : []),
    [data],
  )

  const courseById = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.id, c])), [data?.courses])

  return {
    learnerId,
    learner: active,
    today,
    weekStart: start,
    data,
    loading,
    error,
    clearError: () => setError(null),
    toast,
    dismissToast,
    load: load7,
    courseById,
    refresh,
    add,
    patch,
    move,
    tick,
    skip,
    remove,
    copy,
    keep,
    letGo,
    saveWeek,
    setData,
  }
}

export type PlannerApi = ReturnType<typeof usePlannerWeek>

/** A sort position between neighbours, with gaps so a reorder writes one row. */
export function positionAt(siblings: readonly PlannerItem[], index: number | null): number {
  if (siblings.length === 0) return SORT_GAP
  if (index === null || index >= siblings.length) return siblings[siblings.length - 1]!.sortOrder + SORT_GAP
  if (index <= 0) return siblings[0]!.sortOrder - SORT_GAP
  const a = siblings[index - 1]!.sortOrder
  const b = siblings[index]!.sortOrder
  // The column shows open cards before the done pile, so two neighbours can
  // sit in the opposite order to their sort numbers. Step past the one above
  // rather than land somewhere between that is above both.
  if (a >= b) return a + SORT_GAP
  return Math.floor((a + b) / 2)
}

function inverse(before: PlannerItem, changes: ItemPatch): ItemPatch {
  const out: ItemPatch = {}
  if ('onDay' in changes) {
    out.onDay = before.onDay
    out.sortOrder = before.sortOrder
    if (!before.onDay) out.weekStart = before.weekStart
  }
  if ('status' in changes) out.status = before.status
  if ('title' in changes) out.title = before.title
  if ('courseId' in changes) out.courseId = before.courseId
  if ('minutes' in changes) out.minutes = before.minutes
  return out
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' })
}
