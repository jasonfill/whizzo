import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Pill } from '../../components/ui'
import {
  listConnectionCodes,
  mintConnectionCode,
  revokeConnectionCode,
  type ConnectionCode,
} from '../../lib/learners/api'

/**
 * A code to hand to other families, so they can let you see their learner.
 *
 * Not a separate kind of account: a parent and a tutor use the same screens,
 * the same permissions and the same library, and "tutor" is a property of one
 * link rather than of a person — the same grown-up is a parent to their own
 * children and a tutor to somebody else's. So this is offered to everyone, and
 * worded for whoever happens to need it.
 *
 * It grants nothing on its own; each family decides which of their children it
 * applies to, and can disconnect later.
 */
export default function MyTutorCode() {
  const [codes, setCodes] = useState<ConnectionCode[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await listConnectionCodes(signal)
      if (!signal?.aborted) setCodes(rows)
    } catch {
      if (!signal?.aborted) setCodes([])
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const mint = async () => {
    setBusy(true)
    try {
      await mintConnectionCode({ label: label.trim() || null })
      setLabel('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (code: string) => {
    setBusy(true)
    try {
      await revokeConnectionCode(code)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const has = (codes?.length ?? 0) > 0

  // Nothing to say to a parent who has never tutored, so it stays folded away
  // until they ask for it.
  if (!has && !open) {
    return (
      <Card className="mt-4">
        <h3 className="mb-1 text-lg font-extrabold text-ink">
          Working with someone else&apos;s children?
        </h3>
        <p className="mb-3 text-sm font-bold text-muted">
          Tutoring, teaching, or helping out a friend — get a code to hand to their family. They
          choose which of their children you can see, and can disconnect you later.
        </p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Get a code
        </Button>
      </Card>
    )
  }

  return (
    <Card className="mt-4">
      <h3 className="mb-1 text-lg font-extrabold text-ink">Your connection code</h3>
      <p className="mb-3 text-sm font-bold text-muted">
        Give this to a family. They enter it, pick which of their children it applies to, and
        those learners appear in your Family screen alongside your own. Nobody is added until
        they accept.
      </p>

      {codes?.map((c) => (
        <div
          key={c.code}
          className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl bg-quiet px-4 py-3"
        >
          <span className="font-mono text-2xl font-extrabold tracking-widest text-ink">
            {c.code}
          </span>
          {c.label && <span className="font-bold text-muted">{c.label}</span>}
          <Pill className="bg-white text-xs text-muted">
            {c.uses} {c.uses === 1 ? 'family' : 'families'} joined
          </Pill>
          <div className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(c.code)
                setCopied(c.code)
              }}
            >
              {copied === c.code ? 'Copied ✓' : 'Copy'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => withdraw(c.code)}>
              Withdraw
            </Button>
          </div>
        </div>
      ))}

      {has && (
        <p className="mb-3 text-xs font-bold text-stone">
          Withdrawing a code stops new families joining. Anyone already connected stays connected
          until they disconnect you.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 80))}
          placeholder="What is it for? e.g. Tuesday math"
          className="flex-1 rounded-xl border-2 border-edge px-3 py-2 font-bold text-ink outline-none focus:border-ink"
        />
        <Button disabled={busy} onClick={mint}>
          {busy ? 'Working…' : has ? 'New code' : 'Create a code'}
        </Button>
      </div>
    </Card>
  )
}
