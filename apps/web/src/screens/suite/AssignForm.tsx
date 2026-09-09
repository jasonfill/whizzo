import { useMemo, useState } from 'react'
import { Button, Card } from '../../components/ui'
import { CURRICULUM } from '../../data/lessons'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { GRADES } from '../../data/spelling'
import { createAssignments, type AssignmentDraft } from '../../lib/assignments/api'
import { ASSIGNABLE, type AssignableActivity } from '../../lib/assignments/routing'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { allDecks } from '../../lib/quiz/decks'

/**
 * Setting one piece of work.
 *
 * The form is built from the same list the completion rule reads, so anything
 * that can be set can be finished — there is no way to compose a task here that
 * no round could ever close.
 *
 * The score bar is only offered on graded work. A bar is judged on answers the
 * app checked, and a self-graded mode has none, so offering it on flashcards
 * would be offering a task that can never be completed.
 */
export default function AssignForm({
  learners,
  defaultLearnerIds,
  fixedTarget,
  onDone,
  onCancel,
}: {
  /** Everyone this grown-up could set work for. */
  learners: Array<{ id: string; displayName: string; avatarEmoji: string }>
  defaultLearnerIds: string[]
  /**
   * Set when the form was opened from a particular piece of material — from the
   * library, where you start with the deck and choose who gets it, rather than
   * from a child, where you start with the child.
   *
   * More than one id means a whole document: the six sets a chapter came back
   * as, set in one action rather than six. They become six tasks, because six
   * is what the learner has to do — the shortcut is for the grown-up filling
   * the form, not a change to what was set.
   */
  fixedTarget?: { kind: 'deck' | 'list'; ids: string[]; label?: string }
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { snapshot } = useProgress()
  const [choice, setChoice] = useState<AssignableActivity>(
    fixedTarget
      ? (ASSIGNABLE.find(
          (a) => a.target === (fixedTarget.kind === 'deck' ? 'deck' : 'spelling-list') && a.graded,
        ) ?? ASSIGNABLE[0])
      : ASSIGNABLE[0],
  )
  const [selected, setSelected] = useState<string[]>(defaultLearnerIds)
  const [targetId, setTargetId] = useState(fixedTarget?.ids[0] ?? '')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [minAccuracy, setMinAccuracy] = useState('')
  /**
   * Set an outcome rather than an activity.
   *
   * Default for a deck, because it is the better answer nearly every time:
   * "master this" is what a grown-up actually wants, and choosing between
   * Learn and Test is a pedagogical decision they should never have been
   * handed. Picking a specific activity stays available for the teacher who
   * genuinely wants a test on Friday.
   */
  const [asGoal, setAsGoal] = useState(fixedTarget?.kind === 'deck')
  /**
   * Only a study set can be "mastered" as a whole. A spelling list is part of a
   * curriculum that keeps going, and a typing lesson is one lesson — neither
   * has a finishing line a goal could measure.
   */
  const canSetGoal = fixedTarget?.kind === 'deck' || choice.target === 'deck'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decks = useMemo(() => allDecks(snapshot, STARTER_DECKS), [snapshot])

  const targets = useMemo(() => {
    if (choice.target === 'deck') return decks.map((d) => ({ id: d.id, name: d.title }))
    if (choice.target === 'spelling-list') {
      return GRADES.flatMap((g) =>
        g.lists.map((l) => ({ id: l.id, name: `Grade ${g.grade} — ${l.title}` })),
      )
    }
    return CURRICULUM.map((l) => ({ id: l.id, name: l.title }))
  }, [choice, decks])

  /** Every piece of material this form is about — one, or a whole document. */
  const targetIds = fixedTarget?.ids ?? (targetId ? [targetId] : [])
  const chosenTarget =
    targets.find((t) => t.id === targetId) ??
    (fixedTarget ? { id: targetId, name: fixedTarget.label ?? 'this' } : undefined)
  // A sensible default so the grown-up does not have to write a title for
  // "Learn — Times Tables"; they can still overwrite it.
  const effectiveTitle = title.trim() || `${choice.name}: ${chosenTarget?.name ?? '…'}`

  const submit = async () => {
    if (targetIds.length === 0) {
      setError('Pick what the work is on.')
      return
    }
    if (selected.length === 0) {
      setError('Choose at least one person to give it to.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const drafts: AssignmentDraft[] = targetIds.map((id) => ({
        subject: choice.subject,
        // A goal is walked by the path, so the activity is the path itself
        // rather than one round of one thing.
        activity: asGoal ? 'mastery-path' : choice.activity,
        goal: asGoal ? { kind: 'mastery' } : null,
        targetId: id,
        // Each part of a document keeps its own name, so a task list reads
        // "Organelles" and "Cell division" rather than six copies of the
        // chapter's title. A title typed by hand applies to all of them.
        title: (title.trim()
          ? title.trim()
          : `${choice.name}: ${targets.find((t) => t.id === id)?.name ?? chosenTarget?.name ?? '…'}`
        ).slice(0, 120),
        note: note.trim() || null,
        dueOn: dueOn || null,
        // A score bar measures one round. A goal is a statement about a state,
        // and the two would be answering different questions about the same
        // task.
        minAccuracy: !asGoal && choice.graded && minAccuracy ? Number(minAccuracy) : null,
      }))
      await createAssignments(selected, drafts)
      await onDone()
    } catch {
      setError(
        'Could not save that. Setting work is for the grown-up who owns the profile, or a ' +
          'guardian they have trusted with content.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-xl font-extrabold text-ink">Set some work</h2>

      {/* Who it is for comes first: the same work usually goes to more than one
          child, and deciding that after writing the task is backwards. */}
      {learners.length > 1 && (
        <fieldset className="mb-3">
          <legend className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            Who it is for
          </legend>
          <div className="flex flex-wrap gap-2">
            {learners.map((l) => {
              const on = selected.includes(l.id)
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                    )
                  }
                  className={`flex items-center gap-2 rounded-2xl px-4 py-2 font-bold ring-1 transition-colors ${
                    on
                      ? 'bg-ink text-white ring-ink'
                      : 'bg-white/85 text-muted ring-hair hover:bg-quiet'
                  }`}
                >
                  <span className="text-lg leading-none">{l.avatarEmoji}</span>
                  {l.displayName}
                  {on && <span aria-hidden>✓</span>}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-sm font-bold text-stone">
            Set it once and everyone gets their own copy to finish.
          </p>
        </fieldset>
      )}

      {/* Outcome or activity. The first is the default for a set because it is
          what a grown-up actually wants; the second is there for the teacher
          who wants a test on Friday and should get a test on Friday. */}
      {canSetGoal && (
        <fieldset className="mb-3">
          <legend className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            What to set
          </legend>
          <label className="mb-1 flex items-start gap-2 font-bold text-body">
            <input
              type="radio"
              name="assign-kind"
              checked={asGoal}
              onChange={() => setAsGoal(true)}
              className="mt-1"
            />
            <span>
              Master it
              <span className="block text-xs font-bold text-stone">
                They keep going until they know it. The app picks what to practice each time.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 font-bold text-body">
            <input
              type="radio"
              name="assign-kind"
              checked={!asGoal}
              onChange={() => setAsGoal(false)}
              className="mt-1"
            />
            <span>
              One particular activity
              <span className="block text-xs font-bold text-stone">
                A single round of something you choose.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <label className={`mb-3 block ${asGoal ? 'hidden' : ''}`}>
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          What kind
        </span>
        <select
          value={`${choice.subject}:${choice.activity}`}
          onChange={(e) => {
            const next = ASSIGNABLE.find(
              (a) => `${a.subject}:${a.activity}` === e.target.value,
            )
            if (next) {
              setChoice(next)
              // A form opened from the library stays on that piece of material;
              // only the way it is practiced is up for choosing.
              if (!fixedTarget) setTargetId('')
            }
          }}
          className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        >
          {ASSIGNABLE.filter(
            (a) =>
              !fixedTarget ||
              a.target === (fixedTarget.kind === 'deck' ? 'deck' : 'spelling-list'),
          ).map((a) => (
            <option key={`${a.subject}:${a.activity}`} value={`${a.subject}:${a.activity}`}>
              {a.emoji} {SUBJECT_LABEL[a.subject]} — {a.name}
              {a.graded ? '' : ' (not checked)'}
            </option>
          ))}
        </select>
      </label>

      <label className={`mb-3 block ${fixedTarget ? 'hidden' : ''}`}>
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          On what
        </span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        >
          <option value="">Choose…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {fixedTarget && fixedTarget.ids.length > 1 && (
        <p className="mb-3 rounded-xl bg-wash px-3 py-2 text-sm font-bold text-body">
          {fixedTarget.label ?? 'This document'} came back as {fixedTarget.ids.length} parts. Each
          one becomes its own task, so finishing means finishing all of them.
        </p>
      )}

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          {targetIds.length > 1 ? 'What they see (each part keeps its own name)' : 'What they see'}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={effectiveTitle}
          maxLength={120}
          className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        />
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
          A note (optional)
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Take your time on this one"
          maxLength={500}
          className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
        />
      </label>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            Due (optional)
          </span>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-stone">
            Score to beat (optional)
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={minAccuracy}
            onChange={(e) => setMinAccuracy(e.target.value)}
            disabled={!choice.graded}
            placeholder={choice.graded ? 'e.g. 80' : 'not available'}
            className="w-full rounded-2xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none disabled:bg-quiet"
          />
        </label>
      </div>

      {!choice.graded && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
          This one is self-graded, so the app cannot judge a score on it. The task will be marked
          done once the round is played.
        </p>
      )}

      {error && <p className="mb-3 font-bold text-rose-500">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving
            ? 'Saving…'
            : targetIds.length > 1
              ? `Set all ${targetIds.length} parts${
                  selected.length > 1 ? ` for ${selected.length} of them` : ''
                }`
              : selected.length > 1
                ? `Set this for ${selected.length} of them`
                : 'Set this task'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Never mind
        </Button>
      </div>
    </Card>
  )
}

const SUBJECT_LABEL: Record<string, string> = {
  quiz: 'Quiz',
  spelling: 'Spelling',
  typing: 'Typing',
}
