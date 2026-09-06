// Turning documents into practice material.
//
// One screen rather than three, because it is one task: a parent hands over the
// things they already have and waits. Splitting it into pages would make the
// waiting feel like a place they had been sent rather than something happening.
//
// The rule the whole flow is built around: **nothing is spent without being
// shown first.** Sources are registered, the cost comes back, and only an
// explicit tap starts the run.
//
// Two ways in — a link or files — and from the moment they are registered the
// screen stops caring which it was. Everything below works on a *list* of
// documents, because uploading is plural: a parent hands over three chapters at
// once and each one is its own quote, its own run and its own charge. A link is
// simply a list of one, which is why there is no second code path for it.
//
// One thing the plural case must not do is quote each document against the full
// balance and then let the person start all of them. Each estimate the API
// returns is answered independently, so three individually affordable documents
// can be unaffordable together. The total is what gets checked before the
// button appears.

import { useCallback, useEffect, useRef, useState } from 'react'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill } from '../../components/ui'
import type { Route } from '../../routes'
import {
  addLink,
  contentStatus,
  estimateFor,
  isFinished,
  jobStatus,
  pollDelay,
  startBuild,
  uploadFiles,
  type ContentStatus,
  type EstimateView,
  type JobView,
} from '../../lib/content/api'

type Phase = 'idle' | 'registering' | 'quoted' | 'running' | 'finished'

/** One document, from registration through to its cards landing. */
interface Item {
  sourceId: string
  /** The filename, or the link. Something the person can recognise. */
  label: string
  quote: EstimateView | null
  job: JobView | null
  error: string | null
}

/** What the file picker offers, matching what the API accepts. */
const ACCEPT = '.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif'

export default function ContentScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [status, setStatus] = useState<ContentStatus | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [noRush, setNoRush] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [items, setItems] = useState<Item[]>([])
  const [refused, setRefused] = useState<Array<{ filename: string; reason: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const controller = new AbortController()
    contentStatus(controller.signal)
      .then(setStatus)
      .catch((e: unknown) => {
        // An unreachable API is not the same answer as a switched-off feature,
        // and saying the second when it was the first sends someone looking at
        // their configuration for a fault that is not there.
        if (controller.signal.aborted) return
        console.error('Could not read content status', e)
        setStatusFailed(true)
      })
    return () => controller.abort()
  }, [])

  // Stop polling when the screen goes away. A poll loop that outlives its
  // screen is a request every eight seconds forever — and with several
  // documents in flight it is that many loops.
  useEffect(() => () => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }, [])

  const watch = useCallback((sourceId: string, jobId: string, attempt = 0) => {
    const id = window.setTimeout(() => {
      jobStatus(jobId)
        .then(({ job: next }) => {
          setItems((prev) =>
            prev.map((it) => (it.sourceId === sourceId ? { ...it, job: next } : it)),
          )
          if (!isFinished(next)) watch(sourceId, jobId, attempt + 1)
        })
        .catch(() => watch(sourceId, jobId, attempt + 1))
    }, pollDelay(attempt))
    timers.current.push(id)
  }, [])

  /** Register whatever was handed over, then ask what each piece would cost. */
  const submit = useCallback(async () => {
    setError(null)
    setRefused([])
    setPhase('registering')
    try {
      let registered: Array<{ sourceId: string; label: string }>

      if (files.length) {
        const result = await uploadFiles(files)
        setRefused(result.rejected)
        registered = result.sources.map((s) => ({ sourceId: s.sourceId, label: s.filename }))
        if (!registered.length) {
          // Every file was refused. The reasons are already on screen, so there
          // is nothing to add and nothing to quote.
          setPhase('idle')
          return
        }
      } else {
        const { sourceId } = await addLink(url.trim())
        registered = [{ sourceId, label: url.trim() }]
      }

      // The cost, before anything is spent on it.
      const quoted = await Promise.all(
        registered.map(async (r) => ({
          ...r,
          quote: await estimateFor(r.sourceId, noRush),
          job: null,
          error: null,
        })),
      )
      setItems(quoted)
      setPhase('quoted')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      setPhase('idle')
    }
  }, [url, files, noRush])

  /** Start every document that was quoted. */
  const run = useCallback(async () => {
    if (!items.length) return
    setError(null)
    setPhase('running')

    const started = await Promise.all(
      items.map(async (it) => {
        try {
          const { job } = await startBuild(it.sourceId, { noRush })
          return { ...it, job, error: null }
        } catch (e) {
          return { ...it, job: null, error: e instanceof Error ? e.message : 'That did not start.' }
        }
      }),
    )
    setItems(started)

    const running = started.filter((it) => it.job)
    if (!running.length) {
      // Nothing started, so nothing is happening. Back to the quote, rather
      // than leaving a page that looks busy and is not.
      setError(started.find((it) => it.error)?.error ?? 'That did not start.')
      setPhase('quoted')
      return
    }
    for (const it of running) watch(it.sourceId, it.job!.id)
  }, [items, noRush, watch])

  if (statusFailed || (status && !status.enabled)) {
    return (
      <div>
        <ScreenHeader title="Add a document" onBack={() => navigate({ name: 'library' })} />
        <Card>
          <p className="font-bold text-body">
            {statusFailed
              ? 'We could not check whether this is ready. Try again in a moment.'
              : 'Turning documents into practice material is not switched on here yet.'}
          </p>
        </Card>
      </div>
    )
  }

  const single = items.length === 1 ? items[0]! : null
  const totalPages = items.reduce((n, it) => n + (it.quote?.estimate.pages ?? 0), 0)
  const totalCredits = items.reduce((n, it) => n + (it.quote?.estimate.credits ?? 0), 0)
  const balance = items[0]?.quote?.balance ?? status?.balance ?? null
  const eachAllowed = items.every((it) => it.quote?.allowed)
  // The check no individual quote is in a position to make.
  const affordable = eachAllowed && totalCredits <= (balance?.total ?? 0)

  return (
    <div>
      <ScreenHeader title="Add a document" onBack={() => navigate({ name: 'library' })} />

      {status?.balance && (
        <p className="mb-3 text-sm font-bold text-stone">
          {status.balance.total} credit{status.balance.total === 1 ? '' : 's'} left. One credit is
          about one page.
        </p>
      )}

      {phase === 'idle' || phase === 'registering' ? (
        <Card className="mb-4">
          <label className="mb-1 block text-sm font-bold text-muted" htmlFor="content-files">
            Choose files
          </label>
          <input
            id="content-files"
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              // One or the other. Holding both would leave the person guessing
              // which one the button is about to act on.
              if (e.target.files?.length) setUrl('')
            }}
            className="mb-1 w-full text-sm font-bold text-body"
          />
          <p className="mb-3 text-xs font-bold text-stone">
            PDFs, photos of a page, or plain text. Several at once is fine — each one becomes its
            own set of cards.
          </p>

          {files.length > 0 && (
            <ul className="mb-3 space-y-1">
              {files.map((f) => (
                <li key={f.name} className="text-sm font-bold text-body">
                  {f.name}
                </li>
              ))}
            </ul>
          )}

          <label className="mb-1 block text-sm font-bold text-muted" htmlFor="content-url">
            Paste a link
          </label>
          <input
            id="content-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (e.target.value) setFiles([])
            }}
            placeholder="https://docs.google.com/document/d/…"
            className="mb-3 w-full rounded-xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
          />
          <label className="mb-3 flex items-center gap-2 text-sm font-bold text-body">
            <input type="checkbox" checked={noRush} onChange={(e) => setNoRush(e.target.checked)} />
            No rush — half the credits, ready within a day
          </label>
          <Button
            onClick={submit}
            disabled={(!url.trim() && !files.length) || phase === 'registering'}
          >
            {phase === 'registering' ? 'Looking at it…' : 'See what it would cost'}
          </Button>
        </Card>
      ) : null}

      {/* Files that never got far enough to be quoted. Named, with the reason —
          a file that disappears without explanation is a support ticket, and
          usually a correct one. */}
      {refused.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 font-bold text-ink">Not these:</p>
          <ul className="space-y-1">
            {refused.map((r) => (
              <li key={r.filename} className="text-sm font-bold text-rose-600">
                {r.filename} — {r.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* The cost, before anything has been spent on it. This screen exists so
          that a parent chooses to spend the credits rather than discovering
          that they did. */}
      {phase === 'quoted' && items.length > 0 && (
        <Card className="mb-4">
          {single && single.quote ? (
            <p className="mb-1 text-xl font-extrabold text-ink">
              {single.quote.estimate.pages} page{single.quote.estimate.pages === 1 ? '' : 's'}, about{' '}
              {single.quote.estimate.credits} credit
              {single.quote.estimate.credits === 1 ? '' : 's'}
            </p>
          ) : (
            <>
              <p className="mb-1 text-xl font-extrabold text-ink">
                {items.length} documents, {totalPages} page{totalPages === 1 ? '' : 's'}, about{' '}
                {totalCredits} credit{totalCredits === 1 ? '' : 's'}
              </p>
              <ul className="mb-2 space-y-1">
                {items.map((it) => (
                  <li key={it.sourceId} className="text-sm font-bold text-body">
                    {it.label} — {it.quote?.estimate.pages ?? 0} page
                    {it.quote?.estimate.pages === 1 ? '' : 's'}, {it.quote?.estimate.credits ?? 0}{' '}
                    credit{it.quote?.estimate.credits === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mb-3 text-sm font-bold text-stone">You have {balance?.total ?? 0}.</p>

          {affordable ? (
            <Button onClick={run}>Make the cards</Button>
          ) : eachAllowed ? (
            <p className="font-bold text-rose-600">
              Together these need {totalCredits} credits and there are {balance?.total ?? 0} left.
              Take one out, or add credits.
            </p>
          ) : (
            <div className="space-y-1">
              {items
                .filter((it) => it.quote && !it.quote.allowed)
                .map((it) => (
                  <p key={it.sourceId} className="font-bold text-rose-600">
                    {items.length > 1 ? `${it.label} — ` : ''}
                    {it.quote?.reason}
                  </p>
                ))}
            </div>
          )}
        </Card>
      )}

      {(phase === 'running' || phase === 'finished') && items.length > 0 && (
        <>
          {items.map((it) => (
            <Card key={it.sourceId} className="mb-4">
              {!single && <p className="mb-1 text-sm font-bold text-stone">{it.label}</p>}

              {it.job && <p className="text-xl font-extrabold text-ink">{it.job.stage}</p>}

              {it.job && !isFinished(it.job) && (
                <p className="mt-1 text-sm font-bold text-stone">
                  This takes a minute or two. You can leave this page — it keeps going.
                </p>
              )}

              {it.job?.status === 'done' && (
                <div className="mt-3">
                  <Pill className="bg-quiet text-body">
                    {it.job.result?.setsLanded ?? 0} set
                    {it.job.result?.setsLanded === 1 ? '' : 's'} ready
                  </Pill>
                  <p className="mt-3 mb-3 text-sm font-bold text-stone">
                    Look them over before setting them as work — they are drafts until you do.
                  </p>
                  <Button onClick={() => navigate({ name: 'library' })}>Go and look</Button>
                </div>
              )}

              {it.job?.status === 'failed' && (
                <p className="mt-2 font-bold text-rose-600">
                  {it.job.error ?? 'That did not finish.'}
                </p>
              )}

              {it.error && <p className="mt-2 font-bold text-rose-600">{it.error}</p>}
            </Card>
          ))}
        </>
      )}

      {error && <p className="font-bold text-rose-600">{error}</p>}
    </div>
  )
}
