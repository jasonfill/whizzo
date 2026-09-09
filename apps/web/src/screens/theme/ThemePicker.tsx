import Mascot from '../../components/Mascot'
import { Button } from '../../components/ui'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { useAuth } from '../../auth/AuthProvider'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { themesForGrade, type Theme } from '../../lib/themes'
import type { Navigate } from '../../routes'

/**
 * "Pick your world."
 *
 * The picker is ordered by grade band, but the band is advisory and nothing
 * else: it is not shown as a gate, no card is ever disabled, and a grade 11
 * student who wants Dinosaurs gets Dinosaurs.
 */
export default function ThemePicker({ navigate }: { navigate: Navigate }) {
  const { theme, setTheme } = useTheme()
  const { active } = useLearners()
  const { profile } = useAuth()

  // Nearest-fit first for this learner's grade. Ordering only — every card
  // below is selectable, whatever it says.
  const ordered = themesForGrade(active?.gradeHint ?? profile?.gradeHint ?? null)

  return (
    <div className="mx-auto w-full max-w-5xl py-4">
      <ScreenHeader
        title="Pick your world"
        subtitle="Who you learn with is up to you."
        onBack={() => navigate({ name: 'home' })}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {ordered.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            active={t.id === theme.id}
            onPick={() => setTheme(t.id)}
          />
        ))}
      </div>

      {/* Load-bearing copy: the promise that a theme is paint and nothing more. */}
      <p className="rounded-[20px] border border-hair bg-quiet p-5 text-[15px] leading-relaxed text-body">
        You can change it whenever you like. It never changes what you’re learning — only who
        you’re learning it with.
      </p>
    </div>
  )
}

function ThemeCard({
  theme,
  active,
  onPick,
}: {
  theme: Theme
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      aria-pressed={active}
      className={`flex flex-col rounded-[20px] p-4 text-left transition-transform hover:-translate-y-px ${
        active ? 'border-2 border-accent' : 'border border-hair'
      }`}
      style={{
        background: theme.tintA,
        boxShadow: active ? `0 8px 24px -12px ${theme.accent}` : undefined,
      }}
    >
      <div
        className="mb-3 flex items-center justify-center rounded-2xl"
        style={{ background: theme.tintB }}
      >
        {/* Its own theme's mascot, not the active one, so the picker is ten
            characters rather than one repeated in ten colors. */}
        <Mascot mood="idle" themeId={theme.id} color={theme.accent} size={86} />
      </div>
      <div className="font-display text-lg font-extrabold tracking-[-0.02em] text-ink">
        {theme.name}
      </div>
      <div className="text-[13px] font-bold text-muted">Collect {theme.unit}</div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
        Often picked in {theme.bands}
      </div>
      <div className="mt-3 text-[13px] font-extrabold" style={{ color: theme.deep }}>
        {active ? 'Your world ✓' : `${theme.verb} →`}
      </div>
    </button>
  )
}

/** The one-line entry point other screens use to reach the picker. */
export function ThemeTeaser({ navigate }: { navigate: Navigate }) {
  const { theme } = useTheme()
  return (
    <Button variant="ghost" onClick={() => navigate({ name: 'theme' })}>
      {theme.name} · change world
    </Button>
  )
}
