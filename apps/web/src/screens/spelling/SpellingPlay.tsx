import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Mascot, { type Mood } from '../../components/Mascot'
import HereNow from '../../components/live/HereNow'
import Confetti from '../../components/Confetti'
import { Button, Card, Pill } from '../../components/ui'
import type { CurriculumWord } from '../../data/spelling'
import { wordDifficulty } from '../../data/spelling'
import { useSpellingSession, type ItemResult } from '../../hooks/useSpellingSession'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useBand } from '../../lib/band/useBand'
import { sfx, unlockAudio } from '../../lib/sound'
import {
  activity as activityDef,
  buildMissingLetters,
  diffAnswer,
  errorPattern,
  isCorrect,
  maskWordInSentence,
  proofreadChoices,
  scramble,
  type ActivityId,
} from '../../lib/spelling/activities'
import { REASON_LABEL, type SessionMode } from '../../lib/spelling/session'
import { wordHistory } from '../../lib/spelling/stats'
import {
  dictate,
  isSpeechAvailable,
  primeVoices,
  speak,
  stopSpeaking,
  whenVoicesReady,
} from '../../lib/spelling/speech'
import type { Navigate } from '../../routes'
import SpellingResults from './SpellingResults'

interface Props {
  activity: ActivityId
  mode: SessionMode
  listId?: string
  customListId?: string
  size?: number
  navigate: Navigate
}

type Phase = 'prompt' | 'feedback' | 'grading' | 'done'

export default function SpellingPlay({ activity, mode, listId, customListId, size, navigate }: Props) {
  const session = useSpellingSession()
  const { snapshot } = useProgress()
  const { theme } = useTheme()
  const { celebrates, say, roundSize } = useBand()
  const def = activityDef(activity)

  const [phase, setPhase] = useState<Phase>('prompt')
  const [answer, setAnswer] = useState('')

  /**
   * Typing, with anybody following along told about it once it pauses.
   *
   * Wrapped here rather than inside the answer box so the resets elsewhere in
   * this file stay silent — clearing the field between words is not something
   * to broadcast.
   */
  const type = useCallback(
    (value: string) => {
      setAnswer(value)
      session.draft(value)
    },
    [session],
  )
  const [last, setLast] = useState<ItemResult | null>(null)
  const [hints, setHints] = useState(0)
  const [speechReady, setSpeechReady] = useState(isSpeechAvailable())
  const [flashWord, setFlashWord] = useState(false)
  const collected = useRef<ItemResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const startedRef = useRef(false)

  const customWords = useMemo<CurriculumWord[] | undefined>(() => {
    if (!customListId) return undefined
    const list = snapshot.customLists.find((l) => l.id === customListId)
    if (!list) return undefined
    return list.words.map((entry) => ({
      ...entry,
      listId: `custom:${list.id}`,
      listTitle: list.title,
      grade: list.grade ?? 4,
      difficulty: wordDifficulty(entry.w, list.grade ?? 4),
    }))
  }, [customListId, snapshot.customLists])

  // Start the round exactly once; the plan must not be rebuilt on re-render or
  // the learner would get a different word mid-question.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    primeVoices()
    // Same rule as the quiz: the band sets how long a round is when nobody
    // asked, and an explicit size from the URL still wins. A placement round
    // is left alone — it has to span the grades to place anyone.
    session.start({
      activity,
      mode,
      listId,
      customWords,
      size: size ?? (mode === 'placement' ? undefined : roundSize),
    })
  }, [activity, customWords, listId, mode, roundSize, session, size])

  // Voices load asynchronously, so the answer to "can this device talk?" may
  // change a beat after mount.
  useEffect(() => whenVoicesReady(setSpeechReady), [])

  const current = session.current
  const total = session.plan.length

  // Read the word aloud when a new dictation prompt appears. Browsers without a
  // voice get a two-second flash of the word instead, so the activity still works.
  useEffect(() => {
    if (!current || phase !== 'prompt') return
    session.beginItem()
    setAnswer('')
    setHints(0)
    if (activity === 'listen-spell' || activity === 'test') {
      if (speechReady) {
        dictate(current.w, current.s)
      } else {
        // No voice on this device, so fall back to look-cover-write-check: show
        // the word briefly, hide it, then ask for it. That is a real spelling
        // method, not a degraded one.
        setFlashWord(true)
        const t = setTimeout(() => setFlashWord(false), 2500)
        return () => clearTimeout(t)
      }
    } else if (activity === 'study') {
      speak(current.w)
    }
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.w, phase, activity, speechReady])

  useEffect(() => () => stopSpeaking(), [])

  const finishRound = useCallback(async () => {
    stopSpeaking()
    await session.finish(collected.current)
    setPhase('done')
  }, [session])

  const grade = useCallback(
    (given: string, correct: boolean) => {
      const result = session.submit(given, correct, hints)
      if (!result) return
      collected.current = [...collected.current, result]
      setLast(result)
      if (correct) sfx.correct()
      else sfx.wrong()
      setPhase('feedback')
    },
    [hints, session],
  )

  const submitTyped = useCallback(() => {
    if (!current || !answer.trim()) return
    unlockAudio()
    grade(answer, isCorrect(answer, current.w))
  }, [answer, current, grade])

  const next = useCallback(() => {
    stopSpeaking()
    if (session.index >= total - 1) {
      // Marking the round in flight before awaiting matters: clearing the last
      // result while the feedback panel is still mounted would render it
      // against nothing.
      setPhase('grading')
      void finishRound()
      return
    }
    setLast(null)
    session.advance()
    setPhase('prompt')
  }, [finishRound, session, total])

  if (phase === 'done' && session.summary) {
    return (
      <SpellingResults
        summary={session.summary}
        navigate={navigate}
        onAgain={() => {
          collected.current = []
          startedRef.current = false
          session.reset()
          setPhase('prompt')
        }}
      />
    )
  }

  if (phase === 'grading' || (phase === 'done' && !session.summary)) {
    return (
      <div className="mx-auto w-full max-w-2xl py-16 text-center">
        <Mascot mood="idle" size={120} className="mx-auto animate-floaty" />
        <p className="mt-4 text-lg font-bold text-muted">Adding up your round…</p>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="mx-auto w-full max-w-2xl py-16 text-center">
        <Mascot mood="resting" size={120} className="mx-auto animate-floaty" />
        <p className="mt-4 text-lg font-bold text-muted">Rounding up some words…</p>
      </div>
    )
  }

  const reason = REASON_LABEL[current.reason]
  const mood: Mood = phase === 'feedback' ? (last?.correct ? 'cheer' : 'thinking') : 'idle'
  const pattern = errorPattern(current.w)
  const history = wordHistory(snapshot, current.w)
  const seenBefore = history.attempts > 0

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      {/* Nobody follows a round without the learner seeing it, and the line is
          specific about what leaves this screen — see docs/realtime-spec.md §9. */}
      {session.watched && (
        <div className="mb-2 flex flex-col items-center gap-1">
          <HereNow names={session.watcherNames} doing="following along" />
          <p className="text-[12px] font-bold text-muted">
            They can see the word you are on and what you type.
          </p>
        </div>
      )}

      {/* One segment per word: filled behind you, tinted where you are, inert
          ahead. A strip rather than a bar, because a round is countable. */}
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            stopSpeaking()
            navigate({ name: 'spelling' })
          }}
        >
          ← Leave
        </Button>
        <div className="flex flex-1 gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-2 flex-1 rounded-full ${
                i < session.index ? 'bg-accent' : i === session.index ? 'bg-tintB' : 'bg-tray'
              }`}
            />
          ))}
        </div>
        <span className="text-sm font-extrabold text-muted">
          {session.index + 1} / {total}
        </span>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="bg-tintB font-mono text-[11px] uppercase tracking-[0.1em] text-ink">
              {def.emoji} {def.name} ·{' '}
              {def.isTest ? 'Counts' : 'Practice'}
            </Pill>
            {mode === 'adaptive' && (
              <Pill className="bg-wash text-muted">
                {reason.emoji} {reason.label}
              </Pill>
            )}
          </div>
          {/* Grade and the feature that catches this word out — the same source
              the proofreading distractors are built from. */}
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-faint">
            Grade {Math.round(current.difficulty)}
            {pattern && ` · ${pattern}`}
          </span>
        </div>

        {/* Load-bearing: what this round does to the level, said plainly. */}
        <p className="mb-4 text-[13px] font-bold">
          {def.isTest ? (
            <span className="text-pine">Counts toward your level</span>
          ) : (
            <span className="text-muted">Practice only · doesn’t affect level</span>
          )}
          {seenBefore && (
            <span className="text-muted">
              {' '}
              · You’ve had this one right {history.correct} of {history.attempts} times.
            </span>
          )}
        </p>

        {phase === 'prompt' || !last ? (
          <PromptArea
            activity={activity}
            word={current.w}
            sentence={current.s}
            difficulty={current.difficulty}
            answer={answer}
            setAnswer={type}
            inputRef={inputRef}
            onSubmit={submitTyped}
            onChoose={(choice) => grade(choice, isCorrect(choice, current.w))}
            hints={hints}
            onHint={() => setHints((h) => h + 1)}
            onReveal={() => {
              setHints((h) => h + 1)
              setFlashWord(true)
              window.setTimeout(() => setFlashWord(false), 2000)
            }}
            speechReady={speechReady}
            flashWord={flashWord}
          />
        ) : (
          <Feedback result={last} onNext={next} isLast={session.index >= total - 1} />
        )}
      </Card>

      <div
        className="mt-5 flex flex-wrap items-center justify-center gap-4 rounded-[22px] p-5 text-center sm:text-left"
        style={{ background: theme.tintA }}
      >
        <Mascot mood={mood} size={62} className={phase === 'prompt' ? 'animate-floaty' : ''} />
        <div>
          {/* Praise belongs to an answer, and only to a right one.
              This used to be the `else` of the miss branch, which meant it also
              rendered while the learner was still reading the word — so word
              one of a placement check congratulated a brand-new learner before
              they had typed anything, and told them "that is the word that got
              you last Tuesday" about a word they had never seen. Being
              congratulated for nothing is how a child learns the praise means
              nothing; being told a false thing about their own history is
              worse. Nothing is said until there is something to say. */}
          {phase === 'feedback' && last && (
            last.correct ? (
              <>
                {/* The theme owns the words; the band owns whether they are
                    said at all. A sixteen-year-old gets "Correct · 1.4s", not
                    a cheer and a mascot line about last Tuesday. */}
                <div className="font-display text-lg font-extrabold text-ink">
                  {celebrates ? theme.cheer : say(true, last.responseMs)}
                </div>
                {celebrates && <div className="text-[15px] text-body">{theme.cheerSub}</div>}
              </>
            ) : (
              <>
                <div className="font-display text-lg font-extrabold text-ink">
                  {celebrates ? 'That one goes back in the pile.' : say(false)}
                </div>
                <div className="text-[15px] text-body">
                  You will see it again before long — that is how it sticks.
                </div>
              </>
            )
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-[13px] text-stone">
        The mascot is the only part of this screen your world changes. The words, the grading
        and the level are the same whichever one you pick.
      </p>
      {phase === 'feedback' && last?.correct && <Confetti count={16} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

interface PromptProps {
  activity: ActivityId
  word: string
  sentence: string
  difficulty: number
  answer: string
  setAnswer: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement>
  onSubmit: () => void
  onChoose: (choice: string) => void
  hints: number
  onHint: () => void
  onReveal: () => void
  speechReady: boolean
  flashWord: boolean
}

function PromptArea(props: PromptProps) {
  const { activity, word, sentence, difficulty } = props

  // Puzzle shapes are generated once per word so they do not reshuffle while
  // the learner is looking at them.
  const puzzle = useMemo(() => buildMissingLetters(word, difficulty), [word, difficulty])
  const scrambled = useMemo(() => scramble(word), [word])
  const choices = useMemo(() => proofreadChoices(word), [word])

  if (activity === 'proofread') {
    return (
      <div>
        <p className="mb-1 text-lg font-extrabold text-ink">Which one is spelled correctly?</p>
        <p className="mb-4 font-bold text-muted">{maskWordInSentence(sentence, word)}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              key={choice}
              onClick={() => props.onChoose(choice)}
              className="rounded-2xl border-2 border-edge bg-white px-4 py-4 font-mono text-xl font-bold text-ink transition-colors hover:border-ink hover:bg-quiet"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {activity === 'listen-spell' || activity === 'test' ? (
        <ListenPrompt {...props} />
      ) : activity === 'missing-letters' ? (
        <div className="mb-5 text-center">
          <p className="mb-2 font-bold text-muted">Fill in the missing letters:</p>
          <p className="font-mono text-4xl font-extrabold tracking-[0.2em] text-ink">
            {puzzle.masked}
          </p>
          <p className="mt-3 font-bold text-muted">{maskWordInSentence(sentence, word)}</p>
        </div>
      ) : activity === 'scramble' ? (
        <div className="mb-5 text-center">
          <p className="mb-2 font-bold text-muted">Unscramble these letters:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[...scrambled].map((c, i) => (
              <span
                key={`${c}-${i}`}
                className="rounded-xl bg-wash px-3 py-2 font-mono text-2xl font-extrabold uppercase text-ink"
              >
                {c}
              </span>
            ))}
          </div>
          <p className="mt-3 font-bold text-muted">{maskWordInSentence(sentence, word)}</p>
        </div>
      ) : (
        // study
        <div className="mb-5 text-center">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">
            Look at it, say it, then type it
          </p>
          <p className="font-mono text-5xl font-extrabold text-ink">{word}</p>
          <p className="mt-3 font-bold text-muted">{sentence}</p>
          <button
            onClick={() => speak(word)}
            className="mt-2 rounded-full bg-wash px-4 py-1.5 text-sm font-extrabold text-ink"
          >
            🔊 Hear it again
          </button>
        </div>
      )}

      <TypedAnswer {...props} />
    </div>
  )
}

function ListenPrompt({
  word,
  sentence,
  hints,
  onHint,
  onReveal,
  activity,
  speechReady,
  flashWord,
}: PromptProps) {
  return (
    <div className="mb-5 text-center">
      {speechReady ? (
        <p className="mb-3 text-6xl">🎧</p>
      ) : (
        <div className="mb-3">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">
            {flashWord ? 'Look at it, then spell it from memory' : 'Now spell it'}
          </p>
          <p className="font-mono text-4xl font-extrabold text-ink">
            {flashWord ? word : '• • •'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {speechReady ? (
          <>
            <button
              onClick={() => dictate(word, sentence)}
              className="rounded-full bg-accent px-5 py-2 text-sm font-extrabold text-white shadow"
            >
              🔊 Say it again
            </button>
            <button
              onClick={() => speak(sentence)}
              className="rounded-full bg-wash px-5 py-2 text-sm font-extrabold text-ink"
            >
              📖 In a sentence
            </button>
          </>
        ) : (
          activity !== 'test' && (
            <button
              onClick={onReveal}
              className="rounded-full bg-accent px-5 py-2 text-sm font-extrabold text-white shadow"
            >
              👀 Show it again
            </button>
          )
        )}
        {activity !== 'test' && (
          <button
            onClick={onHint}
            className="rounded-full bg-sun/30 px-5 py-2 text-sm font-extrabold text-ink"
          >
            💡 Hint — this word stops counting
          </button>
        )}
      </div>

      {!speechReady && (
        <p className="mt-3 text-xs font-bold text-stone">
          This device has no speech voice installed, so we show the word instead of reading it.
        </p>
      )}

      {!speechReady && (
        <p className="mt-3 font-bold text-muted">{maskWordInSentence(sentence, word)}</p>
      )}

      {hints > 0 && activity !== 'test' && (
        <div className="mt-3 rounded-2xl bg-sun/15 p-3">
          <p className="text-sm font-bold text-ink">
            {hints === 1
              ? `${word.length} letters, starts with "${word[0]}"`
              : `${word.slice(0, Math.ceil(word.length / 2))}${'_'.repeat(Math.floor(word.length / 2))}`}
          </p>
          <p className="mt-1 text-xs font-bold text-muted">
            Hints are fine — this one just will not count toward your level.
          </p>
        </div>
      )}
    </div>
  )
}

function TypedAnswer({ answer, setAnswer, inputRef, onSubmit }: PromptProps) {
  return (
    <div>
      <input
        ref={inputRef}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder="Type the word…"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Your spelling"
        className="w-full rounded-[14px] border-2 border-edge px-4 py-4 text-center font-mono text-2xl font-bold text-ink caret-accent focus:border-accent focus:outline-none"
      />
      <Button variant="play" className="mt-3 w-full" onClick={onSubmit} disabled={!answer.trim()}>
        Check it ✓
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function Feedback({
  result,
  onNext,
  isLast,
}: {
  result: ItemResult
  onNext: () => void
  isLast: boolean
}) {
  const diff = diffAnswer(result.given, result.word.w)

  // Enter advances, so a learner on a roll never has to reach for the mouse.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNext])

  return (
    <div className="text-center">
      <p className={`mb-2 text-2xl font-extrabold ${result.correct ? 'text-emerald-600' : 'text-rose-500'}`}>
        {result.correct ? 'That’s it! 🎉' : 'Not quite'}
      </p>

      {!result.correct && (
        <>
          <p className="mb-1 text-sm font-bold text-stone">You wrote</p>
          <p className="mb-3 font-mono text-2xl font-bold">
            {diff.map((d, i) => (
              <span
                key={i}
                className={
                  d.status === 'correct'
                    ? 'text-stone'
                    : d.status === 'missing'
                      ? 'text-emerald-600 underline decoration-dotted'
                      : 'text-rose-500 line-through'
                }
              >
                {d.char}
              </span>
            ))}
          </p>
        </>
      )}

      <p className="mb-1 text-sm font-bold text-stone">
        {result.correct ? 'That is the one' : 'The correct spelling is'}
      </p>
      <p className="font-mono text-4xl font-extrabold text-ink">{result.word.w}</p>
      <p className="mx-auto mt-3 max-w-md font-bold text-muted">{result.word.s}</p>

      <button
        onClick={() => speak(result.word.w)}
        className="mt-3 rounded-full bg-wash px-4 py-1.5 text-sm font-extrabold text-ink"
      >
        🔊 Hear it
      </button>

      <Button className="mt-5 w-full" onClick={onNext}>
        {isLast ? 'See my results →' : 'Next word →'}
      </Button>
      <p className="mt-2 text-xs font-bold text-stone">or press Enter</p>
    </div>
  )
}
