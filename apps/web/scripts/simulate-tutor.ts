// Put simulated learners through tutor rounds and check the rules hold.
//
// The companion to simulate-ladder.ts. The tutor round is run by an assistant
// we do not control, so everything that keeps it honest has to be true of the
// payloads *we* build, over many rounds, for every mode and every rung. Five
// claims, each cheap to state and easy to break by adding a field:
//
//   1. No question payload — in any mode but study — contains the answer to
//      the card it asks. The withholding rule (docs/mcp-tutor-spec.md).
//   2. A rung-1 payload's choices always include the answer, unmarked, and a
//      rung-2 scaffold reveals no more than the app's letter hint does.
//   3. A skip is a miss; a card missed and requeued never promotes within the
//      round (the ladder's own rule, checked through the tutor's attempts).
//   4. The round's written attempts reconstruct its summary exactly.
//   5. A learner who knows the material is graded as knowing it when they
//      *say* it — the spoken layer never marks a right answer wrong.

import {
  acceptableAnswers,
  attemptFor,
  clueFor,
  deriveLadderState,
  gradeSpoken,
  normalizeSpoken,
  passes,
  planTutorRound,
  questionFor,
  studyCardFor,
  summarizeRound,
  type Attempt,
  type ItemMastery,
  type QuizCard,
  type QuizDeck,
  type TutorMode,
} from '@whizzo/shared'
import { richToPlain } from '@whizzo/shared/rich'

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) return
  failures += 1
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

// --- Material ------------------------------------------------------------------

const TERMS: Array<[string, string]> = [
  ['Powerhouse of the cell', 'Mitochondria'],
  ['Packages proteins', 'Golgi apparatus / Golgi body'],
  ['Controls the cell', 'Nucleus'],
  ['Makes proteins', 'Ribosome'],
  ['Site of photosynthesis', 'Chloroplast'],
  ['Holds the cell together', 'Cell membrane'],
  ['Fluid inside the cell', 'Cytoplasm'],
  ['Stores water in plant cells', 'Vacuole'],
  ['Breaks down waste', 'Lysosome'],
  ['Three quarters as a decimal', '0.75'],
  ['Twelve times twelve', '144'],
  ['A half plus a quarter', '$\\frac{3}{4}$'],
]

const deck: QuizDeck = {
  id: 'deck1',
  title: 'Cells and a little maths',
  description: '',
  tags: [],
  cards: TERMS.map(([term, definition], i) => ({
    id: `c${i}`, term, definition, hint: null, difficulty: 2,
    example: `In class we said ${definition.split('/')[0]!.replace(/\$/g, '')} when we meant "${term.toLowerCase()}".`,
    explanation: `${definition.split('/')[0]!.replace(/\$/g, '')}: ${term.toLowerCase()}.`,
  })),
  source: 'user',
  termLabel: 'Term',
  definitionLabel: 'Definition',
  createdAt: 0,
  updatedAt: 0,
}

/** How a learner who knows a card would *say* the answer. */
function spoken(card: QuizCard, random: () => number): string {
  const answer = card.definition.split('/')[0].replace(/\$/g, '').trim()
  const plain = answer.startsWith('\\frac') ? 'three quarters' : answer
  const dressings = [
    (a: string) => a,
    (a: string) => `um, ${a}`,
    (a: string) => `I think it's ${a}`,
    (a: string) => `${a}?`,
    (a: string) => `the ${a}`,
    (a: string) => `The answer is ${a}.`,
  ]
  const spokenNumber: Record<string, string> = { '0.75': 'zero point seven five', '144': 'a hundred and forty four' }
  const said = spokenNumber[plain] ?? plain
  return dressings[Math.floor(random() * dressings.length)](said)
}

// --- The simulation -------------------------------------------------------------

const random = rng(20260906)
const DAY = 86_400_000
let rounds = 0
let payloads = 0
let spokenChecks = 0

for (const mode of ['practise', 'test', 'review', 'study'] as TutorMode[]) {
  for (let learner = 0; learner < 12; learner++) {
    const skill = 0.3 + (learner / 11) * 0.65
    const knows = new Set(deck.cards.filter(() => random() < skill).map((c) => c.id))
    const masteryStore = new Map<string, ItemMastery>()
    const history = new Map<string, Attempt[]>()

    for (let day = 0; day < 8; day++) {
      const today = `2026-09-${String(6 + day).padStart(2, '0')}`
      const now = Date.UTC(2026, 8, 6 + day, 16)
      const plan = planTutorRound({
        mode,
        decks: [deck],
        deckId: 'deck1',
        band: 'middle',
        masteryOf: (deckId, cardId) => masteryStore.get(`${deckId}:${cardId}`),
        today,
        rng: random,
      })
      if (!plan.length) continue
      rounds += 1

      if (mode === 'study') {
        for (const p of plan) {
          const s = studyCardFor(p)
          check('study card carries the answer', s.answer.length > 0)
        }
        continue
      }

      const attempts: Attempt[] = []
      const queue = plan.map((p, i) => ({ p, index: i + 1 }))
      const requeued = new Set<string>()
      let t = now
      while (queue.length) {
        const { p, index } = queue.shift()!
        const q = questionFor(p, deck.cards, index, plan.length, random)
        payloads += 1

        // 1. The withholding rule. A choice question lists the answer among
        //    the options — that is what a choice is — so for those the check
        //    is that nothing *outside* the options carries it.
        const answer = p.card.definition
        const answerPlain = richToPlain(acceptableAnswers(answer)[0] ?? answer).trim().toLowerCase()
        const outside = q.kind === 'multiple-choice' ? { ...q, choices: undefined, say: undefined } : q
        const text = JSON.stringify(outside).toLowerCase()
        check(`no payload contains the answer (${q.kind})`, !text.includes(answerPlain), `${q.itemKey}: ${text}`)

        // 1b. A clue, when there is one, never says the answer either.
        const clue = clueFor(p.card, p.direction)
        if (clue) check('a clue does not contain the answer', !clue.text.toLowerCase().includes(answerPlain), `${q.itemKey}: ${clue.text}`)

        // 2. Choices carry the answer, unmarked; the scaffold shows one letter.
        if (q.kind === 'multiple-choice') {
          const hit = q.choices?.some((c) => richToPlain(c).trim().toLowerCase() === richToPlain(answer).trim().toLowerCase())
          check('choices include the answer', Boolean(hit), `${q.itemKey}: ${q.choices?.join(' | ')}`)
          check('choices are unmarked', !('answer' in q) && !('correct' in q))
        }
        if (q.kind === 'letter-hint') {
          const shown = (q.scaffold ?? '').replace(/[_\s-]/g, '')
          check('scaffold reveals one letter', shown.length === 1, q.scaffold)
        }

        // The learner answers, or skips one time in ten.
        const skips = random() < 0.1
        let correct: boolean
        let given: string | null
        if (skips) {
          correct = false
          given = null
        } else if (knows.has(p.card.id)) {
          given = spoken(p.card, random)
          const g = gradeSpoken(given, p.card, p.direction)
          spokenChecks += 1
          // 5. Saying a right answer is graded as right.
          check('a spoken right answer is graded right', passes(g.verdict, mode), `${given} → ${g.verdict} for ${answer}`)
          correct = passes(g.verdict, mode)
        } else {
          given = 'no idea'
          correct = passes(gradeSpoken(given, p.card, p.direction).verdict, mode)
          check('a wrong answer is graded wrong', !correct, given)
        }

        t += 4000
        attempts.push(attemptFor({ question: q, given, correct, hintsUsed: 0, at: t }, p.card, null))
        if (!correct && !requeued.has(p.card.id) && mode !== 'test') {
          requeued.add(p.card.id)
          queue.push({ p, index })
        }
      }

      // 3. Skips are misses, and the requeue never promotes within the round.
      for (const a of attempts) {
        if (a.given === null) check('a skip is a miss', !a.correct)
      }
      for (const id of requeued) {
        const key = `deck1:${id}`
        const before = deriveLadderState([...(history.get(key) ?? [])]).level
        const after = deriveLadderState([...(history.get(key) ?? []), ...attempts.filter((a) => a.itemKey === key)]).level
        check('a requeued card does not promote in the round it was missed', after <= before, `${key}: ${before} → ${after}`)
      }

      // 4. The summary is what the attempts say.
      const summary = summarizeRound(plan, attempts, (k) => masteryStore.get(k), today, 'middle')
      const firsts = new Map<string, Attempt>()
      for (const a of attempts) if (!firsts.has(a.itemKey)) firsts.set(a.itemKey, a)
      check('summary asked = distinct cards', summary.asked === firsts.size)
      check('summary correct = first-sight corrects', summary.correct === [...firsts.values()].filter((a) => a.correct).length)

      for (const m of summary.mastery) masteryStore.set(m.itemKey, m)
      for (const a of attempts) history.set(a.itemKey, [...(history.get(a.itemKey) ?? []), a])
      void DAY
    }
  }
}

// Idempotence of the spoken layer over everything the deck says.
for (const c of deck.cards) {
  const once = normalizeSpoken(c.definition)
  check('normalizeSpoken is idempotent', normalizeSpoken(once) === once, c.definition)
}

console.log('\nThe tutor round, over simulated practice\n')
console.log(`  rounds: ${rounds} · question payloads checked: ${payloads} · spoken answers graded: ${spokenChecks}\n`)

if (failures > 0) {
  console.error(`Tutor simulation failed ${failures} check${failures === 1 ? '' : 's'}.\n`)
  process.exit(1)
}
console.log('No payload leaked an answer, the requeue promoted nothing, and speech was graded as typing.\n')
