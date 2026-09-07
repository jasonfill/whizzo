import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Pill } from '../../components/ui'
import { listGrants, revokeGrant, type McpGrant } from '../../lib/mcp/api'

/**
 * The assistants connected to this account, and the one thing to do about
 * each: disconnect. There is no edit — which children a connection covers was
 * agreed when it was made, and widening that is a new connection.
 *
 * Also the setup instructions, because "paste this URL into Claude" is the
 * whole onboarding and there is nowhere better for it to live.
 */
export default function ConnectedApps() {
  const [grants, setGrants] = useState<McpGrant[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showHow, setShowHow] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await listGrants(signal)
      if (signal?.aborted) return
      setGrants(res.grants)
      setEnabled(res.enabled)
      setServerUrl(res.serverUrl)
    } catch {
      if (!signal?.aborted) setGrants([])
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const disconnect = async (id: string) => {
    setBusy(id)
    try {
      await revokeGrant(id)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!serverUrl) return
    try {
      await navigator.clipboard.writeText(serverUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the URL is on screen; they can select it */
    }
  }

  const label = (g: McpGrant) => (g.client === 'claude' ? 'Claude' : g.client === 'chatgpt' ? 'ChatGPT' : g.clientName)
  const when = (ms: number | null) => {
    if (!ms) return 'not used yet'
    const days = Math.floor((Date.now() - ms) / 86_400_000)
    return days === 0 ? 'used today' : days === 1 ? 'used yesterday' : `used ${days} days ago`
  }

  return (
    <Card className="mb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold text-ink">Connected apps 🗣️</h2>
        <Pill className={grants?.length ? 'bg-sun text-white' : 'bg-wash text-muted'}>
          {grants === null ? '…' : grants.length === 0 ? 'None yet' : `${grants.length} connected`}
        </Pill>
      </div>
      <p className="mb-3 font-bold text-muted">
        Let Claude or ChatGPT tutor a learner out loud on their own decks. The assistant asks the
        questions and Whizzo checks the answers, so what they practise counts here exactly as if
        they had done it in the app.
      </p>

      {!enabled ? (
        <p className="font-bold text-stone">Connected apps are not switched on in this build.</p>
      ) : (
        <>
          {grants && grants.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {grants.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-quiet px-4 py-3"
                >
                  <div>
                    <p className="font-extrabold text-ink">{label(g)}</p>
                    <p className="text-sm font-bold text-muted">
                      {g.learners.map((l) => l.name).join(', ')} · {when(g.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={busy === g.id}
                    onClick={() => void disconnect(g.id)}
                  >
                    {busy === g.id ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <code className="rounded-xl bg-wash px-3 py-2 text-sm font-bold text-ink">{serverUrl}</code>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied ✓' : 'Copy URL'}
            </Button>
            <Button variant="ghost" onClick={() => setShowHow((v) => !v)}>
              {showHow ? 'Hide steps' : 'How to connect'}
            </Button>
          </div>

          {showHow && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-quiet p-4">
                <p className="mb-1 font-extrabold text-ink">Claude</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm font-bold text-muted">
                  <li>Customize → Connectors → Add custom connector.</li>
                  <li>Paste the URL above and follow the sign-in back here.</li>
                  <li>
                    In the connector’s tool settings, allow <em>start_round</em> and <em>answer</em>{' '}
                    to run without asking — otherwise every answer needs a tap.
                  </li>
                  <li>
                    Open voice mode and say: <em>“Tutor Maya on her biology deck.”</em>
                  </li>
                </ol>
              </div>
              <div className="rounded-2xl bg-quiet p-4">
                <p className="mb-1 font-extrabold text-ink">ChatGPT</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm font-bold text-muted">
                  <li>Settings → Apps → Advanced settings → turn on Developer mode.</li>
                  <li>Create a connector with the URL above and sign in here.</li>
                  <li>
                    In a chat, type or dictate: <em>“Tutor Maya on her biology deck.”</em>
                  </li>
                  <li>ChatGPT’s voice mode cannot use connectors yet; dictation works.</li>
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
