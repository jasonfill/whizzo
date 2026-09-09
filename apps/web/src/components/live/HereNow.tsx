// Who else is on this learner's channel right now.
//
// Symmetric on purpose, and the same component in the planner and in a round:
// a learner sees the grown-up exactly as the grown-up sees the learner. Whizzo
// has no way to look over somebody's shoulder without their knowing — see
// docs/realtime-spec.md §9 — and this is the surface that promise rests on,
// which is why there is one of these rather than one per feature.

export default function HereNow({
  names,
  doing = 'here',
}: {
  names: string[]
  /** Completes "Mom is …" — "here", "following along". */
  doing?: string
}) {
  if (!names.length) return null
  const who =
    names.length === 1
      ? `${names[0]} is`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are`
        : `${names[0]} and ${names.length - 1} others are`
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-[12px] font-extrabold text-ink"
      // Presence changes on its own; announce it politely rather than
      // interrupting whatever a screen reader is in the middle of.
      aria-live="polite"
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      {who} {doing}
    </span>
  )
}
