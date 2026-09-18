import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { GameApi } from '../hooks/useGameState'
import { rainWords } from '../lib/content'
import { sfx, unlockAudio } from '../lib/sound'
import { Button, Card } from '../components/ui'
import Mascot from '../components/Mascot'
import ResultsCard from '../components/ResultsCard'
import { useBack } from '../hooks/useBack'
import type { Route } from '../App'

interface Props {
  game: GameApi
  navigate: (r: Route) => void
}

interface FallingWord {
  id: number
  word: string
  typed: number
  x: number // percent 0..100
  y: number // px from top of play area
  speed: number // px per second
  color: string
}

const AREA_HEIGHT = 440
const FLOOR = AREA_HEIGHT - 46
const CAT_COLORS = ['#f59e0b', '#94a3b8', '#f472b6', '#38bdf8', '#a78bfa', '#84cc16']

interface Loop {
  words: FallingWord[]
  nextId: number
  score: number
  lives: number
  level: number
  combo: number
  maxCombo: number
  correct: number
  wrong: number
  lockedId: number | null
  spawnTimer: number
  running: boolean
  pop: { id: number; x: number; y: number }[]
}

export default function CatRainScreen({ game, navigate }: Props) {
  const goBack = useBack({ name: 'typing' })
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const phaseRef = useRef<'ready' | 'playing' | 'over'>('ready')
  const gRef = useRef<Loop | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number>(0)
  const poolRef = useRef<string[]>(rainWords('all'))
  const soundOn = game.state.settings.sound

  const start = useCallback(() => {
    unlockAudio()
    poolRef.current = rainWords('all')
    gRef.current = {
      words: [],
      nextId: 1,
      score: 0,
      lives: 3,
      level: 1,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      wrong: 0,
      lockedId: null,
      spawnTimer: 0,
      running: true,
      pop: [],
    }
    phaseRef.current = 'playing'
    lastRef.current = performance.now()
    forceRender()
  }, [])

  const spawnInterval = (level: number) => Math.max(1700 - level * 110, 650)
  const baseSpeed = (level: number) => 28 + level * 6

  const spawn = useCallback((g: Loop) => {
    const pool = poolRef.current
    const word = pool[Math.floor(Math.random() * pool.length)]
    g.words.push({
      id: g.nextId++,
      word,
      typed: 0,
      x: 8 + Math.random() * 78,
      y: -10,
      speed: baseSpeed(g.level) + Math.random() * 14,
      color: CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)],
    })
  }, [])

  const endGame = useCallback(
    (g: Loop) => {
      g.running = false
      phaseRef.current = 'over'
      const total = g.correct + g.wrong
      const accuracy = total > 0 ? Math.round((g.correct / total) * 100) : 100
      game.addHighScore({
        score: g.score,
        wpm: 0,
        accuracy,
        mode: 'Word Rain',
        date: Date.now(),
      })
      forceRender()
    },
    [game],
  )

  // Main animation loop.
  useEffect(() => {
    if (phaseRef.current !== 'playing') return
    const step = (now: number) => {
      const g = gRef.current
      if (!g || !g.running) return
      const dt = Math.min((now - lastRef.current) / 1000, 0.05)
      lastRef.current = now

      g.level = 1 + Math.floor(g.score / 300)
      g.spawnTimer += dt * 1000
      if (g.spawnTimer >= spawnInterval(g.level)) {
        g.spawnTimer = 0
        spawn(g)
      }

      for (const w of g.words) w.y += w.speed * dt

      // Words that hit the floor cost a life.
      const survivors: FallingWord[] = []
      for (const w of g.words) {
        if (w.y >= FLOOR) {
          g.lives -= 1
          g.combo = 0
          if (g.lockedId === w.id) g.lockedId = null
          if (soundOn) sfx.wrong()
        } else {
          survivors.push(w)
        }
      }
      g.words = survivors
      g.pop = g.pop.slice(-6)

      if (g.lives <= 0) {
        endGame(g)
        return
      }

      forceRender()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseRef.current === 'playing'])

  // Keyboard input for the arcade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        const g = gRef.current
        if (g) endGame(g)
        return
      }
      if (e.key.length !== 1) return
      const g = gRef.current
      if (!g || !g.running) return
      unlockAudio()
      const ch = e.key.toLowerCase()

      // Find the locked word, or lock onto a new word whose next char matches.
      let target = g.lockedId != null ? g.words.find((w) => w.id === g.lockedId) : undefined
      if (!target) {
        const candidates = g.words
          .filter((w) => w.word[w.typed] === ch)
          .sort((a, b) => b.y - a.y) // prefer the lowest (most urgent) word
        target = candidates[0]
        if (target) g.lockedId = target.id
      }

      if (target && target.word[target.typed] === ch) {
        target.typed += 1
        g.correct += 1
        g.combo += 1
        g.maxCombo = Math.max(g.maxCombo, g.combo)
        if (soundOn) {
          if (g.combo >= 3) sfx.combo(g.combo)
          else sfx.correct()
        }
        if (target.typed >= target.word.length) {
          // Word cleared!
          g.score += target.word.length * 10 + g.combo * 5 + g.level * 5
          g.pop.push({ id: target.id, x: target.x, y: target.y })
          g.words = g.words.filter((w) => w.id !== target!.id)
          g.lockedId = null
          if (soundOn) sfx.chime()
        }
      } else {
        g.wrong += 1
        g.combo = 0
        g.lockedId = null
        if (soundOn) sfx.wrong()
      }
      forceRender()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [endGame, soundOn])

  // ---- Render ----
  if (phaseRef.current === 'ready') {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Card className="text-center">
          <div className="mb-2 flex justify-center">
            <Mascot mood="cheer" color="#f472b6" size={120} className="animate-floaty" />
          </div>
          <h1 className="text-3xl font-extrabold text-ink">Word Rain 🌧️</h1>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Words fall from the sky! <b>Type a word</b> to pop it before it lands
            before it reaches the ground. Miss 3 and it&apos;s game over. Keep a combo for bonus points!
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={start}>▶ Start</Button>
            <Button variant="ghost" onClick={goBack}>
              ← Typing
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const g = gRef.current!

  if (phaseRef.current === 'over') {
    const total = g.correct + g.wrong
    const accuracy = total > 0 ? Math.round((g.correct / total) * 100) : 100
    return (
      <div className="py-6">
        <ResultsCard
          result={{
            wpm: 0,
            accuracy,
            correct: g.correct,
            incorrect: g.wrong,
            totalTyped: total,
            elapsedMs: 0,
            maxCombo: g.maxCombo,
            score: g.score,
          }}
          stars={g.score >= 800 ? 3 : g.score >= 400 ? 2 : 1}
          title="Word Rain"
          soundOn={soundOn}
          onReplay={start}
          onMenu={() => navigate({ name: 'typing' })}
        />
      </div>
    )
  }

  // playing
  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-4 text-lg font-extrabold">
          <span className="text-ink">Score: {g.score}</span>
          <span className="text-body">Lvl {g.level}</span>
          <span className={g.combo >= 5 ? 'text-accent' : 'text-stone'}>
            Combo x{g.combo}
          </span>
        </div>
        <div className="text-2xl" aria-label={`${g.lives} lives`}>
          {'❤️'.repeat(g.lives)}
          {'🖤'.repeat(Math.max(0, 3 - g.lives))}
        </div>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-b from-chalk to-tintA shadow-inner ring-2 ring-hair"
        style={{ height: AREA_HEIGHT }}
      >
        {g.words.map((w) => {
          const done = w.word.slice(0, w.typed)
          const rest = w.word.slice(w.typed)
          const locked = g.lockedId === w.id
          return (
            <div
              key={w.id}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${w.x}%`, top: w.y }}
            >
              <Mascot mood={locked ? 'cheer' : 'idle'} color={w.color} size={44} />
              <div
                className={`mt-0.5 rounded-lg px-2 py-0.5 font-mono text-lg font-bold shadow ${
                  locked ? 'bg-white ring-2 ring-accent' : 'bg-white/90'
                }`}
              >
                <span className="text-emerald-500">{done}</span>
                <span className="text-ink">{rest}</span>
              </div>
            </div>
          )
        })}

        {/* pounce/pop effects */}
        {g.pop.map((p) => (
          <div
            key={`pop-${p.id}`}
            className="pointer-events-none absolute -translate-x-1/2 animate-pop text-3xl"
            style={{ left: `${p.x}%`, top: p.y }}
          >
            💥
          </div>
        ))}

        {/* ground */}
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-accent/20 backdrop-blur-sm" />
      </div>

      <div className="mt-3 flex justify-between">
        <p className="text-sm text-stone">Type the falling words! Esc to quit.</p>
        <Button
          variant="ghost"
          onClick={() => {
            const cur = gRef.current
            if (cur) endGame(cur)
          }}
        >
          ✕ End
        </Button>
      </div>
    </div>
  )
}
