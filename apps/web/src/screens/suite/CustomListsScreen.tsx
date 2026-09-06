import { useState } from 'react'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill } from '../../components/ui'
import { useCoverage } from '../../lib/billing/coverage'
import { useProgress } from '../../lib/progress/ProgressProvider'
import type { CustomWordList } from '../../lib/progress/types'
import type { Navigate } from '../../routes'

/**
 * Paste-a-list editor. One word per line; anything after a tab, a pipe, or a
 * dash is treated as the example sentence, which is how most teachers already
 * write their weekly lists.
 */
function parseWords(text: string): Array<{ w: string; s: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const split = line.split(/\t|\s+\|\s+|\s+--?\s+/)
      const w = split[0].trim()
      const s = split.slice(1).join(' ').trim()
      return { w, s: s || `Please spell the word ${w}.` }
    })
    .filter((entry) => entry.w.length > 0)
    .slice(0, 60)
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CustomListsScreen({ navigate }: { navigate: Navigate }) {
    const { snapshot, saveCustomLists, deleteCustomList } = useProgress()
  const coverage = useCoverage()

  const [editing, setEditing] = useState<CustomWordList | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const lists = snapshot.customLists
  const atLimit = lists.length >= coverage.wordListLimit && !editing

  const startNew = () => {
    setEditing({
      id: newId(),
      title: '',
      subject: 'spelling',
      grade: null,
      words: [],
      updatedAt: Date.now(),
    })
    setTitle('')
    setText('')
  }

  const startEdit = (list: CustomWordList) => {
    setEditing(list)
    setTitle(list.title)
    setText(list.words.map((w) => (w.s ? `${w.w}\t${w.s}` : w.w)).join('\n'))
  }

  const save = async () => {
    if (!editing) return
    const words = parseWords(text)
    if (!title.trim() || words.length === 0) return
    setBusy(true)
    try {
      await saveCustomLists([
        { ...editing, title: title.trim().slice(0, 80), words, updatedAt: Date.now() },
      ])
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title="My word lists ✏️"
        subtitle="Paste this week's class list and practise it with every activity."
        onBack={() => navigate({ name: 'home' })}
      />

      {editing ? (
        <Card className="mb-4">
          <h2 className="mb-3 text-xl font-extrabold text-ink">
            {editing.title ? 'Edit list' : 'New list'}
          </h2>

          <label className="mb-1 block text-sm font-bold text-muted">List name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Week 12 — Mrs. Alvarez"
            maxLength={80}
            className="mb-4 w-full rounded-xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
          />

          <label className="mb-1 block text-sm font-bold text-muted">
            Words — one per line
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={'because\nfriend\tMy friend sits next to me.\nthrough | We walked through the park.'}
            className="mb-2 w-full rounded-xl border-2 border-edge px-4 py-3 font-mono text-sm font-bold text-ink focus:border-ink focus:outline-none"
          />
          <p className="mb-4 text-xs font-bold text-stone">
            Add an example sentence after a tab, a <code>|</code>, or a <code>-</code>. Without one
            we will read a simple prompt instead. Up to 60 words per list.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button onClick={save} disabled={busy || !title.trim() || parseWords(text).length === 0}>
              {busy ? 'Saving…' : `Save ${parseWords(text).length} words`}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <Button className="mb-4 w-full" onClick={startNew} disabled={atLimit}>
          ➕ New word list
        </Button>
      )}

      {atLimit && (
        <Card className="mb-4">
          <p className="font-bold text-amber-700">
            An uncovered learner saves {coverage.wordListLimit} custom{' '}
            {coverage.wordListLimit === 1 ? 'list' : 'lists'}.{' '}
            <button className="underline" onClick={() => navigate({ name: 'upgrade' })}>
              Covering them
            </button>{' '}
            removes the limit.
          </p>
        </Card>
      )}

      {lists.length === 0 && !editing ? (
        <Card>
          <p className="font-bold text-stone">
            No lists yet. Paste one in and every spelling activity will use it.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => (
            <Card key={list.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-extrabold text-ink">{list.title}</h3>
                  <p className="text-sm font-bold text-stone">
                    {list.words.length} words · updated{' '}
                    {new Date(list.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <Pill className="bg-wash text-ink">Custom</Pill>
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {list.words.slice(0, 20).map((w) => (
                  <span
                    key={w.w}
                    className="rounded-lg bg-quiet px-2 py-1 font-mono text-xs font-bold text-body"
                  >
                    {w.w}
                  </span>
                ))}
                {list.words.length > 20 && (
                  <span className="px-2 py-1 text-xs font-bold text-stone">
                    +{list.words.length - 20} more
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    navigate({
                      name: 'spell-play',
                      activity: 'listen-spell',
                      mode: 'custom',
                      customListId: list.id,
                    })
                  }
                >
                  🎧 Practise
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate({
                      name: 'spell-play',
                      activity: 'test',
                      mode: 'custom',
                      customListId: list.id,
                    })
                  }
                >
                  📝 Test
                </Button>
                <Button variant="ghost" onClick={() => startEdit(list)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => void deleteCustomList(list.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
