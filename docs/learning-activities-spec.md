# Learning activities — the mastery spec

**Status:** proposal · **Date:** 2026-08-29 · **Scope:** apps/web, packages/shared, apps/api, one migration

The goal this document works toward: **a grown-up loads content once and never
sets anything else up, and the learner is walked from "never seen it" to
"knows it cold" by activities the app chooses.** Everything below is in service
of that sentence.

---

## 1. What we have today

Fourteen activities across three subjects.

| Subject | Activity | Graded (`isTest`) | Checked (`verified`) | What it actually asks for |
| --- | --- | --- | --- | --- |
| Spelling | Study the List | no | — | nothing; exposure |
| Spelling | Listen & Spell | yes | yes | unaided production from audio |
| Spelling | Missing Letters | no | yes | cued recall |
| Spelling | Word Scramble | no | yes | cued recall |
| Spelling | Proofread | no | yes | recognition |
| Spelling | Spelling Test | yes | yes | unaided production |
| Quiz | Flashcards | no | **no** | self-report |
| Quiz | Learn | yes (written only) | yes | escalates recognition → production |
| Quiz | Match | no | yes | recognition |
| Quiz | Multiple Choice | no | yes | recognition, every card, nothing typed |
| Quiz | Test | yes (written only) | yes | mixed measurement |
| Typing | Lesson | yes | yes (keystrokes) | motor skill |
| Typing | Practice | no | yes | motor skill |
| Typing | Word Rain | no | yes | motor skill under pressure |

What is already excellent and must not be rebuilt:

- **One ability scale per subject**, with item difficulty on the same axis
  (`lib/adaptive.ts`). Every activity below plugs into `updateAbility` and
  `applyAttemptToMastery` unchanged.
- **Per-item spaced repetition** with immediate re-queue on a miss.
- **Per-card format escalation** — `kindFor()` in `lib/quiz/session.ts` already
  moves a single card from multiple choice → true/false → written based on its
  own mastery. This is the seed of the whole ladder in §4.
- **The evidence rules**: `isTest` (were hints shown), `verified` (did we check
  it or did the learner claim it), server-derived session counts, append-only
  attempts. Every new activity has to declare both flags honestly.
- **Assignments closed by evidence**, never ticked off.

### Where it stops short

1. **Activities are bound to a content shape, and the shape is a pair.**
   `QuizCard` is `{term, definition}`. Every activity that a K–12 learner needs
   beyond recognition and recall — sorting, sequencing, applying, explaining —
   needs a field that does not exist, so it cannot be built without asking the
   adult for more typing.
2. **The ladder is three rungs and stops below mastery.** `kindFor` tops out at
   "written once, correctly". Writing an answer once is not mastery; it is the
   entry price to the part of the ladder we do not have.
3. **The adult still picks the activity.** `ASSIGNABLE` in
   `lib/assignments/routing.ts` makes a grown-up choose subject + activity +
   target for every piece of work. Choosing between "Learn" and "Test" is a
   pedagogical decision we are outsourcing to a parent at 9pm.
4. **Coverage is 2nd–8th grade spelling, touch typing, and whatever the adult
   pasted.** Not K–12, and nothing at all for the most-drilled content in
   elementary school: math facts.
5. **Retrieval speed is recorded and ignored.** `Attempt.responseMs` is stored
   on every attempt and read by nothing. Fluency is half of mastery.

---

## 2. Two problems, stated plainly

**Problem A — the content problem.** Anything richer than a pair costs the
adult authoring time, and adults do not do authoring. The fix is not a better
editor. It is that *one paste has to yield many activities*, by deriving the
missing fields rather than asking for them.

**Problem B — the progression problem.** We have activities but no route
through them. A learner should not be picking a mode any more than a parent
should; the app knows each item's mastery, so it knows which rung each item is
on and what should be asked next.

Both are one architectural move: **separate the content from the activity, and
put a ladder between them.**

---

## 3. Non-negotiables

Carried forward from what is already built. Any activity in §9 that cannot
satisfy these does not ship.

1. **Mastered means the system watched it happen.** Self-graded work is capped
   below the mastered band and never advances a streak (`blendSelfReport`).
   New activities declare `verified` from the *mode*, server-side, exactly as
   `SELF_GRADED_ACTIVITIES` does now.
2. **Only unaided production moves ability.** Recognition updates the item, not
   the learner's level. Multiple choice never made anyone cleverer.
3. **Nothing is ticked off.** Completion is derived from a round that landed.
4. **Generated content is labeled as generated** and is reviewable. A machine
   filling in an example sentence is a convenience, not an authority.
5. **Every activity produces a parent-legible number.** If a grown-up cannot
   read the result and know what the child can do, the activity is a game.

---

## 4. The mastery ladder

The spine of the whole spec, and the thing §5 reviews hardest. Applied **per
item, not per round** — the same principle as today's `kindFor`, extended to
its full length. One set of forty items can have forty items in forty different
places, and every question still lands where that item is.

"Ladder" is the learner-facing metaphor and it is a good one: a child
understands climbing. Underneath, an item's position is **three coordinates,
not one rung**, because the review in §5 found that a single ladder conflates
three genuinely different things.

**`Attempt.askedAt` is what makes this derivable.** A mode is a container — a
round of Learn asks each card at whatever rung that card is on — so `activity`
alone does not say what happened, and a scaffolded question inside Learn would
read back as unaided recall and promote an item on evidence that does not
exist. Every attempt records the rung it was actually asked at; attempts from
before the ladder fall back to the mode's own rung, which is what those rounds
meant at the time.

### Axis 1 — retrieval support (the rungs a learner sees)

How much scaffolding the retrieval gets. This is a real continuum and it is the
one the planner walks.

| # | Level | The question it answers | Moves ability? |
| --- | --- | --- | --- |
| 0 | **Encounter** | Have they met it? | no |
| 1 | **Recognize** | Can they pick it out from among others? | no |
| 2 | **Recall (cued)** | Can they produce it with a scaffold? | no |
| 3 | **Recall (free)** | Can they produce it from nothing? | **yes** |

Levels 0–2 are *practice*: they build the item's mastery and its review
schedule, they do not move the learner's level. Level 3 is *evidence*. This is
the existing `isTest` rule, restated as a curriculum rather than as a per-mode
flag.

### Axis 2 — transfer (a parallel track, not a higher rung)

Can they use it somewhere new? **Apply is not "above" free recall** — that was
the original spec's mistake. A learner can apply a concept they cannot yet
name, and for conceptual material working an application *before* the label
often beats drilling the label first. So transfer is a flag an item carries,
worked alongside the support axis rather than after it, and it moves ability in
its own right.

### Axis 3 — durability (a schedule state, not an achievement)

Does it survive delay? Retention is not a harder thing you do; it is the same
thing done later. It belongs on the schedule, not on the ladder, and it is what
the Checkpoint measures.

### The rules that make it work

- **Promotion needs two corrects at the current level, on two different days,
  at least one after a real delay.** Two rungs of agreement, spaced.
- **A within-round requeue never promotes.** An item missed and asked again
  four cards later is *massed* practice — valuable for fixing the error, worth
  nothing as evidence of durable retrieval. It restores the item, it does not
  advance it. Without this rule the requeue policy quietly manufactures
  promotions, which is the most likely way this ladder gets silently wrong.
- **One miss spends the banked evidence; two misses running cost a rung.**
  Originally this demoted on every miss, and the ladder simulation showed why
  that is wrong: an item practiced at the learner's frontier is *meant* to be
  missed sometimes, and if one miss both wipes the progress and drops the rung,
  the item ping-pongs — a learner answering 90% correctly never reaches free
  recall at all. So a miss always costs the banked corrects, and the rung only
  moves on a second consecutive miss with nothing right in between. Dropping to
  the bottom is never on the table: a lapse is a lapse, not amnesia.
- **Nothing skips level 3.** An item can *arrive* at level 3 by testing out —
  answered right, first time, unaided — but it cannot pass it. Free production
  is load-bearing, and it stays in rotation after transfer work begins rather
  than being retired by it.

Existing activities map on directly, which is the evidence that this describes
the app we already have rather than a new one: Study = 0, Proofread and Match =
1, Missing Letters and Scramble = 2, Listen & Spell, Test and the written half
of Learn = 3.

---

## 5. Pedagogy review

A design review of §4 and §9 against the learning-science literature. Not a
systematic review — findings are named so they can be checked, and where the
evidence is thin or contested it says so.

### What holds up

The core of this design sits on the two best-evidenced findings in the field,
and it sits on them almost by accident, because the app was built that way
before anyone wrote this down.

| Principle | Where it lives | Standing |
| --- | --- | --- |
| **Retrieval practice** (testing effect) — retrieving beats re-studying, by a lot | the entire ladder; every activity is a retrieval attempt | Roediger & Karpicke 2006; rated **high utility** in Dunlosky et al. 2013 |
| **Distributed practice** — spacing beats massing | `lib/adaptive.ts` interval ladder | Cepeda et al. 2006 meta-analysis; also **high utility** in Dunlosky |
| **Free recall beats elaborative study** | `brain-dump` | Karpicke & Blunt 2011 — retrieval practice outperformed concept mapping |
| **Generation effect** — producing beats recognizing | levels 2→3, and the rule that nothing skips level 3 | Slamecka & Graf 1978 |
| **Desirable difficulties** — harder-feeling practice retains better | escalation, and scoring against prediction rather than a flat 90% | Bjork |
| **Interleaving** | Today's Mix, and the capped review proportions | Rohrer & Taylor 2007; strongest for confusable categories |
| **Immediate corrective feedback on factual material** | requeue-on-miss, the `close` grade | well supported for facts; the picture is murkier for complex tasks |
| **Self-explanation** | `explain` | Chi et al. 1994 |
| **Automaticity frees working memory** | `speed-recall`, math facts | strong for foundational skills — decoding, number facts |

Two of the app's existing decisions are better than they look. **Scoring
against the model's own prediction** rather than a fixed bar is a defensible
implementation of desirable difficulties: it means a learner working at their
frontier is not punished for working at their frontier. And **capping review at
40% of a round** avoids the demoralisation spiral that pure error-driven
scheduling produces.

### What needs fixing

Nine findings, in order of how much damage they do if left.

**1. The single ladder conflated three axes.** Levels 1–3 are all the same
cognitive operation — retrieving a paired associate — at different levels of
cueing. That is a *retrieval-support continuum*, not a hierarchy of knowledge.
Apply is a genuinely different operation, and Retain is a property of the
schedule. Treating all six as one ladder implied that application comes after
free recall (often false) and that retention is something you climb to (it is
not). **Fixed in §4** — three coordinates, and Apply runs parallel.

**2. Within-round requeues would have manufactured promotions.** The requeue
policy brings a missed card back four places later; under "two corrects at this
level" that second correct is massed practice minutes after the first, and it
would have promoted the item. This is the single most likely way the ladder
gets quietly wrong, because it fails in the direction of flattering numbers.
**Fixed in §4** — a requeue restores, it never advances.

**3. Multiple choice can teach the wrong answer.** The negative suggestion
effect: exposure to plausible distractors makes them more likely to be recalled
as true later, especially without corrective feedback (Roediger & Marsh 2005).
Our distractors are *deliberately plausible*, which is right for discrimination
and wrong for anything left uncorrected. Three mitigations, all cheap:

- corrective feedback is mandatory after every multiple-choice item, never
  optional and never skippable by tapping through;
- **an item is never left at level 1 as its last experience of a session** —
  if it is asked as multiple choice, it comes back cued or free before the
  round ends, or on the next one;
- misconception-shaped distractors belong in `find-the-error`, where the
  learner's job is to reject them explicitly, not in a stem where they sit
  unlabeled as one of four.

**4. Mastery is claimed before it has been tested at delay.** "Two correct on
two different days" can mean forty-eight hours. Retention at three weeks is the
claim a parent will read into the word, and two days does not support it.
**Recommendation:** split the claim honestly — an item is **learned** when it
meets the §13 criterion, and **mastered** only once it has survived one
retrieval at a 7+ day gap. The Checkpoint already computes the second; this
just stops the word being spent early. It costs nothing but a rename and it is
the difference between a defensible report and an optimistic one.

**5. Timed activities carry a real cost, and it is not evenly distributed.**
Speed pressure raises anxiety, and the math literature specifically implicates
timed drill in the development of math anxiety (Boaler; Ramirez et al.), with
the largest effect on the learners who are already struggling — the exact
population this product exists for. Fluency is still worth measuring.
**Recommendation:** `speed-recall` reports fluency but **never gates mastery,
never gates a reward criterion, and is never the only route to any goal.** Timed
rounds stay opt-in below the `middle` band, which §10 already sets. Response
time informs promotion as a tiebreaker only — never as a requirement.

**6. Card difficulty is estimated from production load, not from difficulty.**
`estimateDifficulty()` reads answer length, word count and numerals. That is a
reasonable *prior* and a poor *posterior*: it says a long answer is hard, when
what makes an item hard is usually conceptual. Meanwhile the engine holds the
one thing that would actually answer the question — how often learners get it
wrong. **Recommendation:** treat the current estimate as a starting value and
let observed response data move an item's difficulty over time, per learner at
first and across learners later. This is ordinary item-response calibration,
the engine is already shaped for it, and it would improve every planning
decision downstream.

**7. Transfer is asserted, not designed.** One novel scenario per item is not
transfer; it is a second exemplar. The literature is consistent that transfer
needs **variability of practice** and **contrasting cases** — the same idea met
across genuinely different surface contexts, and near-miss cases compared
side by side. **Recommendation:** `apply` should draw from a *rotating* pool of
contexts rather than one stored second example, and a `compare` activity —
two items side by side, "what is the difference?" — is worth more for
conceptual sets than anything currently in the catalog. Add it to §9.

**8. Feedback is corrective, not explanatory.** Showing the right answer is the
weakest useful feedback there is. Explanatory feedback — *why* that answer, why
not yours — reliably beats it. Our cards have no field for it. **Recommendation:**
`explanation` joins the optional fields in §7, filled by Tier 2 enrichment
where the adult has not supplied one, and shown after a miss rather than after
every answer.

**9. Children are poor judges of their own knowing.** Metacognitive calibration
is weak in children and worst in the least skilled. This is a stronger argument
against self-graded flashcards than the reward argument already in the spec:
the problem is not only that "Got it" inflates mastery, it is that it lets the
learner **stop studying something they cannot do**. The existing cap handles the
accounting; it does not handle the study decision. **Recommendation:** an item
self-graded "Got it" is asked again in a *checked* format before the round ends.
The learner's judgement decides the pacing, the app decides what counts.

### Two things this spec still does not do

Named so nobody thinks they were considered and solved.

- **Nothing here teaches.** Every activity is retrieval, and retrieval assumes
  the material was encountered somewhere — a lesson, a class, a book. That is a
  legitimate product boundary (this is practice software, and practice software
  that pretends to be a curriculum is worse at both), but it should be a stated
  boundary rather than an accident. The `explanation` field in finding 8 is the
  smallest useful step across it.
- **No misconception repair.** Some material is not unknown, it is known wrong,
  and conceptual change needs the wrong idea confronted directly rather than
  the right one repeated. `find-the-error` is adjacent to this; a real
  treatment would pair a misconception with its correction and re-test the pair.
  Worth a phase of its own eventually; out of scope here.

---

## 6. Choice, modality, and the learners we actually have

The requirement — *learners should be able to pick the activity that suits
them, and the range should cover very different kinds of learner* — is right,
and this section delivers it. One part of the usual framing has to change,
because the mechanism does not work and building on it would cost real quality.

### On learning styles

The idea that learners have a style (visual / auditory / kinesthetic) and learn
better when instruction is matched to it is called the **meshing hypothesis**,
and it is one of the most tested and most consistently unsupported claims in
education research. The experiment is straightforward — sort learners by
preferred style, teach half in their style and half against it, test everyone —
and when it is run properly the interaction does not appear (Pashler, McDaniel,
Rohrer & Bjork 2008; Willingham et al. 2015; Kirschner 2017). What survives is
that people have real *preferences*. What does not survive is that matching
them improves learning.

Two reasons not to build it anyway, beyond it not working:

- **It would make the product worse.** A learner labeled "visual" who is
  steered away from writing answers from memory has been steered away from the
  single most effective thing in this app. The label becomes a reason to avoid
  the practice that works.
- **Labels stick to children.** A parent-facing product that tells a family
  their nine-year-old "is an auditory learner" has handed them a story about
  their child that no evidence supports and that the child may carry for years.

So: **no style diagnostic, no style label, no style-based routing.** What
replaces it is better, and it is three separate things that were being asked
for under one name.

### Replacement 1 — modality belongs to the content, not the learner

Matching presentation to *material* is well supported (Paivio's dual coding;
Mayer's multimedia work). A diagram is visual because the content is spatial. A
pronunciation is auditory because the content is sound. Phonics is auditory
because that is the skill. None of that depends on who is looking.

So the catalog should cover modalities **because content needs them**:

| Modality | Serves | Activities |
| --- | --- | --- |
| Verbal / read | most factual content | write, cloze, first-letter, word-bank |
| Auditory | phonics, pronunciation, languages, pre-readers, dyslexia | listen-write, audio prompts on any activity, read-aloud |
| Visual / spatial | anatomy, maps, geometry, diagrams | label, sequence, sort |
| Manipulative | early literacy and numeracy, dysgraphia | tiles, drag-sort, sequence |

That is the same coverage a style-based design would have produced, arrived at
for a reason that holds.

### Replacement 2 — choice within a rung

This is the mechanism for the actual request, and it is one line:

> **The planner chooses the rung. The learner chooses the activity.**

Each retrieval-support level offers two to four activities that are
pedagogically equivalent at that level. The Mastery Path decides an item needs
level 2 work; the learner picks whether that is Fill the Blank, Starts With, a
Word Bank or letter tiles. Autonomy over *how* is the part that motivates —
self-determination theory puts autonomy alongside competence and relatedness as
a basic need, and it is one of the better-supported motivational findings — and
none of it costs any pedagogical ground, because the options are equivalent by
construction.

The rule that keeps it honest: **choose the road, not the destination.** You can
pick how you produce an answer from memory. You cannot pick not to.

Four supporting rules:

1. **Preference is a ranking bias, not a lock.** A chosen activity floats to the
   top of the menu next time; it never becomes the only thing offered.
2. **Enforce variety anyway.** No single activity exceeds ~60% of a learner's
   rounds. Variability of practice is itself beneficial, and a
   preference-only diet narrows into exactly the rut the style framing would
   have prescribed deliberately.
3. **The grown-up can constrain the menu** — no timed activities, no typing,
   audio always on. That is the accommodation surface, and calling it an
   accommodation rather than a style is both honest and more useful, because
   accommodations are specific and reviewable.
4. **Choosing is one tap and skippable.** A learner who does not want to choose
   presses Continue and the planner picks. Offering a choice must never become
   a decision tax on the child who just wants to get on with it.

### Replacement 3 — the differences that are real

Style is not an individual difference worth adapting to. These are, and each one
has a concrete handle in this spec:

| Difference | Why it matters | What we do |
| --- | --- | --- |
| **Prior knowledge** | the largest single predictor of what to do next; scaffolding that helps a novice actively harms an expert (expertise reversal effect, Kalyuga) | the entire ladder — this is what per-item placement *is* |
| **Reading level** | a vocabulary quiz a child cannot read is a reading test with a vocabulary score | audio-first below `growing`, plain-language definitions, reading level as a field on sets |
| **Working memory** | prompt and answer competing for the same limited space | batches of 5–7, prompt stays on screen while answering, no multi-step instructions |
| **Language background** | an EAL learner may know the concept and not the English word | `close` grading already forgives form over substance; term/definition direction can be reversed |
| **Dyslexia** | typing and timed reading both tax the deficit, not the target | tiles input, audio prompts, no timers, never penalize spelling on a non-spelling subject |
| **Dysgraphia** | producing text is the barrier, not knowing the answer | tap and tiles input on every activity that would otherwise require typing |
| **ADHD** | sustained attention, not capability | short rounds with visible ends, immediate feedback, no infinite queues — mostly already true |
| **Attitude to failure** | the child who most needs this app has the most experience of failing at it | prediction-relative scoring, capped review, no round that can be failed below `growing` |

That table is what "covering a wide array of learners" should mean. It is
harder than a style quiz and it is the version that works.

### What this changes elsewhere

- §9 gains a `compare` activity (finding 7) and an `explanation` field appears
  in §7 (finding 8).
- §11's criteria may not be gated on timed activities (finding 5).
- §13 splits **learned** from **mastered** (finding 4).
- §12's round assembly gains the activity chooser, and the Mastery Path's
  "Continue" button becomes "Continue" plus a quiet "or pick how".
- Stage 2 gains the choose-within-a-rung menu; it is small, and it is the part
  of this spec a learner will notice first.

## 7. The item model — one paste, many activities

`QuizCard` gains optional fields. Every one is nullable, every existing deck
keeps working, and `decks.cards` is `jsonb` so **there is no migration for the
content itself**.

```ts
// packages/shared/src/progress.ts
export interface QuizCard {
  id: string
  term: string
  definition: string
  hint: string | null
  difficulty: number

  // --- enrichment: all optional, all unlock activities ---
  /** Bucket this item belongs to. Unlocks Sort and Odd One Out. */
  category?: string | null
  /** A sentence or scenario using the term. Unlocks Cloze, Apply, Use It. */
  example?: string | null
  /** Position in an ordered set. Unlocks Sequence. */
  order?: number | null
  /**
   * Photographs and recorded audio only. Anything drawable — charts, shapes,
   * number lines, geometry — is a `[[figure {…}]]` inside the text instead,
   * per docs/card-formatting.md. Two ways to carry a diagram would be one too
   * many, and the figure is the better one: it is data, it is describable, and
   * it is generable.
   */
  media?: { kind: 'image' | 'audio'; url: string; alt: string } | null
  /** How the answer is graded. Default 'text'. */
  answerKind?: 'text' | 'numeric' | 'set'
  /** Numeric answers only: acceptable absolute error. */
  tolerance?: number | null
  /** Beyond the '/' and ';' splitting acceptableAnswers() already does. */
  altAnswers?: string[]
  /** Why the answer is the answer. Shown after a miss — see §5, finding 8. */
  explanation?: string | null
  /** Which fields were machine-derived, so the UI can say so. */
  generated?: string[]
}
```

### The capability matrix

One function decides everything downstream:

```ts
// apps/web/src/lib/activities/capability.ts  (new)
export type Availability = 'ready' | 'partial' | 'locked'

export function availableActivities(
  set: QuizDeck,
): Array<{ activity: ActivityKey; status: Availability; reason: string }>
```

`partial` means the activity can run on some items but not all — a set where
nineteen of forty items have a category can still play Sort, on nineteen. This
is what lets enrichment be incremental instead of a gate.

### Capability is a function of the text, not only of the fields

Card text is not plain text. Since `docs/card-formatting.md`, `$…$`,
`$$…$$`, `<math>…</math>` and `[[figure {…}]]` all mean something — so
`availableActivities()` reads `parseRich()` from `packages/shared/src/rich/`
as well as the optional fields above.

**The rule that has to be right first time**, because getting it wrong shows a
broken question to a child:

> An activity that manipulates the *characters* of the answer is **locked**
> when the answer side contains math or a figure.

That is `scramble`, `first-letter`, `missing-letters` and letter tiles.
`$\frac{3}{4}$` scrambled is not a puzzle, it is nonsense, and `M______` on a
figure answer means nothing. Those activities degrade to `choose` or `write`,
which are both fine on a math card.

The converse unlocks something: a card carrying a `[[figure]]` can play
`label`, which is the only activity that *requires* one.

Capabilities are computed on save and stored with the set, never recomputed on
render. Plain text costs `parseRich()` one regex test, but forty cards × every
screen is still work nobody needs to do twice.

The matrix is shown in exactly two places: on the set's page as *what this set
can do* (learner-facing, as unlockable activities), and in the assign flow as
*what you can set* (adult-facing). Nowhere else does any screen hardcode a list
of activities again.

### Degradation, not refusal

Every new activity declares a fallback, the way `buildQuestion` already falls
back from multiple choice to written on a three-card deck. Sequence with no
`order` becomes Match. Sort with no `category` becomes Odd One Out on tags, and
if there are no tags, Choose. **No activity is ever unavailable; it degrades to
the nearest thing the content supports.** The adult never sees an error about
their content, only a quieter version of the same lesson.

---

## 8. Enrichment — filling the fields nobody wants to type

Two tiers, and the split matters commercially as well as technically.

### Tier 1 — deterministic, offline, ships with the client, free

Runs on import and on every save. Costs nothing, works in guest mode.

| Field | Derived from | Already exists? |
| --- | --- | --- |
| `difficulty` | answer length, word count, numerals | yes — `estimateDifficulty` |
| distractors | nearest-length answers in the same set | yes — `buildChoices` |
| misspellings | real error patterns | yes — `MISSPELL_RULES` |
| cloze blank | `example`, else the definition with the term masked | yes — `maskWordInSentence` |
| `order` | the row order of the paste, when rows are numbered or dated | new, trivial |
| `category` | the paste's section headings, or a leading `Group:` prefix | new, trivial |
| `answerKind` | answer parses as a number → `numeric` | new, trivial |
| audio | `speechSynthesis` | yes — `lib/spelling/speech.ts` |

Tier 1 alone unlocks Cloze, First Letter, Word Bank, Odd One Out (on tags),
Speed Recall, Brain Dump and Mastery Check on **every deck that already
exists**, with no adult action whatsoever. That is the cheapest large win in
this document.

### Tier 2 — assisted, server-side, metered

A single API endpoint, `POST /content/enrich`, that takes a set and returns
proposed field values. It writes `generated: ['example', 'category']` onto each
card it touched.

Uses, in value order: example sentences and scenarios (unlocks Apply, Cloze and
Use It on any vocabulary set), categories (unlocks Sort), a second scenario per
item for transfer, and plain-language definitions for a lower reading level.

Three rules on this, which are the product's credibility:

1. **Nothing generated is graded as fact without review.** A generated example
   is a prompt; a generated *answer* is not accepted. Enrichment never touches
   `term`, `definition`, `altAnswers` or `tolerance`.
2. **The adult sees a review screen** with everything proposed, accept-all or
   line-by-line — but the content is usable before they open it.
3. **Generated fields are visibly marked** wherever a grown-up looks at them.

This is also the natural home for the other zero-setup path: **"give me a set
about X"**, which produces a reviewable draft set from a topic and a grade. Same
endpoint, same review screen, same provenance marking.

### Tier 0 — generated banks, no content at all

Some of the most-practiced K–12 content should never be pasted by anyone
because it is a rule, not a list. Ship these as **generators** that emit items
on demand with difficulty computed from their parameters:

- **Math facts** — addition, subtraction, multiplication, division across
  ranges. Difficulty from operand size and carry/borrow. Forty facts a family
  would otherwise type by hand, generated exactly.
- **Sight words** by grade (Dolch/Fry), for K–2 reading.
- **Number bonds, place value, time, money, fractions** as they follow.

A generated bank is a `QuizDeck` from the app's point of view — same mastery
keys (`deckId:cardId` with a stable derived id, the way `starterDecks.ts`
already does it), same schedule, same activities. **This is the single largest
coverage gain per unit of work in this spec**, and it needs no importer, no
enrichment and no adult.

---

## 9. The activity catalog

New activities, by ladder stage. Each declares the fields it needs, its two
evidence flags, and its fallback. `verified: no` means the app cannot check the
answer and the attempt is recorded as unverified — capped mastery, no streak,
no reward eligibility, per §3.

### Stage 1 — Recognize

**`odd-one-out` — Odd One Out**
Four items, three from one category, one from another; pick the intruder.
*Needs:* `category` on ≥4 items across ≥2 categories, or tags.
*Graded:* no. *Checked:* yes. *Falls back to:* `choose`.
*Why it earns a place:* it tests the boundary of a category, which recognition
of a single item never does. It is also the first activity a five-year-old can
do without reading much.

**`sort` — Sort It**
Drag or tap items into 2–4 labeled buckets. Six to twelve items a round.
*Needs:* `category`. *Graded:* no. *Checked:* yes. *Falls back to:* `odd-one-out`.
*Why:* categorization is how a learner builds structure rather than a list of
facts, and it is the natural home for parts of speech, classification, sorting
by operation, era, or region. Also the most engaging activity on a touch screen.

**`find-the-error` — Spot the Mistake**
A statement is shown; is it right, and if not, what is wrong with it. The
general form of the existing Proofread, which stays as the spelling-specific
version because `MISSPELL_RULES` is better than anything generic.
*Needs:* nothing — the wrong version is built from `buildChoices`.
*Graded:* no. *Checked:* yes. *Falls back to:* `true-false`.
*Why:* evaluating a claim is harder than picking one, and it is the format
kids meet most in school assessments.

### Stage 2 — Recall with a scaffold

**`cloze` — Fill the Blank**
The item's example sentence with the answer removed, typed back in.
*Needs:* `example`, else the definition with the term masked.
*Graded:* no (a scaffold is showing). *Checked:* yes. *Falls back to:* `first-letter`.
*Why:* context recall is measurably closer to real use than isolated recall,
and the existing `maskWordInSentence` means it is nearly free to build.

**`first-letter` — Starts With…**
Free typing with the first letter and the answer's shape shown (`M______`).
*Needs:* **nothing at all.** *Graded:* no. *Checked:* yes. *Falls back to:* n/a.
*Why:* this is the missing rung. Today a card goes from four-way choice
straight to blank-page production, and a learner who is not ready fails at a
format rather than at the content. Zero content cost, immediate value on every
existing deck.

**`word-bank` — With a Word Bank**
Free typing with every answer in the round listed off to the side.
*Needs:* nothing. *Graded:* no. *Checked:* yes.
*Why:* the same rung as First Letter for items whose answers are phrases.

**`sequence` — Put It In Order**
Drag 4–7 items into the right order.
*Needs:* `order`. *Graded:* no. *Checked:* yes. *Falls back to:* `match`.
*Why:* nothing we have can test a process, a timeline, or an order of
operations, and those are a large share of what school actually assesses in
science and history.

**`label` — Label It**
A figure with its labels stripped off; drop them back on.
*Needs:* a `[[figure {…}]]` on the card. *Graded:* no. *Checked:* yes.
*Falls back to:* `match`.
*Why:* this was specced as an image with hand-placed hotspots — the one
activity that genuinely required new authoring. The figure work removed that:
`triangle`, `polygon`, `circle`, `angle` and `numberline` already carry their
labeled vertices, sides, angles and points, and the renderer already knows
where each one lands. Hiding them and asking for them back is nearly free, and
it works on any card with a figure, including every generated one. Geometry,
number lines, and charts with labeled axes all come along at once.

### Stage 3 — Free recall

**`speed-recall` — Rapid Fire**
Free written recall against a clock; the round ends on time, not on count.
Scored on items retired per minute alongside accuracy.
*Needs:* nothing. *Graded:* **yes.** *Checked:* yes.
*Never gates anything* — not mastery, not a reward criterion, and never the
only route to a goal. Timed drill carries a real anxiety cost that falls
hardest on struggling learners (§5, finding 5).
*Why:* fluency is the difference between knowing something and being able to
use it, and `Attempt.responseMs` is already recorded on every attempt and
currently read by nothing. This activity is mostly a matter of *using data we
already collect*. It also gives the ability estimate a second axis — a learner
answering correctly in 1.2s is not at the same place as one taking 9s, and the
current model cannot tell them apart.

**`brain-dump` — Everything You Know**
One prompt for the whole set ("List every state capital you can"), a text area,
and a timer. Scored by matching what was written against the set's answers with
the existing `gradeWritten` tolerance.
*Needs:* nothing. *Graded:* **yes.** *Checked:* **yes** — this is the surprise:
free recall of a whole set is fully machine-checkable, because we hold the
answer key. Each matched answer is one correct attempt; each unmatched item is
a miss, which drops it straight back into the schedule.
*Why:* unprompted free recall is the strongest retrieval-practice format there
is and the one no flashcard app offers, because most of them do not hold a
closed answer set. We do. **This is the highest-value new activity in this
document per line of code.**

### Stage 4 — Apply

**`apply` — Where Does This Fit?**
A scenario the learner has not seen paired with this item; name the concept it
demonstrates.
*Needs:* a second `example`, so realistically Tier 2 enrichment.
*Graded:* yes. *Checked:* yes (the answer is still a known term).
*Falls back to:* `cloze` on the first example.
*Draws from a rotating pool of contexts*, not one stored second example — one
extra exemplar is not transfer (§5, finding 7).
*Why:* it is the first activity that distinguishes memorizing from
understanding, which is the thing a parent paying for this actually wants.

**`compare` — What's the Difference?**
Two items side by side; say what separates them.
*Needs:* two items sharing a `category`. *Graded:* yes. *Checked:* yes.
*Falls back to:* `odd-one-out`.
*Why:* contrasting cases are one of the few reliable routes to transfer, and
nothing else in the catalog produces them (§5, finding 7). It is also the
activity that catches the learner who has memorized two definitions without
noticing they describe different things — which is most of what goes wrong on
a science set.

**`solve` — Work It Out**
A numeric or procedural answer, graded with tolerance; optionally show steps.
*Needs:* `answerKind: 'numeric'`, `tolerance`.
*Graded:* yes. *Checked:* yes.

*Half of this already exists.* `gradeWritten` projects `$\frac{3}{4}$` to what
a learner would actually type, and `acceptableAnswers` already refuses to split
`3/4` on the slash it splits `couch / sofa` on. What is left is genuinely
numeric and genuinely missing:

- **edit distance must not apply.** A transposition in a number is a wrong
  answer, not a typo — `gradeWritten`'s tolerance has to switch off entirely
  when `answerKind` is `numeric`.
- **decimal tolerance**: is `0.333` right for one third? Per-card, defaulted.
- **equivalent forms**: `0.75`, `3/4` and `75%` are one answer. Compare
  numerically after projection rather than as strings.

**`use-it` — Use It In A Sentence**
The learner writes an original sentence using the term.
*Needs:* nothing. *Graded:* **no.** *Checked:* **no** — at launch.
*Why the flags:* we can check mechanically that the word appears, is correctly
inflected, and is not copied from the example, and nothing else. That is not
enough to call the answer right, so it records as unverified, capped, and
ineligible for rewards, exactly like a flashcard self-grade. It becomes
`verified` only when assisted grading exists — and at that point it is one of
the strongest signals in the app.

**`explain` — Teach the Cat**
The learner explains the item in their own words, then compares against the
definition and grades themselves.
*Needs:* nothing. *Graded:* no. *Checked:* **no.**
*Why:* self-explanation is one of the best-evidenced study techniques, and it
costs nothing to offer. Its output is not evidence, and the app must say so —
same treatment as Flashcards.

### Stage 5 — Retain and prove

**`mastery-check` — Mastery Check**
8–10 items, no self-grading, no hints. Each item must be answered correctly
**twice, unaided, at escalating format** to be retired from the round; a miss
resets that item's progress within the round. Passing is what marks items
mastered.
*Needs:* nothing. *Graded:* **yes.** *Checked:* yes.
*Note:* this is item 5 of the agreed quiz mastery loop plan; the round queue
from item 1 (`useQuizSession`) and `requeuePolicy` are its groundwork. It is
also the gate the Mastery Path (§12) is built around, so it should be built
first of everything in this section.

**`daily-mix` — Today's Mix**
One five-minute round drawn across every set, subject and activity the learner
has due, ordered by what they are closest to forgetting. Extends
`dueAcrossDecks` from quiz-only to everything.
*Needs:* nothing. *Graded:* mixed, per item's stage. *Checked:* mixed.
*Why:* interleaving beats blocking, it is the single home-screen button that
answers "what should I do now", and it is the habit surface the whole retention
story rests on.

**`checkpoint` — Checkpoint**
A weekly, un-hinted sample of items marked mastered a while ago. Not review —
measurement. Produces the number the parent report is built on: *of what this
child was said to have mastered, how much have they kept?*
*Needs:* nothing. *Graded:* yes. *Checked:* yes.
*Why:* it is the only thing in the app that can prove the app works, and it
is the answer to the question a paying parent eventually asks.

### The early-learner layer (K–2)

Not new activities — a **rendering mode** on the existing ones, selected from
the learner's profile, never from the activity.

```ts
type InputMode = 'type' | 'tap' | 'tiles' | 'speak'
```

- `tap` — every choice-based activity gets large tap targets and no keyboard.
- `tiles` — letter or word tiles instead of a text field, so Scramble, Cloze
  and First Letter work for a child who cannot type. Free recall stays free
  recall; only the input changes.
- Prompts are read aloud automatically, every time, using existing speech.
- No timers, and no round can be failed.
- Reading load capped: sets with a `readingLevel` above the learner's show the
  plain-language definition when one exists.

`speak` (say the answer aloud, checked by speech recognition) is stage 8 and
lands unverified until confidence thresholds have been tested against real
children's voices. It is the one thing that would let a pre-writing child
produce free recall, so it is worth doing properly rather than early.

---

## 10. Engagement — the same activity, dressed for its age

Everything above is pedagogy, and pedagogy on its own gets used twice. This
section is the other half, and it is bound by the same rule the theme layer
already imposes on itself: **the fun is paint, never curriculum.**

### What already works, and must not be broken

`lib/themes.ts` is the best-designed thing in this codebase and it settled the
hard questions years before this spec:

- ten themes are one accent, one mascot, and a handful of copy strings — a verb,
  a collectible noun, level names — and nothing else;
- **earn rate is fixed across all ten**, so switching theme is never a way to
  farm easy wins;
- progress color is never the accent, so a mastery bar means the same thing in
  every world;
- grown-up surfaces are theme-free;
- ten reward screens collapse into three `RewardShape` archetypes.

Every mechanic below has to survive those five rules or it does not ship.

### Three ways the ladder collides with what exists

1. **The reward economy is round-shaped; the ladder is item-shaped.**
   `earnedFor()` counts sessions that beat their predicted accuracy, plus level
   promotions. The behaviors this spec makes valuable — an item climbing a
   rung, a batch clearing, an item surviving a Checkpoint three weeks later —
   are all invisible to it. As written, a learner could move forty items up two
   rungs each and earn nothing at all.
2. **Nothing anywhere scales with age.** The only age signal in the codebase is
   `Theme.bands`, an advisory string that reorders the picker. `feedbackLine()`
   is hardcoded at one register — *"You are a typing wizard! 🧙"* — and a
   sixteen-year-old revising for a biology exam gets it, plus confetti, plus a
   mascot, plus "Pounce in".
3. **Only typing has a play surface.** Word Rain is a real arcade game welded
   to one subject. Spelling and quiz have Match. This spec adds fourteen
   activities and describes not one of them as fun.

### The maturity band

The fix is the move the theme layer already made, applied to age. A **maturity
band** is a property of the learner, not of the theme and not of the activity:

```ts
export type MaturityBand = 'early' | 'growing' | 'middle' | 'upper'
//                          K–2      3–5        6–8       9–12+
```

It defaults from the learner's grade, is overridable by the grown-up (an
eleven-year-old who wants a Boss Battle should get a Boss Battle), and is
independent of theme — a fifteen-year-old can still pick Dinosaurs; they just
get Dinosaurs presented seriously.

**What the band changes:**

| | `early` K–2 | `growing` 3–5 | `middle` 6–8 | `upper` 9–12+ |
| --- | --- | --- | --- | --- |
| Mastery Check is called | Boss Battle | Boss Battle | Mastery Check | Mastery Check |
| Celebration | confetti, mascot, sound, ~2.5s | confetti, ~1.5s | brief accent flourish | one line of type |
| Mascot | large, reacts to every answer | at round ends | corner only | absent |
| Reward vocabulary | the theme's unit — fossils, ribbons | the theme's unit | unit plus a count | terms known, retention % |
| Score shown as | stars | stars and points | points and a personal best | accuracy, recall time, retention |
| Praise register | "Wow! You got it!" | "Nice one." | "Correct." | "Correct · 1.4s" |
| Motion | bouncy | moderate | subtle | minimal |
| Timers | never | opt-in | default on | default on |
| Round length | 5–6 items | 8–10 | 10–12 | learner sets it |

**What the band must never change:** the ladder, item difficulty, what counts
as evidence, or the earn rate. A sixteen-year-old's "340 terms known" and a
six-year-old's fossil cost exactly the same work. The moment a band changes
earn rate it has become a difficulty setting, and the whole argument that
`lib/themes.ts` makes about theme applies again word for word.

`feedbackLine()` becomes band-aware, which is a two-line change and removes the
single most age-inappropriate string in the app.

### The fourth reward shape, and the eleventh theme

`RewardShape` is `collection | journey | assembly` — three ways of arranging
*cute things you have collected*. There is no shape for a learner who does not
want cute things, which is most of the upper band.

Add **`record`**: no collectibles at all. Personal bests, terms known, recall
time trending down, retention rate, days practiced. It is a stat line, and for
a fifteen-year-old it is a better reward than a fossil because it is *evidence
about them*.

That shape needs a theme to live in: **Focus** — accent only, no mascot, no
collectible noun, `bands: '7–12'`. It is the eleventh theme and it is the one a
high-school student actually picks. Note that this costs almost nothing: the
theme layer already treats the mascot as optional (`mascotSrc?`) and the world
screen already branches on shape.

### Game shells

The second architectural move, and the same trick as `RewardShape`: **four
shells, not twenty bespoke games.** A shell is a way of presenting a round; it
consumes only what a theme already provides (accent, unit, mascot, cheer), so
every shell works in all eleven themes on day one.

| Shell | What it is | Activities it suits | Bands |
| --- | --- | --- | --- |
| `falling` | Items descend, answer to clear. **Generalized Word Rain** — the game we already built and locked to typing. | speed-recall, math facts, listen-write, cloze | early → middle |
| `board` | A grid of slots that fills as items are retired. | **brain-dump** (it *is* a slot-filling activity), sort, match, label | all |
| `track` | Advance along a path, with something waiting at the end. | mastery-check, sequence, a batch's progress | early → middle |
| `plain` | No shell. Question, answer, next. | anything | middle → upper, and the accessibility default |

The shell is chosen by **band × activity**, never by the activity alone. Same
items, same ladder stage, same evidence recorded — different clothes. A Rapid
Fire round is falling asteroids for a seven-year-old and a timer with a
personal best for a sixteen-year-old, and `attempts` cannot tell the
difference, which is exactly the property we want.

Generalizing Word Rain is the single best-value item here: it is a finished,
tested arcade loop currently reachable by one subject out of three, and
`rainWords()` is the only thing tying it down.

### What earns a reward, revisited

Three new earn events, all subject to the existing rule that a reward rests on
work the system checked:

- **A rung climbed** — a micro-moment, not a collectible. The item visibly
  moves up; that is the whole reward. Cheap, frequent, per-item, and it is what
  makes the ladder legible to the learner instead of being a thing the planner
  knows about privately.
- **A batch cleared, or a Mastery Check passed** — this is the collectible, and
  it maps onto every theme's existing vocabulary without a single new string.
  It replaces "beat the predicted accuracy" as the main earn event, because it
  is a better description of the same virtue and it is item-shaped.
- **Retention** — a Checkpoint passed 14+ days after an item was mastered.
  This should be **the rarest thing in the app**, with its own treatment in each
  shape: the gold-edged card in a `collection`, the summit in a `journey`, the
  keystone in an `assembly`, the headline number in a `record`. Nothing else in
  a children's learning app rewards *still knowing it a month later*, and it is
  precisely what a parent is paying for.

`earnedFor()` keeps its shape and its guarantees — it just reads mastery
transitions as well as sessions.

### Engagement in the upper band is competence, not confetti

For a fourteen-to-eighteen-year-old the motivating feedback is evidence of
their own competence, delivered without decoration:

> *340 terms known cold · 96% still right after 30 days · median recall 1.4s,
> down from 3.1s in March*

Every number in that line comes from data this spec already collects, and two
of the three come from `responseMs`, which we record on every attempt and
currently read nowhere. That is why Rapid Fire and the fluency work at stage 6
matter more than they look: **they are the entire reward system for older
learners.** A high schooler will not open this app for a fossil. They will open
it for a number that says they are getting faster.

### Where engagement lands

Engagement is not a stage at the end; it interleaves. Stages are from
[build-sequence.md](build-sequence.md).

- **Stage 2**, with the ladder: the maturity band and band-aware copy — the
  cheapest age fix in the app — and the rung-climb micro-moment.
- **Stage 4**, with the Mastery Path: batch-cleared as an earn event, and the
  `track` shell for the Mastery Check.
- **Stage 6**, with fluency: `falling` generalized off typing, the `record`
  shape, and the Focus theme. The same stage as `speed-recall` because for an
  older learner they are the same feature.
- **Stage 7**: the retention reward, once Checkpoints have run long enough for
  anyone to have earned one.
- **Stage 8**: the `board` shell and full early-band presentation.

### Open questions this raises

1. **Leaderboards.** A tutor with twenty students will ask. If it happens it
   must rank effort and consistency, never accuracy — a table sorted by score
   tells the child who most needs this app that they are last. Family-or-class
   scope only, opt-in, and never public.
2. **Does the band belong on the learner or on the guardian link?** A tutor and
   a parent might reasonably disagree about whether a child gets Boss Battles.
   On the learner is simpler and probably right.
3. **Do older learners want a theme at all,** or is Focus really "no theme"?
   Worth asking five actual teenagers before building the other ten variants of
   it.

## 11. Rewards — promises, evidence, and getting paid

Collectibles are the in-app payoff. This is the other kind: a grown-up promises
something real — ice cream, screen time, a dollar a book, the car on Saturday —
and needs to know when it was genuinely earned and whether they have actually
handed it over.

The hard requirement is already settled: **a reward rests on work the system
checked, never on a claim.** No self-graded answer may ever earn a payout.
Everything below is built to hold that line while a real thing of value is
attached to it.

### The one idea this is built on

There are two parties and each one can only be trusted about their own side.

- **The child's side is verified.** Whether the work was done is derived from
  attempts the app checked. Nobody taps "earned".
- **The grown-up's side is asserted.** Whether the ice cream was actually
  bought is not something software can check, ever. So fulfillment is a claim —
  and it is recorded, attributed and dated *as a claim*, exactly the way a
  flashcard self-grade is.

That symmetry is the whole design. The app already distinguishes a checked
answer from a claimed one; rewards apply the identical distinction to the adult.
A parent marking "given" is making the same kind of statement a child makes
tapping "I got it", and the record should say so with the same honesty.

### The lifecycle

```
  offered ──▶ earned ──▶ [claimed] ──▶ fulfilled
     │           │                          
     ├──▶ canceled                    └──▶ (never returns to earned)
     └──▶ expired
```

| State | Set by | Means |
| --- | --- | --- |
| `offered` | the grown-up | a promise the learner can see |
| `earned` | **derived, in the round's transaction** | the criterion was met on checked work |
| `claimed` | the learner, optional | "I'd like to cash this in" — store-style rewards only |
| `fulfilled` | **the author, by hand** | "I gave it to them" — an assertion, recorded as one |
| `canceled` | the author, or the learner's owner | withdrawn before it was earned |
| `expired` | time | an offer with an end date that was not met |

### Earning latches. This is the rule that must not bend.

Once a reward is earned it is **never un-earned** — not by erasing progress,
not by deleting the deck it was about, not by an assignment reopening, not by
the author changing their mind. A promise kept is not revocable by a database
cascade, and a child who watched an ice cream disappear because a grown-up
tidied up some sessions has learned something about this app that we do not
want them to learn.

This is deliberately the **opposite** of `reopen_assignments_for_session()`,
which reopens a task when the round that closed it is deleted. That is right
for a task — a task is a statement about work outstanding. It is wrong for a
reward — a reward is a statement about a promise coming due. The two look
similar enough that building rewards by copying the assignment trigger is the
obvious mistake, so:

- the earned row **snapshots its evidence** into `evidence jsonb` — session id,
  criterion, the counts at that moment — rather than relying on a foreign key;
- the convenience FK to `sessions` is `on delete set null`, and the snapshot
  outlives it;
- there is **no reopen trigger** on rewards. Deliberately. Write it down in the
  migration, because its absence looks like an omission.

### What can be a criterion

Every one of these is computable from evidence the app checked, and none of
them can be satisfied by self-graded work.

| Criterion | Earned when | Notes |
| --- | --- | --- |
| `assignment` | a named task closes | reuses the existing evidence chain wholesale |
| `set_mastered` | a set hits its mastery threshold | uses the strict definition in §13 |
| `mastery_count` | N items reach mastered | across a subject or one set |
| `checkpoint` | a retention Checkpoint is passed | *the good one* — see below |
| `streak` | N consecutive days with a checked round | the habit reward |
| `verified_items` | N system-checked correct answers | the blunt one; use sparingly |
| `level_up` | a promotion in a skill subject | spelling, typing, math facts |
| `minutes` | N minutes practiced | allowed, and worth a warning in the UI: time is an input, not an outcome |

**`checkpoint` is the criterion worth featuring.** A reward for *still knowing
it three weeks later* is the only one that cannot be farmed in an afternoon,
and it is the exact behavior a parent is paying for. Every other app rewards
activity; this rewards retention. Make it the suggested default and say why in
one line of UI copy.

### Anti-gaming — the rules that make a payout safe

1. **Only checked work counts.** Every criterion reads `verified_items_*` or
   attempts with `verified = true`. A flashcard round contributes nothing to
   any reward, ever.
1b. **No criterion may require timed work.** A reward that can only be earned
   under a clock puts money behind the one activity with a documented anxiety
   cost, aimed at the learners most exposed to it (§5, finding 5). Fluency is
   reportable; it is not payable.
2. **A learner cannot earn a reward on content they can edit.** This is the
   real hole and it is not obvious: `can_manage_learner_content()` deliberately
   counts a learner as able to manage their own decks, so without this rule a
   child could type a three-card deck — *cat / cat* — master it in ninety
   seconds and collect. So a reward criterion may only target **assigned
   content or built-in curriculum**: material the learner cannot author or
   edit. This mirrors exactly the `can_assign_to_learner()` versus
   `can_manage_learner_content()` split the assignment feature already makes,
   for exactly the same reason.
3. **Floors on size and difficulty.** "Master a set" on a four-item set is not
   an achievement. Criteria targeting a set require a minimum item count, and
   the UI refuses to offer a bar that is already met at the moment it is set.
4. **Recurrence is counted on the grant, not derived from sessions.** A weekly
   reward stores its own period counter, so erasing progress and redoing the
   work cannot mint a second payout. Erasing is a right; it is not a mint.
5. **Every reward has a defined maximum.** One-off, N times, or a cap per
   period. A parent must never be able to accidentally promise unbounded money.
6. **Nothing retroactive.** A reward is evaluated only against work done after
   it was offered. Setting a reward the child has already met is a mistake, not
   a gift, and the form should say so rather than paying out instantly.

### Rewards are a covered-learner feature ([billing-spec.md](billing-spec.md)):
setting a payout is grown-up leverage rather than learning, so it sits behind
coverage. One rule survives a lapse regardless — **a reward already earned is
always payable**, because coverage ending cannot un-earn a promise any more
than a deleted session can.

Two payout models

Both ship; they serve different ages and the mechanics are shared.

**Direct** — *"Master the Chapter 7 vocabulary → ice cream."* One criterion,
one payoff, concrete and immediate. The right model for K–5, where a promise
three weeks out is not motivating.

**Store** — verified work mints points; the learner spends them from a menu the
grown-up defines and prices. Better for 6–12+, because it gives the learner
agency and a budget, and because a teenager choosing between two rewards is
more engaged than one being handed a fixed prize.

The split that keeps the store honest: **the app mints, the grown-up prices.**
The mint rate is fixed — the same argument that `lib/themes.ts` makes for a
fixed earn rate across themes, and §10 makes for a fixed earn rate across
maturity bands, applies here with money attached. If a parent could tune the
rate, points would stop meaning anything and the store would become a
difficulty setting. What a parent controls is what things *cost*, which is the
lever they actually want and the one that teaches something.

Points are minted on the same events §10 defines as earning collectibles — a
batch cleared, a Mastery Check passed, a Checkpoint retained — so there is one
earn event feeding two economies rather than two systems to keep in step.

### Who can do what

| Action | Who |
| --- | --- |
| Offer a reward | `can_assign_to_learner()` — the same gate as setting work |
| Mark fulfilled | **the author only** — you settle your own promises |
| Cancel | the author, **or the learner's owner** |
| Read | everyone linked to the learner, the learner included |
| Insert / update as the learner | never |

Two of those need their reasons stated.

**Only the author can mark fulfilled**, because a tutor cannot know whether a
parent bought the ice cream and a parent cannot settle a tutor's promise. The
payer settles their own debt.

**The learner's owner can cancel anything**, including a reward a tutor set. A
parent has to be able to veto what someone else is promising their child, and
they have to be able to see it in order to veto it — so a reward set by a tutor
is visible to the family from the moment it is offered. This is the same
consent principle as `describe_connection_code()`: you get to see what you are
agreeing to.

### The ledger, and the nag

The parent-facing surface is a ledger, not a feed:

| | |
| --- | --- |
| **Promised** | offered, not yet earned — with progress toward the criterion |
| **Earned · unpaid** | the action list. This is what "check off paid" acts on |
| **Paid** | date, who marked it, and the evidence behind the earn |

Three behaviors make it worth having:

- **Marking paid is one tap** from the earned row, with an optional note. That
  is the whole interaction the feature exists for; everything else is
  bookkeeping around it.
- **The app nags about unpaid promises, and only about those.** An earned,
  unfulfilled reward is worse than no reward at all, because it teaches a child
  that the system's word is not good. After a few days the grown-up gets a
  reminder. **The child is never nagged and never chases** — the app protects
  the promise on their behalf.
- **The evidence opens.** Every earned row links to the round or the mastery
  state that earned it, the way a completed task already opens its answers.
  "Did they really?" is answerable in one tap, which is what makes the promise
  safe to make in the first place.

### By maturity band

Mechanics identical, presentation and defaults differ (§10):

| Band | Shown as | Suggested rewards |
| --- | --- | --- |
| `early` | a picture chart filling up | ice cream, a sticker, choose dinner, stay up late |
| `growing` | a progress bar and a promise card | screen time, a small toy, a trip |
| `middle` | a points balance and a store | allowance, outings, privileges |
| `upper` | a ledger with a balance | money, phone plan, car time — and their own retention stats |

### Where it lives

Following the placement principle the app already holds to — the child's home
screen is the child's, Family is the people you look after, your account is
your own things:

- **The promise** appears on the learner's home screen next to their tasks.
  Read-only, and phrased as what they are working toward.
- **The ledger and the paying** live in **Family**, on the child's row,
  alongside tasks and history. It is about a person you look after.
- **Reward templates** — a reusable menu, priced once and offered to several
  learners — live in **your account**, next to the library. Same reasoning as
  the library: it is your material, reused across the people you teach.

### Data model

Per-learner in v1, deliberately. Assignments needed the
`assignment_sets` + `assignments` split because a tutor sets one piece of work
for twenty students; a reward is a promise between two specific people, so the
same split would be complexity without a case. If shared rewards are wanted
later, the assignment migration is the known path.

```sql
-- migration 0016
create table public.rewards (
  id             uuid primary key default gen_random_uuid(),
  learner_id     uuid not null references public.learners (id) on delete cascade,
  created_by     uuid references auth.users (id) on delete set null,

  title          text not null,          -- 'Ice cream'
  note           text,
  kind           text not null,          -- 'direct' | 'store'
  cost_points    int,                    -- store rewards only

  criterion      jsonb not null,         -- { type, targetId, threshold, ... }
  max_awards     int  not null default 1,
  period         text,                   -- null | 'week' | 'month'
  awards_made    int  not null default 0,-- on the row, not derived: see rule 4
  offered_at     timestamptz not null default now(),
  expires_on     date,

  status         text not null default 'offered',
  constraint rewards_status_check
    check (status in ('offered','earned','claimed','fulfilled','canceled','expired')),

  earned_at      timestamptz,
  -- Snapshot, not a pointer. Survives the session it came from.
  evidence       jsonb,
  session_id     uuid references public.sessions (id) on delete set null,

  fulfilled_at   timestamptz,
  fulfilled_by   uuid references auth.users (id) on delete set null,
  fulfilled_note text,

  -- Earned means evidence exists. Fulfilled means somebody said so, and we
  -- record who: the adult's assertion is attributed exactly like a learner's.
  constraint rewards_earned_has_evidence
    check (status = 'offered' or status = 'canceled' or status = 'expired'
           or (earned_at is not null and evidence is not null)),
  constraint rewards_fulfilled_is_attributed
    check (status <> 'fulfilled' or (fulfilled_at is not null and fulfilled_by is not null))
);
```

Plus `award_matching_rewards(p_learner_id, p_session_id)` — definer, called in
the same transaction as `complete_matching_assignments()`, evaluating every
`offered` reward for that learner against checked evidence and latching the
ones that are met. **No `before delete` trigger on sessions.**

A `reward_points` balance, minted by the same function, for store rewards.

### The two gaps this inherits

The rewards memo already names them; a payout makes them urgent rather than
theoretical.

1. **Flashcard rounds still award stars and points off self-grades.** That is a
   payout surface with no verification behind it, and it must be closed before
   any points economy ships: a flashcard round mints zero points and advances no
   criterion. It can still award nothing but encouragement, which is what it is
   for.
2. **The server checks how an answer was given, not whether it was right.** For
   rewards this is mitigated rather than solved: criteria rest on mastery, which
   needs repeated checked answers across separate days, so a modified client
   would have to sustain a lie over time rather than post one good round. The
   real fix is server-side answer keys — and the Tier 0 generators (§8) are the
   first content the server can regenerate and re-grade on its own, which makes
   them the natural place to prove that pattern.

### Where rewards land

Rewards slot in after the evidence they depend on exists. Stages are from
[build-sequence.md](build-sequence.md).

- **Stage 5** — the `rewards` table, direct rewards, the `assignment`,
  `streak`, `set_mastered` and `mastery_count` criteria, the ledger, marking
  paid, and the unpaid reminder. Coverage already exists by then (stage 0.5),
  so the gate is one predicate. **Close the flashcard points hole here** — it
  is a payout surface with no verification behind it.
- **Stage 7** — the points economy and the store, alongside the generated
  banks, plus reward templates in your account.
- **Stage 8** — the `checkpoint` criterion, once Checkpoints have run long
  enough for one to be earnable. Then make it the suggested default.

## 12. The Mastery Path — the part that removes the setup

This is the answer to "load content, select different activities for mastery"
and it is the feature, not the catalog. Everything in §9 is machinery for it.

Today a grown-up assigns **an activity on a target**. Instead they should assign
**a goal on a set**:

> *Ava · Chapter 7 Vocabulary · master it · by Friday*

The Mastery Path then runs the whole thing:

**1. Placement.** First round is a short mixed check across the set, at stages
1 and 3, to find out what the learner already knows. Items answered correctly
and unaided start at stage 3, not stage 0. The engine already does this for
spelling (`planPlacement`); this generalizes it to any set.

**2. Batching.** Items are introduced in batches of five to seven, not forty.
A batch is worked up the ladder together until most of it reaches stage 3;
only then does the next batch open. Today's planner takes twelve items off a
forty-item deck and the learner meets everything at once, badly. Batching is a
small change to `planStudy` with a large effect.

**3. Activity selection.** Each round is assembled item by item: every item's
ladder stage picks the activity, the capability matrix (§7) picks the best
available variant, and the round is shuffled so it does not open with six
review items. This is exactly what `kindFor` does today, with a longer ladder
and a wider catalog.

**4. Round shape.** A round is 8–12 items and 5–10 minutes, mixing:

| Share | What |
| --- | --- |
| up to 40% | due review, oldest and most-lapsed first |
| ~40% | the current batch, at whatever stage each item is on |
| the rest | maintenance on mastered items, and one stretch item |

The proportions are capped, not fixed — same rule as the spelling planner, for
the same reason.

**5. The readiness gate.** When most of the current batch has reached stage 3,
the path offers the **Mastery Check**. It is not offered before then, so it is
never a round the learner is set up to fail.

**6. Completion.** The goal closes when the mastery criterion in §13 is met,
with verified evidence. This is the one place the existing model needs a real
change: `complete_matching_assignments()` closes a task when a session lands
matching subject + activity + target. A goal is not closed by *a session*; it
is closed by a *state*. So:

- goal assignments carry `activity = 'mastery-path'` and a `goal` column
  (`mastered_fraction`, default 0.9);
- the same transaction that records a round re-evaluates mastery for the target
  set and closes the assignment when the fraction is met — still derived, still
  in one transaction, still storing the session id that tipped it over as
  evidence. **Nobody ticks anything off; that rule does not bend.**

**7. What the adult sees.** One line: *Ava · Chapter 7 · 23 of 40 mastered ·
on track for Friday · last practiced yesterday.* Not a list of rounds.

The learner sees one button: **Continue**. Not a mode picker.

Manual assignment of a specific activity stays, because a teacher who wants a
test on Friday should get a test on Friday. It stops being the default.

---

## 13. Mastered, redefined

The current definition — `mastery >= 0.8 && correctStreak >= 2` — is a good
smoothing function and a weak claim. If a parent is paying for a report, the
word needs to mean something defensible:

Three words, not one — because §5 (finding 4) found the original single
definition spending "mastered" about forty-eight hours after the learner first
produced an answer, when the word will be read as meaning three weeks.

> An item is **learned** when it has been answered correctly **twice unaided
> and system-checked, at support level 3 or above, on two different days**,
> with no miss since.
>
> An item is **mastered** when a learned item survives one further unaided,
> checked retrieval **at least seven days later**.
>
> An item is **retained** when a mastered item passes a Checkpoint **at least
> fourteen days after that**.

A set is mastered when 90% of its items are, with a passed Mastery Check.

The split costs one rename and buys a report that survives contact with a
suspicious parent: *learned* is an honest description of two good days, and
*mastered* now means what a parent already thinks it means. Keep the existing
continuous `mastery` number for scheduling and for the progress bars — it is
the right shape for both — and use the three booleans above for anything that
makes a *claim*: reports, goal completion, and (per the rewards requirement)
payouts.

**Retention is the number that proves the product works,** and no competitor
reports it.

---

## 14. Spelling and typing, in the same frame

Two kinds of subject, and the difference is worth naming in the code:

- **Skill subjects** (spelling, typing, math facts) — a fixed curriculum, an
  internal difficulty model, an absolute scale that means something outside the
  app (grade level, WPM), placement tests, promotion between levels. Nothing is
  loaded; the content is the product.
- **Content subjects** (any set) — arbitrary material, difficulty relative to
  the set, no meaningful absolute level, no promotion. The adult supplies it.

They differ in *what a level means* and in *what the report says* — a spelling
report says "reading and spelling at a 5th grade level", a set report says
"32 of 40 mastered, 28 retained". They do **not** differ in the ladder: Listen
& Spell is stage 3 free recall, Proofread is stage 1 recognition, Scramble is
stage 2. So:

- tag every activity with `stage` and let one planner drive all subjects;
- keep the two report vocabularies separate and honest;
- math facts join as a skill subject with a generated curriculum, which is why
  §8 Tier 0 belongs here rather than in the importer.

### The K–12 coverage gap

The ask is K–12; spelling covers 2–8. What is actually missing:

- **K–1** — phonics and sight words, audio-first, no typing, tiles input.
  Requires the early-learner layer in §9 and the sight-word generator, not new
  activity types.
- **9–12** — more word lists is the wrong answer. High school spelling is
  vocabulary, etymology, roots and usage; that is a *content* subject on the
  set model, best served by good starter sets (SAT roots, Greek and Latin
  affixes) plus Apply and Use It.
- **Math facts, K–5** — the biggest hole, and the one Tier 0 closes cheaply.

---

## 15. Changes by layer

**`packages/shared/src/progress.ts`**
- optional fields on `QuizCard` (§7); no migration, `decks.cards` is `jsonb`.
- `SELF_GRADED_ACTIVITIES` gains `'explain'`, `'use-it'` (until assisted
  grading), leaves everything else checked.
- a `LadderStage` type and an `ACTIVITY_STAGE` map, so the server can reason
  about evidence quality without importing the web app.

**`apps/web/src/lib/activities/`** (new home)
- `catalog.ts` — one registry replacing the two half-registries in
  `spelling/activities.ts` and `quiz/session.ts`: id, name, emoji, subject
  applicability, `stage`, `isTest`, `verified`, required fields, fallback.
- `capability.ts` — `availableActivities()` (§7).
- `ladder.ts` — stage promotion/demotion from an `ItemMastery`.
- `path.ts` — the Mastery Path planner (§12), which absorbs and generalizes
  `planStudy` and `planSession`.

**`apps/web/src/lib/quiz/session.ts`**
- `kindFor` becomes a thin wrapper over `ladder.ts` (keeps its tests).
- `PlanOptions` gains `cardIds` — also unblocks item 2 of the existing quiz
  mastery plan ("Practice these N").
- batching (§12.2).

**`apps/web/src/lib/assignments/routing.ts`**
- `ASSIGNABLE` is generated from the catalog rather than hand-listed.
- a `mastery-path` assignable whose route is "continue this set".

**`apps/api`**
- `POST /content/enrich` (Tier 2), metered against the ingestion quota and
  provenance-marking. See [billing-spec.md](billing-spec.md).
- goal assignments: evaluate-and-close in the write transaction.

**Migration 0015** (number from the registry in [build-sequence.md](build-sequence.md))
- `assignments.goal jsonb` and the goal-completion predicate.
- nothing else. The content changes are all in `jsonb` already.

**Migration 0016**
- `rewards`, `reward_points`, and `award_matching_rewards()`, called in the same
  transaction as `complete_matching_assignments()`. Deliberately **no** reopen
  trigger on sessions — see §11.

**Generators** — `apps/web/src/data/generated/mathFacts.ts` and friends, shaped
like `starterDecks.ts` with stable derived ids so mastery survives a rebuild.

---

## 16. What a grown-up actually does

The whole point, in three steps:

1. **Load it.** Paste, upload a CSV, photograph a page, or say what the topic
   is. Tier 1 enrichment runs immediately; Tier 2 proposes the rest.
2. **Say what it's for.** Pick learners, pick "master it", optionally a date.
3. **Nothing.** They get a weekly line saying how it is going, and an alert
   only when a learner stalls.

Everything they used to do — choosing modes, sequencing, deciding when to test,
deciding when it is learned — is now derived from evidence the app already
collects.

---

## 17. Build order

**Superseded.** Order now lives in [build-sequence.md](build-sequence.md),
which sequences this spec against the content-structure and ingestion
proposals and resolves the conflicts between them. This document describes
*scope*; that one describes *when*.

Roughly, for orientation: the ladder and the free rungs are **stage 2**; the
Mastery Path is **stage 4**; rewards and the strict mastery split are
**stage 5**; free recall, fluency and the cheap engagement wins are **stage
6**; generated banks are **stage 7**; the early-learner layer and richer
activities are **stage 8**. Do not plan from this paragraph — plan from the
sequence.

---

## 18. Open questions

1. **Does `explain` earn its place before assisted grading exists?** It is
   pedagogically strong and produces no evidence. We already have one
   unverified activity (Flashcards) and it caused the problem the mastery loop
   plan was written to fix. Recommendation: ship it, but never on the Mastery
   Path — offer it only as a learner-chosen extra.
2. **Does fluency move ability, or sit beside it?** A second latent dimension
   is more faithful and more work. Recommendation: start with response time as
   a *tiebreaker* on stage promotion, not as an input to `updateAbility`.
3. **Where do generated banks live** — client constants like `starterDecks.ts`,
   or server-side so they can be re-graded? The rewards requirement wants
   server-side answer keys eventually; math facts are the one content type the
   server can regenerate and re-grade trivially, so they may be worth putting
   there first as the pattern for everything else.
4. **How much does Tier 2 enrichment cost per set?** Billing itself is settled
   — parents pay, coverage follows the learner, teachers never pay — but where
   enrichment sits against the ingestion quota needs the `llm_usage` numbers
   before it can be decided sensibly. See [billing-spec.md](billing-spec.md).
5. **Reading level as a first-class field** on sets — needed for the K–2 layer,
   probably needed for differentiation generally, not specified here.

---

## 19. How we know it worked

- **Setup cost:** median adult actions between loading content and a learner's
  first round. Target: three, and never more than three regardless of set size.
- **Ladder throughput:** share of items that reach stage 3 within seven days of
  being introduced.
- **Retention:** Checkpoint pass rate at 14+ days on items marked mastered.
  This is the headline number and the one to put in front of parents.
- **Verified share:** proportion of all attempts that are system-checked.
  It should go *up* as the catalog grows; if it goes down we have shipped
  entertainment.
- **Return rate:** learners completing a Daily Mix on 4+ days a week.
