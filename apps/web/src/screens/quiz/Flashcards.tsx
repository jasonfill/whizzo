import { useCallback, useEffect, useRef, useState } from 'react'
import RichText from '../../components/rich/RichText'
import { Button, Card, Pill } from '../../components/ui'
import type { QuizItemResult, QuizSessionApi } from '../../hooks/useQuizSession'
import { REASON_LABEL } from '../../lib/quiz/session'
import { richToPlain } from '../../lib/rich/parse'
import { isSpeechAvailable, speak, stopSpeaking } from '../../lib/spelling/speech'

/**
 * Classic flashcards: read the front, decide whether you knew it, turn it over.
 *
 * Two things keep the self-grade from being worth less than nothing:
 *
 *   * a card marked "still learning" comes back later in the same round, so
 *     the honest answer leads somewhere instead of onto a list at the end;
 *   * the grade is submitted unverified, which earns a fraction of the mastery
 *     a checked answer does and can never reach the mastered band. "I knew
 *     that" is a claim about a card, not a measurement of a person, and the
 *     graded modes exist to do the measuring.
 *
 * The card can be shown two ways, and the learner picks which:
 *
 *   * **flip** — the answer replaces the question, like a paper card;
 *   * **slide** — the question slides up to make room and the answer appears
 *     underneath it, so both sides are on screen together. Useful when the
 *     question is long, or when the point is to see the two side by side.
 *
 * Either way the answer stays hidden until the learner asks for it, and the
 * grade buttons stay hidden until then too. Seeing both sides at once is a
 * layout choice, not a licence to grade without thinking first.
 */

export type CardLayout = 'flip' | 'slide'

const LAYOUT_KEY = 'whizzo:flashcards:layout'

function loadLayout(): CardLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'slide' ? 'slide' : 'flip'
  } catch {
    return 'flip'
  }
}

function saveLayout(layout: CardLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // Storage unavailable — the choice lasts for this round and no longer.
  }
}

export default function Flashcards({
  session,
  onFinish,
}: {
  session: QuizSessionApi
  onFinish: (results: QuizItemResult[]) => void
}) {
  const [flipped, setFlipped] = useState(false)
  const [comingBack, setComingBack] = useState(false)
  const [layout, setLayoutState] = useState<CardLayout>(loadLayout)
  const handoffRef = useRef(0)
  const { cursor, progress, current, currentQuestion, results, beginItem, submit, advance } =
    session

  useEffect(() => {
    setFlipped(false)
    setComingBack(false)
    beginItem()
  }, [cursor, beginItem])

  const setLayout = useCallback((next: CardLayout) => {
    setLayoutState(next)
    saveLayout(next)
  }, [])

  const grade = useCallback(
    (knewIt: boolean) => {
      // The pause after a miss is short, but it is long enough for a fast
      // learner to hit the key again and grade the next card by accident.
      if (comingBack) return
      // Self-graded, and marked as such all the way down to the attempt row.
      const result = submit('', knewIt ? 'correct' : 'wrong', { verified: false })
      if (!result) return
      stopSpeaking()
      const all = [...results, result]

      // A card they missed is going to come back — say so, briefly, before
      // moving on. Being told "we'll come back to this" is the difference
      // between a queue and a telling-off.
      if (result.requeued) {
        setComingBack(true)
        handoffRef.current = window.setTimeout(() => {
          if (!advance()) onFinish(all)
        }, 750)
        return
      }
      if (!advance()) onFinish(all)
    },
    [advance, comingBack, onFinish, results, submit],
  )

  // Keyboard: space to turn the card over, then left or right to grade it.
  // Deliberately the same shape as every other flashcard app — muscle memory
  // from Quizlet should carry over without anyone having to learn anything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped((f) => !f)
        return
      }
      if (!flipped) return
      if (e.key === 'ArrowLeft') grade(false)
      if (e.key === 'ArrowRight') grade(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, grade])

  useEffect(
    () => () => {
      stopSpeaking()
      window.clearTimeout(handoffRef.current)
    },
    [],
  )

  if (!current || !currentQuestion) return null

  const front = currentQuestion.prompt
  const back = currentQuestion.answer
  const reason = REASON_LABEL[current.reason]
  const sliding = layout === 'slide'

  const toggleLabel = sliding
    ? flipped
      ? 'Hide the answer'
      : 'Show the answer'
    : flipped
      ? 'Turn card back'
      : 'Turn card over'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Pill className="bg-wash text-ink">
          {reason.emoji} {reason.label}
        </Pill>
        <div className="flex items-center gap-3">
          <LayoutToggle value={layout} onChange={setLayout} />
          <span className="font-bold text-stone">
            {progress.retired} of {progress.total} put away
          </span>
        </div>
      </div>

      {progress.pass > 1 && (
        <p className="mb-3 text-center font-extrabold text-ink">
          🔁 Here it is again — try to get it this time.
        </p>
      )}

      {/* The card. Clicking anywhere turns it over, or slides the answer in. */}
      <button onClick={() => setFlipped((f) => !f)} className="mb-4 w-full" aria-label={toggleLabel}>
        {sliding ? (
          <SlideCard
            front={front}
            back={back}
            hint={current.card.hint}
            revealed={flipped}
          />
        ) : (
          <FlipCard front={front} back={back} hint={current.card.hint} flipped={flipped} />
        )}
      </button>

      {isSpeechAvailable() && (
        <div className="mb-4 flex justify-center">
          <Button
            variant="ghost"
            onClick={() => speak(richToPlain(flipped ? back : front))}
            aria-label="Read this side out loud"
          >
            🔊 Read it out
          </Button>
        </div>
      )}

      {comingBack ? (
        <Card className="bg-amber-50 ring-amber-200">
          <p className="text-center font-extrabold text-amber-700">
            🔁 No problem — we&apos;ll come back to this one in a bit.
          </p>
        </Card>
      ) : flipped ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="danger" onClick={() => grade(false)}>
            😾 Still learning
          </Button>
          <Button variant="success" onClick={() => grade(true)}>
            😺 Got it
          </Button>
        </div>
      ) : (
        <Card>
          <p className="text-center font-bold text-stone">
            {sliding
              ? 'Have a think, then show the answer to see how you did.'
              : 'Have a think, then turn the card over to see how you did.'}
          </p>
        </Card>
      )}
    </div>
  )
}

/** The paper-card way: one side at a time. */
function FlipCard({
  front,
  back,
  hint,
  flipped,
}: {
  front: string
  back: string
  hint?: string | null
  flipped: boolean
}) {
  return (
    <div
      className={`flex min-h-[16rem] flex-col items-center justify-center rounded-3xl p-8 text-center shadow-xl ring-1 backdrop-blur transition-colors ${
        flipped ? 'bg-emerald-50/90 ring-emerald-200' : 'bg-white/90 ring-hair'
      }`}
    >
      <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">
        {flipped ? 'Answer' : 'Question'}
      </p>
      <RichText
        source={flipped ? back : front}
        className="text-3xl font-extrabold text-ink md:text-4xl"
      />
      {!flipped && hint && <p className="mt-3 font-bold text-stone">💡 {hint}</p>}
      <p className="mt-6 text-sm font-bold text-stone">
        {flipped ? 'Tap to see the question again' : 'Tap the card, or press space, to flip'}
      </p>
    </div>
  )
}

/**
 * The both-sides way: the question sits at the top once the answer is shown,
 * and the answer slides up into the space beneath it. Nothing leaves the
 * screen, so a learner can check their answer against the question that
 * prompted it without holding either in their head.
 */
function SlideCard({
  front,
  back,
  hint,
  revealed,
}: {
  front: string
  back: string
  hint?: string | null
  revealed: boolean
}) {
  return (
    <div
      className={`flex min-h-[16rem] flex-col items-center rounded-3xl p-8 text-center shadow-xl ring-1 backdrop-blur transition-all ${
        revealed ? 'justify-start bg-emerald-50/90 ring-emerald-200' : 'justify-center bg-white/90 ring-hair'
      }`}
    >
      <div className="w-full transition-all">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-stone">Question</p>
        <RichText
          source={front}
          className={`font-extrabold text-ink transition-all ${
            revealed ? 'text-xl md:text-2xl' : 'text-3xl md:text-4xl'
          }`}
        />
        {!revealed && hint && <p className="mt-3 font-bold text-stone">💡 {hint}</p>}
      </div>

      {revealed ? (
        <div className="mt-5 w-full animate-slide-up border-t border-emerald-200 pt-5">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-emerald-700">
            Answer
          </p>
          <RichText source={back} className="text-3xl font-extrabold text-ink md:text-4xl" />
          <p className="mt-6 text-sm font-bold text-stone">Tap to hide the answer again</p>
        </div>
      ) : (
        <p className="mt-6 text-sm font-bold text-stone">
          Tap the card, or press space, to show the answer
        </p>
      )}
    </div>
  )
}

/** Flip or slide. Small, out of the way, and remembered between rounds. */
function LayoutToggle({
  value,
  onChange,
}: {
  value: CardLayout
  onChange: (v: CardLayout) => void
}) {
  const options: Array<{ id: CardLayout; label: string; title: string }> = [
    { id: 'flip', label: '🔄 Flip', title: 'Turn the card over to see the answer' },
    { id: 'slide', label: '↕️ Slide', title: 'Slide the question up and show the answer beneath it' },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="How the card shows its answer"
      className="flex gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-edge"
    >
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition-colors ${
            value === o.id ? 'bg-ink text-white' : 'text-ink hover:bg-quiet'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
