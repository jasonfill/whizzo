// A test, and the studying planned backwards from it.
//
// Four taps to add one: course chip, kind, date, a three-face difficulty. Then
// the proposal — ghost sessions with a purpose each — and one Add all. Linking
// a deck is optional and encouraged: with one, every session is a real round
// the app can run, and the card can say how ready the learner actually is.

import { useEffect, useMemo, useState } from 'react'
import {
  ASSESSMENT_KINDS,
  DIFFICULTY_LABEL,
  PURPOSE_COPY,
  dayName,
  readiness,
  todayString,
  type Assessment,
  type AssessmentDraft,
  type AssessmentKind,
  type Course,
  type Difficulty,
  type ItemMastery,
  type PlannerEvent,
  type ProposedSession,
  type QuizDeck,
} from '@whizzo/shared'
import { Button, Pill } from '../ui'
import { CoursePicker } from './CourseChip'
import Timeline from './Timeline'
import {
  acceptSessions,
  assessmentHistory,
  createAssessment,
  deleteAssessment,
  proposeSessions,
  recordOutcome,
  updateAssessment,
} from '../../lib/planner/api'

interface Props {
  learnerId: string
  learnerName: string
  courses: Course[]
  decks: QuizDeck[]
  masteries: ItemMastery[]
  /** Existing: edit, propose, outcome. Absent: the add form. */
  assessment: Assessment | null
  initial?: Partial<AssessmentDraft>
  sessionsDone?: number
  sessionsTotal?: number
  showReadiness: boolean
  canWrite: boolean
  onSaved: (a: Assessment) => void
  onDeleted: (id: string) => void
  onAccepted: () => void
  onClose: () => void
}

export default function AssessmentSheet({
  learnerId,
  learnerName,
  courses,
  decks,
  masteries,
  assessment,
  initial,
  sessionsDone = 0,
  sessionsTotal = 0,
  showReadiness,
  canWrite,
  onSaved,
  onDeleted,
  onAccepted,
  onClose,
}: Props) {
  const today = todayString()
  const [courseId, setCourseId] = useState<string | null>(assessment?.courseId ?? initial?.courseId ?? null)
  const [kind, setKind] = useState<AssessmentKind>(assessment?.kind ?? initial?.kind ?? 'test')
  const [title, setTitle] = useState(assessment?.title ?? initial?.title ?? '')
  const [on, setOn] = useState(assessment?.on ?? initial?.on ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty>(assessment?.difficulty ?? initial?.difficulty ?? 2)
  const [deckId, setDeckId] = useState<string | null>(assessment?.target?.targetId ?? initial?.target?.targetId ?? null)
  const [proposal, setProposal] = useState<{
    sessions: ProposedSession[]
    message: string | null
    calibrationNote: string | null
    wanted: number
  } | null>(null)
  const [kept, setKept] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'plan' | 'history'>('plan')
  const [events, setEvents] = useState<PlannerEvent[] | null>(null)
  const [felt, setFelt] = useState<Difficulty | null>(assessment?.outcome?.feltLike ?? null)
  const [score, setScore] = useState(assessment?.outcome?.score ?? '')

  const past = assessment ? assessment.on < today : false
  const dirty =
    !!assessment &&
    (courseId !== assessment.courseId ||
      kind !== assessment.kind ||
      title !== assessment.title ||
      on !== assessment.on ||
      difficulty !== assessment.difficulty ||
      (deckId ?? null) !== (assessment.target?.targetId ?? null))

  const ready = useMemo(() => {
    if (!assessment?.target || !showReadiness) return null
    return readiness(masteries, assessment.target, today, assessment.on)
  }, [assessment, masteries, today, showReadiness])

  useEffect(() => {
    if (tab !== 'history' || events || !assessment) return
    const controller = new AbortController()
    assessmentHistory(assessment.id, controller.signal)
      .then(setEvents)
      .catch(() => setEvents([]))
    return () => controller.abort()
  }, [tab, events, assessment])

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const draft = (): AssessmentDraft => ({
    courseId,
    kind,
    title: title.trim(),
    on,
    difficulty,
    target: deckId ? { subject: 'quiz', targetId: deckId } : null,
  })

  const save = async (): Promise<Assessment | null> => {
    if (!title.trim() || !on) {
      setError('A title and a date, at least.')
      return null
    }
    setBusy(true)
    setError(null)
    try {
      const saved = assessment
        ? await updateAssessment(assessment.id, draft())
        : (await createAssessment([learnerId], draft()))[0]!
      onSaved(saved)
      return saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      return null
    } finally {
      setBusy(false)
    }
  }

  const propose = async () => {
    const saved = assessment && !dirty ? assessment : await save()
    if (!saved) return
    setBusy(true)
    try {
      const r = await proposeSessions(saved.id, today)
      setProposal(r)
      setKept(new Set(r.sessions.map((_, i) => i)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not plan')
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    if (!assessment || !proposal) return
    setBusy(true)
    try {
      await acceptSessions(
        assessment.id,
        proposal.sessions.filter((_, i) => kept.has(i)),
      )
      onAccepted()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the sessions')
    } finally {
      setBusy(false)
    }
  }

  const outcome = async () => {
    if (!assessment || !felt) return
    setBusy(true)
    try {
      const saved = await recordOutcome(assessment.id, { feltLike: felt, score: score || null, note: null })
      onSaved(saved)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label={assessment ? assessment.title : 'Add a test'}
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-hair bg-chalk p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {assessment && (
          <div className="mb-3 flex gap-1 rounded-xl bg-tray p-1 text-sm font-extrabold">
            {(['plan', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${tab === t ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {tab === 'history' && assessment ? (
          <Timeline events={events ?? []} learnerName={learnerName} emptyText={events ? 'Nothing yet.' : 'Loading…'} />
        ) : (
          <div className="space-y-4">
            <h2 className="font-display text-2xl font-extrabold text-ink">
              {assessment ? assessment.title : 'Add a test'}
            </h2>

            {courses.length > 0 && (
              <div>
                <Label>Course</Label>
                <CoursePicker courses={courses} value={courseId} onChange={setCourseId} />
              </div>
            )}

            <div>
              <Label>What is it</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
                {ASSESSMENT_KINDS.map((k) => (
                  <Choice key={k.id} selected={kind === k.id} onClick={() => setKind(k.id)}>
                    {k.emoji} {k.name}
                  </Choice>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <Label>Called</Label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Chapter 7 test"
                  aria-label="Title"
                  disabled={!canWrite}
                  className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-[15px] font-extrabold text-ink focus:border-ink focus:outline-none"
                />
              </label>
              <label className="block">
                <Label>When</Label>
                <input
                  type="date"
                  value={on}
                  onChange={(e) => setOn(e.target.value)}
                  aria-label="Date"
                  disabled={!canWrite}
                  className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-[15px] font-bold text-ink focus:border-ink focus:outline-none"
                />
              </label>
            </div>

            <div>
              <Label>How do you feel about it?</Label>
              <div className="flex gap-1.5" role="group" aria-label="Difficulty">
                {([1, 2, 3] as Difficulty[]).map((d) => (
                  <Choice key={d} selected={difficulty === d} onClick={() => setDifficulty(d)}>
                    {DIFFICULTY_LABEL[d].emoji} {DIFFICULTY_LABEL[d].name}
                  </Choice>
                ))}
              </div>
            </div>

            {kind !== 'project' && (
              <div>
                <Label>Study with</Label>
                <select
                  value={deckId ?? ''}
                  onChange={(e) => setDeckId(e.target.value || null)}
                  disabled={!canWrite}
                  aria-label="Study with"
                  className="w-full rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink"
                >
                  <option value="">Nothing in the app yet</option>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({d.cards.length} cards)
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs font-bold text-muted">
                  {deckId
                    ? 'Each session becomes a real round, checked by the app.'
                    : 'Link a deck and every session becomes a real round. No deck? Paste the vocab or upload the study guide from Library.'}
                </p>
              </div>
            )}

            {ready && (
              <div className="rounded-xl bg-wash p-3 text-sm font-bold text-ink">
                <span className="text-pine">{ready.mastered} of {ready.total} mastered</span>
                {ready.slipping > 0 && <> · {ready.slipping} slipping</>}
                {' · '}
                {ready.daysLeft > 0 ? `${ready.daysLeft} ${ready.daysLeft === 1 ? 'day' : 'days'} left` : 'today'}
              </div>
            )}
            {assessment && sessionsTotal > 0 && (
              <Pill className="bg-wash text-ink">
                {sessionsDone} of {sessionsTotal} sessions done
              </Pill>
            )}

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

            {/* The proposal. Ghost cards, one Add all. */}
            {proposal && (
              <div className="rounded-2xl border border-hair bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-ink">
                    {proposal.sessions.length} {proposal.sessions.length === 1 ? 'session' : 'sessions'} suggested
                  </span>
                  {proposal.sessions.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-extrabold text-muted underline"
                      onClick={() =>
                        setKept(kept.size === proposal.sessions.length ? new Set() : new Set(proposal.sessions.map((_, i) => i)))
                      }
                    >
                      {kept.size === proposal.sessions.length ? 'Keep none' : 'Keep all'}
                    </button>
                  )}
                </div>
                {proposal.message && <p className="mb-2 text-sm font-bold text-muted">{proposal.message}</p>}
                {proposal.calibrationNote && (
                  <p className="mb-2 text-sm font-bold text-pine">{proposal.calibrationNote}</p>
                )}
                <ul className="space-y-1.5">
                  {proposal.sessions.map((s, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-dashed border-edge px-3 py-2">
                        <input
                          type="checkbox"
                          checked={kept.has(i)}
                          onChange={(e) => {
                            const next = new Set(kept)
                            if (e.target.checked) next.add(i)
                            else next.delete(i)
                            setKept(next)
                          }}
                          className="mt-1"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-extrabold text-ink">
                            {dayName(s.onDay)} {s.onDay.slice(5)} · {PURPOSE_COPY[s.purpose].name} · {s.minutes}m
                          </span>
                          <span className="block text-xs font-bold text-muted">{PURPOSE_COPY[s.purpose].line}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {proposal.sessions.length > 0 && (
                  <Button className="mt-3 w-full" onClick={accept} disabled={busy || kept.size === 0}>
                    Add {kept.size === proposal.sessions.length ? 'all' : kept.size} to my week
                  </Button>
                )}
              </div>
            )}

            {/* The day after: how did it go? A claim, shown as one. */}
            {assessment && past && (
              <div className="rounded-2xl border border-hair bg-white p-3">
                <div className="mb-2 text-sm font-extrabold text-ink">How did {assessment.title} go?</div>
                <div className="mb-2 flex gap-1.5">
                  {([1, 2, 3] as Difficulty[]).map((d) => (
                    <Choice key={d} selected={felt === d} onClick={() => setFelt(d)}>
                      {DIFFICULTY_LABEL[d].emoji} {DIFFICULTY_LABEL[d].name}
                    </Choice>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    placeholder="Score (optional)"
                    aria-label="Score"
                    className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-white px-3 py-2 text-sm font-bold text-ink"
                  />
                  <Button variant="ghost" onClick={outcome} disabled={!felt || busy}>
                    Save
                  </Button>
                </div>
                {assessment.outcome && (
                  <p className="mt-2 text-xs font-bold text-muted">Recorded. Next time this course is planned with that in mind.</p>
                )}
              </div>
            )}

            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-1">
                {!past && kind !== 'project' && (
                  <Button onClick={propose} disabled={busy || !title.trim() || !on}>
                    {proposal ? 'Plan again' : 'Plan the studying'}
                  </Button>
                )}
                {!past && kind === 'project' && (
                  <Button onClick={propose} disabled={busy || !title.trim() || !on}>
                    Plan the milestones
                  </Button>
                )}
                {(dirty || !assessment) && (
                  <Button variant={assessment ? 'ghost' : 'secondary'} onClick={save} disabled={busy}>
                    {assessment ? 'Save changes' : 'Just add it'}
                  </Button>
                )}
                {assessment && (
                  <Button
                    variant="ghost"
                    className="text-red-700"
                    onClick={async () => {
                      await deleteAssessment(assessment.id)
                      onDeleted(assessment.id)
                      onClose()
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 text-right">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">{children}</div>
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition-colors ${
        selected ? 'bg-ink text-white' : 'bg-white text-ink ring-1 ring-edge hover:bg-wash'
      }`}
    >
      {children}
    </button>
  )
}
