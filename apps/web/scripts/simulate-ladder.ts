// Put simulated learners through the ladder and check it behaves.
//
// The companion to simulate-adaptive.ts, and it exists for the same reason:
// the ladder's rules are the kind that fail *quietly*, in the direction of
// numbers that look good. A unit test proves one rule in isolation; this
// proves the rules still hold over a few hundred rounds of realistic practice,
// which is where a subtle interaction between them would show up.
//
// Four claims, all of which would be worth shipping the ladder for and none of
// which are safe to assume:
//
//   1. Practicing three times an evening promotes nothing. The requeue is the
//      obvious way this ladder gets silently wrong.
//   2. Spaced practice does promote — a rule that never promotes is safe and
//      useless.
//   3. A learner who genuinely knows the material reaches free recall.
//   4. A learner who does not stays low rather than drifting up.

import {
  deriveLadderState,
  stageOf,
  type Attempt,
  type SupportLevel,
} from '@whizzo/shared'

const DAY = 86_400_000
const START = Date.UTC(2026, 0, 6, 16)

/** Deterministic, so a failure is reproducible rather than a rumour. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function attempt(over: Partial<Attempt>): Attempt {
  return {
    subject: 'quiz',
    itemKey: 'd:1',
    activity: 'learn',
    isTest: true,
    verified: true,
    correct: true,
    responseMs: 1200,
    hintsUsed: 0,
    difficulty: 2,
    given: 'x',
    at: START,
    sessionId: 's',
    ...over,
  }
}

/** The activity a planner would choose for an item sitting at `level`. */
function activityFor(level: SupportLevel): string {
  return (['study', 'proofread', 'scramble', 'test'] as const)[level]
}

interface Row {
  label: string
  level: number
  rounds: number
  note: string
}
const rows: Row[] = []
let failures = 0

function check(label: string, ok: boolean, detail: string) {
  if (!ok) {
    failures += 1
    console.error(`  FAIL  ${label}: ${detail}`)
  }
}

// --- 1. Three rounds in one evening -----------------------------------------
{
  const attempts: Attempt[] = []
  // Same day, three separate rounds, every answer right — the child who sat
  // down after school and did the deck three times.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) {
      attempts.push(
        attempt({ activity: 'proofread', at: START + round * 600_000, sessionId: `r${round}` }),
      )
    }
  }
  const state = deriveLadderState(attempts)
  rows.push({
    label: 'three rounds, one evening',
    level: state.level,
    rounds: 3,
    note: '12 correct answers, no day passed',
  })
  check(
    'massed practice does not promote',
    state.level === 0,
    `reached level ${state.level} on one day's work`,
  )
}

// --- 2. The same work, spaced ------------------------------------------------
{
  const attempts: Attempt[] = []
  for (let day = 0; day < 3; day++) {
    attempts.push(attempt({ activity: 'proofread', at: START + day * DAY, sessionId: `d${day}` }))
  }
  const state = deriveLadderState(attempts)
  rows.push({
    label: 'one round a day for three days',
    level: state.level,
    rounds: 3,
    note: 'fewer answers, spread out',
  })
  check(
    'spaced practice promotes',
    state.level >= 1,
    `three answers on three days left the item at level ${state.level}`,
  )
}

// --- 3 and 4. Learners who do and do not know the material -------------------
for (const [label, skill, seed] of [
  ['knows it (90% right)', 0.9, 7],
  ['getting there (65%)', 0.65, 11],
  ['does not know it (30%)', 0.3, 13],
] as const) {
  const random = rng(seed)
  const attempts: Attempt[] = []
  let level: SupportLevel = 0
  const rounds = 40

  for (let day = 0; day < rounds; day++) {
    // The planner asks at whatever rung the item is on — the whole point of a
    // per-item ladder is that the question follows the learner.
    level = deriveLadderState(attempts).level
    const activity = activityFor(level)
    // Harder rungs are harder: recognizing is easier than producing.
    const chance = skill - stageOf(activity) * 0.08
    attempts.push(
      attempt({
        activity,
        at: START + day * DAY,
        sessionId: `s${day}`,
        correct: random() < chance,
      }),
    )
  }

  const state = deriveLadderState(attempts)
  rows.push({ label, level: state.level, rounds, note: `${Math.round(skill * 100)}% accurate` })

  if (skill >= 0.9) {
    check('a strong learner reaches free recall', state.level === 3, `stalled at ${state.level}`)
  }
  if (skill <= 0.3) {
    check(
      'a struggling learner is not carried upward',
      state.level <= 1,
      `drifted to level ${state.level} on 30% accuracy`,
    )
  }
}

// --- Report ------------------------------------------------------------------
console.log('\nThe ladder, over simulated practice\n')
console.log('  learner                        | rounds | ends at | note')
console.log('  -------------------------------+--------+---------+------------------------')
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(30)} | ${String(r.rounds).padStart(6)} | ${String(r.level).padStart(7)} | ${r.note}`,
  )
}
console.log('')

if (failures > 0) {
  console.error(`Ladder simulation failed ${failures} check${failures === 1 ? '' : 's'}.\n`)
  process.exit(1)
}
console.log('The ladder promoted on evidence and refused to promote without it.\n')
