import Mascot from '../../components/Mascot'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { earnedFor, type Earned } from '../../lib/theme/rewards'
import {
  assemblyLine,
  journeyLines,
  SHAPE_LABEL,
  slotLabels,
  type Theme,
} from '../../lib/themes'
import type { Navigate } from '../../routes'

/**
 * Three archetypes, not ten screens.
 *
 * This is the load-bearing decision of the whole theme system. Art and nouns
 * differ per theme; layout and logic do not. Ten bespoke reward screens would
 * be ten things to keep working.
 *
 *   collection  Cats, Dogs, Horses, Music      a grid you fill in
 *   journey     Football, Space, Ocean         a rail you move along
 *   assembly    Dinosaurs, Racing, Robots      a thing you build
 *
 * All three read from the same earned count, on the same fixed earn rate, and
 * fill their slots in order: slot 0 first. The results screens name the slot a
 * round filled with the same rule, so what a learner is told they earned is
 * what they find here.
 */
export default function WorldScreen(_props: { navigate: Navigate }) {
  const { theme } = useTheme()
  const { snapshot } = useProgress()
  // The one count. Home, every results screen and the badges room read the
  // same `earnedFor`, and fill slots in the same order this screen draws them.
  const earned = earnedFor(snapshot, theme)

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
        {SHAPE_LABEL[theme.shape]}
      </div>
      <ScreenHeader
        title={theme.worldNoun}
        subtitle={`${earned.owned} of ${earned.total} ${theme.unit}`}
        back={{ name: 'home' }}
      />

      {theme.shape === 'collection' && <Collection theme={theme} earned={earned} />}
      {theme.shape === 'journey' && <Journey theme={theme} earned={earned} />}
      {theme.shape === 'assembly' && <Assembly theme={theme} earned={earned} />}

      {/* The same promise as the reward screen, in the place a learner comes
          to count what they have. */}
      <p className="mt-6 rounded-[20px] border border-hair bg-quiet p-5 text-[15px] leading-relaxed text-body">
        Rewards are earned on graded work only. A hinted word can’t buy a {theme.unitOne}.
      </p>
    </div>
  )
}

/** A grid you fill in. Owned cells are real; locked cells say so plainly. */
function Collection({ theme, earned }: { theme: Theme; earned: Earned }) {
  const labels = slotLabels(theme)
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {labels.map((name, i) => {
        const owned = i < earned.owned
        return (
          <div
            key={`${name}-${i}`}
            className={`rounded-2xl p-3 ${
              owned ? 'border bg-chalk' : 'border border-dashed border-edge bg-[#FBF8F1]'
            }`}
            style={owned ? { borderColor: theme.tintB } : undefined}
          >
            <div
              className="mb-2 aspect-square rounded-xl"
              style={{
                background: owned
                  ? `repeating-linear-gradient(135deg, ${theme.tintB} 0 9px, ${theme.tintA} 9px 18px)`
                  : '#F4EFE5',
              }}
            />
            <div
              className={`truncate text-[13px] font-extrabold ${owned ? 'text-ink' : 'text-stone'}`}
            >
              {owned ? name : 'Locked'}
            </div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
              {owned ? `#${i + 1}` : 'Earn it'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A rail you move along. Where you are, and what is next. */
function Journey({ theme, earned }: { theme: Theme; earned: Earned }) {
  const stops = slotLabels(theme)
  // `owned` stops are behind you; the one you are standing on is the next.
  const current = Math.min(earned.owned, stops.length - 1)
  const lines = journeyLines(theme, earned.owned)

  return (
    <div>
      <div className="overflow-x-auto rounded-[22px] p-5" style={{ background: theme.tintA }}>
        <div className="flex min-w-max items-start gap-0">
          {stops.map((stop, i) => {
            const past = i < current
            const here = i === current
            return (
              <div key={stop} className="flex items-start">
                <div className="flex w-24 flex-col items-center gap-2">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-extrabold"
                    style={
                      past
                        ? { background: theme.accent, color: '#fff' }
                        : here
                          ? { background: '#fff', color: theme.deep, boxShadow: `0 0 0 3px ${theme.accent}` }
                          : { background: '#FFFFFF99', color: theme.deep }
                    }
                  >
                    {past ? '✓' : here ? '●' : ''}
                  </div>
                  <div
                    className="text-center text-[12px] font-extrabold leading-tight"
                    style={{ color: past || here ? theme.deep : '#8A8375' }}
                  >
                    {stop}
                  </div>
                </div>
                {i < stops.length - 1 && (
                  <div
                    className="mt-4 h-1 w-6 rounded-full"
                    style={{ background: past ? theme.accent : '#FFFFFF99' }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        className="mt-4 flex flex-wrap items-center gap-4 rounded-[22px] p-5"
        style={{ background: '#FFFFFFCC' }}
      >
        <Mascot mood="idle" size={62} />
        <div>
          <div className="font-display text-lg font-extrabold text-ink">{lines.now}</div>
          <div className="text-[15px] text-body">{lines.next}</div>
        </div>
      </div>
    </div>
  )
}

/** A thing you build. The stage, and the parts list beside it. */
function Assembly({ theme, earned }: { theme: Theme; earned: Earned }) {
  const parts = slotLabels(theme)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_1fr]">
      <div
        className="flex flex-col items-center justify-center rounded-[22px] p-6"
        style={{ background: theme.tintA }}
      >
        <Mascot mood="idle" size={160} />
        <div className="mt-3 font-display text-xl font-extrabold text-ink">
          {theme.assemblyOf ?? theme.name}
        </div>
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          {earned.owned} of {earned.total} parts
        </div>
        <p className="mt-2 max-w-xs text-center text-[14px] text-body">
          {assemblyLine(theme, earned.owned)}
        </p>
      </div>

      <ul className="space-y-2">
        {parts.map((part, i) => {
          const fitted = i < earned.owned
          return (
            <li
              key={part}
              className={`flex items-center justify-between rounded-2xl px-4 py-3 ${
                fitted ? 'border bg-chalk' : 'border border-dashed border-edge bg-[#FBF8F1]'
              }`}
              style={fitted ? { borderColor: theme.tintB } : undefined}
            >
              <span className={`font-extrabold ${fitted ? 'text-ink' : 'text-stone'}`}>{part}</span>
              <span
                className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: fitted ? theme.deep : '#A29A8A' }}
              >
                {fitted ? 'Fitted' : 'Locked'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
