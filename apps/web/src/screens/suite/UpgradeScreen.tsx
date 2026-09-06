import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useLearners } from '../../lib/learners'
import ScreenHeader from '../../components/suite/ScreenHeader'
import { Button, Card, Pill } from '../../components/ui'
import { COVERED_PERKS, FREE_PERKS, money, priceBreakdown, priceLine } from '../../lib/plans'
import { changeCoverage, isUnconfigured, startCheckout } from '../../lib/billing/api'
import { monthlyPriceCents, PRICE_EXTRA_LEARNER_CENTS, PRICE_FIRST_LEARNER_CENTS } from '@whizzo/shared'
import type { Navigate } from '../../routes'

/**
 * What it costs to cover your children.
 *
 * Not a plan picker. There is no plan — there is a list of children and a
 * question about each one, because that is what is actually being bought and
 * because it is the only shape that works for the people using this. A teacher
 * lands here and is told, correctly, that they are not the one who pays. A
 * parent with three children sees three rows and one total, rather than a
 * "Family" tier they have to work out whether they qualify for.
 *
 * This screen used to read `profiles.plan` and show a disabled "Coming soon"
 * button on a flat $4 tier — a price that was not the one in the spec, against
 * a field the feature gates had already stopped using.
 */
export default function UpgradeScreen({ navigate }: { navigate: Navigate }) {
  const { status, configured, user } = useAuth()
  const { learners, refresh } = useLearners()

  /**
   * This person's own children, and only theirs.
   *
   * `learners` is everyone the session can *see* — owned, guarded, or itself —
   * so a tutor's list includes children whose parents pay for them. Billing
   * them is not on offer: the model is that parents pay and tutors never do,
   * and a screen that showed a tutor a bill for somebody else's child would be
   * wrong about who owes what.
   */
  const mine = useMemo(
    () => learners.filter((l) => l.ownerId === user?.id),
    [learners, user?.id],
  )
  const covered = useMemo(() => mine.filter((l) => l.covered), [mine])
  const uncovered = useMemo(() => mine.filter((l) => !l.covered), [mine])

  /**
   * Which uncovered children the parent has *unticked*.
   *
   * The inverse of the obvious thing, and deliberately: everybody starts
   * selected, because a parent who opened this screen came to pay for their
   * children and making them tick each one to see a price is a toll booth in
   * front of the price. Storing the selection instead would mean seeding state
   * from `learners` — which is empty on first render and filled by a fetch, so
   * the seed would capture nothing and every box would render unticked. Storing
   * the exceptions has no seed to get wrong, and a child who arrives late is
   * selected because nobody excluded them.
   */
  const [excluded, setExcluded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const adding = uncovered.filter((l) => !excluded.includes(l.id)).length
  const total = covered.length + adding
  const delta = monthlyPriceCents(total) - monthlyPriceCents(covered.length)

  /**
   * Off to Stripe.
   *
   * Two routes rather than one, because a family who already pays is a
   * different operation from one who does not: the first changes a
   * subscription's quantity in place and is charged the difference, and the
   * second needs a card form. Sending an existing subscriber through checkout
   * again would give them a second subscription and two charges a month.
   */
  const pay = async () => {
    const chosen = uncovered.filter((l) => !excluded.includes(l.id)).map((l) => l.id)
    if (chosen.length === 0) return
    setBusy(true)
    setError(null)
    try {
      if (covered.length > 0) {
        await changeCoverage({ add: chosen })
        // Straight to the account screen, which is where "what you cover" now
        // says something different.
        navigate({ name: 'account' })
        return
      }
      const { url } = await startCheckout(chosen)
      window.location.assign(url)
    } catch (err) {
      setError(
        isUnconfigured(err)
          ? 'Payments are not switched on yet. Nothing has been charged.'
          : 'That did not go through. Nothing has been charged — please try again.',
      )
      setBusy(false)
    }
  }

  /**
   * Take one child off the subscription.
   *
   * Confirmed, because it is a change to what somebody is charged and the
   * button sits next to nine others. What it never does is delete anything:
   * the child keeps every deck and every answer and loses the reporting, which
   * is what "uncovered" has meant everywhere else in the product.
   */
  const stopCovering = async (learnerId: string, name: string) => {
    const last = covered.length === 1
    const question = last
      ? `Stop covering ${name}? That ends the subscription — nothing they have made is deleted.`
      : `Stop covering ${name}? Your monthly price goes down and nothing they have made is deleted.`
    if (!window.confirm(question)) return

    setBusy(true)
    setError(null)
    try {
      await changeCoverage({ remove: [learnerId] })
      await refresh()
    } catch {
      setError('That did not go through. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <ScreenHeader
        title="Paying for whizzo"
        subtitle="You pay for a child, not for an account. Everything a learner needs is free."
        onBack={() => navigate({ name: 'home' })}
      />

      {/* The price, before the list of what it buys. Somebody who opened this
          screen opened it to find out what it costs. */}
      <Card className="mb-4">
        <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-stone">
          {money(PRICE_FIRST_LEARNER_CENTS)} for the first child ·{' '}
          {money(PRICE_EXTRA_LEARNER_CENTS)} for each one after
        </p>
        <p className="text-4xl font-extrabold text-ink">{priceLine(total)}</p>
        {priceBreakdown(total) && (
          <p className="mt-1 font-bold text-muted">{priceBreakdown(total)}</p>
        )}
        {covered.length > 0 && adding > 0 && (
          <p className="mt-1 font-bold text-muted">
            {money(delta)} more a month than you pay now.
          </p>
        )}
      </Card>

      {status === 'signed-in' && mine.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-1 text-xl font-extrabold text-ink">Your children</h2>
          <p className="mb-3 font-bold text-muted">
            Coverage belongs to the child. Anyone you have trusted with them — a tutor, a teacher —
            gets the full picture for that child without paying anything.
          </p>
          <ul className="space-y-2">
            {mine.map((learner) => {
              const on = learner.covered || !excluded.includes(learner.id)
              return (
                <li
                  key={learner.id}
                  className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-hair"
                >
                  <span className="text-xl leading-none">{learner.avatarEmoji}</span>
                  <span className="font-extrabold text-ink">{learner.displayName}</span>
                  {learner.covered ? (
                    <>
                      <Pill className="bg-emerald-100 text-xs text-emerald-700">Covered</Pill>
                      {/* Stopping is a per-child decision, not an all-or-nothing
                          one. Without this the only way to stop paying for one
                          child of three is to cancel the subscription covering
                          all three. */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void stopCovering(learner.id, learner.displayName)}
                        className="ml-auto text-sm font-bold text-stone underline hover:text-ink disabled:opacity-50"
                      >
                        Stop covering
                      </button>
                    </>
                  ) : (
                    <label className="ml-auto flex items-center gap-2 font-bold text-body">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setExcluded((prev) =>
                            prev.includes(learner.id)
                              ? prev.filter((x) => x !== learner.id)
                              : [...prev, learner.id],
                          )
                        }
                      />
                      Cover them
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          {error && <p className="mt-3 font-bold text-rose-500">{error}</p>}

          <Button className="mt-4 w-full" disabled={adding === 0 || busy} onClick={pay}>
            {busy
              ? 'Taking you to the card form…'
              : adding === 0
                ? covered.length > 0
                  ? 'Everyone is covered'
                  : 'Choose a child to cover'
                : `Cover ${adding === 1 ? 'them' : `${adding} children`} — ${money(delta)} a month`}
          </Button>
          <p className="mt-2 text-center text-xs font-bold text-stone">
            {covered.length > 0
              ? 'Added part-way through a month? You pay the difference, not a fresh month.'
              : 'Card details are handled by Stripe. Cancel whenever you like.'}
          </p>
        </Card>
      )}

      {status === 'signed-in' && mine.length === 0 && (
        <Card className="mb-4">
          <p className="mb-3 font-bold text-muted">
            {learners.length > 0
              ? 'The children you work with are covered by whoever added them. Nothing here is ' +
                'yours to pay for — add a child of your own and this screen becomes about them.'
              : 'There is nobody to cover yet. Add a child first — everything they need to learn ' +
                'is free, so there is no hurry to come back here.'}
          </p>
          <Button onClick={() => navigate({ name: 'family' })}>Add a child</Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-2xl font-extrabold text-ink">Free</h2>
          <p className="mb-4 font-bold text-muted">Everything a learner needs. For everyone.</p>
          <ul className="space-y-2">
            {FREE_PERKS.map((perk) => (
              <li key={perk} className="flex gap-2 font-bold text-body">
                <span className="text-emerald-500">✓</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="ring-2 ring-sun">
          <h2 className="mb-1 text-2xl font-extrabold text-ink">With coverage</h2>
          <p className="mb-4 font-bold text-muted">
            {money(PRICE_FIRST_LEARNER_CENTS)} a month, per child. For the grown-ups keeping track.
          </p>
          <ul className="space-y-2">
            {COVERED_PERKS.map((perk) => (
              <li key={perk} className="flex gap-2 font-bold text-body">
                <span className="text-emerald-500">✓</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="mb-1 text-lg font-extrabold text-ink">Why is the curriculum free?</h3>
        <p className="font-bold text-muted">
          A spelling app that locks fourth grade behind a card number is not much use to the kid who
          needs fourth grade. Every word list, every activity, the mastery ladder and the adaptive
          engine itself stay free — and so does setting work, so a teacher can give it to a class
          without anybody being asked for money. What is paid for is the reporting, the rewards and
          the document uploads: the things a grown-up wants, and the one thing that costs us money
          per use.
        </p>
      </Card>

      {status !== 'signed-in' && configured && (
        <Card className="mt-4">
          <p className="mb-3 font-bold text-muted">
            You will need a free account before you can cover anybody — and your children can use
            everything above without one being paid for.
          </p>
          <Button className="w-full" onClick={() => navigate({ name: 'auth' })}>
            Create a free account
          </Button>
        </Card>
      )}
    </div>
  )
}
