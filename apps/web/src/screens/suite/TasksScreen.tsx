import { useMemo, useState } from 'react'
import ScreenHeader from '../../components/suite/ScreenHeader'
import SessionDetail from '../../components/suite/SessionDetail'
import SharedWork from '../../components/suite/SharedWork'
import { Button, Card, Pill } from '../../components/ui'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { useAssignments } from '../../hooks/useAssignments'
import {
  deleteAssignment,
  updateAssignment,
  type Assignment,
} from '../../lib/assignments/api'
import { assignableFor, routeForAssignment, targetName } from '../../lib/assignments/routing'
import { useAuth } from '../../auth/AuthProvider'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { allDecks } from '../../lib/quiz/decks'
import { todayString } from '../../lib/progress/types'
import type { Navigate } from '../../routes'
import AssignForm from './AssignForm'

/**
 * The task list, from both sides.
 *
 * A child sees what they have been asked to do and a button that starts it. A
 * grown-up sees the same list plus the means to add to it, and — the part that
 * makes it worth keeping — the round behind every finished task, openable in
 * place. There is no "mark as done" for anybody: work is closed by doing it.
 */
export default function TasksScreen({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth()
  const { active, learners } = useLearners()
  const { snapshot } = useProgress()
  const { open, done, loading, error, refresh, learnerId } = useAssignments()
  const [busy, setBusy] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [openResult, setOpenResult] = useState<string | null>(null)

  /**
   * Whether to offer the controls for setting work.
   *
   * The real rule lives in `can_assign_to_learner()` and depends on guardian
   * rights the client is not told about, so this cannot be exact. It draws the
   * one line it can see — the learner themselves never sets their own homework
   * — and lets the API refuse anyone else who is not entitled. Erring this way
   * round is deliberate: a co-parent who may assign but sees no button has lost
   * a feature silently, where one who tries and is refused gets told why.
   */
  const canAssign = !!user && user.id !== active?.authUserId

  const deckTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const deck of allDecks(snapshot, STARTER_DECKS)) map.set(deck.id, deck.title)
    return map
  }, [snapshot])

  if (!active || !learnerId) {
    return (
      <div className="mx-auto w-full max-w-3xl py-4">
        <ScreenHeader title="Tasks ✅" onBack={() => navigate({ name: 'home' })} />
        <Card>
          <p className="mb-3 font-bold text-muted">
            Tasks are set for a learner, so they need an account with a learner profile.
          </p>
          <Button onClick={() => navigate({ name: 'auth' })}>Sign in</Button>
        </Card>
      </div>
    )
  }

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id)
    try {
      await fn()
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title="Tasks ✅"
        subtitle={`${active.displayName} · ${open.length} to do`}
        onBack={() => navigate({ name: 'home' })}
      />

      {error && <Card className="mb-4"><p className="font-bold text-rose-500">{error}</p></Card>}

      {canAssign && (
        <div className="mb-4">
          {showForm ? (
            <AssignForm
              // Everyone this grown-up looks after, minus the learner acting as
              // themselves — you cannot set your own homework.
              learners={learners.filter((l) => l.authUserId !== user?.id)}
              defaultLearnerIds={[learnerId]}
              onDone={async () => {
                setShowForm(false)
                await refresh()
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <Button onClick={() => setShowForm(true)}>➕ Set some work</Button>
          )}
        </div>
      )}

      {canAssign && <SharedWork onChanged={refresh} />}

      <Card className="mb-4">
        <h2 className="mb-3 text-xl font-extrabold text-ink">To do ({open.length})</h2>
        {loading && open.length === 0 ? (
          <p className="font-bold text-stone">Loading…</p>
        ) : open.length === 0 ? (
          <p className="font-bold text-stone">
            Nothing set right now. {canAssign ? 'Add something above.' : 'Enjoy it.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((a) => (
              <OpenTask
                key={a.id}
                assignment={a}
                deckTitles={deckTitles}
                canAssign={canAssign}
                busy={busy === a.id}
                onStart={() => {
                  const route = routeForAssignment(a)
                  if (route) navigate(route)
                }}
                onCancel={() =>
                  act(() => updateAssignment(learnerId, a.id, { status: 'canceled' }), a.id)
                }
                onDelete={() => act(() => deleteAssignment(learnerId, a.id), a.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-xl font-extrabold text-ink">Done ({done.length})</h2>
        <p className="mb-3 font-bold text-muted">
          Every one of these was closed by a round that was actually played. Open it to see the
          answers.
        </p>
        {done.length === 0 ? (
          <p className="font-bold text-stone">Nothing finished yet.</p>
        ) : (
          <ul className="divide-y divide-hair">
            {done.map((a) => {
              const session = snapshot.sessions.find((s) => s.id === a.sessionId)
              const isOpen = openResult === a.id
              return (
                <li key={a.id} className="py-1">
                  <button
                    onClick={() => setOpenResult(isOpen ? null : a.id)}
                    aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center gap-2 rounded-xl px-1 py-2 text-left hover:bg-quiet"
                  >
                    <span className="text-xs font-bold text-stone">{isOpen ? '▾' : '▸'}</span>
                    <span className="text-lg">✅</span>
                    <span className="font-extrabold text-ink">{a.title}</span>
                    {session && (
                      <span className="font-bold text-muted">
                        {session.itemsCorrect}/{session.itemsTotal} · {Math.round(session.accuracy)}%
                      </span>
                    )}
                    {a.minAccuracy !== null && (
                      <Pill className="bg-emerald-100 text-xs text-emerald-700">
                        cleared {a.minAccuracy}%
                      </Pill>
                    )}
                    <span className="ml-auto text-xs font-bold text-stone">
                      {a.completedAt ? new Date(a.completedAt).toLocaleDateString() : ''}
                    </span>
                  </button>
                  {isOpen &&
                    (session ? (
                      <SessionDetail session={session} />
                    ) : (
                      <p className="px-1 py-2 font-bold text-stone">
                        The round that finished this is older than the history the app keeps
                        loaded.
                      </p>
                    ))}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function OpenTask({
  assignment,
  deckTitles,
  canAssign,
  busy,
  onStart,
  onCancel,
  onDelete,
}: {
  assignment: Assignment
  deckTitles: Map<string, string>
  canAssign: boolean
  busy: boolean
  onStart: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const def = assignableFor(assignment.subject, assignment.activity)
  const startable = routeForAssignment(assignment) !== null
  // A goal has no activity to name, on purpose: the learner presses Continue
  // and the app works out what that means today. Showing "Learn" here would be
  // telling them something they are not choosing and that changes every round.
  const isGoal = assignment.activity === 'mastery-path'
  const overdue = assignment.dueOn !== null && assignment.dueOn < todayString()

  return (
    <li
      className={`rounded-2xl px-4 py-3 ring-1 ${
        overdue ? 'bg-rose-50 ring-rose-200' : 'bg-white/85 ring-hair'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl">{def?.emoji ?? '📌'}</span>
        <span className="text-lg font-extrabold text-ink">{assignment.title}</span>
        {assignment.dueOn && (
          <Pill
            className={
              overdue ? 'bg-rose-100 text-xs text-rose-700' : 'bg-wash text-xs text-muted'
            }
          >
            {overdue ? 'overdue · ' : 'due '}
            {assignment.dueOn}
          </Pill>
        )}
        {assignment.minAccuracy !== null && (
          <Pill className="bg-amber-100 text-xs text-amber-700">
            needs {assignment.minAccuracy}%
          </Pill>
        )}
        {isGoal && <Pill className="bg-quiet text-xs text-body">master it</Pill>}
      </div>

      <p className="mt-1 font-bold text-muted">
        {isGoal ? 'Keep going until you know it' : (def?.name ?? assignment.activity)} ·{' '}
        {targetName(assignment, deckTitles)}
      </p>
      {assignment.note && (
        <p className="mt-1 rounded-xl bg-quiet px-3 py-2 font-bold text-body">
          {assignment.note}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {/* "Continue" rather than "Start" for a goal: it is one thing worked at
            over days, and "Start" would suggest beginning it again. */}
        {startable ? (
          <Button onClick={onStart}>{isGoal ? '▶️ Continue' : '▶️ Start'}</Button>
        ) : (
          <p className="font-bold text-rose-500">
            This one cannot be started — whatever it pointed at is gone.
          </p>
        )}
        {canAssign && (
          <>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel it
            </Button>
            <Button variant="ghost" onClick={onDelete} disabled={busy}>
              🗑️ Remove
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
