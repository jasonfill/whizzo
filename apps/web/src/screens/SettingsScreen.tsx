import type { GameApi } from '../hooks/useGameState'
import { useLearners } from '../lib/learners/LearnerProvider'
import { useProgress } from '../lib/progress/ProgressProvider'
import ScreenHeader from '../components/suite/ScreenHeader'
import { Card } from '../components/ui'
import { setSoundEnabled, sfx } from '../lib/sound'
import type { Route } from '../App'

interface Props {
  game: GameApi
  navigate: (r: Route) => void
}

/**
 * Suite-wide settings: sound, the typing helpers, the flashcard layout, the
 * strike-out switch on multiple choice. Every
 * switch is saved to the learner, so it is the same on every device and a
 * grown-up can set it from their own phone. Nothing here is this browser's
 * own, which is why there is nothing here to clear.
 */
export default function SettingsScreen({ game }: Props) {
  const { state, setSetting } = game
  const { mode } = useProgress()
  const { active } = useLearners()

  return (
    <div className="mx-auto max-w-lg py-8">
      <ScreenHeader title="Settings ⚙️" back={{ name: 'home' }} backLabel="← Home" />

      <Section title="Sound">
        <Toggle
          label="🔊 Sound effects"
          checked={state.settings.sound}
          onChange={(v) => {
            setSetting('sound', v)
            setSoundEnabled(v)
            if (v) sfx.chime()
          }}
        />
      </Section>

      <Section title="Typing">
        <Toggle
          label="⌨️ Show on-screen keyboard"
          checked={state.settings.showKeyboard}
          onChange={(v) => setSetting('showKeyboard', v)}
        />
        <Toggle
          label="🖐️ Show hand guide"
          checked={state.settings.showHands}
          onChange={(v) => setSetting('showHands', v)}
        />
      </Section>

      <Section title="Flashcards">
        <Choice
          label="🃏 How a card shows its answer"
          value={state.settings.flashcardLayout}
          options={[
            { id: 'flip', label: '🔄 Flip', title: 'Turn the card over to see the answer' },
            { id: 'slide', label: '↕️ Slide', title: 'Slide the question up and show the answer beneath it' },
          ]}
          onChange={(v) => setSetting('flashcardLayout', v)}
        />
        <Toggle
          label="✕ Strike out answers I have ruled out"
          checked={state.settings.strikeOutChoices}
          onChange={(v) => setSetting('strikeOutChoices', v)}
        />
      </Section>

      <p className="mt-6 text-center text-xs text-stone">
        {active
          ? `Settings and progress are saved to ${active.displayName}'s account.`
          : mode === 'cloud'
            ? 'Progress is saved to your account.'
            : 'Progress is saved on this device until you sign in.'}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-3 text-lg font-extrabold text-ink">{title}</h2>
      {children}
    </Card>
  )
}

/** A two-way (or few-way) pick, laid out as one segmented control. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ id: T; label: string; title?: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-hair last:mb-0">
      <span className="font-bold text-body">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-2xl bg-wash p-1 ring-1 ring-edge"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition-colors ${
              value === o.id ? 'bg-ink text-white' : 'text-ink hover:bg-quiet'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="mb-3 flex cursor-pointer items-center justify-between rounded-xl bg-white p-3 ring-1 ring-hair last:mb-0">
      <span className="font-bold text-body">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors ${
          checked ? 'bg-emerald-400' : 'bg-tray'
        }`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  )
}
