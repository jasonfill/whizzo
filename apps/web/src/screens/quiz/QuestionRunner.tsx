import { useCallback, useEffect, useRef, useState } from 'react'
import RichText from '../../components/rich/RichText'
import { Button, Card, Pill } from '../../components/ui'
import type { QuizItemResult, QuizSessionApi } from '../../hooks/useQuizSession'
import { gradeWritten, isProduced, type Grade } from '../../lib/quiz/questions'
import { REASON_LABEL } from '../../lib/quiz/session'
import { sfx } from '../../lib/sound'
import type { QuestionKind } from '../../lib/quiz/questions'

/** What the learner is being asked to do, said plainly above the question. */
const KIND_LABEL: Record<QuestionKind, string> = {
  'multiple-choice': 'Pick the answer',
  'true-false': 'True or false',
  'letter-hint': 'Write it out — here is the shape',
  'word-bank': 'Write it out — the answers are below',
  written: 'Write it out',
}

/**
 * Runs the graded modes: Learn and Test.
 *
 * Feedback is immediate in both. Holding results back to the end is how a real
 * exam works, but nobody learns from a paper handed back cold — and the whole
 * point of Learn is that the next question already knows how the last one went.
 *
 * Learn also puts a missed card back into the round a few questions later, so
 * the learner meets it again while the correction is still fresh. Test does
 * not: it is a measurement, and a paper that keeps handing your mistakes back
 * until you fix them is measuring something else.
 */
export default function QuestionRunner({
  session,
  strict,
  onFinish,
}: {
  session: QuizSessionApi
  /** Test mode shows the answer but never lets you try again. */
  strict: boolean
  onFinish: (results: QuizItemResult[]) => void
}) {
  const { cursor, progress, isLast, current, currentQuestion, results, beginItem, submit, advance } =
    session

  const [typed, setTyped] = useState('')
  const [hintsUsed, setHintsUsed] = useState(0)
  const [feedback, setFeedback] = useState<QuizItemResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTyped('')
    setHintsUsed(0)
    setFeedback(null)
    beginItem()
    // Autofocus written questions so a learner can type straight away without
    // reaching for the mouse between every card.
    const id = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(id)
  }, [cursor, beginItem])

  const answer = useCallback(
    (given: string, grade: Grade) => {
      const result = submit(given, grade, { hintsUsed })
      if (!result) return
      if (result.correct) sfx.correct()
      else sfx.wrong()
      setFeedback(result)
    },
    [hintsUsed, submit],
  )

  const next = useCallback(() => {
    if (!feedback) return
    const all = [...results]
    if (!advance()) onFinish(all)
  }, [advance, feedback, onFinish, results])

  // Enter moves on once an answer is in, so a whole round can be done from the
  // keyboard without ever leaving the home row.
  useEffect(() => {
    if (!feedback) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [feedback, next])

  if (!current || !currentQuestion) return null

  const q = currentQuestion
  const reason = REASON_LABEL[current.reason]
  const revealed = feedback !== null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill className="bg-wash text-ink">
            {reason.emoji} {reason.label}
          </Pill>
          <Pill className="bg-wash text-muted">
            {KIND_LABEL[q.kind]}
          </Pill>
        </div>
        <span className="font-bold text-stone">
          {progress.retired} of {progress.total} done
        </span>
      </div>

      <div className="mb-4 h-2 overflow-hidden rounded-full bg-wash">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(progress.retired / Math.max(1, progress.total)) * 100}%` }}
        />
      </div>

      {progress.pass > 1 && (
        <p className="mb-3 text-center font-extrabold text-ink">
          🔁 Second go at this one — you have seen the answer now.
        </p>
      )}

      <Card className="mb-4">
        <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-stone">
          {q.kind === 'true-false' ? 'Does this match?' : 'Question'}
        </p>
        <RichText source={q.prompt} className="text-2xl font-extrabold text-ink md:text-3xl" />
        {q.kind === 'true-false' && (
          <RichText
            source={q.claim ?? ''}
            className="mt-3 block rounded-2xl bg-quiet px-4 py-3 text-xl font-bold text-body"
          />
        )}
        {hintsUsed > 0 && current.card.hint && (
          <p className="mt-3 font-bold text-amber-600">💡 {current.card.hint}</p>
        )}
      </Card>

      {/* --- The answer controls, by question kind --- */}

      {q.kind === 'multiple-choice' && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {q.choices?.map((choice) => {
            const isAnswer = choice === q.answer
            const picked = feedback?.given === choice
            const style = !revealed
              ? 'bg-white/85 text-ink ring-hair hover:-translate-y-0.5 hover:shadow-lg'
              : isAnswer
                ? 'bg-emerald-100 text-emerald-800 ring-emerald-300'
                : picked
                  ? 'bg-rose-100 text-rose-700 ring-rose-300'
                  : 'bg-white/60 text-stone ring-edge'
            return (
              <button
                key={choice}
                disabled={revealed}
                onClick={() => answer(choice, isAnswer ? 'correct' : 'wrong')}
                className={`rounded-2xl px-5 py-4 text-left text-lg font-bold shadow ring-1 transition-all ${style}`}
              >
                <RichText source={choice} />
              </button>
            )
          })}
        </div>
      )}

      {q.kind === 'true-false' && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[true, false].map((value) => {
            const correct = value === q.claimIsTrue
            const picked = feedback ? feedback.given === String(value) : false
            const style = !revealed
              ? 'bg-white/85 text-ink ring-hair hover:-translate-y-0.5 hover:shadow-lg'
              : correct
                ? 'bg-emerald-100 text-emerald-800 ring-emerald-300'
                : picked
                  ? 'bg-rose-100 text-rose-700 ring-rose-300'
                  : 'bg-white/60 text-stone ring-edge'
            return (
              <button
                key={String(value)}
                disabled={revealed}
                onClick={() => answer(String(value), correct ? 'correct' : 'wrong')}
                className={`rounded-2xl px-5 py-5 text-xl font-extrabold shadow ring-1 transition-all ${style}`}
              >
                {value ? '✅ True' : '❌ False'}
              </button>
            )
          })}
        </div>
      )}

      {isProduced(q.kind) && (
        <form
          className="mb-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (revealed || !typed.trim()) return
            answer(typed, gradeWritten(typed, q.answer))
          }}
        >
          {/* The scaffold. Shown above the box rather than inside it, so the
              learner's own typing is never mixed up with the help. */}
          {q.kind === 'letter-hint' && q.masked && (
            <p
              className="mb-3 font-mono text-2xl font-extrabold tracking-[0.35em] text-stone"
              aria-label={`The answer starts with ${q.masked[0]} and has ${q.masked.length} characters`}
            >
              {q.masked}
            </p>
          )}
          {q.kind === 'word-bank' && q.bank && (
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Possible answers">
              {q.bank.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={revealed}
                  onClick={() => setTyped(option)}
                  className="rounded-xl bg-quiet px-3 py-2 text-sm font-bold text-body ring-1 ring-hair transition-all hover:-translate-y-0.5 hover:shadow disabled:opacity-60"
                >
                  <RichText source={option} />
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              // Held until typing pauses, and dropped entirely when nobody is
              // following along — see useLiveRound.
              session.draft(e.target.value)
            }}
            disabled={revealed}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type the answer…"
            className="mb-3 w-full rounded-2xl border-2 border-edge px-5 py-4 text-xl font-bold text-ink focus:border-ink focus:outline-none disabled:bg-quiet"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={revealed || !typed.trim()}>
              Check it
            </Button>
            {!revealed && !strict && (
              <>
                {current.card.hint && hintsUsed === 0 && (
                  <Button type="button" variant="ghost" onClick={() => setHintsUsed(1)}>
                    💡 Hint
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => answer('', 'wrong')}
                  title="Show me — this one counts as missed"
                >
                  I do not know
                </Button>
              </>
            )}
          </div>
          {hintsUsed > 0 && (
            <p className="mt-2 text-xs font-bold text-stone">
              Hinted cards still count toward review, but not toward your level.
            </p>
          )}
        </form>
      )}

      {/* --- Feedback --- */}

      {feedback && (
        <Card
          className={
            feedback.grade === 'correct'
              ? 'ring-emerald-200'
              : feedback.grade === 'close'
                ? 'ring-amber-200'
                : 'ring-rose-200'
          }
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl">
              {feedback.grade === 'correct' ? '🎉' : feedback.grade === 'close' ? '😼' : '😿'}
            </span>
            <h3 className="text-xl font-extrabold text-ink">
              {feedback.grade === 'correct'
                ? 'Correct!'
                : feedback.grade === 'close'
                  ? 'So close — spelling slipped'
                  : 'Not this time'}
            </h3>
          </div>

          {feedback.grade !== 'correct' && (
            <div className="mb-3 text-lg font-bold text-body">
              The answer is <RichText source={q.answer} className="text-emerald-700" />
            </div>
          )}
          {feedback.grade === 'close' && (
            <p className="mb-3 font-bold text-muted">
              Counted as correct — you knew it. Worth a second look at the spelling.
            </p>
          )}

          {feedback.requeued && (
            <p className="mb-3 font-bold text-amber-600">
              🔁 We&apos;ll come back to this one before the end.
            </p>
          )}

          <Button className="w-full" onClick={next} autoFocus>
            {isLast ? 'See how I did →' : 'Next card →'}
          </Button>
        </Card>
      )}
    </div>
  )
}
