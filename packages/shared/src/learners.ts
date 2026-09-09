// Types shared by the web app and the API.
//
// The API is the only thing that talks to Postgres, so these are the wire
// shapes — already camelCased, already parsed into numbers and dates. The
// snake_case row shapes never leave the API.

/** The age at which a learner may attach their own external account. */
export const SELF_SIGNIN_MIN_AGE = 13

export type AuthKind = 'none' | 'provisioned' | 'self'
/**
 * What a grown-up is to a learner.
 *
 * Deliberately a property of the link rather than of the account: the same
 * person is a parent to their own children and a tutor to somebody else's, and
 * an account-wide type could not say that.
 */
export type GuardianRole = 'parent' | 'teacher' | 'tutor'
export type InvitePurpose = 'guardian' | 'self_login'

/**
 * A standing invitation from one grown-up, usually a tutor.
 *
 * It stands for the person, not for a learner: they hand it to families, and
 * each family redeems it against a child they own. Minting one grants nothing.
 */
export interface ConnectionCode {
  code: string
  /** What a family sees before accepting — "Mrs Patel, Tuesday math". */
  label: string | null
  role: GuardianRole
  canManageContent: boolean
  expiresAt: number | null
  maxUses: number | null
  uses: number
  createdAt: number
}

/**
 * Which pairing system a typed code belongs to.
 *
 * Three operations wearing the same eight characters:
 *
 *   `connection`  minted by a tutor; the redeemer *grants* them access
 *   `invite`      minted by a child's owner; the redeemer *gains* access
 *   `self_login`  minted by a child's owner for a 13+ learner; the redeemer
 *                 *becomes* that learner — no guardian link is made at all,
 *                 and the app offers no way back
 *
 * Nothing on the paper tells them apart, so the server decides and the one
 * entry box follows. The last is split out from `invite` because describing
 * it as one told a teenager they were gaining oversight of somebody, when
 * that somebody is who they were about to become.
 */
export type CodeKind = 'connection' | 'invite' | 'self_login' | 'unknown'

/** What somebody is told about a code before they accept it. */
export interface ConnectionCodePreview {
  kind: CodeKind
  valid: boolean
  reason: string | null
  ownerName: string | null
  /** The tutor's own note, or for an invite the learner it is about. */
  label: string | null
  role: GuardianRole | null
  canManageContent: boolean | null
}

export interface Learner {
  id: string
  ownerId: string
  displayName: string
  avatarEmoji: string
  gradeHint: number | null
  birthYear: number | null
  authKind: AuthKind
  authUserId: string | null
  createdAt: number
  /**
   * Whether a subscription covers this child.
   *
   * A property of the learner rather than of whoever is looking, which is the
   * whole billing model in one field: a tutor working with a covered child
   * sees the full picture for that child and has never bought anything.
   * Absent on older payloads, and absent means uncovered — the safe reading.
   */
  covered?: boolean
  /**
   * The learner's chosen world. Display state only — it never touches the
   * curriculum, the difficulty, or what earns a reward. Null means the client
   * default. Kept here rather than in browser storage because a grown-up can
   * set it, and that has to reach the child's device.
   */
  theme: string | null
}

export interface Guardian {
  guardianId: string
  learnerId: string
  role: GuardianRole
  canManageContent: boolean
  createdAt: number
  /** Filled in when the API can see the guardian's profile. */
  displayName?: string | null
}

export interface NewLearner {
  displayName: string
  avatarEmoji?: string
  gradeHint?: number | null
  birthYear?: number | null
  theme?: string | null
}

/** Age in whole years, or null when no birth year has been recorded. */
export function ageOf(learner: Pick<Learner, 'birthYear'>, now: Date = new Date()): number | null {
  if (!learner.birthYear) return null
  return now.getFullYear() - learner.birthYear
}

/**
 * Whether this learner may attach their own Google/email account. Mirrors the
 * `learners_guard` trigger in migration 0003: an unknown age is a no, because
 * the point of the gate is that we do not hand a child's record to an
 * unverified identity.
 *
 * Duplicated deliberately — the database is the enforcement point, this is so
 * the UI can gray out a button without a round trip.
 */
export function canUseSelfSignIn(learner: Pick<Learner, 'birthYear'>): boolean {
  const age = ageOf(learner)
  return age !== null && age >= SELF_SIGNIN_MIN_AGE
}
