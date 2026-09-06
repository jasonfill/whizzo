// Who pays, and what that buys.
//
// The decision underneath all of it: **parents pay, teachers and tutors never
// do, and what is bought is coverage of a specific child.** `profiles.plan`
// asked "is this user Pro?", which has no answer for a teacher with
// twenty-five students in twelve families. "Is this learner covered?" always
// has one.
//
// The gate principle, which is the existing commitment about the curriculum
// extended to everything: **never gate learning; gate leverage, and gate
// marginal cost.** A child on an uncovered learner can still learn everything
// this app knows how to teach.
//
// See docs/billing-spec.md.

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled'

export interface Subscription {
  id: string
  payerId: string
  status: SubscriptionStatus
  currentPeriodEnd: number | null
}

/**
 * How many learners a subscription covers.
 *
 * Counted, never stored. A stored copy is a second answer to a question that
 * already has one, and that is exactly how a billed quantity and a
 * covered-children list drift apart.
 */
export function seatsOf(coveredLearnerIds: readonly string[]): number {
  return new Set(coveredLearnerIds).size
}

/**
 * `past_due` counts as covered on purpose. A failed card is a payment problem,
 * not a reason to take a child's progress report away mid-week.
 */
export function isActiveStatus(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'past_due'
}

// --- Pricing ---------------------------------------------------------------

/** In cents, so nothing here ever meets a floating-point rounding error. */
export const PRICE_FIRST_LEARNER_CENTS = 400
export const PRICE_EXTRA_LEARNER_CENTS = 200

/**
 * $4 for one child, $8 for three. A flat family rate was the alternative and it
 * is worse for the same money: it prices a one-child family the same as a
 * four-child family, and one-child families are most of the market.
 */
export function monthlyPriceCents(learners: number): number {
  if (learners <= 0) return 0
  return PRICE_FIRST_LEARNER_CENTS + (learners - 1) * PRICE_EXTRA_LEARNER_CENTS
}

// --- What coverage buys ----------------------------------------------------

/**
 * Every gate in the app, named once.
 *
 * Anything not here is free, and that is the point rather than an oversight:
 * activities, the ladder, the whole curriculum, tracks, spaced review, and —
 * deliberately and permanently — **setting work**. A teacher who assigns to
 * twenty-five children causes twenty-five families to open the app and find
 * that somebody set work for their child. Gating that would strangle the exact
 * wedge this business runs on.
 */
export type Gate =
  | 'fullHistory'
  | 'itemReport'
  | 'retentionReport'
  | 'rewards'
  | 'printableReports'
  | 'dataExport'
  | 'unlimitedContent'
  | 'trackAbility'

const COVERED_GATES: ReadonlySet<Gate> = new Set<Gate>([
  'fullHistory',
  'itemReport',
  'retentionReport',
  'rewards',
  'printableReports',
  'dataExport',
  'unlimitedContent',
  'trackAbility',
])

/**
 * Whether this learner's grown-ups get a given capability.
 *
 * Takes coverage rather than a plan, so a tutor working with a covered child
 * gets the full picture for that child without ever having bought anything.
 */
export function allows(covered: boolean, gate: Gate): boolean {
  return covered && COVERED_GATES.has(gate)
}

/** How far back a grown-up can look. The one place the free tier is limited. */
export const FREE_HISTORY_DAYS = 30

export function historyDays(covered: boolean): number {
  return covered ? Number.POSITIVE_INFINITY : FREE_HISTORY_DAYS
}

/**
 * What an uncovered learner may keep.
 *
 * Limits apply to *creating*, never to keeping: forty decks made while covered
 * stay usable after a lapse, and the forty-first is refused. Deleting a
 * child's work for non-payment is not a business model.
 */
export const FREE_DECKS = 3
export const FREE_WORD_LISTS = 1

export function deckLimit(covered: boolean): number {
  return covered ? Number.POSITIVE_INFINITY : FREE_DECKS
}

export function wordListLimit(covered: boolean): number {
  return covered ? Number.POSITIVE_INFINITY : FREE_WORD_LISTS
}

/**
 * Whether one more may be created.
 *
 * Note the question: *creating*, not keeping. A learner who made forty decks
 * while covered keeps all forty after a lapse and is refused the forty-first.
 * Nothing is ever deleted for non-payment.
 */
export function canCreateAnother(existing: number, limit: number): boolean {
  return existing < limit
}

// --- Credits ---------------------------------------------------------------

/**
 * Document ingestion is the only feature with a real marginal cost, and it is
 * metered in credits rather than documents.
 *
 * A document is not a unit of cost; a page very nearly is, at roughly $0.025.
 * So an allowance of *ten documents a month* prices a parent uploading ten
 * worksheets ($1.25) identically to one uploading ten chapters ($5.00) —
 * against $4.00 of revenue. The second is a loss on exactly the case the
 * feature exists to serve.
 *
 * Every number below is provisional and meant to be replaced by measurements
 * from `llm_usage` within a month of the first real upload. The mechanism is
 * what is being committed to here, not the arithmetic.
 */
export const CREDITS_PER_PAGE = 1
/** Even a one-page upload pays for a full read call. */
export const CREDIT_FLOOR = 5

export const CREDITS_UNCOVERED_ONCE = 20
export const CREDITS_FIRST_LEARNER = 30
export const CREDITS_EXTRA_LEARNER = 15
export const CREDITS_TEACHER_MONTHLY = 40

export function creditsForPages(pages: number): number {
  return Math.max(CREDIT_FLOOR, Math.ceil(Math.max(0, pages) * CREDITS_PER_PAGE))
}

/**
 * A page of plain text.
 *
 * Uploads are not all paginated: a photograph of a worksheet has no pages, and
 * a `.txt` has as many as the reader's window is wide. But the price is quoted
 * in pages, and quoting one document in pages and the next in kilobytes would
 * make the two impossible to compare on the screen where a parent decides. So
 * everything is converted to the same unit before it is priced, and these are
 * the two conversions.
 *
 * 2000 characters is a generously full page of prose — chosen to err towards
 * over-counting, because a quote that comes in under itself is a good surprise
 * and one that comes in over is a complaint.
 */
export const CHARS_PER_PAGE = 2000

export function pagesForText(characters: number): number {
  return Math.max(1, Math.ceil(Math.max(0, characters) / CHARS_PER_PAGE))
}

/** One photograph is one page. It costs one read call either way. */
export const PAGES_PER_IMAGE = 1

/** The monthly allowance a subscription grants, pooled across its learners. */
export function monthlyCredits(coveredLearners: number): number {
  if (coveredLearners <= 0) return 0
  return CREDITS_FIRST_LEARNER + (coveredLearners - 1) * CREDITS_EXTRA_LEARNER
}

/**
 * Half price for work that can wait.
 *
 * The Batch API runs at 50% and fits "upload the textbook on Sunday" perfectly
 * while fitting "generate this while I wait" not at all. Exposing it as a
 * choice aligns the payer's patience with our cost — the rare lever that feels
 * generous while spending less.
 */
export function creditsWithSpeed(credits: number, noRush: boolean): number {
  return noRush ? Math.max(1, Math.ceil(credits / 2)) : credits
}

export type CreditBucket = 'included' | 'purchased'

export interface CreditBalance {
  included: number
  purchased: number
  total: number
}

/**
 * What to draw from, and in what order.
 *
 * **Included is always spent first.** The reverse order burns a parent's bought
 * credits while free ones expire underneath them, which is how you generate the
 * angriest email you will ever receive.
 *
 * Returns null when the balance cannot cover it — a hard stop rather than an
 * overage. This is a product bought by parents for children, and a surprise
 * bill would cost more in trust than the credits are worth.
 */
export function planSpend(
  balance: CreditBalance,
  credits: number,
): { included: number; purchased: number } | null {
  if (credits <= 0) return { included: 0, purchased: 0 }
  if (balance.total < credits) return null
  const included = Math.min(balance.included, credits)
  return { included, purchased: credits - included }
}
