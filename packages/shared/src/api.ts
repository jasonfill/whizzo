// The wire contract.
//
// One definition of every request and response shape, imported by the API that
// produces them and the web app that consumes them. If a route and its caller
// disagree, that is now a type error at build time rather than a surprise in
// production.

import type {
  ConnectionCode,
  Guardian,
  InvitePurpose,
  Learner,
} from './learners.js'
import type { Assignment, AssignmentSetSummary, Attempt, CustomWordList, LearnerOverview, ProgressSnapshot, QuizDeck } from './progress.js'

export interface ApiErrorBody {
  code: string
  message: string
}

export interface ErrorResponse {
  error: ApiErrorBody
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  uptime?: number
  detail?: string
}

export interface LearnersResponse {
  learners: Learner[]
}

export interface LearnerResponse {
  learner: Learner
}

export interface GuardiansResponse {
  guardians: Guardian[]
}

export interface GuardianResponse {
  guardian: Guardian
}

export interface InviteResponse {
  invite: {
    code: string
    /** ISO timestamp, or null if the row could not be read back. */
    expiresAt: string | null
    purpose: InvitePurpose
  }
}

export interface RedeemResponse {
  learnerId: string
}

export interface SnapshotResponse {
  snapshot: ProgressSnapshot
}

/** Everything a grown-up owns: decks and word lists that are theirs, not a learner's. */
export interface LibraryResponse {
  decks: QuizDeck[]
  customLists: CustomWordList[]
}

export interface ConnectionCodesResponse {
  codes: ConnectionCode[]
}

export interface ConnectionCodeResponse {
  code: ConnectionCode
}

export interface AssignmentsResponse {
  assignments: Assignment[]
}

/** Work the caller has set, with everyone they can see who was given it. */
export interface AssignmentSetsResponse {
  sets: AssignmentSetSummary[]
}

/** Every learner the caller can see, with enough to run a family dashboard. */
export interface FamilyOverviewResponse {
  learners: LearnerOverview[]
}

/** Every answer given in one round, oldest first. */
export interface SessionAttemptsResponse {
  attempts: Attempt[]
}

export interface WordListsResponse {
  customLists: CustomWordList[]
}

export interface DecksResponse {
  decks: QuizDeck[]
}

/**
 * What the API hands back after exchanging a child's code and PIN for a
 * session. The tokens go straight into the Supabase client in the browser,
 * which then behaves exactly as it does after any other sign-in.
 */
export interface ChildSessionResponse {
  learnerId: string
  displayName: string
  session: {
    accessToken: string
    refreshToken: string
    expiresIn: number
  }
}

// --- Connected apps (docs/mcp-tutor-spec.md) -------------------------------------

export interface McpGrant {
  id: string
  /** Which assistant, as best the client's own name says. */
  client: 'claude' | 'chatgpt' | 'other'
  clientName: string
  learners: Array<{ id: string; name: string }>
  currentLearnerId: string | null
  scope: string
  createdAt: number
  lastUsedAt: number | null
}

export interface McpGrantsResponse {
  grants: McpGrant[]
  /** False in a build with no MCP_TOKEN_SECRET. */
  enabled: boolean
  /** The URL a family pastes into the assistant. */
  serverUrl: string | null
}

export interface McpPendingResponse {
  clientName: string
  clientLabel: 'claude' | 'chatgpt' | 'other'
  scope: string
}
