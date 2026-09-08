// Who else is in this week right now.
//
// Symmetric on purpose: a learner sees the grown-up exactly as the grown-up
// sees the learner. Whizzo does not have a way to look over somebody's shoulder
// without their knowing — see docs/realtime-spec.md §9 — and the planner is
// where that rule shows up first.

import type { LiveWatcher } from '@whizzo/shared'

function label(watchers: LiveWatcher[]): string {
  const names = watchers.map((w) => w.name?.trim() || (w.isLearner ? 'Your learner' : 'Someone'))
  if (names.length === 1) return `${names[0]} is here`
  if (names.length === 2) return `${names[0]} and ${names[1]} are here`
  return `${names[0]} and ${names.length - 1} others are here`
}

export default function HereNow({ watchers }: { watchers: LiveWatcher[] }) {
  if (!watchers.length) return null
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-[12px] font-extrabold text-ink"
      // Presence changes on its own; announce it politely rather than
      // interrupting whatever a screen reader is in the middle of.
      aria-live="polite"
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      {label(watchers)}
    </span>
  )
}
