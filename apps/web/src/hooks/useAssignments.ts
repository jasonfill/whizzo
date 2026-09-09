import { useCallback, useEffect, useState } from 'react'
import { listAssignments, type Assignment } from '../lib/assignments/api'
import { useLearners } from '../lib/learners/LearnerProvider'

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
 */
export function useAssignments() {
  const { active } = useLearners()
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

  const open = assignments.filter((a) => a.status === 'open')
  const done = assignments.filter((a) => a.status === 'done')

  return { assignments, open, done, loading, error, refresh, learnerId }
}
