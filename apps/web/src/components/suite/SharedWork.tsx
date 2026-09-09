import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Pill } from '../../components/ui'
import {
  deleteAssignmentSet,
  listAssignmentSets,
  type AssignmentSetSummary,
} from '../../lib/assignments/api'

/**
 * Work this grown-up has set, and who has done it.
 *
 * The other side of the task list: a parent's view is one child's list, and
 * this is one piece of work across everyone given it — the question a tutor
 * opens the app to ask.
 *
 * Only learners the viewer is linked to appear under each piece of work. That
 * is the API's doing rather than this component's: work shared between families
 * shows each parent their own child and nobody else's.
 */
export default function SharedWork({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [sets, setSets] = useState<AssignmentSetSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await listAssignmentSets(signal)
      if (!signal?.aborted) setSets(rows)
    } catch {
      if (!signal?.aborted) setSets([])
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (!sets || sets.length === 0) return null

  const withdraw = async (setId: string) => {
    setBusy(setId)
    try {
      await deleteAssignmentSet(setId)
      await load()
      await onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-1 text-xl font-extrabold text-ink">Work you have set</h2>
      <p className="mb-3 font-bold text-muted">
        One piece of work, everyone you gave it to, and who has finished it.
      </p>

      <ul className="space-y-3">
        {sets.map((set) => {
          const done = set.learners.filter((l) => l.status === 'done').length
          const total = set.learners.length
          const complete = total > 0 && done === total

          return (
            <li key={set.setId} className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-hair">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-ink">{set.title}</span>
                <Pill
                  className={
                    complete
                      ? 'bg-emerald-100 text-xs text-emerald-700'
                      : 'bg-wash text-xs text-muted'
                  }
                >
                  {done} of {total} done
                </Pill>
                {set.dueOn && (
                  <Pill className="bg-wash text-xs text-muted">due {set.dueOn}</Pill>
                )}
                {set.minAccuracy !== null && (
                  <Pill className="bg-amber-100 text-xs text-amber-700">
                    needs {set.minAccuracy}%
                  </Pill>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {set.learners.map((l) => (
                  <span
                    key={l.assignmentId}
                    title={
                      l.status === 'done' && l.completedAt
                        ? `Finished ${new Date(l.completedAt).toLocaleDateString()}`
                        : l.status
                    }
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
                      l.status === 'done'
                        ? 'bg-pine/10 text-pine'
                        : l.status === 'canceled'
                          ? 'bg-wash text-stone line-through'
                          : 'bg-wash text-ink'
                    }`}
                  >
                    <span className="leading-none">{l.avatarEmoji}</span>
                    {l.displayName}
                    <span aria-hidden>{l.status === 'done' ? '✅' : '⏳'}</span>
                  </span>
                ))}
              </div>

              <div className="mt-3">
                <Button variant="ghost" onClick={() => withdraw(set.setId)} disabled={busy === set.setId}>
                  🗑️ Withdraw for everyone
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
