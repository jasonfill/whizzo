import { useCoverage } from '../../lib/billing/coverage'
import { useLearners } from '../../lib/learners'
import { useEffect, useState } from 'react'
import type { LibraryResponse } from '@whizzo/shared'
import { useAuth } from '../../auth/AuthProvider'
import MyTutorCode from '../../components/suite/MyTutorCode'
import ConnectedApps from '../../components/suite/ConnectedApps'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { loadLibrary } from '../../lib/assignments/library'
import { Button, Card, Pill } from '../../components/ui'
import { money, priceBreakdown, priceLine } from '../../lib/plans'
import { billingPortal } from '../../lib/billing/api'
import { PRICE_FIRST_LEARNER_CENTS } from '@whizzo/shared'
import { useProgress } from '../../lib/progress/ProgressProvider'
import type { Navigate } from '../../routes'
import { exportProgressCsv } from '../../lib/progress/export'

const AVATARS = ['🐱', '🐈', '🐈‍⬛', '🦁', '🐯', '🐼', '🦊', '🐨', '🐸', '🦉', '🐙', '🦄']

export default function AccountScreen({ navigate }: { navigate: Navigate }) {
  const { status, profile, user, signOut, updateProfile, configured } = useAuth()
  const { snapshot, mode, sync, reset } = useProgress()
  const [name, setName] = useState(profile?.displayName ?? '')
  const [confirmReset, setConfirmReset] = useState(false)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)

  // Just the counts, so the card can say something true before you open it.
  // A library that will not load shows a dash rather than a zero: "none" and
  // "could not ask" are different answers.
  useEffect(() => {
    if (status !== 'signed-in') return
    const controller = new AbortController()
    loadLibrary(controller.signal)
      .then((lib) => {
        if (!controller.signal.aborted) setLibrary(lib)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [status])

  const { learners } = useLearners()
  const [portalBusy, setPortalBusy] = useState(false)
  const coverage = useCoverage()
  // What this person actually pays for: the children *of theirs* that are
  // covered. Not `profiles.plan` — a flag that says "Pro" for a teacher who has
  // never paid and "Free" for a parent whose child is covered by somebody else.
  //
  // The ownership test is not decoration. `learners` is everyone the session
  // can see, guarded children included, so without it a tutor with two covered
  // students would be shown a bill for $6 a month and thanked for paying it.
  const covering = learners.filter((l) => l.covered && l.ownerId === user?.id)

  if (status !== 'signed-in') {
    return (
      <div className="mx-auto w-full max-w-2xl py-4">
        <ScreenHeader title="Your account" onBack={() => navigate({ name: 'home' })} />
        <Card>
          <p className="mb-4 font-bold text-muted">
            Nobody is signed in on this device.
          </p>
          {configured ? (
            <Button className="w-full" onClick={() => navigate({ name: 'auth' })}>
              Sign in
            </Button>
          ) : (
            <p className="font-bold text-stone">
              This build has no database connected — see <code>supabase/README.md</code>.
            </p>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <ScreenHeader
        title="Your account"
        subtitle={user?.email ?? undefined}
        onBack={() => navigate({ name: 'home' })}
      />

      <Card className="mb-4">
        <h2 className="mb-3 text-xl font-extrabold text-ink">Profile</h2>

        <label className="mb-1 block text-sm font-bold text-muted">Display name</label>
        <div className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            className="flex-1 rounded-xl border-2 border-edge px-4 py-3 font-bold text-ink focus:border-ink focus:outline-none"
          />
          <Button
            variant="secondary"
            onClick={() => updateProfile({ displayName: name.trim() })}
            disabled={!name.trim() || name.trim() === profile?.displayName}
          >
            Save
          </Button>
        </div>

        <label className="mb-2 block text-sm font-bold text-muted">Your avatar</label>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => updateProfile({ avatarEmoji: emoji })}
              className={`rounded-xl px-3 py-2 text-2xl transition-transform hover:scale-110 ${
                profile?.avatarEmoji === emoji ? 'bg-wash ring-2 ring-ink' : 'bg-quiet'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-ink">What you cover</h2>
          <Pill className={covering.length > 0 ? 'bg-sun text-white' : 'bg-wash text-muted'}>
            {covering.length > 0
              ? `${covering.length} ${covering.length === 1 ? 'child' : 'children'}`
              : 'Nobody yet'}
          </Pill>
        </div>
        {covering.length > 0 ? (
          <>
            <p className="mb-1 font-bold text-body">
              {covering.map((l) => l.displayName).join(', ')} —{' '}
              {priceLine(covering.length).toLowerCase()}.
            </p>
            {priceBreakdown(covering.length) && (
              <p className="mb-3 text-sm font-bold text-stone">
                {priceBreakdown(covering.length)}
              </p>
            )}
            {/* No renewal date until there is a subscription to read one from.
                `profiles.plan_renews_at` belongs to the legacy flag, and
                printing it under a coverage total would be the same
                substitution this screen just stopped making. */}
            <p className="mb-3 font-bold text-muted">Thank you for supporting the project.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => navigate({ name: 'upgrade' })}>
                Cover somebody else
              </Button>
              {/* Stripe's own portal rather than screens of ours. Card details
                  are the one thing this product should never see, and a cancel
                  flow we wrote is one we would have to keep correct against
                  Stripe's rules forever. */}
              <Button
                variant="ghost"
                disabled={portalBusy}
                onClick={async () => {
                  setPortalBusy(true)
                  try {
                    const { url } = await billingPortal()
                    window.location.assign(url)
                  } catch {
                    setPortalBusy(false)
                  }
                }}
              >
                {portalBusy ? 'Opening…' : 'Card and invoices'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 font-bold text-muted">
              Everything a learner needs is free, so there is nothing you are missing out on. What
              covering a child adds is the reporting: their full history, every word they missed,
              what is about to slip, and rewards you can check off as paid.
            </p>
            <Button className="w-full" onClick={() => navigate({ name: 'upgrade' })}>
              ✨ See what covering a child adds — from {money(PRICE_FIRST_LEARNER_CENTS)} a month
            </Button>
          </>
        )}
      </Card>

      {/* Your things, as opposed to the people you look after — those live in
          Family. A tutor's decks are not any one student's, so this is where
          they belong. */}
      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-ink">Your library 📚</h2>
          <Button variant="secondary" onClick={() => navigate({ name: 'library' })}>
            Open library
          </Button>
        </div>
        <p className="mb-3 font-bold text-muted">
          Decks and word lists that belong to you rather than to one learner — build once, set
          them for any learner you look after.
        </p>
        <div className="flex flex-wrap gap-2">
          <Pill className="bg-wash text-ink">
            🃏 {library ? library.decks.length : '—'} decks
          </Pill>
          <Pill className="bg-wash text-ink">
            ✏️ {library ? library.customLists.length : '—'} word lists
          </Pill>
        </div>
      </Card>

      <ConnectedApps />

      <MyTutorCode />

      <Card className="mb-4 mt-4">
        <h2 className="mb-2 text-xl font-extrabold text-ink">Your data</h2>
        <p className="mb-3 font-bold text-muted">
          Progress is stored {mode === 'cloud' ? 'in your account' : 'in this browser'}
          {sync === 'error' && ' (the last sync failed — check your connection)'}.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="secondary"
            onClick={() => exportProgressCsv(snapshot)}
            disabled={!coverage.can('dataExport')}
          >
            ⬇️ Export as CSV{!coverage.can('dataExport') && ' (Pro)'}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true)
                return
              }
              void reset()
              setConfirmReset(false)
            }}
          >
            {confirmReset ? 'Really erase everything?' : '🗑️ Erase my progress'}
          </Button>
        </div>
        {confirmReset && (
          <button
            onClick={() => setConfirmReset(false)}
            className="mt-2 text-sm font-bold text-stone underline"
          >
            Never mind
          </button>
        )}
      </Card>

      <Button
        variant="ghost"
        className="w-full"
        onClick={() => {
          void signOut()
          navigate({ name: 'home' })
        }}
      >
        Sign out
      </Button>
    </div>
  )
}
