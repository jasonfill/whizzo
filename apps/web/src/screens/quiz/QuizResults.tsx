import Mascot from '../../components/Mascot'
import Confetti from '../../components/Confetti'
import RichText from '../../components/rich/RichText'
import { Button, Card, Pill, StarRow } from '../../components/ui'
import type { QuizSummary } from '../../hooks/useQuizSession'
import { modeDef } from '../../lib/quiz/session'
import { useBand } from '../../lib/band/useBand'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { findRound, roundCollectible } from '../../lib/theme/rewards'
import Collectible from '../../components/Collectible'
import type { SessionRecord } from '../../lib/progress/types'

interface Props {
  summary: QuizSummary
  onAgain: () => void
  /** Leaves the round: back to wherever it was started from. */
  onDone: () => void
  onHome: () => void
}

export default function QuizResults({ summary, onAgain, onDone, onHome }: Props) {
  const { celebrates } = useBand()
  const def = modeDef(summary.mode)
  // Not "everything you ever got wrong" — the cards still unresolved when the
  // round ended. One missed and then fixed is a success story, not a to-do.
  const missed = summary.unresolved
  const near = summary.results.filter((r) => r.grade === 'close')
  const beatPrediction = summary.accuracy >= summary.predictedAccuracy

  // The collectible, on the one rule every results screen and the collection
  // wall share. The play hook commits the round before showing this, so the
  // snapshot normally has it; the summary builds the same record otherwise.
  const { theme } = useTheme()
  const { snapshot } = useProgress()
  const thisRound = findRound(snapshot, probeOf(summary)) ?? recordOf(summary, def.isTest)
  const collectible = roundCollectible(snapshot, theme, thisRound)

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      {celebrates && summary.stars >= 3 && <Confetti />}

      <Card className="mb-4 text-center">
        {/* The mascot bounces for the learner it was drawn for. Higher up, the
            score is the thing on the screen and the cat is in the way of it. */}
        {celebrates && (
          <Mascot
            mood={summary.accuracy >= 80 ? 'cheer' : summary.accuracy >= 50 ? 'idle' : 'resting'}
            size={110}
            className="mx-auto animate-pounce"
          />
        )}
        <h1 className="mt-2 text-4xl font-extrabold text-ink">
          {summary.itemsCorrect} / {summary.itemsTotal}
        </h1>
        <p className="mb-3 text-lg font-bold text-muted">
          {def.emoji} {def.name} · {summary.deckTitle}
        </p>

        <div className="mb-4 flex justify-center">
          <StarRow stars={summary.stars} />
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Pill
            className="bg-wash text-ink"
            title="Scored on your first go at each card, so going back over one never costs you."
          >
            {summary.accuracy}% first time
          </Pill>
          <Pill className="bg-pineSoft/30 text-pine">{summary.score} points</Pill>
          {near.length > 0 && (
            <Pill
              className="bg-sun/30 text-ink"
              title="Counted as correct — you had it, the spelling just slipped."
            >
              {near.length} near {near.length === 1 ? 'miss' : 'misses'}
            </Pill>
          )}
          {summary.retiredAfterMiss > 0 && (
            <Pill
              className="bg-teal-100 text-teal-700"
              title="Missed at first, then got right before the end of the round."
            >
              💪 {summary.retiredAfterMiss} turned around
            </Pill>
          )}
          {summary.newlyMastered.length > 0 && (
            <Pill className="bg-pine/10 text-pine">
              💎 {summary.newlyMastered.length} newly mastered
            </Pill>
          )}
        </div>

        {/* Honest framing: the score is measured against what was predicted for
            this exact set of cards, not a flat pass mark. */}
        <p className="mt-4 font-bold text-muted">
          {beatPrediction
            ? `We expected about ${summary.predictedAccuracy}% on these cards — you beat it.${
                celebrates ? ' 🎉' : ''
              }`
            : `We expected about ${summary.predictedAccuracy}% on these. These were hard cards; keep going.`}
        </p>
      </Card>

      {collectible.earned && (
        <Card className="mb-4 text-center">
          <h2 className="text-2xl font-extrabold text-ink">New {theme.unitOne}!</h2>
          <Collectible slot={collectible.slot} className="mx-auto mt-3 h-32 w-44" />
          <p className="mt-2 font-extrabold text-ink">{collectible.name}</p>
          <p className="mx-auto mt-2 max-w-md font-bold text-muted">{theme.because}</p>
        </Card>
      )}

      {summary.newAchievements.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 text-xl font-extrabold text-ink">
            {summary.newAchievements.length === 1 ? 'New badge!' : 'New badges!'} 🏅
          </h2>
          <div className="flex flex-wrap gap-2">
            {summary.newAchievements.map((a) => (
              <Pill key={a.id} className="bg-sun/30 text-ink">
                {a.emoji} {a.name}
              </Pill>
            ))}
          </div>
        </Card>
      )}

      {missed.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-1 text-xl font-extrabold text-ink">
            Worth another look ({missed.length})
          </h2>
          <p className="mb-3 font-bold text-muted">
            These are queued up for next time, so they will come round again.
          </p>
          <div className="space-y-2">
            {missed.map((r, i) => (
              <div key={`${r.planned.card.id}-${i}`} className="rounded-2xl bg-rose-50 px-4 py-3">
                <RichText
                  source={r.question.prompt}
                  className="block font-extrabold text-ink"
                  figures="describe"
                />
                <p className="font-bold text-emerald-700">
                  ✓ <RichText source={r.question.answer} figures="describe" />
                </p>
                {r.given && (
                  <p className="text-sm font-bold text-rose-500">
                    You said: {r.given}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onAgain}>🔁 Go again</Button>
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
        <Button variant="ghost" onClick={onHome}>
          All decks
        </Button>
      </div>
    </div>
  )
}

function probeOf(summary: QuizSummary) {
  return {
    subject: 'quiz' as const,
    activity: summary.mode,
    listId: summary.deckId,
    itemsTotal: summary.itemsTotal,
    itemsCorrect: summary.itemsCorrect,
    accuracy: summary.accuracy,
  }
}

/** The round as the store would hold it, when the store does not yet. */
function recordOf(summary: QuizSummary, isTest: boolean): SessionRecord {
  // Flashcards self-grade; every other mode is checked by the app. A round
  // with any self-graded answer in it is treated as unchecked, which is the
  // conservative reading and the one a reward should take.
  const checked = summary.results.every((r) => r.verified)
  return {
    id: 'this-round',
    ...probeOf(summary),
    isTest,
    score: summary.score,
    wpm: null,
    durationMs: summary.durationMs,
    abilityBefore: summary.abilityBefore,
    abilityAfter: summary.abilityAfter,
    meta: { predictedAccuracy: summary.predictedAccuracy },
    startedAt: Date.now() - summary.durationMs,
    endedAt: Date.now(),
    evidence: 'attempts',
    verifiedItemsTotal: checked ? summary.itemsTotal : 0,
    verifiedItemsCorrect: checked ? summary.itemsCorrect : 0,
  }
}
