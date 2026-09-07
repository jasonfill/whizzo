# Build sequence — the three specs as one plan

**Status:** in progress · **Date:** 2026-09-06 · **Governs:** activities, structure, ingestion, billing, planner, MCP

| Stage | | |
| --- | --- | --- |
| 0 Foundations | **done** | `rich` in `shared`, one `QuizCard`, migration registry |
| 0.5 Billing | **done** | migration 0013, coverage model, `llm_usage`, `credit_ledger`, gates moved off `profiles.plan` |
| 0.6 Stripe | **code done, needs config** | migration 0018, checkout, webhook, add/remove learners, portal. Needs two Stripe prices and four env vars — see below. Credit packs still deferred |
| 1 Tracks | **done** | registry, `track` end to end, migration 0014, deck picker, per-track reporting |
| 2 The ladder | **done** | `ladder.ts`, catalog, capability matrix, puzzles, `simulate:ladder`, the two scaffolded question kinds, `ASSIGNABLE` generated |
| 3 Ingestion | **done** | migration 0017, validator, credit gate, model layer, SSRF fence, pipeline, job runner, routes, screen |
| 4 Mastery Path | **done** | `path.ts`, batching, readiness gate, migration 0015, goals closed by state, goal option in the assign form, Continue on the task list |
| 5 Rewards | **done** | migration 0016, shared model, routes, flashcard points hole closed, parent's ledger on Family |
| 6 Fluency & engagement | **done** | maturity band + band-aware praise, `brain-dump` grading, `speed-recall` fluency from `responseMs` |
| 7 Generators | **done** | math fact banks — six out of the box, stable ids, difficulty as children meet it |
| 8 Publishing | **partial** | units, prerequisites and `validateCatalog`. Groups, slots and the supplied catalog deliberately deferred |
| 9 Planner | **proposed** | courses, the week, tests planned backwards, verified study sessions, grown-up comments — [weekly-planner-spec.md](weekly-planner-spec.md) |
| 10 MCP | **code done, needs config** | OAuth server, `/mcp`, ten tools, grading and the adaptive engine moved to shared, `channel` on attempts, migration 0020, `simulate:tutor`. Needs `APP_URL` and `MCP_TOKEN_SECRET`, then the voice spike — see §3d |

Three proposals exist, they overlap, and each one has its own "Phase 1". This
document is the single authority on **what gets built when**, and on the
fifteen places where the three specs currently disagree, duplicate or drift.

Read this before starting work in any of them.

> **Every phase number inside the three specs is superseded by the stages
> here.** "Activities phase 2" is not a thing any more; there are stages, and
> the specs describe scope, not order.

---

## 1. The alignment audit

Fifteen findings. Four **conflicts**, four **collisions**, six **gaps**, one
**drift**.

**All fifteen are now resolved in the specs themselves** — the Resolution
column says what was decided, and the decision is written into the document it
belongs to rather than living here. What remains is the code, at the stage
named. Finding 1 is the only one that cannot be resolved by writing: it is a
file move, and it is the first thing stage 0 does.

| # | Kind | Finding | Resolution — **written into the specs** | Code at |
| 1 | collision | `lib/rich` lives in `apps/web`. Ingestion needs it server-side; the activities capability matrix needs it client-side. Both specs assume they will move it. | Move to `packages/shared/src/rich/` **once**, re-export from the old path. File move, not a rewrite. | 0 |
| 2 | collision | `QuizCard`'s optional fields are defined in activities §7 and again in ingestion §5's `GeneratedCard`, with different members. | One definition in `packages/shared`, the superset: activities' fields **plus** `explanation` and `sourcePages`. | 0 |
| 3 | collision | Migration numbers: activities claims 0013 and 0014, ingestion assumes 0015, structure is unnumbered. | Assigned in §3 below. This document is the registry. | 0 |
| 4 | collision | Three independent "Phase 1/2/3" schemes. "Phase 2" is ambiguous across a four-document set. | Global stage names. The specs keep scope and lose ordering. | 0 |
| 5 | drift | Ingestion cites activities §5, §6, §14, §16, §17 — all moved by two when the pedagogy review and choice sections landed. Only §3 still resolves. | Rewrite the nine references. | 0 |
| 6 | **conflict** | Activities §7 does not know rich content exists. `scramble`, `first-letter`, `missing-letters` and tiles all chop the answer into characters — `$\frac{3}{4}$` scrambled is nonsense. | The capability matrix consults `parseRich()` and marks character-manipulating activities `locked` when the answer side carries maths or a figure. **This is the one that would show a broken question to a child.** | 2 |
| 7 | **conflict** | Ingestion says *a draft can be practised*; structure says content with attempts against it is copy-on-write. Together, a parent fixing a typo after their kid tried the deck forks a version of an unshared draft. | Fork-on-edit applies to **shared or assigned** content only. An unshared draft is freely editable however many attempts it has. | 1 |
| 8 | **conflict** | Ingestion's acceptance test is *"a generated set makes every activity in the capability matrix read `ready`"*. The capability matrix does not exist until the ladder ships. | Ladder before ingestion. Without it there is no way to tell whether generation worked. | 2 → 3 |
| 9 | **conflict** | Activities §7 has `media?: {kind:'image'\|'audio'}`; card-formatting puts figures **in the text** as `[[figure {…}]]`. Unbounded overlap. | Figures for anything data-driven and generable; `media` **only** for photographs and recorded audio. | 0 |
| 10 | gap | `label` is specced as an image with hotspots — *"the only activity that requires new authoring"*. Figures already carry labelled vertices, points and parts. | Re-spec on figure specs: render with labels hidden, learner drops them in. Moves it from nearly-last to nearly-free. | 6 |
| 11 | gap | `explanation` (activities §5, finding 8) is absent from ingestion's `GeneratedCard`, which is the best place to produce it — the document is already in a cached context block. | Add to the Zod schema. | 3 |
| 12 | gap | Structure says ingestion should propose `track` and `objective`; ingestion's schema has neither. | Add, once tracks exist. | 3 |
| 13 | gap | `solve`'s numeric grading is partly built — `gradeWritten` already projects `$\frac{3}{4}$` to `3/4` and protects fraction slashes. What is missing is decimal tolerance and equivalent forms (0.75 = 3/4 = 75%). | Restate the activity as "what is left", or someone rebuilds the projection. | 5 |
| 14 | gap | `estimateDifficulty()` measures the plain-text projection, so a triangle figure reads as a short answer regardless of the question's difficulty. | Covered by the existing recommendation to calibrate from observed responses; geometry makes it more urgent. | 5 |
| 15 | gap | No `simulate:ladder`. `simulate:adaptive` is in `npm test` and is what catches exactly this class of bug. | Ships with the ladder, not after it. | 2 |

**Checked and genuinely compatible** — no action needed: rewards' *"no criterion
may require timed work"* and ingestion's *"a draft cannot earn a reward"* compose
cleanly; structure's additive migration does not collide with either of the
others' tables; the `verified` / `isTest` model is consistent across all three.

---

## 2. The sequencing principle

Two rules decided the order below.

**Schema-shaped work lands before behaviour-shaped work.** Adding `track` to
`attempts` costs one migration today and one migration plus a backfill decision
every month it waits. Behaviour can be rewritten cheaply; accumulated rows
cannot.

**The falsifiable bet goes early, and cheaply.** The ladder is the assumption
everything else rests on. It has no external dependencies, costs no money per
use, and can be proven or disproven by a simulation and one metric. If ladder
throughput does not move, three documents' worth of downstream work is
questionable — and that is worth finding out in week three rather than month
six.

---

## 3. The stages

### Stage 0 — Foundations

*Blocks all three specs. Nothing else starts cleanly until this is done.*

- ~~Move `apps/web/src/lib/rich/` → `packages/shared/src/rich/`~~ **done.** Four
  files, not five: `layout.ts` is drawing arithmetic and stayed in the web app,
  because validating a figure and drawing one are different jobs and only the
  first is the server's. Not one import in `apps/web` changed.
- ~~One `QuizCard` in `packages/shared`~~ **done**, carrying every field the
  three specs ask for, all optional; the API schema accepts them and
  `normalizeDeck` preserves them.
- State the figure/`media` boundary in activities §7 (finding 9).
- Fix the nine stale cross-references (finding 5).
- Adopt this document's stage names in all three specs (finding 4).

**Migration registry** — claimed here, and here only:

| Number | What | Stage |
| --- | --- | --- |
| 0013 | `subscriptions`, `learner_coverage`, `is_learner_covered()`, `llm_usage`, `credit_ledger` | 0.5 |
| 0014 | tracks: `track` on decks, word lists, attempts, sessions, skill states | 1 |
| 0015 | `assignments.goal` and the goal-completion predicate | 4 |
| 0016 | `rewards`, `reward_points`, `award_matching_rewards()` | 5 |
| 0017 | `content_sources`, `content_jobs`, `source_id`, `accepted_at` | 3 |
| 0018 | Stripe: customer and subscription ids, webhook bookkeeping | 0.6 |
| 0019 | `courses`, `planner_weeks`, `assessments`, `planner_items`, `planner_comments`, `planner_prefs`, `course_id` on decks / word lists / assignments | 9 |
| 0020 | `mcp_clients`, `mcp_grants`, `mcp_auth_codes`, `mcp_refresh_tokens`, `mcp_rounds`, `attempts.channel` | 10 |

Numbers follow the stages except ingestion, which is built third and numbered
last: rewards is the smaller and more certain change, and there is no value in
holding a low number for the stage with the least settled cost model.

Billing takes the first number because it is the one migration that changes an
existing table's *meaning* — `profiles.plan` stops being read — and that is
better done before four others sit on top of it.

### Stage 0.5 — Billing

*Not a blocker for stages 1 and 2. A hard blocker for stage 3.*

**Schema only.** Coverage replaces plans: `subscriptions`, `learner_coverage`,
`is_learner_covered()`, and every gate moved off `profiles.plan`. Plus
`llm_usage` and `credit_ledger`, which must exist **before the first model call
is ever made** — cost logging written after the fact is cost logging that never
happened.

**Stripe wiring is not in this stage.** Subscriptions and credit-pack purchases
are weeks of external integration that help no learner and block nothing until
stage 3. Put the schema in early, take the money later.

See [billing-spec.md](billing-spec.md). The short version: **parents pay,
teachers and tutors never do, and what is bought is coverage of one child.**
Assigning stays free for everybody, permanently, because a teacher setting work
for twenty-five children is how twenty-five families find out the product
exists.

Half a stage rather than a whole one because nothing before stage 3 charges
anybody — but ingestion cannot be metered against a model that does not exist,
and cost logging written after the fact is cost logging that never happened.

### Stage 1 — Structure v1: tracks

*First, because it is a change to `attempts` and it only gets more expensive.*

The Area → Track registry as a constant; `track` on content, attempts,
sessions; `skill_states` re-keyed to `(user_id, subject, track)` and seeded
from existing ability; a skippable track picker; per-track reporting.
`objective` is written and read by nothing.

Settles finding 7 while writing the sharing rules: **fork-on-edit is a property
of shared content, not of content with attempts.**

**Pays for itself immediately**, before any curriculum exists: the parent's
report goes from *"Quiz: 71%"* to *"Biology 62% · Spanish 88% · Geometry 45%"*.

### Stage 2 — The ladder

*The falsifiable bet. No API, no migration, no cost.*

`catalog.ts`, `ladder.ts`, the capability matrix, `first-letter`, the
requeue-never-promotes rule, the choose-within-a-rung menu, and
**`simulate:ladder` in the same pull request as the ladder** (finding 15).

It earned its place on the first run: with demotion on a single miss, a
simulated learner answering 90% correctly stalled two rungs short of free
recall, ping-ponging between levels. No unit test would have caught that — each
rule was individually right. Demotion now needs two misses running.

Resolves finding 6 — the capability matrix is where maths and figures lock out
the activities that chop answers into characters, and it must be right the
first time because the failure is visible to a child.

Deliberately **not** here: `catalog.ts` merging the two activity registries
rewrites two existing test suites, so it is its own change inside this stage.

### Stage 3 — Ingestion: upload through acceptance

*Both of its dependencies now exist.*

Ingestion's own phases 1 and 2 together, because its spec is right that phase 1
alone is a demo. PDF only: acquire → read → build → validate → draft, plus the
review screen, `accepted_at`, and the draft gates.

Adds `explanation`, `track` and `objective` to the build call's schema
(findings 11, 12) — all three are nearly free once the document is in a cached
context block, and expensive to backfill.

Its acceptance test is now checkable, because the capability matrix exists
(finding 8).

### Stage 4 — The Mastery Path

Planning within a track (needs stage 1), batching, placement, the readiness
gate, goal assignments, migration 0015.

### Stage 5 — Rewards, and the mastery criteria they rest on

`set_mastered` and `mastery_count`, the strict learned/mastered/retained split,
the rewards table and ledger, migration 0016. Close the flashcard-points hole
in the same stage — it is a payout surface with no verification behind it.

Pick up findings 13 and 14 here: `solve` finishes what the rich work started,
and item difficulty starts calibrating from observed responses.

### Stage 6 — Free recall, fluency, and the cheap engagement wins

`brain-dump`, `speed-recall` (reporting only, gating nothing), `responseMs` in
the model, the maturity band and band-aware copy, the rung-climb micro-moment,
`label` re-specced onto figures (finding 10).

### Stage 7 — Generators

Math facts and sight words. Largest coverage gain for zero authoring, and the
only content where item identity is free across learners — which is what makes
class-level reporting possible later.

### Stage 8 — Publishing, groups, and the catalog

Structure v2 and v3: units, prerequisites, `validate:catalog`, groups, slots,
pinning. Then the supplied catalog, Financial Literacy first.

Last on purpose. It needs a real class asking for it, and it turns the product
into a publisher — a different business with different costs, gated on the
billing model that is still open.

---

### Stage 9 — The weekly planner

*Proposed. Depends on nothing unbuilt: tracks (1), the Mastery Path (4) and
retention are all in place.*

Courses as per-learner enrolments citing a track; the week grid with tasks,
assessments and the app's own due work pulled in; `proposeStudyPlan()` with
`simulate:planner` in the same pull request; linked study sessions closed in
the round's transaction by the same mechanism as assignments; grown-up view,
attributed writes and comments; the Family line. Scope in
[weekly-planner-spec.md](weekly-planner-spec.md).

Sits after 8 in number only. It can start now, and it is the first stage whose
value is visible to a learner who never opens a deck.

### Stage 10 — MCP: renting the tutor

*Proposed. Depends on the ladder (2) and the Mastery Path (4), both built.
Independent of 9; the two can run side by side.*

The app as a tool surface for Claude and ChatGPT, so the assistant a family
already pays for can run a practice round out loud and the answers land in
`attempts` as verified evidence. Scope in
[mcp-tutor-spec.md](mcp-tutor-spec.md).

**Claude voice mode calls custom connectors** (confirmed 2026-09-06), and
that is the whole point: a child practising out loud with the assistant the
family already pays for. ChatGPT gets the same server and the text-chat
tutor until its voice mode grows tools.

**Starts with a one-day spike, before any of the rest**: a stub server with
one read and one write tool, connected to Claude on iOS, to measure the tool
round trip inside a voice turn and confirm an *allow always* tool runs
without a prompt mid-conversation. Those two numbers set the round length
and decide whether grading and the next question can stay one call.

Then, in order: grading moved from `apps/web` to `packages/shared` (the
`rich` move again — file move, old path re-exports); the OAuth server and
consent screen; `/mcp` and the tool catalogue with `simulate:tutor` in the
same pull request; migration 0020; the `tutor` activity and `speakable`
requirement; Learn tasks closed by tutor sessions; the tutor packet.

No model call is made from this code and `llm_usage` gains nothing from it,
which is why it is free at every tier.

## 3b. Deliberately not built

Stage 8's second half — **groups, slots, offer-into-a-slot, pinning, and the
supplied Financial Literacy catalogue** — is not built, and that is the plan
rather than a shortfall.

It needs a real class asking for it. Every design decision in the publishing
section (who curates, what a slot is, whether a parent may offer into another
family's week) is a guess until somebody is actually trying to do it, and the
schema for guessing wrong is expensive to unpick. It also turns the product
into a publisher — content that has to be made, reviewed and kept correct — and
that is a different business, gated on the billing model that is only half
wired.

What *is* built is the part that has to exist first and is expensive to add
later: units carry prerequisites, the graph is validated, and `objectives` is
written on every piece of content while nothing reads it. Backfilling an
objective onto every set anyone ever made is the one thing here that gets
harder with every passing day.

## 3c. Turning payments on

The code is finished and tested; what remains is account configuration, which
cannot be done from a repository. In Stripe:

1. Two **recurring monthly prices** on one product — $4 and $2. Two flat prices
   rather than one graduated tier on purpose: a tier is configured in the
   dashboard, which puts the amount a customer is charged somewhere this
   repository cannot see, review or test. With two prices the arithmetic is in
   `billing/stripe.ts` and is asserted against `monthlyPriceCents`, the same
   function the pricing page renders from.
2. A **webhook endpoint** at `/api/billing/webhook`, subscribed to
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` and `invoice.payment_failed`.
3. The **customer portal** enabled, since cancelling and card changes are
   handed off to it rather than rebuilt.

Then four variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_FIRST`, `STRIPE_PRICE_EXTRA`, plus `APP_URL` for the return
links. Absent, every billing route refuses with `stripe_unconfigured` and the
rest of the API runs — a contributor without a Stripe account is not blocked.

**Two strings still say payments are off** — the closing lines on
`PricingScreen` and `MarketingScreen`. They are accurate for a build with no
keys and become false the moment there are keys, so they are the last thing to
change, deliberately after the first live test charge rather than before it.

**The legacy arm in `is_learner_covered` stays until there are real rows.** It
matches `profiles.plan = 'pro'`, which is how every comped account is covered
today. Dropping it before migrating those accounts onto subscriptions would
silently strip them. That is a migration to write once the first real
subscriptions exist, not now.

---

## 3d. Turning connected apps on

The code is finished and tested; what remains is two variables and a phone.

1. `APP_URL` — the app's real public origin. The OAuth server uses it as its
   issuer and for the consent redirect, so it must be exact and must never be
   derived from a request.
2. `MCP_TOKEN_SECRET` — `openssl rand -base64 48`. Separate from every
   Supabase secret; rotating it signs every assistant out and families
   reconnect in a minute.

Absent, the OAuth and `/mcp` routes answer `mcp_unconfigured` and the rest of
the API runs. Migration 0020 applies at startup like the others.

Then the spike the spec asks for, on Claude iOS: add the custom connector at
`APP_URL/mcp`, approve on the consent screen, allow `start_round` and
`answer` to run unsupervised in the connector's tool settings, open voice
mode and say *"tutor Maya on her cells deck."* Two things to write down: how
long a tool call takes inside a voice turn, and whether the unsupervised
setting holds mid-conversation. Those set the default round length.

## 4. What can run in parallel

Stages 1 and 2 touch almost nothing in common — structure is schema and
reporting, the ladder is planning and activities. Two people, or two sessions,
can run them side by side after stage 0. Everything from stage 3 on is
sequential.

Stage 6's engagement items (the maturity band, band-aware copy) have no
dependencies at all and can be pulled forward into any stage that needs a small
win.

---

## 5. Rules that stop it fragmenting again

1. **One definition per shared shape, in `packages/shared`.** `QuizCard`,
   `Attempt`, `Subject`, `TrackId`, `Objective`. A spec that needs a field adds
   it there; it never redeclares the type.
2. **Migration numbers come from §3 of this document**, never from a spec.
3. **Specs describe scope. This document describes order.** A spec that says
   "phase 2" is out of date.
4. **A cross-reference between specs cites a section *title*, not a number.**
   Numbers moved once and will move again.
5. **New shared behaviour gets a simulation or a validator**, following
   `simulate:adaptive` and `validate:words`. It is the house style and it is
   what has caught the real bugs.
6. **`attempts` is never rewritten.** Every design that would require it is
   wrong; there is always an additive alternative, and finding it is the work.

---

## 6. Still unresolved, and what it blocks

| Question | Blocks | Why it can wait |
| --- | --- | --- |
| ~~Seat-based billing for tutors~~ | — | **Settled.** Parents pay, coverage follows the learner, teachers never pay — [billing-spec.md](billing-spec.md) |
| What a page actually costs | stage 3's credit numbers | `llm_usage` lands in stage 0.5; the mechanism is committed to, the numbers are not |
| Annual pricing, and what a lapsed parent sees | nothing yet | needs a renewal cohort to measure |
| Maturity band on the learner or the guardian link | stage 6 | Learner is simpler and probably right |
| Whether achievements stay cross-track | stage 1 | Cross-track is the default and needs no decision to keep |
| Whether a group's slot must exist before content is offered into it | stage 8 | Far enough out to learn from real use |

The one that matters soonest is **ingestion cost**, and it does not need an
answer — it needs `llm_usage` written in stage 0.5 and populated from the very
first model call, even though the quota gate lands in stage 3. Guessing at a
price with no data is how this becomes expensive; measuring it costs one insert
per call.

One number is worth an alert rather than a dashboard: **cache read tokens on
the second topic call of a build fan-out.** If it is zero, something upstream
is varying and that document costs roughly ten times what it should.

The reason credits exist at all is worth restating, because it was found by
arithmetic rather than by argument: an allowance of *ten documents a month*
prices ten worksheets ($1.25 of cost) identically to ten chapters ($5.00) —
against $4.00 of revenue. **Metering by document is a 25% loss on exactly the
use case the feature exists to serve.** A page is a unit of cost; a document
is not.
