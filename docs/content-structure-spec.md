# Content structure — tracks, objectives, and shared work

**Status:** proposal · **Date:** 2026-08-31 · **Scope:** packages/shared, apps/web, apps/api, one additive migration

Three problems, one structure.

1. **The ability number for content is meaningless.** `SkillState` is keyed by
   subject, and every study deck in the app shares the subject `quiz`. So a
   learner has one "quiz ability" averaging Spanish vocabulary, cell biology
   and state capitals. Every planning decision that reads it — stretch items,
   promotion, prediction-relative scoring — runs on noise.
2. **There is nowhere to put a curriculum that is not spelling or typing.**
   Spelling has `GRADES → SpellingList → words`. Typing has `WORLDS → lessons`.
   Everything else is floating decks with tags. A supplied curriculum has no
   shape to land in.
3. **Shared content cannot be related to other shared content.** Two parents
   who both make a deck for the same week of the same class produce two
   unrelated objects with similar titles. At one class that is untidy; at any
   scale it is unusable.

This document specifies the scaffolding. It does not specify any curriculum —
see [learning-activities-spec.md](learning-activities-spec.md) for what runs on
top of it and [content-ingestion-spec.md](content-ingestion-spec.md) for how
content arrives.

---

## 1. `subject` does four jobs and only one of them is wrong

The obvious move is to make `Subject` open-ended so that Biology is a subject.
That move is a trap, and seeing why is what makes the rest of this cheap.

| Job `subject` does today | Should it change? |
| --- | --- |
| Which planner and engine runs | **No.** Genuinely three-valued: the spelling planner, the typing engine, the card planner. |
| Assignment routing — subject + activity + target | **No.** Works, and `complete_matching_assignments()` depends on it. |
| The mastery key namespace, `quiz:deckId:cardId` | **Never.** Change it and every learner's history detaches from the cards it belongs to. |
| Which ability pool the learner has | **Yes.** This is the broken one. |

Opening up `Subject` changes the third row, which leaves two options, both bad:
rewrite `attempts` — violating the append-only guarantee pinned in
`supabase/tests/0007_attempt_integrity_test.sql` — or let every learner silently
lose their study history.

**So `subject` is not touched. A second dimension is added.**

```ts
/** Which engine runs. Unchanged, forever. */
export type Subject = 'spelling' | 'typing' | 'quiz'

/** Which ability pool this work belongs to. New. */
export type TrackId = string   // 'math.facts', 'science.biology', 'general'
```

Everything below is additive. Nothing is rewritten, no key changes, no learner
loses anything.

---

## 2. The taxonomy

**Area → Track → Unit.**

| Level | Example | What it is | Computes anything? |
| --- | --- | --- | --- |
| **Area** | Science | Navigation and nothing else | no |
| **Track** | Biology | **The ability pool.** The scope a level or a report is about | yes |
| **Unit** | Cell Structure | What gets assigned, mastered and reported on — a deck, with an order and prerequisites | yes |

A unit is what a `QuizDeck` already is. Nothing about the deck format changes;
it gains a place to sit.

### Naming

"Track" rather than "Subject" in **both code and UI**, because `Subject`
already means *engine* in this codebase and one word meaning two things is a
permanent source of bugs. A parent reads *"Ava's tracks: Biology, Spanish,
Geometry"* without trouble, and schools already use the word. This is cheap to
change now and expensive later.

### Skill tracks and content tracks

The distinction §14 of the activities spec draws becomes structural:

- **Skill tracks** — spelling, typing, math facts. An ordered curriculum, an
  absolute scale that means something outside the app, levels, promotion,
  placement. The content *is* the product.
- **Content tracks** — Biology, Spanish, Investing. Arbitrary material,
  difficulty relative to the track, mastery and retention rather than a level.

Ability is estimated for both, because the planner needs it for stretch items
and prediction-relative scoring. It is **shown as a level only for skill
tracks**. A content track reports mastery and retention and never claims a
grade, because it cannot support one honestly.

### The floor

**A track holding fewer than ~30 answered items shows no ability number at
all** — mastery counts only. An ability estimated from twelve cards is noise
wearing a decimal point, and putting it in front of a parent is worse than
saying nothing.

---

## 3. Objectives — the layer that makes sharing work

Area/Track/Unit organizes *our* content. It does not answer the question this
document exists for: **when two people independently make content for the same
thing, how does the app know it is the same thing?**

Not by title. "Unit 1 Quiz", "unit 1 math", "Math Facts U1" and "Chapter 1
Test" are four strings and one meaning, and no amount of fuzzy matching
recovers it.

**The join key is the objective.** Content does not align to other content; it
aligns to a stated learning objective, and two pieces of content are related
because they target the same objective.

```ts
export interface Objective {
  id: string          // 'math.facts.multiply-within-100'  — ours, stable, forever
  trackId: TrackId
  title: string       // 'Multiply within 100'
  grades: [number, number]
  /** External standards this corresponds to. Optional, additive, never load-bearing. */
  aligns?: string[]   // ['CCSS.MATH.CONTENT.3.OA.C.7']
}
```

Two decisions here matter more than they look.

**Our own objective ids, with external codes as an optional annotation.** Not
Common Core ids as the primary key. Common Core covers math and ELA only,
states have diverged from it, science uses NGSS, and personal finance uses the
CEE standards — so adopting any one of them as *the* identifier guarantees a
migration the first time we leave its coverage. Our ids stay stable; `aligns`
grows as mappings are added, and is what a district asks about.

**Objectives are coarse.** Roughly one per unit, not one per card. Fine-grained
standards taxonomies are a maintenance burden that nobody outside a curriculum
department will ever use correctly, and the value here — *relating alternative
content for the same goal* — is fully served at unit granularity.

---

## 4. Two join keys, and the mess comes from conflating them

The motivating case is *"a parent makes content for Unit 1 of Math Facts and
shares it with the class; another parent makes something different for the same
Unit 1."* Underneath that sentence are two different kinds of sameness.

| | **Objective** | **Local scope** |
| --- | --- | --- |
| Means | "teaches multiplying within 100" | "is what Ms Johnson's class is doing this week" |
| Scope | global, permanent | one class, one year |
| Who defines it | us, once | the teacher, per class |
| Stable across schools? | yes | no — one district's Unit 1 is another's Unit 3 |
| Answers | "what else could my child practice for this?" | "what is the class doing?" |

Conflating them is what makes distributed publishing messy. "Unit 1" is not a
global identity and must never be treated as one; it is a **position in one
group's sequence**. So:

- **Global relatedness runs through objectives.** Two decks targeting
  `math.facts.multiply-within-100` are alternatives for the same goal, whoever
  made them, wherever they are.
- **Local relatedness runs through a group's own sequence.** A class has its
  own ordered list of units, and within that class "Unit 1" is unambiguous.
  Each of the class's units cites objectives, which is how it reaches outward.

A group's Unit 1 is therefore a *slot*, and content is offered **into** the
slot. Several parents can offer into the same slot without collision, because
the slot is the thing with identity and their decks are options in it.

Groups do not exist yet — today the app has learners, guardian links and tutor
connection codes. Section 8 says what v1 does about that, which is mostly:
nothing, carefully.

---

## 5. Standardization: closed at the top, open at the bottom

The rule that keeps the vocabulary usable without making it a bottleneck.

| Level | Who may create one | Why |
| --- | --- | --- |
| **Area** | us | a fixed, small list; navigation only |
| **Track** | us | it is an ability pool, and ability pools cannot be user-generated without becoming meaningless |
| **Objective** | us | it is the join key; a join key anyone can mint is not a join key |
| **Unit** | **anyone** | this is where the long tail lives, and where a teacher's actual week is |

So a parent making content does not invent a track. They file into
`math.facts` and, optionally, cite an objective. That is the whole
standardization burden on them: **one picker, one optional picker.**

Two things make that realistic rather than aspirational:

- **Filing is never required.** `track` is nullable and null means the
  **General** track — a real pool with its own ability, not an error state.
  Somebody pasting twenty words for tomorrow gets a working deck and is asked
  nothing, which is the promise the activities spec makes in §16.
- **The picker suggests.** Content arriving through the ingestion pipeline
  already had a model read it; proposing a track and an objective costs
  nothing and is reviewable like every other generated field.

---

## 6. Distributed publishing

What happens when content moves between people. Four rules, each with a reason
that is not obvious.

### 6.1 Shared content is referenced, not copied

Starter decks are copied (`copyDeck`, fresh card ids) so that editing one never
forks everyone's. That is right for a template and wrong for shared work,
because copying **breaks the mastery key**: two learners studying "the same"
deck from two copies have mastery under two different `deckId:cardId`
namespaces, and no class-level question can be answered across them.

The library already established the alternative: assigned library content is
*readable* by the learner and never writable. Extend that — **assigned or
shared content is referenced.** Then `deckId:cardId` is the same key for
everybody, and *"18 of 24 have mastered 7 × 8"* becomes a query rather than an
impossibility. That single fact is most of what a teacher would ever pay for.

Copying stays available and stays explicit: **Take a copy** gives you something
you own, with fresh ids, and a `derivedFrom` pointer so the lineage survives.
What it costs you is inclusion in the shared view, and the UI should say so.

### 6.2 Content in use is copy-on-write

A referenced deck that somebody has answered against must not change under
them. An author editing a deck mid-assignment silently invalidates the history
of every learner who already answered the old cards.

So: once a deck is **shared or assigned**, an edit **forks a version** rather
than mutating. Learners already working stay on the version they started; new
assignments get the new one. It is the only way both "shared content is
referenced" and "authors can fix typos" can be true at once.

**The trigger is sharing, not attempts.** The obvious implementation — fork
when attempts exist — is wrong, and wrong in a way that would only show up
after both this and the ingestion spec had shipped: an ingested deck is a
draft, a draft *can be practiced*, and so a parent fixing a typo on their own
unshared draft after their child tried it would fork a version of something
nobody else can see. An unshared deck is freely editable however many attempts
it carries. Nothing forks until somebody else is depending on it.

### 6.3 Nothing shared is ever auto-assigned

Content reaching a learner is always a decision by somebody who can already
assign to that learner. Shared content is *available*, never *applied*. This is
the same rule the connection-code design already holds to — minting grants
nothing, redemption is consent — and it is what stops a shared space from
becoming a way to push material at other people's children.

### 6.4 Everything carries provenance, and curation is ordering rather than deletion

A shared unit shows who made it, when, and how much it has been used. The owner
of the slot — the teacher whose class it is — can **pin** one option as the
default. Nobody's contribution is deleted by anyone but its author.

This matters because the failure mode of community content is not spam, it is
*wrongness*: a math deck with an incorrect answer is worse than no deck.
Pinning gives a knowledgeable person a lever without giving them a delete
button over other families' work, and provenance means a wrong card is
traceable to whoever wrote it.

### 6.5 What we deliberately do not attempt

**Item-level identity across authors.** Whether your "7 × 8" card and mine are
"the same item" is unanswerable in general, and answering it wrongly merges two
learners' evidence about different things. Objective-level relation is enough
for every question worth asking.

The exception, and it is a real one: **generated banks** (the activities spec's
*Enrichment*, Tier 0) derive card ids from their parameters, so every learner practicing
multiplication within 100 is genuinely on the same items with no coordination
at all. For the content most worth comparing across a class, identity is free —
which is another argument for building the generators early.

---

## 7. Data model

One additive migration — **0014**, per the registry in
[build-sequence.md](build-sequence.md). Nothing is rewritten.

```sql
-- Where content sits.
alter table public.decks        add column track     text;
alter table public.decks        add column objective text;
alter table public.decks        add column derived_from uuid references public.decks (id) on delete set null;
alter table public.word_lists   add column track     text;
alter table public.word_lists   add column objective text;

-- Where work is recorded. Denormalized on purpose — see below.
alter table public.attempts     add column track text;
alter table public.sessions     add column track text;

-- Where ability lives.
alter table public.skill_states add column track text not null default '';
-- primary key (user_id, subject) → (user_id, subject, track)
```

**Why `track` is denormalized onto `attempts`.** It could be recovered by
joining through `decks`, and that would be wrong twice: a deleted deck takes
its track with it, and — more importantly — it breaks the property the whole
schema rests on, that `attempts` alone can rebuild every other table.
`rebuild_item_mastery()` and any future `rebuild_skill_state()` have to be able
to answer "which pool did this belong to?" without a join to mutable content.

**Areas, tracks and objectives ship as client constants**, the way `GRADES` and
`starterDecks.ts` already do — a registry in `apps/web/src/data/tracks.ts` with
stable ids. No table, no migration, and the pattern is proven here. It moves
server-side when the catalog needs to be sold separately or re-graded, not
before.

**Existing ability seeds each new track once.** A learner with quiz ability 3.2
starts every track they touch at 3.2 rather than at the default. It is an
initial value, not a rewrite, and it means nobody restarts from zero on the day
this ships.

---

## 8. What v1 ships, and what it deliberately does not

**v1 — tracks and ability scoping.**

- the Area → Track registry as a constant, with `general` as a real track;
- `track` on decks, word lists, attempts, sessions;
- `skill_states` re-keyed and seeded;
- a track picker on the deck editor and in the ingestion review screen, always
  skippable;
- **`objective` written but read by nothing.** One nullable column now versus
  backfilling every piece of content later. This is the cheapest forward
  compatibility in the document.
- per-track progress reporting.

That last point is the part that pays for v1 on its own: the parent's report
goes from *"Quiz: 71%"* to *"Biology 62% · Spanish 88% · Geometry 45%"*, which
is a better product before any curriculum exists.

**v2 — units, ordering, prerequisites.** Units within a track form a directed
graph rather than a list: *interest → compound interest → credit card debt*,
with independent branches. Needs `validate:catalog` for cycles, orphans and
unreachable units — the direct parallel to `validate:words`, and the same
reason: an invariant nobody checks is an invariant that is already broken.

**v3 — groups, slots and shared publishing.** Classes, the local sequence, the
offer-into-a-slot model, pinning. Everything in §6 lands here. It needs a group
container that does not exist yet, and it should be built when there is a real
class asking for it rather than in anticipation of one.

**v4 — the supplied catalog.** Financial Literacy first.

---

## 9. What this changes elsewhere

- **The Mastery Path** (activities spec) plans within a track. Batching,
  placement and the readiness gate are all track-scoped.
- **Activities spec, *Spelling and typing in the same frame*** — skill tracks
  versus content tracks stops being a
  distinction in prose and becomes a field.
- **Ingestion spec, *Stage 3 — the build*** — the build call proposes `track`
  and `objectives`
  alongside the enrichment fields. It has read the document; it knows what the
  material is about, and asking costs a few output tokens.
- **`quizAchievements.ts`** counts mastered cards where `subject === 'quiz'`,
  globally. Decide whether achievements stay cross-track — probably yes, they
  are motivational rather than diagnostic — or split per track.
- **Themes** name levels for spelling (`Theme.levels`) and typing
  (`Theme.worlds`). Content tracks have no levels and dodge theming entirely,
  but a future **math facts** skill track needs level names in all ten themes.
- **Plans** count decks per learner. Unchanged by tracks; worth revisiting when
  shared content means a learner can reach many decks they do not own.

---

## 10. Open questions

1. **Does the General track keep its own ability, or inherit?** A learner whose
   only content is unfiled has one pool that behaves exactly like today's
   `quiz`. That is correct and slightly sad. Filing should visibly improve
   something, or nobody will do it.
2. **Who owns a track's ability when a learner works across two schools?**
   Nothing here is per-guardian, and it should stay that way — ability belongs
   to the learner. Worth confirming before groups exist.
3. **How coarse is coarse?** One objective per unit is the working assumption.
   A math unit may genuinely span three. Allowing an array costs nothing now
   and is hard to add later, so `objective` is probably `objectives text[]`.
4. **Does a group's slot need to exist before content can be offered into it?**
   Yes for coherence, no for adoption — the first parent to make something for
   next week should not have to create a class first.
5. **What happens to a referenced deck when its author deletes their account?**
   Library content already faces this; shared content makes it common. Probably
   transfers to the group, or is frozen. Not answered here.
