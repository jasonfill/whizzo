import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { clearSignupIntent, readSignupIntent } from '../../auth/signupIntent'
import Mascot from '../../components/Mascot'
import HaveACode from '../../components/suite/HaveACode'
import ThemeChoice from '../../components/suite/ThemeChoice'
import { themeById } from '../../lib/themes'
import MyTutorCode from '../../components/suite/MyTutorCode'
import RewardLedger from '../../components/suite/RewardLedger'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { useRoundsNow } from '../../hooks/useRoundsNow'
import PracticingNow from '../../components/live/PracticingNow'
import { Button, Card, Pill } from '../../components/ui'
import { ApiError } from '../../lib/api/client'
import { familyOverview, type LearnerOverview } from '../../lib/assignments/api'
import { useLearners } from '../../lib/learners/LearnerProvider'
import {
  ageOf,
  canUseSelfSignIn,
  listGuardians,
  mintInvite,
  removeChildLogin,
  revokeGuardian,
  setChildLogin,
  setGuardianContentAccess,
  SELF_SIGNIN_MIN_AGE,
  type Guardian,
  type Learner,
} from '../../lib/learners/api'
import type { Navigate, Route } from '../../routes'
import { plannerLine, todayString } from '@whizzo/shared'

const AVATARS = ['🐱', '🐯', '🦊', '🐰', '🐨', '🐼', '🦁', '🐸', '🐧', '🦄']

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

export default function FamilyScreen({ navigate }: { navigate: Navigate }) {
  const { user, profile } = useAuth()
  const { learners, active, select, create, refresh, status } = useLearners()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read once: it is a hand-off from the sign-up screen, not live state.
  const [intent] = useState(() => readSignupIntent())

  /**
   * How everyone is actually doing, alongside who they are.
   *
   * One aggregated call for the whole family rather than a progress snapshot
   * per child — a grown-up with four children should not pay for four full
   * loads to see who still has homework. Failing to load it costs the status
   * lines and nothing else, so it is deliberately not wired to `error`: not
   * knowing this week's minutes should never stop somebody adding a learner.
   */
  const [overview, setOverview] = useState<Map<string, LearnerOverview>>(new Map())

  useEffect(() => {
    if (status !== 'ready') return
    const controller = new AbortController()
    familyOverview(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setOverview(new Map(rows.map((r) => [r.learnerId, r])))
        }
      })
      .catch(() => {
        /* status lines stay blank; the rest of the screen still works */
      })
    return () => controller.abort()
  }, [status, learners.length])

  const roundsNow = useRoundsNow()

  if (status === 'unavailable') {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <ScreenHeader title="Family" onBack={() => navigate({ name: 'home' })} />
        <Card>
          <p className="font-bold text-muted">
            Sign in to add learners and share progress with another grown-up.
          </p>
        </Card>
      </div>
    )
  }

  // First run. A grown-up who has just signed up owns nobody, and the rest of
  // the app is the *child's* experience — so without this they land in a
  // student dashboard with no idea they were supposed to add someone.
  if (status === 'ready' && learners.length === 0) {
    // What they told the sign-up screen. A 13+ learner who already said "I am
    // the one learning" and gave their birth year should not be asked again.
    const selfLearner = intent?.role === 'learner'
    // A tutor owns nobody, and marching them through "add your first learner"
    // would have them creating profiles for children who are not theirs. Their
    // first step is a code to hand to the families they work with.
    const tutor = intent?.role === 'tutor'

    const finish = async (draft: {
      displayName: string
      avatarEmoji?: string
      birthYear?: number | null
    }) => {
      setError(null)
      try {
        await create(draft)
        clearSignupIntent()
        navigate({ name: 'home' })
      } catch (err) {
        setError(messageOf(err))
      }
    }

    return (
      <div className="mx-auto w-full max-w-lg py-6">
        <div className="mb-5 flex flex-col items-center">
          <Mascot mood="cheer" size={110} className="animate-floaty" />
          <h1 className="mt-1 text-center text-3xl font-extrabold text-ink">
            {selfLearner ? 'One last thing' : tutor ? 'Connect your first family' : 'Who is learning?'}
          </h1>
          <p className="mt-1 text-center font-bold text-muted">
            {selfLearner
              ? 'Set up your learner profile — that is where your progress lives.'
              : tutor
                ? 'Your students stay on their own families\u2019 accounts. Give a family your code and they choose which of their children you can see.'
                : 'This account is yours, the grown-up. Add the people who will actually be practicing, and their progress stays with them.'}
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
            {error}
          </p>
        )}

        {tutor ? (
          <>
            <MyTutorCode />

            {/* AddLearner brings its own card, so this is a plain note above
                it rather than a second box around it. */}
            <p className="mt-4 px-1 text-sm font-bold text-muted">
              Teaching your own children too? Plenty of tutors do — add them and they sit
              alongside your students.
            </p>
            <AddLearner title="Add a learner of your own" onAdd={finish} />
          </>
        ) : selfLearner ? (
          <Card>
            <h3 className="mb-1 text-lg font-extrabold text-ink">
              {profile?.displayName?.trim() || 'You'}
            </h3>
            <p className="mb-4 text-sm font-bold text-muted">
              We already have your name and age from sign-up. Tap once and you are in.
            </p>
            <Button
              className="w-full"
              onClick={() =>
                finish({
                  displayName: profile?.displayName?.trim() || 'Me',
                  avatarEmoji: profile?.avatarEmoji ?? '🙂',
                  birthYear: intent?.birthYear ?? null,
                })
              }
            >
              Start learning
            </Button>
          </Card>
        ) : (
          <>
            <AddLearner startOpen title="Add your first learner" onAdd={finish} />

            <Card className="mt-4">
              <h3 className="mb-1 text-lg font-extrabold text-ink">Actually, it is me</h3>
              <p className="mb-3 text-sm font-bold text-muted">
                Practicing yourself is fine — you just need a learner too, so there is
                somewhere for the progress to live.
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  finish({
                    displayName: profile?.displayName?.trim() || 'Me',
                    avatarEmoji: profile?.avatarEmoji ?? '🙂',
                  })
                }
              >
                I am the one learning
              </Button>
            </Card>
          </>
        )}

        <HaveACode
          ownedLearners={[]}
          onChanged={async () => {
            setError(null)
            await refresh()
          }}
        />

        <button
          onClick={() => navigate({ name: 'home' })}
          className="mt-5 w-full text-sm font-bold text-stone underline hover:text-ink"
        >
          Skip for now
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ScreenHeader
        title="Family"
        subtitle={familySubtitle(overview, learners.length)}
        onBack={() => navigate({ name: 'home' })}
      />

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}
      <PracticingNow rounds={roundsNow} navigate={navigate} />

      <div className="flex flex-col gap-3">
        {learners.map((learner) => (
          <LearnerRow
            key={learner.id}
            userId={user?.id}
            learner={learner}
            overview={overview.get(learner.id)}
            isActive={learner.id === active?.id}
            isOwner={learner.ownerId === user?.id}
            expanded={expanded === learner.id}
            onToggle={() => setExpanded((v) => (v === learner.id ? null : learner.id))}
            onSelect={() => select(learner.id)}
            onError={setError}
            onChanged={refresh}
            onOpen={(route) => {
              // Every screen in the suite shows the active learner, so looking
              // at a child's work means switching to them first.
              select(learner.id)
              navigate(route)
            }}
          />
        ))}
      </div>

      <AddLearner
        onAdd={async (draft) => {
          setError(null)
          try {
            await create(draft)
          } catch (err) {
            setError(messageOf(err))
          }
        }}
      />

      {/* One box for both kinds of code. Two boxes meant a code entered in the
          wrong one came back "not valid any more", and nothing on the code
          itself said which one it belonged to. */}
      <HaveACode
        // Only learners this person owns: granting access to somebody else's
        // child is not theirs to do, and the database refuses it anyway.
        ownedLearners={learners.filter((l) => l.ownerId === user?.id)}
        onChanged={async () => {
          setError(null)
          await refresh()
        }}
      />
    </div>
  )
}

function LearnerRow({
  userId,
  learner,
  overview,
  isActive,
  isOwner,
  expanded,
  onToggle,
  onSelect,
  onError,
  onChanged,
  onOpen,
}: {
  /** Who is looking. Only the person who promised a reward may settle it. */
  userId: string | undefined
  learner: Learner
  overview: LearnerOverview | undefined
  isActive: boolean
  isOwner: boolean
  expanded: boolean
  onToggle: () => void
  onSelect: () => void
  onError: (message: string | null) => void
  onChanged: () => Promise<void>
  onOpen: (route: Route) => void
}) {
  const age = ageOf(learner)

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl leading-none">{learner.avatarEmoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold text-ink">{learner.displayName}</p>
          <p className="text-sm font-bold text-stone">
            {age !== null ? `${age} years old` : 'Age not set'}
            {' · '}
            <SignInLabel learner={learner} />
            {/* Which world they are in, so a parent can see it without opening
                anything — and so the setting advertises that it exists. */}
            {' · '}
            {themeById(learner.theme).name}
            {!isOwner && ' · shared with you'}
          </p>
        </div>
        {isActive ? (
          <span className="rounded-full bg-pine px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
            Playing
          </span>
        ) : (
          <Button variant="ghost" onClick={onSelect}>
            Switch to
          </Button>
        )}
        {isOwner && (
          <Button variant="ghost" onClick={onToggle}>
            {expanded ? 'Done' : 'Manage'}
          </Button>
        )}
      </div>

      {overview && <LearnerStatus overview={overview} onOpen={onOpen} />}

      {/* Promises live here rather than on a screen of their own, for the same
          reason the status line does: Family is the people you look after, and
          a grown-up thinks about one child at a time. */}
      {expanded && userId && (
        <RewardLedger
          learnerId={learner.id}
          learnerName={learner.displayName}
          userId={userId}
          ownsLearner={isOwner}
        />
      )}

      {expanded && isOwner && (
        <ManagePanel learner={learner} onError={onError} onChanged={onChanged} />
      )}
    </Card>
  )
}

/**
 * How this child is doing, on the row that already says who they are.
 *
 * Deliberately part of the family list rather than a dashboard of its own: a
 * grown-up looking after several children thinks about them one at a time, and
 * a second screen listing the same people again is a worse answer than one
 * screen that says more.
 */
function LearnerStatus({
  overview,
  onOpen,
}: {
  overview: LearnerOverview
  onOpen: (route: Route) => void
}) {
  const { openAssignments, overdueAssignments, doneThisWeek } = overview

  return (
    <div className="mt-3 border-t border-hair pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {overdueAssignments > 0 && (
          <Pill className="bg-rose-100 text-rose-700">⚠️ {overdueAssignments} overdue</Pill>
        )}
        <Pill
          className={
            openAssignments > 0 ? 'bg-wash text-ink' : 'bg-wash text-muted'
          }
        >
          {openAssignments === 0 ? 'nothing to do' : `${openAssignments} to do`}
        </Pill>
        {doneThisWeek > 0 && (
          <Pill className="bg-pine/10 text-pine">✅ {doneThisWeek} done this week</Pill>
        )}
        {overview.currentStreakDays > 0 && (
          <Pill className="bg-sun/30 text-ink">🔥 {overview.currentStreakDays}</Pill>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-bold text-muted">
        <span>{lastSeen(overview.lastActiveAt)}</span>
        <span>
          {overview.minutesThisWeek}m · {overview.itemsThisWeek} questions this week
        </span>
        {/* The checked figure, not the headline: a week of self-graded
            flashcards should not read as a week of demonstrated accuracy. */}
        <span
          title="Accuracy over answers the app checked this week. A dash means nothing graded was done."
        >
          {overview.verifiedAccuracyThisWeek === null
            ? 'nothing checked yet'
            : `${overview.verifiedAccuracyThisWeek}% checked`}
        </span>
      </div>

      {/* The planner line: one sentence, because one line stays one line. */}
      {overview.planner && (
        <p className="mb-3 text-sm font-bold text-muted">
          🗓️ {plannerLine(overview.planner, todayString())}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onOpen({ name: 'tasks' })}>
          ✅ Tasks{openAssignments > 0 ? ` (${openAssignments})` : ''}
        </Button>
        <Button variant="ghost" onClick={() => onOpen({ name: 'planner' })}>
          🗓️ Planner
        </Button>
        <Button variant="ghost" onClick={() => onOpen({ name: 'progress' })}>
          📊 History
        </Button>
      </div>
    </div>
  )
}

function lastSeen(at: number | null): string {
  if (!at) return 'has not practiced yet'
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days === 0) return 'practiced today'
  if (days === 1) return 'practiced yesterday'
  if (days < 7) return `practiced ${days} days ago`
  if (days < 14) return 'practiced last week'
  return `last practiced ${new Date(at).toLocaleDateString()}`
}

/** Leads with what needs doing, because that is what a grown-up opens this for. */
function familySubtitle(overview: Map<string, LearnerOverview>, learnerCount: number): string {
  const rows = [...overview.values()]
  const outstanding = rows.reduce((n, r) => n + r.openAssignments, 0)
  const overdue = rows.reduce((n, r) => n + r.overdueAssignments, 0)

  if (!rows.length || !learnerCount) {
    return 'Everyone learning here, and the grown-ups who can see them.'
  }
  if (overdue > 0) {
    return `${outstanding} task${outstanding === 1 ? '' : 's'} outstanding, ${overdue} overdue.`
  }
  if (outstanding > 0) {
    return `${outstanding} task${outstanding === 1 ? '' : 's'} outstanding across the family.`
  }
  return 'Nothing outstanding. Everyone is up to date.'
}

function SignInLabel({ learner }: { learner: Learner }) {
  if (learner.authKind === 'self') return <>signs in with their own account</>
  if (learner.authKind === 'provisioned') return <>signs in with a code</>
  return <>plays on your device</>
}

function ManagePanel({
  learner,
  onError,
  onChanged,
}: {
  learner: Learner
  onError: (message: string | null) => void
  onChanged: () => Promise<void>
}) {
  const [guardians, setGuardians] = useState<Guardian[]>([])
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [selfCode, setSelfCode] = useState<string | null>(null)
  const [loginCode, setLoginCode] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  const loadGuardians = useCallback(async () => {
    try {
      setGuardians(await listGuardians(learner.id))
    } catch (err) {
      onError(messageOf(err))
    }
  }, [learner.id, onError])

  useEffect(() => {
    void loadGuardians()
  }, [loadGuardians])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    onError(null)
    try {
      await fn()
    } catch (err) {
      onError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const eligibleForSelf = canUseSelfSignIn(learner)

  return (
    <div className="mt-5 flex flex-col gap-5 border-t-2 border-hair pt-5">
      <section>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">
          {learner.displayName}’s world
        </h3>
        <p className="mb-3 text-sm font-bold text-muted">
          Swaps the mascot and what gets collected — never the words, the difficulty, or what
          earns a reward. {learner.displayName} can change it themselves too.
        </p>
        <ThemeChoice learner={learner} onChanged={() => void onChanged()} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">
          Grown-ups who can see {learner.displayName}
        </h3>
        {guardians.length === 0 ? (
          <p className="text-sm font-bold text-stone">Just you so far.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {guardians.map((g) => (
              <li
                key={g.guardianId}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-quiet px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink">
                  {g.displayName ?? 'Another grown-up'}
                </span>
                <label className="flex items-center gap-1.5 text-xs font-bold text-muted">
                  <input
                    type="checkbox"
                    checked={g.canManageContent}
                    disabled={busy}
                    onChange={(e) =>
                      run(async () => {
                        await setGuardianContentAccess(learner.id, g.guardianId, e.target.checked)
                        await loadGuardians()
                      })
                    }
                  />
                  Can add decks
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await revokeGuardian(learner.id, g.guardianId)
                      await loadGuardians()
                    })
                  }
                  className="text-xs font-extrabold text-red-500 underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="ghost"
          className="mt-3"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const invite = await mintInvite(learner.id)
              setInviteCode(invite.code)
            })
          }
        >
          ➕ Invite another grown-up
        </Button>
        {inviteCode && (
          <CodeBanner
            code={inviteCode}
            hint="Share this with the other grown-up. It works once, and expires in 24 hours."
          />
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">
          How {learner.displayName} signs in
        </h3>

        {learner.authKind === 'self' ? (
          <p className="text-sm font-bold text-muted">
            {learner.displayName} uses their own account. To change that, they can sign out and you
            can set up a code instead.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm font-bold text-muted">
              {learner.authKind === 'provisioned'
                ? 'They have their own code. Setting a new PIN replaces it.'
                : 'Give them a code and a PIN so they can play on their own tablet. We never ask a child for an email address.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                placeholder="4-digit PIN"
                className="w-32 rounded-xl border-2 border-edge px-3 py-2 text-sm font-extrabold text-ink outline-none focus:border-ink"
              />
              <Button
                disabled={busy || pin.length < 4}
                onClick={() =>
                  run(async () => {
                    const result = await setChildLogin(learner.id, pin)
                    setLoginCode(result.loginCode)
                    setPin('')
                    await onChanged()
                  })
                }
              >
                {learner.authKind === 'provisioned' ? 'Reset their PIN' : 'Set up their sign-in'}
              </Button>
              {learner.authKind === 'provisioned' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await removeChildLogin(learner.id)
                      setLoginCode(null)
                      await onChanged()
                    })
                  }
                  className="text-xs font-extrabold text-red-500 underline disabled:opacity-50"
                >
                  Turn it off
                </button>
              )}
            </div>
            {loginCode && (
              <CodeBanner
                code={loginCode}
                hint={`${learner.displayName} signs in with this code and the PIN you just chose. Write it down — we cannot show it again.`}
              />
            )}
          </>
        )}
      </section>

      {learner.authKind !== 'self' && (
        <section>
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-stone">
            Their own Google account
          </h3>
          {eligibleForSelf ? (
            <>
              <p className="mb-3 text-sm font-bold text-muted">
                {learner.displayName} is old enough to link their own account. Give them this code
                while they are signed in with it.
              </p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const invite = await mintInvite(learner.id, { purpose: 'self_login' })
                    setSelfCode(invite.code)
                  })
                }
              >
                Create a linking code
              </Button>
              {selfCode && (
                <CodeBanner code={selfCode} hint="Expires in 24 hours and works once." />
              )}
            </>
          ) : (
            <p className="text-sm font-bold text-stone">
              Available from age {SELF_SIGNIN_MIN_AGE}.{' '}
              {learner.birthYear
                ? 'Until then, a code and PIN keeps their account free of personal details.'
                : 'Add their birth year first.'}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function CodeBanner({ code, hint }: { code: string; hint: string }) {
  return (
    <div className="mt-3 rounded-2xl border-2 border-dashed border-edge bg-quiet p-4 text-center">
      <p className="select-all font-mono text-2xl font-extrabold tracking-[0.3em] text-ink">
        {code}
      </p>
      <p className="mt-2 text-xs font-bold text-muted">{hint}</p>
    </div>
  )
}

function AddLearner({
  onAdd,
  startOpen = false,
  title = 'Add a learner',
}: {
  onAdd: (draft: { displayName: string; avatarEmoji: string; birthYear: number | null }) => Promise<void>
  startOpen?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(startOpen)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0]!)
  const [birthYear, setBirthYear] = useState('')
  const [busy, setBusy] = useState(false)

  const thisYear = new Date().getFullYear()

  if (!open) {
    return (
      <Button className="mt-4 w-full" variant="ghost" onClick={() => setOpen(true)}>
        ➕ Add a learner
      </Button>
    )
  }

  return (
    <Card className="mt-4">
      <h3 className="mb-3 text-lg font-extrabold text-ink">{title}</h3>
      <div className="flex flex-col gap-3">
        <label className="text-sm font-extrabold text-muted">
          Their name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Ada"
            className="mt-1 w-full rounded-xl border-2 border-edge px-3 py-2 font-extrabold text-ink outline-none focus:border-ink"
          />
        </label>

        <div>
          <p className="text-sm font-extrabold text-muted">Pick an avatar</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                className={`rounded-xl border-2 px-2 py-1 text-xl transition-colors ${
                  avatar === a ? 'border-ink bg-quiet' : 'border-transparent hover:bg-quiet'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <label className="text-sm font-extrabold text-muted">
          Birth year
          <input
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={String(thisYear - 8)}
            className="mt-1 w-full rounded-xl border-2 border-edge px-3 py-2 font-extrabold text-ink outline-none focus:border-ink"
          />
          <span className="mt-1 block text-xs font-bold text-stone">
            Used only to decide whether they are old enough ({SELF_SIGNIN_MIN_AGE}+) to link their
            own Google account.
          </span>
        </label>

        <div className="flex gap-2">
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true)
              const year = Number(birthYear)
              await onAdd({
                displayName: name.trim(),
                avatarEmoji: avatar,
                birthYear: year >= 1900 && year <= thisYear ? year : null,
              })
              setBusy(false)
              setName('')
              setBirthYear('')
              setOpen(false)
            }}
          >
            {busy ? 'Adding…' : 'Add them'}
          </Button>
          {!startOpen && (
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
