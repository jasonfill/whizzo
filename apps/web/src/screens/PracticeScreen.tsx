import { useMemo, useState } from 'react'
import type { GameApi } from '../hooks/useGameState'
import { CURRICULUM } from '../data/lessons'
import { generatePracticeText } from '../lib/content'
import type { RoundResult } from '../lib/stats'
import { starRating } from '../lib/stats'
import GamePlay from '../components/GamePlay'
import ResultsCard from '../components/ResultsCard'
import { Button, Card } from '../components/ui'
import Mascot from '../components/Mascot'
import { useBack } from '../hooks/useBack'
import type { Route } from '../App'

interface Props {
  game: GameApi
  navigate: (r: Route) => void
}

type Scope = 'learned' | 'all'
type Length = 15 | 25 | 40

// Union of keys unlocked through lessons the player has actually completed.
function learnedKeys(game: GameApi): string[] {
  const played = CURRICULUM.filter((l) => (game.state.lessons[l.id]?.plays ?? 0) > 0)
  if (played.length === 0) return CURRICULUM[0].allowedKeys
  const last = played[played.length - 1]
  return last.allowedKeys
}

export default function PracticeScreen({ game, navigate }: Props) {
  const goBack = useBack({ name: 'typing' })
  const [scope, setScope] = useState<Scope>('learned')
  const [length, setLength] = useState<Length>(25)
  const [phase, setPhase] = useState<'setup' | 'play' | 'results'>('setup')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<RoundResult | null>(null)

  const keys = useMemo(() => (scope === 'all' ? 'all' : learnedKeys(game)), [scope, game])
  const text = useMemo(() => {
    void attempt
    return generatePracticeText(keys, length)
  }, [keys, length, attempt])

  if (phase === 'play') {
    return (
      <div className="py-4">
        <GamePlay
          key={attempt}
          text={text}
          title="⌨️ Free Practice"
          subtitle={scope === 'all' ? 'Every key' : 'Keys you have learned'}
          catColor="#38bdf8"
          showKeyboard={game.state.settings.showKeyboard}
          showHands={game.state.settings.showHands}
          sound={game.state.settings.sound}
          onFinish={(r) => {
            setResult(r)
            game.addHighScore({
              score: r.score,
              wpm: r.wpm,
              accuracy: r.accuracy,
              mode: 'Practice',
              date: Date.now(),
            })
            setPhase('results')
          }}
          onQuit={() => setPhase('setup')}
        />
      </div>
    )
  }

  if (phase === 'results' && result) {
    return (
      <div className="py-6">
        <ResultsCard
          result={result}
          stars={starRating(result.accuracy, result.wpm)}
          title="Practice"
          soundOn={game.state.settings.sound}
          onReplay={() => {
            setAttempt((a) => a + 1)
            setResult(null)
            setPhase('play')
          }}
          onMenu={() => navigate({ name: 'typing' })}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <Mascot mood="idle" color="#38bdf8" size={80} />
          <div>
            <h1 className="text-2xl font-extrabold text-ink">Free Practice</h1>
            <p className="text-muted">Warm up with a custom round.</p>
          </div>
        </div>

        <p className="mb-2 font-bold text-body">Which keys?</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Choice active={scope === 'learned'} onClick={() => setScope('learned')}>
            🎓 Keys I&apos;ve learned
          </Choice>
          <Choice active={scope === 'all'} onClick={() => setScope('all')}>
            🌍 All keys
          </Choice>
        </div>

        <p className="mb-2 font-bold text-body">How long?</p>
        <div className="mb-6 grid grid-cols-3 gap-2">
          {([15, 25, 40] as Length[]).map((n) => (
            <Choice key={n} active={length === n} onClick={() => setLength(n)}>
              {n} words
            </Choice>
          ))}
        </div>

        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => { setAttempt((a) => a + 1); setPhase('play') }}>
            Start!
          </Button>
          <Button variant="ghost" onClick={goBack}>
            ← Typing
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-3 py-3 text-center font-bold transition-all ${
        active
          ? 'bg-accent text-white shadow'
          : 'bg-white text-body ring-2 ring-hair hover:ring-edge'
      }`}
    >
      {children}
    </button>
  )
}
