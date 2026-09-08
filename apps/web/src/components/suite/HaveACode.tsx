import { useState } from 'react'
import { Button, Card } from '../../components/ui'
import { ApiError } from '../../lib/api/client'
import {
  describeCode,
  redeemConnectionCode,
  redeemInvite,
  type ConnectionCodePreview,
  type Learner,
} from '../../lib/learners/api'

/**
 * One box for every pairing code.
 *
 * There are two systems and they run opposite ways. An *invite* is minted by
 * the grown-up who owns a child and hands the redeemer access to them. A
 * *connection* code is minted by a tutor and the redeemer grants the tutor
 * access instead. Both are eight characters from the same alphabet, so a code
 * written on a scrap of paper says nothing about which one it is — and while
 * there were two boxes, putting a code in the wrong one answered "that code is
 * not valid any more" about a code that was perfectly good.
 *
 * So the server resolves the code and this follows its answer. Nobody has to
 * know which system they are holding, because that was never knowable.
 *
 * Two steps either way: typing eight characters and hoping is not consent, so
 * the code is looked up first and the person is told what accepting means
 * before anything happens. For a connection code they then choose which of
 * their children it applies to — only ones they own, because granting access
 * to somebody else's child is not theirs to do, and the database refuses it.
 */
export default function HaveACode({
  ownedLearners,
  onChanged,
}: {
  ownedLearners: Learner[]
  onChanged: () => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<ConnectionCodePreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(0)
  const [joined, setJoined] = useState<'invite' | 'self_login' | null>(null)

  const reset = () => {
    setPreview(null)
    setSelected([])
    setConnected(0)
    setJoined(null)
  }

  const look = async () => {
    setBusy(true)
    setError(null)
    setConnected(0)
    setJoined(null)
    try {
      const found = await describeCode(code)
      setPreview(found)
      if (found.valid && found.kind === 'connection' && ownedLearners.length === 1) {
        setSelected([ownedLearners[0].id])
      }
    } catch {
      setError('Could not check that code.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reload the family, without letting that stand in for the redemption.
   *
   * A code is spent the moment the server accepts it. If the reload afterwards
   * fails, the screen is stale — which the provider reports for itself — and
   * the code is still spent. Folding that into the same catch told people
   * their code had not worked and sent them back to re-enter it, and the
   * second attempt then failed for real, on a single-use code.
   */
  const refreshQuietly = async () => {
    try {
      await onChanged()
    } catch {
      /* a stale list, not a failed redemption */
    }
  }

  /** A tutor's code: we give, so we choose who to give. */
  const grant = async () => {
    setBusy(true)
    setError(null)
    try {
      const n = await redeemConnectionCode(code.trim(), selected)
      setConnected(n)
      setPreview(null)
      setCode('')
      setSelected([])
    } catch (err) {
      setError(messageOf(err, 'Could not connect them. The code may have been withdrawn since.'))
      return
    } finally {
      setBusy(false)
    }
    await refreshQuietly()
  }

  /** An invite: we receive, so there is nothing to choose. */
  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      await redeemInvite(code)
      // Committed before the reload, deliberately: on a first-ever join that
      // reload repaints the Family screen out of its empty state and takes
      // this card with it, so a confirmation set afterwards is never seen.
      setJoined(preview?.kind === 'self_login' ? 'self_login' : 'invite')
      setPreview(null)
      setCode('')
    } catch (err) {
      setError(messageOf(err, 'Could not use that code. It may have been used since.'))
      return
    } finally {
      setBusy(false)
    }
    await refreshQuietly()
  }

  return (
    <Card className="mt-4">
      <h3 className="mb-1 text-lg font-extrabold text-ink">Have a code?</h3>
      <p className="mb-3 text-sm font-bold text-muted">
        A grown-up sharing a learner with you, a tutor&apos;s code, or your own linking code —
        enter it here and we will work out which it is.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().slice(0, 12))
            reset()
          }}
          placeholder="ABCD2345"
          aria-label="Pairing code"
          className="flex-1 rounded-xl border-2 border-edge px-3 py-2 font-mono text-lg font-extrabold tracking-widest text-ink outline-none focus:border-ink"
        />
        <Button disabled={busy || code.trim().length < 6} onClick={look}>
          {busy ? 'Checking…' : 'Check code'}
        </Button>
      </div>

      {error && <p className="mb-2 font-bold text-rose-500">{error}</p>}

      {joined === 'invite' && (
        <p className="font-bold text-emerald-700">✅ Added. You can see their progress now.</p>
      )}

      {joined === 'self_login' && (
        <p className="font-bold text-emerald-700">
          ✅ Linked. Signing in with this account now brings you straight to your own work.
        </p>
      )}

      {connected > 0 && (
        <p className="font-bold text-emerald-700">
          ✅ Connected. They can now see {connected === 1 ? 'that learner' : `${connected} learners`}.
        </p>
      )}

      {preview && !preview.valid && (
        <p className="font-bold text-rose-500">{preview.reason ?? 'That code did not work.'}</p>
      )}

      {preview?.valid && preview.kind === 'invite' && (
        <div className="rounded-2xl bg-quiet p-4">
          <p className="mb-1 font-extrabold text-ink">
            {preview.ownerName} shared {preview.label ?? 'a learner'} with you
          </p>
          <p className="mb-3 text-sm font-bold text-muted">
            You will be able to see their progress and set them work. They stay on their own
            family&apos;s account, and either of you can undo this later.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={accept}>
              {busy ? 'Joining…' : 'Join'}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Never mind
            </Button>
          </div>
        </div>
      )}

      {/* A linking code is not an invite to help with somebody: it hands the
          learner profile to whoever is signed in. Told plainly, because it is
          the one action here that cannot be undone from the app. */}
      {preview?.valid && preview.kind === 'self_login' && (
        <div className="rounded-2xl bg-quiet p-4">
          <p className="mb-1 font-extrabold text-ink">
            This links {preview.label ?? 'a learner'} to the account you are signed in with
          </p>
          <p className="mb-3 text-sm font-bold text-muted">
            {preview.label ?? 'That learner'}&apos;s work, streak and rewards become yours to
            sign in to, and {preview.ownerName} stays the grown-up who looks after the profile.
            Only do this if {preview.label ?? 'that learner'} is you — it cannot be undone here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={accept}>
              {busy ? 'Linking…' : 'Yes, that is me'}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Never mind
            </Button>
          </div>
        </div>
      )}

      {preview?.valid && preview.kind === 'connection' && (
        <div className="rounded-2xl bg-quiet p-4">
          <p className="mb-1 font-extrabold text-ink">
            {preview.ownerName}
            {preview.label ? ` — ${preview.label}` : ''}
          </p>

          {/* A code that runs this way needs a child of yours to point at. Said
              plainly, because the alternative is a picker with nothing in it. */}
          {ownedLearners.length === 0 ? (
            <p className="text-sm font-bold text-muted">
              This code is theirs, not yours: entering it lets them see one of your learners.
              Add a learner first, then enter it again.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm font-bold text-muted">
                They will be able to see the progress of whoever you choose
                {preview.canManageContent ? ', and set them work' : ''}. They will not see anyone
                else in your family.
              </p>

              <fieldset className="mb-3">
                <legend className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">
                  Who can they see?
                </legend>
                <div className="flex flex-wrap gap-2">
                  {ownedLearners.map((l) => {
                    const on = selected.includes(l.id)
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setSelected((prev) =>
                            prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                          )
                        }
                        className={`flex items-center gap-2 rounded-2xl px-4 py-2 font-bold ring-1 transition-colors ${
                          on
                            ? 'bg-ink text-white ring-ink'
                            : 'bg-white/85 text-muted ring-hair hover:bg-quiet'
                        }`}
                      >
                        <span className="text-lg leading-none">{l.avatarEmoji}</span>
                        {l.displayName}
                        {on && <span aria-hidden>✓</span>}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || selected.length === 0} onClick={grant}>
                  {busy ? 'Connecting…' : `Give them access`}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Never mind
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * The server's own words when it has any.
 *
 * Every refusal below the API is a rule somebody can act on — "that is your
 * own code", "that code has expired" — and swallowing those for one house
 * sentence is what left people staring at a code they knew was good. Only an
 * ApiError is an answer, though: a dropped connection is not a verdict on the
 * code, so that keeps the guess.
 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message.trim() ? err.message : fallback
}
