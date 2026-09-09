// "Ada is practicing — Follow."
//
// The way into following a round, and deliberately on more than one screen: a
// grown-up is not usually sitting on Family when a child opens their deck. It
// renders nothing at all when nobody is working, so it costs a quiet screen
// nothing.

import type { RoundNow } from '../../hooks/useRoundsNow'
import type { Route } from '../../routes'

export default function PracticingNow({
  rounds,
  navigate,
}: {
  rounds: RoundNow[]
  navigate: (route: Route) => void
}) {
  if (!rounds.length) return null
  return (
    <div className="mb-3 flex flex-col gap-2">
      {rounds.map((round) => (
        <button
          key={round.learnerId}
          type="button"
          onClick={() => navigate({ name: 'watch', learnerId: round.learnerId })}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-hair bg-wash px-3 py-2 text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-extrabold text-ink">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            {round.learnerName ?? 'Your learner'} is practicing
            {round.title ? ` — ${round.title}` : ''}
          </span>
          <span className="shrink-0 text-[13px] font-extrabold text-ink underline">Follow</span>
        </button>
      ))}
    </div>
  )
}
