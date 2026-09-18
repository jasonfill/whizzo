import { useEffect } from 'react'
import Mascot from '../../components/Mascot'
import Confetti from '../../components/Confetti'
import { Button, Card, StarRow } from '../../components/ui'
import type { SessionSummary } from '../../hooks/useSpellingSession'
import { sfx } from '../../lib/sound'
import { activity as activityDef } from '../../lib/spelling/activities'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useBand } from '../../lib/band/useBand'
import { findRound, roundCollectible } from '../../lib/theme/rewards'
import Collectible from '../../components/Collectible'
import type { SessionRecord } from '../../lib/progress/types'
import { speak } from '../../lib/spelling/speech'
import { useBack } from '../../hooks/useBack'

interface Props {
  summary: SessionSummary
  onAgain: () => void
}

function encouragement(accuracy: number, predicted: number): string {
  if (accuracy === 100) return 'Every single word. That is a clean sweep! 🏆'
  if (accuracy >= predicted + 15) return 'You did far better than expected on these! 🚀'
  if (accuracy >= 90) return 'So close to perfect — brilliant work! ✨'
  if (accuracy >= predicted) return 'You beat what we predicted for these words. Nicely done! ✨'
  if (accuracy >= 60) return 'Solid round. The tricky ones will come back for another go. 💪'
  if (accuracy >= 40) return 'Good effort! These words are now on your review list. 🎯'
  return 'These were hard ones. We will bring them back easier next time.'
}

export default function SpellingResults({ summary, onAgain }: Props) {
  const { celebrates } = useBand()
  // Done goes back to wherever the round was started from — the spelling
  // screen, a list, or a task — and to spelling only on a cold link.
  const done = useBack({ name: 'spelling' })
  const def = activityDef(summary.activity)
  const missed = summary.results.filter((r) => !r.correct)
  const abilityDelta = summary.abilityAfter - summary.abilityBefore
  const levelledUp = summary.level.direction === 'promote'

  const { theme } = useTheme()
  const { snapshot } = useProgress()
  const beatBy = summary.accuracy - summary.predictedAccuracy
  // One rule, shared with the collection wall and every other results screen:
  // `earnsCollectible` on the stored round. The play hook commits the round
  // before showing this, so the snapshot normally has it; when it does not,
  // the summary is enough to build the same record (spelling is app-checked).
  const thisRound = findRound(snapshot, probeOf(summary)) ?? recordOf(summary, def.isTest)
  const { earned: earnedReward, slot, name: rewardName } = roundCollectible(snapshot, theme, thisRound)

  useEffect(() => {
    if (levelledUp || summary.accuracy === 100) sfx.win()
    else sfx.star()
  }, [levelledUp, summary.accuracy])

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      {celebrates && (levelledUp || summary.accuracy >= 90) && <Confetti count={40} />}

      <div className="mb-4 rounded-[26px] p-7 text-center" style={{ background: theme.tintA }}>
        <div className="flex justify-center">
          <StarRow stars={summary.stars} size={34} />
        </div>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">
          {earnedReward ? theme.rewardTitle : `${summary.itemsCorrect} of ${summary.itemsTotal} correct`}
        </h1>

        {/* The curve-graded star rule, said out loud. A learner who beats a
            hard prediction and one who aces an easy set both get told which
            of those happened. */}
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-body">
          {summary.itemsCorrect} of {summary.itemsTotal} unaided, and you{' '}
          {beatBy >= 0
            ? `beat what we predicted for this set by ${beatBy} points`
            : `came in ${Math.abs(beatBy)} points under what we predicted for this set`}
          . {summary.stars >= 3 ? 'The third star is for that.' : encouragement(summary.accuracy, summary.predictedAccuracy)}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <RewardStat label="Unaided" value={`${summary.itemsCorrect}/${summary.itemsTotal}`} />
          <RewardStat label="Predicted" value={`${summary.predictedAccuracy}%`} />
          <RewardStat label="Points" value={String(summary.score)} />
        </div>
      </div>

      {/* The collectible. Only a graded round that cleared its prediction
          reaches this branch — which is what the footnote below promises. */}
      {earnedReward && (
        <div className="mb-4 rounded-[26px] border border-hair bg-chalk p-6 text-center">
          {/* The collectible itself is earned, so it is shown to everyone. The
              cheering cat on top of it is decoration, and is not. */}
          {celebrates && (
            <div className="mx-auto flex justify-center">
              <Mascot mood="cheer" size={108} />
            </div>
          )}
          <div className="mt-2 font-display text-2xl font-extrabold text-ink">New {theme.unitOne}!</div>
          <Collectible slot={slot} className="mx-auto mt-3 h-32 w-44" />
          <div className="mt-2 font-extrabold text-ink">{rewardName}</div>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-body">{theme.because}</p>
        </div>
      )}

      <p className="mb-4 rounded-[20px] border border-hair bg-quiet p-4 text-center text-[13px] text-body">
        Rewards are earned on graded work only. A hinted word can’t buy a {theme.unitOne}.
      </p>

      {/* What the round did to the learner's level */}
      {def.isTest && (
        <Card className="mb-4">
          <h2 className="mb-2 text-xl font-extrabold text-ink">Your level 📈</h2>
          {levelledUp ? (
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-lg font-extrabold text-emerald-700">
                Moving up to grade {summary.gradeAfter}! 🎉
              </p>
              <p className="font-bold text-emerald-600">{summary.level.reason}</p>
            </div>
          ) : summary.level.direction === 'demote' ? (
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-lg font-extrabold text-amber-700">
                Stepping back to grade {summary.gradeAfter}
              </p>
              <p className="font-bold text-amber-600">{summary.level.reason}</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-quiet p-4">
              <p className="font-bold text-body">
                Still working through grade {summary.gradeAfter}.{' '}
                {abilityDelta >= 0.01
                  ? `Your spelling level went up ${abilityDelta.toFixed(2)} this round.`
                  : abilityDelta <= -0.01
                    ? `Your spelling level dipped ${Math.abs(abilityDelta).toFixed(2)} — the next round will be a touch easier.`
                    : 'Your spelling level held steady.'}
              </p>
            </div>
          )}
          <p className="mt-2 text-xs font-bold text-stone">
            Only words you spelled from scratch, with no hints, change your level.
          </p>
        </Card>
      )}

      {/* Word-by-word */}
      <Card className="mb-4">
        <h2 className="mb-3 text-xl font-extrabold text-ink">Word by word</h2>
        <ul className="divide-y divide-hair">
          {summary.results.map((r, i) => (
            <li key={`${r.word.w}-${i}`} className="flex items-center gap-3 py-2">
              <span className="text-lg">{r.correct ? '✅' : '❌'}</span>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-base font-bold text-ink">{r.word.w}</span>
                {!r.correct && r.given && (
                  <span className="ml-2 font-mono text-sm font-bold text-rose-400 line-through">
                    {r.given}
                  </span>
                )}
                <span className="ml-2 text-xs font-bold text-stone">
                  grade {r.word.grade}
                  {r.hintsUsed > 0 && ' · used a hint'}
                </span>
              </div>
              <button
                onClick={() => speak(r.word.w)}
                className="shrink-0 rounded-full bg-quiet px-2 py-1 text-xs font-extrabold text-ink"
                aria-label={`Hear ${r.word.w}`}
              >
                🔊
              </button>
            </li>
          ))}
        </ul>
        {missed.length > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
            🔁 {missed.length === 1 ? 'That word goes' : `Those ${missed.length} words go`} straight
            back into your practice pile — you will see{' '}
            {missed.length === 1 ? 'it' : 'them'} again in your next round.
          </p>
        )}
      </Card>

      {summary.newAchievements.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-3 text-xl font-extrabold text-ink">
            {summary.newAchievements.length === 1 ? 'New badge!' : 'New badges!'} 🏅
          </h2>
          <div className="flex flex-wrap gap-3">
            {summary.newAchievements.map((a) => (
              <div key={a.id} className="rounded-2xl bg-amber-50 px-4 py-3 text-center">
                <div className="text-3xl">{a.emoji}</div>
                <div className="font-extrabold text-amber-700">{a.name}</div>
                <div className="text-xs font-bold text-amber-600">{a.description}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onAgain}>🔁 Another round</Button>
        <Button variant="ghost" onClick={done}>
          Done
        </Button>
      </div>
    </div>
  )
}

function probeOf(summary: SessionSummary) {
  return {
    subject: 'spelling' as const,
    activity: summary.activity,
    listId: summary.listId,
    itemsTotal: summary.itemsTotal,
    itemsCorrect: summary.itemsCorrect,
    accuracy: summary.accuracy,
  }
}

/** The round as the store would hold it, when the store does not yet. */
function recordOf(summary: SessionSummary, isTest: boolean): SessionRecord {
  return {
    id: 'this-round',
    ...probeOf(summary),
    isTest,
    score: summary.score,
    wpm: null,
    durationMs: summary.durationMs,
    abilityBefore: summary.abilityBefore,
    abilityAfter: summary.abilityAfter,
    meta: { level: summary.level.direction, predictedAccuracy: summary.predictedAccuracy },
    startedAt: Date.now() - summary.durationMs,
    endedAt: Date.now(),
    evidence: 'attempts',
    // Every spelling answer is checked by the app; nothing is self-graded.
    verifiedItemsTotal: summary.itemsTotal,
    verifiedItemsCorrect: summary.itemsCorrect,
  }
}

function RewardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: '#FFFFFFB8' }}>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        {label}
      </div>
      <div className="font-display text-xl font-extrabold text-ink">{value}</div>
    </div>
  )
}
