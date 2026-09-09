// Simulates learners through the adaptive engine to check it behaves.
// Run with: npm run simulate:adaptive
//
// Each simulated learner has a hidden "true" grade level. They answer a word
// correctly with a probability that depends on how far that word sits above or
// below that true level. The engine never sees the hidden value — it only sees
// right and wrong answers, exactly like the real app. If the engine works, each
// learner should converge on their own level and stay there.

import { GRADES, gradeAt, wordsInGrade } from '../src/data/spelling'
import {
  applyAttemptToMastery,
  evaluateLevel,
  expectedCorrect,
  masteryBand,
  placeLevel,
  updateAbility,
} from '../src/lib/adaptive'
import { emptySnapshot, masteryKey, todayString, type Attempt, type SkillState } from '../src/lib/progress/types'
import { defaultSkillState } from '../src/lib/progress/types'
import { planPlacement, planSession } from '../src/lib/spelling/session'

/** Deterministic RNG so the simulation is reproducible. */
function mulberry32(seed: number) {
  return function rng() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SimResult {
  trueLevel: number
  placedAt: number
  finalGrade: number
  finalAbility: number
  accuracy: number
  /** Accuracy the first time a word is met — the pretest signal. */
  freshAccuracy: number
  /** Accuracy on a word's third or later exposure — the learning signal. */
  repeatAccuracy: number
  /** Words the learner ends up holding at the mastered band. */
  mastered: number
  rounds: number
}

function simulate(trueLevel: number, rounds: number, seed: number, growth: number): SimResult {
  const rng = mulberry32(seed)
  const shuffle = <T,>(items: T[]): T[] => {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  let snapshot = emptySnapshot()
  let state: SkillState = defaultSkillState('spelling')
  let attempts = 0
  let correctTotal = 0
  let freshAttempts = 0
  let freshCorrect = 0
  let repeatAttempts = 0
  let repeatCorrect = 0
  const today = todayString()

  // Placement check first, exactly as a new learner would experience it.
  const placement = planPlacement(12, shuffle)
  for (const word of placement) {
    const correct = rng() < expectedCorrect(trueLevel, word.difficulty)
    attempts += 1
    if (correct) correctTotal += 1
    const update = updateAbility(state, word.difficulty, correct)
    state = {
      ...state,
      ability: update.ability,
      abilitySd: update.abilitySd,
      totalAttempts: state.totalAttempts + 1,
      totalCorrect: state.totalCorrect + (correct ? 1 : 0),
    }
  }
  state = {
    ...state,
    placed: true,
    levelIndex: placeLevel(
      state.ability,
      GRADES.map((g) => g.grade),
    ),
  }
  const placedAt = gradeAt(state.levelIndex).grade

  for (let round = 0; round < rounds; round++) {
    const plan = planSession(snapshot, state, { mode: 'adaptive', size: 10, today, shuffle })
    let roundCorrect = 0

    for (const word of plan) {
      // The hidden truth: chance of spelling this word right. Learners also
      // improve on words they have already practiced, which is what lets the
      // engine promote them over time.
      const seen = snapshot.mastery[masteryKey('spelling', word.w)]
      const familiarity = Math.min(growth, (seen?.totalAttempts ?? 0) * growth * 0.35)
      const p = Math.min(0.98, expectedCorrect(trueLevel, word.difficulty) + familiarity)
      const correct = rng() < p

      attempts += 1
      if (correct) {
        correctTotal += 1
        roundCorrect += 1
      }
      // Bucket by how many times this learner has met this exact word, which
      // isolates learning from the fact that the review pool is, by
      // construction, made of the words they keep getting wrong.
      const exposures = seen?.totalAttempts ?? 0
      if (exposures === 0) {
        freshAttempts += 1
        if (correct) freshCorrect += 1
      } else if (exposures >= 2) {
        repeatAttempts += 1
        if (correct) repeatCorrect += 1
      }

      const attempt: Attempt = {
        subject: 'spelling',
        itemKey: word.w,
        activity: 'listen-spell',
        isTest: true,
        correct,
        responseMs: 4000,
        hintsUsed: 0,
        difficulty: word.difficulty,
        given: correct ? word.w : 'xxx',
        at: Date.now(),
      }

      const update = updateAbility(state, word.difficulty, correct)
      state = {
        ...state,
        ability: update.ability,
        abilitySd: update.abilitySd,
        totalAttempts: state.totalAttempts + 1,
        totalCorrect: state.totalCorrect + (correct ? 1 : 0),
      }

      const key = masteryKey('spelling', word.w)
      snapshot = {
        ...snapshot,
        mastery: {
          ...snapshot.mastery,
          [key]: applyAttemptToMastery(snapshot.mastery[key], attempt, {
            today,
            ability: state.ability,
          }),
        },
      }
    }

    // Level check, exactly as the app does it at the end of a round.
    const grade = gradeAt(state.levelIndex).grade
    const levelWords = wordsInGrade(grade)
    const levelMastered =
      levelWords.filter((w) => masteryBand(snapshot.mastery[masteryKey('spelling', w.w)]) === 'mastered')
        .length / levelWords.length
    const levelAttempts = levelWords.reduce(
      (n, w) => n + (snapshot.mastery[masteryKey('spelling', w.w)]?.reps ?? 0),
      0,
    )
    const roundAccuracy = roundCorrect / plan.length

    const decision = evaluateLevel({
      state,
      levelDifficulty: grade,
      levelCount: GRADES.length,
      levelMastered,
      levelAttempts,
      recentAccuracy: roundAccuracy,
    })
    state = { ...state, levelIndex: decision.levelIndex }
  }

  return {
    trueLevel,
    placedAt,
    finalGrade: gradeAt(state.levelIndex).grade,
    finalAbility: state.ability,
    accuracy: correctTotal / attempts,
    freshAccuracy: freshAttempts > 0 ? freshCorrect / freshAttempts : 0,
    repeatAccuracy: repeatAttempts > 0 ? repeatCorrect / repeatAttempts : 0,
    mastered: Object.values(snapshot.mastery).filter((m) => masteryBand(m) === 'mastered').length,
    rounds,
  }
}

const ROUNDS = 60

let failures = 0

function expect(label: string, ok: boolean, detail: string): void {
  if (!ok) {
    failures += 1
    console.error(`       ${label}: ${detail}`)
  }
}

// ---------------------------------------------------------------------------
// Suite 1 — measurement. The learner never improves, so a correct engine should
// settle on their true level and hold there.
// ---------------------------------------------------------------------------
console.log('Measurement: learners whose ability never changes\n')
console.log(
  '  hidden level | placed at | ends at grade | ability | overall | first look | third look | mastered',
)
console.log(
  '  -------------+-----------+---------------+---------+---------+------------+------------+---------',
)

for (const trueLevel of [2, 3, 4, 5, 6, 7, 8]) {
  const r = simulate(trueLevel, ROUNDS, trueLevel * 7919, 0)
  console.log(row(r))
  expect(
    `level ${trueLevel}`,
    Math.abs(r.finalAbility - trueLevel) <= 0.9,
    `ability estimate ${r.finalAbility.toFixed(2)} is more than 0.9 from the true level`,
  )
  expect(
    `level ${trueLevel}`,
    Math.abs(r.finalGrade - trueLevel) <= 1,
    `placed at grade ${r.finalGrade}, more than one band from the true level`,
  )
  // First exposure should look like a pretest: hard enough to be worth doing,
  // not so hard the round is noise.
  expect(
    `level ${trueLevel}`,
    r.freshAccuracy >= 0.35 && r.freshAccuracy <= 0.8,
    `first-exposure accuracy ${(r.freshAccuracy * 100).toFixed(0)}% is outside the pretest band`,
  )
  // A learner who never improves must not drift up the curriculum.
  expect(
    `level ${trueLevel}`,
    r.repeatAccuracy <= r.freshAccuracy + 0.12,
    `a static learner appeared to improve on repeats (${(r.repeatAccuracy * 100).toFixed(0)}% vs ${(
      r.freshAccuracy * 100
    ).toFixed(0)}%)`,
  )
}

// ---------------------------------------------------------------------------
// Suite 2 — progression. The learner genuinely improves on words they have
// practiced, so the engine should notice and move them up the curriculum.
// ---------------------------------------------------------------------------
console.log('\nProgression: learners who improve as they practice\n')
console.log(
  '  hidden level | placed at | ends at grade | ability | overall | first look | third look | mastered',
)
console.log(
  '  -------------+-----------+---------------+---------+---------+------------+------------+---------',
)

for (const trueLevel of [2, 4, 6]) {
  const r = simulate(trueLevel, ROUNDS, trueLevel * 104729, 0.35)
  console.log(row(r))
  expect(
    `level ${trueLevel}`,
    r.finalGrade > r.placedAt,
    `never moved up from grade ${r.placedAt} despite improving`,
  )
  // The learning signal, measured as the drop in error rate rather than the
  // rise in accuracy: a learner already getting two-thirds right has less room
  // to gain in percentage points than one getting a third right.
  const errorDrop = 1 - (1 - r.repeatAccuracy) / Math.max(0.01, 1 - r.freshAccuracy)
  expect(
    `level ${trueLevel}`,
    errorDrop >= 0.15,
    `errors fell only ${(errorDrop * 100).toFixed(0)}% between first and third look (${(
      r.freshAccuracy * 100
    ).toFixed(0)}% -> ${(r.repeatAccuracy * 100).toFixed(0)}%)`,
  )
  expect(`level ${trueLevel}`, r.mastered >= 20, `only ${r.mastered} words reached mastered`)
}

function row(r: SimResult): string {
  return `  ${String(r.trueLevel).padStart(12)} | ${String(r.placedAt).padStart(9)} | ${String(
    r.finalGrade,
  ).padStart(13)} | ${r.finalAbility.toFixed(2).padStart(7)} | ${(r.accuracy * 100)
    .toFixed(0)
    .padStart(6)}% | ${(r.freshAccuracy * 100).toFixed(0).padStart(9)}% | ${(
    r.repeatAccuracy * 100
  )
    .toFixed(0)
    .padStart(9)}% | ${String(r.mastered).padStart(8)}`
}

console.log('')
if (failures > 0) {
  console.error(`${failures} expectation(s) missed`)
  process.exit(1)
}
console.log('Adaptive engine measured and progressed every simulated learner.')
