// Acquire → read → build → validate → land.
//
// The orchestration, with every side effect injected. That is not testing
// ceremony: this is the one flow in the app that spends real money per run, and
// the parts most worth pinning — what happens when a topic fails, what happens
// when the credits run out, whether a failed run is refunded — are exactly the
// parts you cannot exercise against a live API without paying for them.

import {
  authorizeJob,
  landingSummary,
  settleJob,
  validateGeneratedCards,
  type CreditBalance,
  type CreditEntry,
  type QuizCard,
  type ValidatedSet,
} from '@whizzo/shared'
import { cacheHealthy, buildTopic, readSource, RefusedError, type CallUsage, type ModelDeps } from './model.js'
import type { SourceMap, Topic } from './schemas.js'

export interface BuiltSet {
  topicId: string
  title: string
  track: string | null
  objectives: string[]
  cards: QuizCard[]
  dropped: ValidatedSet['dropped']
  summary: string
}

export interface RunOutcome {
  ok: boolean
  map: SourceMap | null
  sets: BuiltSet[]
  /** Topics that failed on their own, without taking the others down. */
  failedTopics: Array<{ topicId: string; reason: string }>
  ledger: CreditEntry[]
  usage: CallUsage[]
  cacheHealthy: boolean
  error: string | null
}

export interface PipelineDeps extends ModelDeps {
  makeCard: (term: string, definition: string) => QuizCard
  /** Reported so a slow run can say which stage it is on. */
  onStage?: (stage: 'reading' | 'building', detail?: Record<string, unknown>) => void
}

export interface RunOptions {
  fileId: string
  pages: number
  balance: CreditBalance
  covered: boolean
  noRush?: boolean
  /** Which topics to build. Empty means every topic the read found. */
  topicIds?: string[]
}

/**
 * Run one document through.
 *
 * The shape of the error handling is the point. A refusal or a failed read
 * takes the whole run down, because there is nothing to build from. A topic
 * that fails takes only itself down — five topics landing instead of none is
 * strictly better for the person waiting, and the one that failed is named
 * rather than quietly missing.
 */
export async function runIngestion(
  deps: PipelineDeps,
  opts: RunOptions,
): Promise<RunOutcome> {
  const usage: CallUsage[] = []
  const collect = async (u: CallUsage, feature: string) => {
    usage.push(u)
    await deps.onUsage?.(u, feature)
  }
  const model: ModelDeps = { client: deps.client, onUsage: collect }

  // Nothing is spent before this. A refusal here is a refusal to start, and it
  // says how many credits short it is so the next screen can offer exactly
  // that rather than a generic upgrade.
  const decision = authorizeJob(opts.balance, opts.pages, {
    covered: opts.covered,
    noRush: opts.noRush,
  })
  if (!decision.ok) {
    return {
      ok: false,
      map: null,
      sets: [],
      failedTopics: [],
      ledger: [],
      usage: [],
      cacheHealthy: true,
      error: decision.reason,
    }
  }

  const reserved = decision.reserve
  const fail = (error: string): RunOutcome => ({
    ok: false,
    map: null,
    sets: [],
    failedTopics: [],
    // A run that produced nothing is ours to absorb. Charging for it is how a
    // support queue becomes a chargeback queue.
    ledger: [...reserved, ...settleJob(reserved, { ok: false })],
    usage,
    cacheHealthy: cacheHealthy(usage),
    error,
  })

  deps.onStage?.('reading')
  let map: SourceMap
  try {
    map = (await readSource(model, opts.fileId)).map
  } catch (error) {
    return fail(
      error instanceof RefusedError
        ? error.message
        : "We couldn't read that document. If it is a Word file, try printing it to PDF first.",
    )
  }

  const wanted = opts.topicIds?.length
    ? map.topics.filter((t) => opts.topicIds!.includes(t.id))
    : map.topics

  if (!wanted.length) {
    // Not an error. A permission slip has nothing to practice, and saying so is
    // a better answer than twenty cards about the school's address.
    return {
      ok: true,
      map,
      sets: [],
      failedTopics: [],
      ledger: [...reserved, ...settleJob(reserved, { ok: false })],
      usage,
      cacheHealthy: cacheHealthy(usage),
      error: null,
    }
  }

  deps.onStage?.('building', { topics: wanted.length })

  // The first topic runs alone; the rest fan out behind it.
  //
  // This looks like a needless serialization and is the opposite. The cache is
  // *written* by the first request to reach the server, so firing all six at
  // once means all six start before any cache exists — every one is a miss, and
  // the document is paid for six times. That failure is invisible: the cards
  // come back fine and the only symptom is the bill.
  //
  // One call to warm it, then everything else reads it. `allSettled` rather
  // than `all` throughout: one topic failing must not discard the others.
  const [first, ...rest] = wanted
  const results: Array<PromiseSettledResult<{ built: Awaited<ReturnType<typeof buildTopic>> }>> = []

  results.push(
    ...(await Promise.allSettled([
      (async () => ({ built: await buildTopic(model, opts.fileId, first!) }))(),
    ])),
  )
  if (rest.length) {
    results.push(
      ...(await Promise.allSettled(
        rest.map(async (topic) => ({ built: await buildTopic(model, opts.fileId, topic) })),
      )),
    )
  }

  const sets: BuiltSet[] = []
  const failedTopics: RunOutcome['failedTopics'] = []

  results.forEach((result, i) => {
    const topic = wanted[i]!
    if (result.status === 'rejected') {
      failedTopics.push({ topicId: topic.id, reason: reasonOf(result.reason) })
      return
    }
    const { set } = result.value.built
    const validated = validateGeneratedCards(set.cards, deps.makeCard)
    if (!validated.cards.length) {
      failedTopics.push({ topicId: topic.id, reason: 'Nothing in that section came back usable.' })
      return
    }
    sets.push({
      topicId: topic.id,
      title: set.title || topic.title,
      track: set.track ?? map.track,
      objectives: set.objectives ?? [],
      cards: validated.cards,
      dropped: validated.dropped,
      summary: landingSummary(validated, pagesOf(topic)),
    })
  })

  const anythingLanded = sets.length > 0
  return {
    ok: anythingLanded,
    map,
    sets,
    failedTopics,
    ledger: [...reserved, ...settleJob(reserved, { ok: anythingLanded, actualPages: opts.pages, noRush: opts.noRush })],
    usage,
    cacheHealthy: cacheHealthy(usage),
    error: anythingLanded ? null : 'We could not make anything usable out of that document.',
  }
}

function pagesOf(topic: Topic): number {
  return topic.pages.length
}

function reasonOf(error: unknown): string {
  if (error instanceof RefusedError) return error.message
  return 'That section could not be written up.'
}
