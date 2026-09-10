import { useCallback, useEffect, useRef, useState } from 'react'
import { listAssignments, type Assignment } from '../lib/assignments/api'
import { useLearners } from '../lib/learners/LearnerProvider'
import { useProgress } from '../lib/progress/ProgressProvider'

/**
 * The active learner's task list.
 *
 * Assignments are the one part of a learner's world written by somebody else,
 * so they are fetched rather than folded into the progress snapshot: a parent
 * adding homework on their phone should show up on the child's device at the
 * next look, not at the next sign-in.
 *
 * `refresh` is called after a round finishes, because that round may have
 * closed a task — the database decides that, not the client, so the only way to
 * find out is to ask.
 *
 * A task can name a deck the snapshot has never seen: a library deck set as
 * work after the snapshot loaded reaches the learner through the assignment,
 * and the snapshot is what the round is built from. So when the list arrives
 * naming a deck that is not here, the material is fetched again — once per
 * set of missing decks, so one that really is gone does not start a loop.
 */
export function useAssignments() {
  const { active } = useLearners()
  const { snapshot, reloadMaterial } = useProgress()
  const learnerId = active?.id ?? null

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!learnerId) {
        setAssignments([])
        return
      }
      setLoading(true)
      try {
        const rows = await listAssignments(learnerId, 'all', signal)
        if (!signal?.aborted) {
          setAssignments(rows)
          setError(null)
        }
      } catch {
        // A task list that will not load is worth saying so about, but it must
        // never stop a child getting on with practicing.
        if (!signal?.aborted) setError('Could not load the task list.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [learnerId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(() => load(), [load])

  const askedFor = useRef('')
  useEffect(() => {
    const have = new Set(snapshot.decks.map((d) => d.id))
    const missing = assignments
      .filter((a) => a.subject === 'quiz' && a.status === 'open' && a.targetId && !have.has(a.targetId))
      .map((a) => a.targetId as string)
    const key = [...new Set(missing)].sort().join(',')
    if (!key || key === askedFor.current) return
    askedFor.current = key
    void reloadMaterial()
  }, [assignments, snapshot.decks, reloadMaterial])

  const open = assignments.filter((a) => a.status === 'open')
  const done = assignments.filter((a) => a.status === 'done')

  return { assignments, open, done, loading, error, refresh, learnerId }
}
