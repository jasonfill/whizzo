import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RichText from '../../components/rich/RichText'
import { Button, Card, Pill } from '../../components/ui'
import type { QuizItemResult, QuizSessionApi } from '../../hooks/useQuizSession'
import { sfx } from '../../lib/sound'

interface Tile {
  key: string
  cardId: string
  text: string
  side: 'prompt' | 'answer'
}

/**
 * The timed matching game. It is the least academic mode here and the one that
 * gets played most: it is short, it has a clock, and it rewards recognizing a
 * pair rather than producing an answer.
 *
 * A card is only recorded as correct if it was matched without a wrong attempt
 * first, so the game still produces honest evidence rather than a participation
 * trophy for everyone who eventually clicked the right tile.
 */
export default function MatchGame({
  session,
  onFinish,
}: {
  session: QuizSessionApi
  onFinish: (results: QuizItemResult[]) => void
}) {
  const { plan, questions } = session

  const tiles = useMemo<Tile[]>(() => {
    const built = plan.flatMap((p, i) => {
      const q = questions[i]
      if (!q) return []
      return [
        { key: `${p.card.id}-p`, cardId: p.card.id, text: q.prompt, side: 'prompt' as const },
        { key: `${p.card.id}-a`, cardId: p.card.id, text: q.answer, side: 'answer' as const },
      ]
    })
    for (let i = built.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[built[i], built[j]] = [built[j], built[i]]
    }
    return built
  }, [plan, questions])

  const [selected, setSelected] = useState<Tile | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [wrongPair, setWrongPair] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [done, setDone] = useState(false)

  // Cards the learner fumbled before getting right. Tracked in a ref because
  // the finish handler reads it once, and re-rendering on every miss would
  // restart the animation of the tiles that are still on the board.
  const missesRef = useRef<Set<string>>(new Set())
  const startedAtRef = useRef(Date.now())

  useEffect(() => {
    if (done) return
    const id = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAtRef.current) / 100) / 10)
    }, 100)
    return () => window.clearInterval(id)
  }, [done])

  const finishGame = useCallback(
    (finalMatched: Set<string>) => {
      setDone(true)
      const seconds = (Date.now() - startedAtRef.current) / 1000
      const results = plan
        .map((p, i): QuizItemResult | null => {
          const q = questions[i]
          if (!q || !finalMatched.has(p.card.id)) return null
          const clean = !missesRef.current.has(p.card.id)
          return {
            planned: p,
            question: q,
            given: clean ? q.answer : '',
            grade: clean ? ('correct' as const) : ('wrong' as const),
            correct: clean,
            // Per-card timing is not meaningful in a free-for-all grid, so the
            // round's average stands in rather than a fabricated number.
            responseMs: Math.round((seconds * 1000) / Math.max(1, plan.length)),
            hintsUsed: 0,
            // The grid checks every pair itself, and nothing repeats in a
            // round of Match — you either found it or the timer stopped.
            verified: true,
            pass: 1,
            requeued: false,
          }
        })
        .filter((r): r is QuizItemResult => r !== null)
      sfx.win()
      onFinish(results)
    },
    [onFinish, plan, questions],
  )

  const pick = (tile: Tile) => {
    if (done || matched.has(tile.cardId) || wrongPair.length > 0) return

    if (!selected) {
      setSelected(tile)
      return
    }
    if (selected.key === tile.key) {
      setSelected(null)
      return
    }

    const isPair = selected.cardId === tile.cardId && selected.side !== tile.side
    if (isPair) {
      sfx.correct()
      const next = new Set(matched).add(tile.cardId)
      setMatched(next)
      setSelected(null)
      if (next.size === plan.length) finishGame(next)
      return
    }

    sfx.wrong()
    missesRef.current.add(selected.cardId)
    missesRef.current.add(tile.cardId)
    setWrongPair([selected.key, tile.key])
    window.setTimeout(() => {
      setWrongPair([])
      setSelected(null)
    }, 500)
  }

  if (!plan.length) return null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Pill className="bg-wash text-ink">
          ⏱ {elapsed.toFixed(1)}s
        </Pill>
        <Pill className="bg-pine/10 text-pine">
          {matched.size} / {plan.length} pairs
        </Pill>
      </div>

      <Card className="mb-4">
        <p className="text-center font-bold text-muted">
          Tap a card, then tap its partner. Beat the clock.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((tile) => {
          const isMatched = matched.has(tile.cardId)
          const isSelected = selected?.key === tile.key
          const isWrong = wrongPair.includes(tile.key)
          return (
            <button
              key={tile.key}
              onClick={() => pick(tile)}
              disabled={isMatched}
              className={`flex min-h-[6.5rem] items-center justify-center rounded-2xl p-3 text-center text-sm font-bold shadow ring-1 transition-all md:text-base ${
                isMatched
                  ? 'pointer-events-none scale-95 bg-emerald-50 text-emerald-300 opacity-40 ring-emerald-100'
                  : isWrong
                    ? 'animate-shake bg-rose-100 text-rose-700 ring-rose-300'
                    : isSelected
                      ? 'bg-accent text-white ring-edge'
                      : 'bg-white/90 text-ink ring-hair hover:-translate-y-0.5 hover:shadow-lg'
              }`}
            >
              <RichText source={tile.text} figures="describe" />
            </button>
          )
        })}
      </div>

      {!done && (
        <div className="mt-5 flex justify-center">
          <Button variant="ghost" onClick={() => finishGame(matched)}>
            Stop here
          </Button>
        </div>
      )}
    </div>
  )
}
