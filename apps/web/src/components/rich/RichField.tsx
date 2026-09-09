import { useRef, useState } from 'react'
import { hasRich, richProblems } from '../../lib/rich/parse'
import {
  FIGURE_TEMPLATES,
  MATH_SNIPPETS,
  SYMBOLS,
  caretOffset,
  templateSource,
} from '../../lib/rich/templates'
import RichText from './RichText'

/**
 * One side of a card, with the tools for putting math and figures in it.
 *
 * The thing this has to get right is that most cards are still "photosynthesis"
 * and a plain box to type in. So it stays a plain box: the toolbar is one row of
 * small buttons, and the preview only appears once there is something to
 * preview. Nobody writing a spelling deck should have to notice any of it.
 *
 * The insert buttons exist because the alternative is remembering that a
 * fraction is `\frac{}{}` — which teachers who have used a graphing calculator
 * will know and nobody else will. Everything they insert is ordinary text in
 * the box afterwards, editable by hand, so the buttons are a shortcut and never
 * a mode you can get stuck in.
 */
export default function RichField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [panel, setPanel] = useState<'none' | 'symbols' | 'figures'>('none')
  // A textarea nobody has clicked into reports a caret at position 0, not a
  // missing one — so without this, adding a figure to a card that already has
  // text drops it in front of the sentence rather than where the author is.
  const [visited, setVisited] = useState(false)

  const insert = (text: string, caret = text.length) => {
    const field = ref.current
    const start = visited && field ? field.selectionStart : value.length
    const end = visited && field ? field.selectionEnd : value.length
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    // Put the cursor where the author has to type next, after React has had a
    // chance to write the new value into the box.
    window.setTimeout(() => {
      field?.focus()
      field?.setSelectionRange(start + caret, start + caret)
    }, 0)
  }

  const problems = richProblems(value)
  const lines = value.split('\n').length + Math.floor(value.length / 70)

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setVisited(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={Math.min(8, Math.max(1, lines))}
        className={`w-full resize-y rounded-xl border-2 border-edge px-3 py-2 font-bold text-ink focus:border-ink focus:outline-none ${className}`}
      />

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {MATH_SNIPPETS.map((snippet) => (
          <ToolButton
            key={snippet.label}
            title={snippet.hint}
            onClick={() => insert(snippet.text, caretOffset(snippet.text))}
          >
            {snippet.label}
          </ToolButton>
        ))}
        <ToolButton
          title="Symbols"
          pressed={panel === 'symbols'}
          onClick={() => setPanel((p) => (p === 'symbols' ? 'none' : 'symbols'))}
        >
          π…
        </ToolButton>
        <ToolButton
          title="Add a picture: a shape, a graph or a chart"
          pressed={panel === 'figures'}
          onClick={() => setPanel((p) => (p === 'figures' ? 'none' : 'figures'))}
        >
          📊 Figure
        </ToolButton>
      </div>

      {panel === 'symbols' && (
        <div className="mt-1 flex flex-wrap gap-1 rounded-xl bg-quiet p-2">
          {SYMBOLS.map((symbol) => (
            <ToolButton key={symbol} title={symbol} onClick={() => insert(symbol)}>
              {symbol}
            </ToolButton>
          ))}
        </div>
      )}

      {panel === 'figures' && (
        <div className="mt-1 rounded-xl bg-quiet p-2">
          <p className="mb-1 text-xs font-bold text-muted">
            Drops in an example you can edit — change the numbers and the labels.
          </p>
          <div className="flex flex-wrap gap-1">
            {FIGURE_TEMPLATES.map((template) => (
              <ToolButton
                key={template.kind}
                title={template.label}
                onClick={() => {
                  const prefix = value.trim() && !value.endsWith('\n') ? '\n' : ''
                  insert(`${prefix}${templateSource(template)}`)
                  setPanel('none')
                }}
              >
                {template.emoji} {template.label}
              </ToolButton>
            ))}
          </div>
        </div>
      )}

      {hasRich(value) && (
        <div className="mt-2 rounded-xl bg-white/70 p-2 ring-1 ring-hair">
          <p className="mb-1 text-[0.65rem] font-extrabold uppercase tracking-widest text-stone">
            How it will look
          </p>
          <RichText source={value} className="block font-bold text-ink" />
          {problems.map((problem) => (
            <p key={problem} className="mt-1 text-xs font-bold text-amber-700">
              ⚠️ {problem}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function ToolButton({
  children,
  title,
  onClick,
  pressed = false,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-lg px-2 py-1 text-xs font-extrabold ring-1 transition-colors ${
        pressed ? 'bg-ink text-white ring-ink' : 'bg-white/80 text-ink ring-edge hover:bg-white'
      }`}
    >
      {children}
    </button>
  )
}
