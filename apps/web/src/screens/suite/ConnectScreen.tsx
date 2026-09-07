import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card } from '../../components/ui'
import { useLearners } from '../../lib/learners'
import { decide, pendingRequest } from '../../lib/mcp/api'
import { keepPendingConnect } from '../../lib/mcp/pending'
import type { McpPendingResponse } from '@whizzo/shared'
import type { Navigate } from '../../routes'

/**
 * The consent screen an assistant sends a grown-up to.
 *
 * This is where a connection is decided, and it is deliberately ours rather
 * than the assistant's: the person approving is signed into Whizzo with their
 * ordinary login, sees which children the assistant will be able to work
 * with, and picks. A child is never the one connecting — the assistant's
 * account is a grown-up's in every case that matters, and the token it gets
 * is scoped to the children chosen here.
 */
export default function ConnectScreen({ navigate }: { navigate: Navigate }) {
  const [query] = useSearchParams()
  const req = query.get('req') ?? ''
  const { learners, status } = useLearners()
  const [pending, setPending] = useState<McpPendingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!req) {
      setError('This page needs to be opened from the assistant you are connecting.')
      return
    }
    const controller = new AbortController()
    pendingRequest(req, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) setPending(p)
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message)
      })
    return () => controller.abort()
  }, [req])

  // Everyone the session can see, ticked by default: the common case is one
  // parent, one or two children, and the answer is "yes, both".
  const selected = useMemo(() => chosen ?? new Set(learners.map((l) => l.id)), [chosen, learners])

  const who = pending?.clientLabel === 'claude' ? 'Claude' : pending?.clientLabel === 'chatgpt' ? 'ChatGPT' : pending?.clientName ?? 'The assistant'

  const answer = async (approve: boolean) => {
    setBusy(true)
    try {
      const { redirect } = await decide(req, approve, approve ? [...selected] : [])
      window.location.assign(redirect)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl py-4">
      <ScreenHeader title="Connect an assistant" onBack={() => navigate({ name: 'account' })} />

      {error ? (
        <Card>
          <p className="mb-4 font-bold text-muted">{error}</p>
          <Button variant="secondary" onClick={() => navigate({ name: 'account' })}>
            Back to your account
          </Button>
        </Card>
      ) : !pending || status !== 'ready' ? (
        <Card>
          <p className="font-bold text-muted">One moment…</p>
        </Card>
      ) : (
        <Card>
          <h2 className="mb-3 text-xl font-extrabold text-ink">
            {who} wants to work with your learners
          </h2>

          <p className="mb-2 font-bold text-body">{who} will be able to:</p>
          <ul className="mb-4 list-disc space-y-1 pl-5 font-bold text-muted">
            <li>see the decks and how each learner is doing on them</li>
            <li>run practice rounds out loud and record the answers they give</li>
            <li>make new decks for your library, marked as made by {who}</li>
          </ul>
          <p className="mb-5 font-bold text-muted">
            It will not be able to see other children, change settings, or delete anything. Answers
            are checked by Whizzo, never by {who} — it is never told an answer before the learner
            has tried.
          </p>

          <p className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">
            Which learners?
          </p>
          {learners.length === 0 ? (
            <div className="mb-4">
              <p className="mb-3 font-bold text-amber-700">
                There is nobody to connect yet. Add a learner first — this request will be
                waiting when you come back.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  // The request goes back into its pocket; the app returns
                  // here on the next screen after Family.
                  keepPendingConnect(req)
                  navigate({ name: 'family' })
                }}
              >
                Add a learner
              </Button>
            </div>
          ) : (
            <div className="mb-5 flex flex-col gap-2">
              {learners.map((l) => {
                const on = selected.has(l.id)
                return (
                  <label
                    key={l.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 font-bold ${
                      on ? 'bg-wash text-ink ring-2 ring-ink' : 'bg-quiet text-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = new Set(selected)
                        if (on) next.delete(l.id)
                        else next.add(l.id)
                        setChosen(next)
                      }}
                    />
                    <span className="text-2xl">{l.avatarEmoji}</span>
                    <span>{l.displayName}</span>
                  </label>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1"
              disabled={busy || selected.size === 0}
              onClick={() => void answer(true)}
            >
              {busy ? 'Connecting…' : `Connect ${who}`}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void answer(false)}>
              Not now
            </Button>
          </div>
          <p className="mt-3 text-sm font-bold text-stone">
            You can disconnect at any time from Account → Connected apps.
          </p>
        </Card>
      )}
    </div>
  )
}
