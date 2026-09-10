# Gimkit import — a teacher's kit in, a deck out

**Status:** spec · **Date:** 2026-09-10 · **Migration:** 0025 (registry in [build-sequence.md](build-sequence.md)) · **Scope:** apps/api (one new content route, one extractor, no model call), packages/shared (one optional card field, one change to how choices are built), apps/web (the add-content screen learns a second kind of link), one additive migration

A teacher makes a kit on Gimkit, plays it in class, and hands the family a
link so the child can practice at home. The parent wants that kit in Whizzo
— on the ladder, on the planner, tutored by the assistant — and today the
only way is to retype it. The ask is simple: *paste the link, get the deck.*

Gimkit has no official API. That is the whole design problem, and the answer
is not to pretend otherwise. This spec rests on what Gimkit actually does on
the date above (§1), builds the import on the one request a parent's own
browser already makes when they open the link, and keeps a second door open
that needs no reading of Gimkit at all: the **Export** button Gimkit itself
puts on every kit (§4). The first door is convenient and will one day close
without notice. The second is boring and will not.

Two things carry the design:

1. **Nothing is generated.** A kit is a teacher's finished work: questions,
   answers, wrong answers. The import is a *translation*, not a build. No
   model runs, no credits are spent, and the deck is not a draft in the
   sense ingestion means — a person wrote every word (§6).
2. **The link path is a convenience with an expiry date, and the code knows
   it.** The response is parsed against a strict schema; the moment the
   shape drifts, the import says so and offers the paste path in the same
   breath. "Gimkit changed" is an expected event with a designed outcome,
   not an incident.

---

## 1. What is true about Gimkit today

Checked on the date above, logged out, from a browser and from a plain
server-side request. The first thing to re-check before building is the
last row.

| | Finding |
| --- | --- |
| Kit ids | 24 hex characters (a MongoDB ObjectId), e.g. `64dcfb9c94b4e3002b739fba` |
| Links a teacher hands out | **Practice:** `gimkit.com/practice/<id>` — what an instructor shares for homework; the link the ask names. **View:** `gimkit.com/view/<id>` — the kit page, "copy the URL from your browser bar" per Gimkit's own help. Both carry the same kit id. **Join:** `gimkit.com/join` plus a game code — a *live game*, not a kit; nothing to import |
| What a logged-out visitor sees at `/view/<id>` | The kit's title, author, every question, a **Show answers** toggle, and **Practice / Share / Export** buttons. Gimkit's help: *"Anyone, including students, with the link to your public kits can view questions and the answers"* |
| What the page loads | One request: `GET https://www.gimkit.com/api/games/fetch/<id>` → `200 application/json`. The practice page makes the same request for the same id |
| Response shape | `{ kit: { _id, title, privacy: 'public', questionCount, lang, gradeLevel, isArchived, creator, createdAt, updatedAt, questions: [ { _id, type: 'mc' \| 'text', text, image?, isActive, position, answers: [ { _id, text, correct: boolean } ] } ] } }`. Answers include which one is correct. `image` is either a `data:image/jpeg;base64,…` (12–17 KB in the sample) or an external `https://` URL. `position` was `0` on every question in the sample — array order is the order |
| Unknown id | `500` with body `No Kit Found`. The view page for it falls through to the marketing homepage |
| Private kit | **Not tested** — we had none. Gimkit's help says private kits are not viewable by link. Treat any non-200, any body that is not the shape above, and any `privacy !== 'public'` as "not available" (§8) |
| Export | The kit page's **Export** opens a preview of tab-separated lines — `question⇥correct answer`, one per question — with a **Flip Question/Answer** toggle and **Copy Text**. Wrong answers and images are not included. Help: *"You can export any Kit within Gimkit to quickly bring the content over to another site"* |
| Server-side fetch | `curl` of the endpoint returned `200` and the full JSON with curl's default user agent, with an identifying `Whizzo/1.0 (+url)` agent, and with a browser agent. No bot challenge on the API host. (The help site and the terms page *do* sit behind one — a plain fetch of those got `403`) |
| Terms of service | *Member Content* (kits) is owned by the member; Gimkit disclaims ownership. *Our Content* (Gimkit's own software, layouts, themes) may not be reverse-engineered or copied. Under account rules: *"You must be a human to use the Services and an automated account is not allowed. This policy also applies beyond Account creation to the general use of the Services. 'Robot' (or automatic) activity is not allowed."* Under community rules: no harvesting of user names or emails |
| robots.txt | `User-agent: *` / `Allow: /` / `Content-Signal: search=yes, ai-train=no, use=reference`. Named AI crawlers are disallowed individually |

Two kits were read in full and are the fixtures for §16: the ask's own
example, *Ordering Numbers* (10 multiple-choice questions, one correct and
three wrong each, no images), and a student-made *Gimkit* kit (16 questions:
13 plain multiple-choice, one text-input with four acceptable answers, three
with images — two inline, one an external URL).

---

## 2. Two intakes

**The link.** The parent pastes a practice or view URL on the add-content
screen. We fetch the kit the way their browser would, translate it, and
land a deck. No quote, no credits, no job — it takes under a second.

**The paste.** The parent (or the teacher, for a private kit) presses
**Export → Copy Text** on Gimkit and pastes the result. We parse the lines
and land the same deck, minus wrong answers and pictures. This is the path
Gimkit built for exactly this purpose, it needs nothing undocumented, and it
is the fallback the link path names whenever it cannot deliver.

Both land in the same place, with the same provenance, through the same
validator. The link path is the one people will use; the paste path is the
one that makes the link path safe to ship.

---

## 3. The link path

### 3a. Screening the URL

Accept, and reduce to a kit id:

| Pasted | Kit id |
| --- | --- |
| `https://www.gimkit.com/practice/<id>` | `<id>` |
| `https://www.gimkit.com/view/<id>` | `<id>` |
| `https://gimkit.com/…` (no `www`) | same |
| `https://www.gimkit.com/api/games/fetch/<id>` | `<id>` — someone pasted the network tab; fine |
| a bare 24-hex string | `<id>` |

Refuse, with a reason the parent can act on:

| Pasted | Reason |
| --- | --- |
| `gimkit.com/join`, or a 6–8 character game code | *"That's a live game code. Ask for the kit's practice link instead."* |
| any other host | not a Gimkit link — falls through to the existing link intake (§ingestion 2) |
| `http://` | rewritten to `https://`, then screened |

The id must match `/^[0-9a-f]{24}$/`. Nothing else from the pasted URL is
used: the request we make is built from the id alone, so a crafted URL
cannot redirect the fetch anywhere.

### 3b. Fetching

Reuse `apps/api/src/content/fetch.ts` — `fetchSource` — as it stands: https
only, DNS resolved and checked for private ranges before connecting and
again on every redirect, 3 redirects, 25 MB, 30 s, no credentials, no
cookies. The target is always `https://www.gimkit.com/api/games/fetch/<id>`.

Two additions, both because this is the first source where we fetch a third
party's site on purpose rather than a document someone linked:

- **An identifying user agent.** `Whizzo/1.0 (+https://<APP_URL>/about/import; a parent asked for one kit)`. `fetchSource` sends none today, which on Node means `undici`; a named agent with a contact URL is the difference between a site operator who can find us and one who can only block us.
- **Courtesy limits.** One request per kit per import; the fetched kit is remembered by id for 24 hours (in `content_sources`, §10), so retries and a second parent importing the same kit do not ask Gimkit again. At most one in-flight request to gimkit.com per instance, spaced 500 ms apart. Per-account, the content route scope's existing 12 requests per hour applies.

### 3c. Parsing

The body is parsed against a **strict zod schema** of the shape in §1 —
strict in what it needs (`kit.title`, `kit.questions[]`, each with `text`,
`type`, `answers[].text`, `answers[].correct`) and permissive in what it
ignores (every other key is passed through and dropped). `privacy`, if
present, must be `'public'`. `isArchived` is ignored: the kit above is
archived and still served.

A parse failure is the drift signal. It is logged as `gimkit_shape_drift`
with the top-level keys seen (never the body — it is someone's content), it
increments a counter that the ops view can alarm on, and the parent sees:

> Gimkit's page has changed and we couldn't read the kit from the link.
> Open the kit on Gimkit, press **Export**, then **Copy Text**, and paste it
> here.

with the paste box open below. `GIMKIT_FETCH=off` in the environment turns
the link path into that message unconditionally — the kill switch for the
day Gimkit asks us to stop, or starts challenging the request.

### 3d. Translating questions into cards

Every question becomes a `RawGeneratedCard` (packages/shared `ingest.ts`)
and goes through `validateGeneratedCards` unchanged — the 300 cap, the
empty-side check, the dedupe key, the rich-text grammar gate, `makeCard`
for ids and difficulty, the numeric downgrade. The translation is the only
Gimkit-specific step.

| Gimkit question | Card |
| --- | --- |
| `mc`, one `correct` answer | `term` = question text · `definition` = the correct answer · `distractors` = the incorrect answers, in kit order (§5) |
| `mc`, several `correct` answers | `definition` = the first correct · `altAnswers` = the other correct ones · `distractors` = the incorrect ones |
| `text` (all answers are acceptable) | `definition` = the first answer · `altAnswers` = the rest · no distractors |
| correct answer is *"All of the above"* | `definition` = the incorrect answers joined with ", " (that *is* the answer) · `altAnswers` = `['all of the above']` · no distractors |
| correct answer is *"None of the above"* | skipped — there is no answer to learn. Reported |
| answer that `isNumericAnswer` accepts | `answerKind: 'numeric'`; the validator downgrades it if the label is wrong |
| `image` present | **v1: skipped and reported** — *"3 questions need their pictures and were left out."* A question written around a picture is unanswerable without it, and a 16 KB data URL per card does not belong in a deck row. v2 copies images into storage and lands them as `media` (§15) |
| `isActive: false`, empty text, no correct answer | skipped and reported |
| more than 300 | the first 300, and *"This kit has 340 questions; the first 300 came over."* |

Answer texts are trimmed; an incorrect answer equal to the correct one, or
to another incorrect one, is dropped from `distractors`. A question whose
text is **choice-bound** — it reads *which of the following / which of
these / all of the above / none of the above* — is only meaningful with its
choices; §5 says how play treats it, and if it arrives with no distractors
(possible via the paste path) it is skipped with *"can't be asked without
its choices."*

The deck:

| Field | Value |
| --- | --- |
| `title` | `kit.title`, trimmed to 80; `"Gimkit kit"` if empty |
| `description` | `Imported from Gimkit` — plus ` — by <name>` when the payload names an author (the practice page shows one; the JSON we read carried only an id, so this is a nice-to-have, not a promise) |
| `tags` | `['gimkit']` |
| `term_label` / `definition_label` | `Question` / `Answer` — the same as ingestion |
| `track` | null. `gradeLevel` and `lang` are kept in `source_map` for a later mapping |
| `source_id` | the `content_sources` row (§10) |
| `accepted_at` | `now()` — §6 |
| owner | the importing grown-up's library, exactly where ingestion lands a document |

`generated` is **not** stamped on these cards. `validateGeneratedCards`
stamps it because every caller until now was a model; it grows an option
(`{ provenance: 'authored' }`) that leaves the list empty. Nothing here was
machine-written, and the UI's "generated" chips would be a lie.

### 3e. Landing

Synchronous, inside the request, like the existing link route already does
its fetch: screen → fetch → parse → translate → validate → insert source →
insert deck → return the deck. There is no job row and no polling. A kit is
a few kilobytes of JSON and the whole thing takes less time than the quote
screen takes to render — which is why the quote screen is skipped (§12).

Ordering of writes: the source row first, then the deck that points at it,
in one `withUser` transaction, so a failure leaves nothing behind.

**Idempotency.** The source row's `sha256` is the hash of the canonical kit
(id, and for each question its id, text, and answers). Importing the same
unchanged kit again finds the existing source and returns its deck with
*"Already in your library."* Importing a kit that has changed since makes a
new source and — v1 — a new deck. v1.1 offers *"Update the deck you have"*
and runs the same term-matching merge `update_deck` uses (the MCP spec's
correction rule), so progress on unchanged cards survives a teacher's edit.

---

## 4. The paste path

`content_sources.kind = 'paste'` — declared in 0017, used by nothing until
now. The add-content screen gets a disclosure, *"Have the kit's export
text? Paste it,"* opening a textarea and an optional title. The parser:

- Splits lines; splits each on tabs (the export format), falling back to a comma-separated split for the CSV templates Gimkit's importer uses (**to verify** — the template article sits behind the bot challenge; the columns are believed to be *question, correct, incorrect 1–3*).
- Two columns → `term`, `definition`. Three or more → the rest are `distractors`.
- Honors nothing else. If Gimkit's **Flip** was on, the parent gets a flipped deck and a *"Swap sides"* button on the result card fixes it (the deck editor's existing swap).
- Same validator, same landing, same provenance except `kind`, `origin = 'paste'`, `mime = 'text/tab-separated-values'`.

This path also serves a teacher who wants to hand a family a private kit:
they export it and send the text. It never touches Gimkit's servers.

---

## 5. Multiple choice: distractors get a home

`QuizCard` has no field for wrong answers. Multiple choice is built at play
time from sibling cards' answers (`grading.ts` `buildChoices`), which works
for vocabulary and fails for a kit like *Ordering Numbers*: *"Which of the
following is in ascending order?"* has four hand-made options that are the
question, and three answers pulled from other cards make it nonsense.

So: `distractors?: string[]` on `QuizCard`, optional, at most 6, plain or
rich text, never containing the definition. Touches, in one commit:

| Where | Change |
| --- | --- |
| `packages/shared/src/progress.ts` | the field, documented next to `altAnswers` with the one sentence that keeps them apart: *altAnswers are also right; distractors are wrong* |
| `apps/api/src/schemas.ts` `quizCardSchema` | admit it, or the editor strips it on save |
| `packages/shared/src/ingest.ts` | `RawGeneratedCard.distractors`; the validator trims, dedupes against the definition and each other, caps at 6 |
| `packages/shared/src/grading.ts` `buildChoices` | **prefer the card's own distractors**, shuffled with the answer; fill from the pool only when fewer than three survive. `buildTrueFalse` draws its impostor from them first for the same reason |
| `packages/shared/src/tutor.ts` | nothing — rung 1 already calls `buildChoices` |
| capability matrix | a card with `distractors` reads `multiple-choice: ready` on its own, without needing three siblings |
| the editor | v1 shows them read-only under the card, *"Also offered: …"*, and preserves them on save. Editing them is v2 |

**Choice-bound cards** (§3d) are derived at play time from the question
text by one shared regex, not stored. They are offered only by activities
that show choices — multiple choice, the spoken tutor at rung 1 — and never
as typed or spoken recall, where the question has no answer to recall.
Ingestion's model-written cards can also carry `distractors` from now on;
that is a prompt change, not part of this spec.

---

## 6. Provenance, review, attribution

Ingestion's rule is *a generated set is a draft until a grown-up accepts it*
(ingestion §8), and migration 0017 gates assignment on `accepted_at`. The
rule's reason is that nothing the app claims may rest on unreviewed machine
output. A Gimkit kit is not machine output. A teacher wrote it, played it
in a classroom, and a parent chose to import it. It lands **accepted** —
`accepted_at = now()` at import, the same way 0024 treats a hand-made deck
— and is assignable immediately. It still carries `source_id`, so the
Library groups it under the kit's name (`source_map.title` is read by the
library heading today, and written by nothing until now).

Attribution is on the deck: the description says *Imported from Gimkit*,
the tag says `gimkit`, the source row keeps the kit id and the URL. A
parent looking at a card can find out where it came from. A learner cannot
tell the difference, which is right.

---

## 7. Terms, robots, and courtesy — the stance

The spec sets have had no position on fetching a third party's site because
no source until now was one. Gimkit is, and this is the stance, stated so it
can be argued with.

**What the facts support.** The kit is the teacher's content, and Gimkit's
terms say so; the teacher made it public and handed out the link; Gimkit's
own help says anyone with the link can see the questions and answers, and
Gimkit's own Export button exists to move a kit *"over to another site."*
`robots.txt` allows all paths to all agents and reserves only training
(`ai-train=no`), which we never do — nothing fetched is used for anything
but the one deck it becomes. The request we make is the request the
parent's browser makes when they open the link, once, on their instruction.

**What cuts the other way.** *"'Robot' (or automatic) activity is not
allowed"* is written about accounts and game play, but it is broad enough to
read against any script, and the endpoint is undocumented. The
reverse-engineering clause covers *Our Content* — Gimkit's software and
layouts — not member kits, and we copy no layout; but reading an internal
endpoint is closer to that line than reading a page.

**So the design is:** one fetch per kit per day, on a person's request,
under an agent that names us and links a page explaining what we do and
who to write to; no crawling, no search, no listing, no fetching anything
but the one kit id given; no account, no cookie, no game; a kill switch; a
drift detector that fails toward the sanctioned path rather than toward
trying harder; and the paste path shipped in the same release so that the
feature survives the link path being switched off. Before the link path
ships, a short note to `hello@gimkit.com` saying what it does and that we
will turn it off on request costs nothing and is the honest thing to do.
If Gimkit publishes an API, this spec is superseded by it.

Nothing in this section is legal advice. It is the reasoning, so the next
person can re-run it when a fact in §1 changes.

---

## 8. Failure modes

| What happened | What the parent sees | What we do |
| --- | --- | --- |
| not a Gimkit link | falls through to the document link intake | — |
| a join code | *"That's a live game code…"* | 400 `not_a_kit` |
| `No Kit Found` (500 from Gimkit) | *"Gimkit has no kit at that link. Check it, or ask for the practice link."* | 404 `kit_not_found` |
| not public, or the shape says private | *"That kit is private. Ask the teacher to press Export and send you the text."* paste box opens | 403 `kit_not_public` |
| shape drift, timeout, 403/429/5xx from Gimkit | §3c message; paste box opens | 502 `gimkit_unavailable`, `fallback: 'paste'`, logged |
| `GIMKIT_FETCH=off` | same as above, without the "changed" wording | 503 `gimkit_fetch_off` |
| everything skipped (all images, all inactive) | *"None of these questions could come over: 12 need their pictures."* | 422 `nothing_usable` with the reasons |
| kit already imported, unchanged | *"Already in your library."* → the deck | 200, existing deck |
| over the free-tier deck limit | the same refusal the library gives a hand-made deck | existing `assertUnderDeckLimit` behavior |

Every refusal is a sentence a parent can act on, and every one that is
Gimkit's doing rather than theirs opens the paste box.

---

## 9. Quota and abuse

No model runs, so no credits, no `llm_usage`, no `credit_ledger` row, no
quote, and no coverage check. What is spent is a request to someone else's
server and a row in our database, and both are capped:

- content route scope: 12 requests per hour per account (exists);
- Gimkit fetches: 20 per account per day, 1 in flight per instance, 500 ms apart, 24-hour memory per kit id;
- decks: the free-tier deck limit, as for any deck;
- source rows: a kit is at most a few hundred KB of JSON in `source_map` with images stripped; 25 MB cap on the fetch as for any source.

The link path is for signed-in adults only, as every content route is.

---

## 10. Data model

Migration **0025** — one line of change:

```sql
alter table public.content_sources drop constraint if exists content_sources_kind_check;
alter table public.content_sources
  add constraint content_sources_kind_check check (kind in ('upload', 'link', 'paste', 'gimkit'));
```

The source row for a kit:

| Column | Value |
| --- | --- |
| `kind` | `'gimkit'` (or `'paste'`) |
| `origin` | `https://www.gimkit.com/view/<id>` — canonical, whatever was pasted |
| `mime` | `application/json` (`text/tab-separated-values` for paste) |
| `bytes` | length of the fetched body |
| `pages` | null — there are none, and null keeps it out of `creditsForPages` |
| `sha256` | hash of the canonical kit (§3e) |
| `provider_file_id` | null — nothing is uploaded anywhere |
| `source_map` | `{ title, kitId, creator, questionCount, lang, gradeLevel, fetchedAt, skipped: [{ text, reason }] }` — images stripped |

`decks.distractors` needs no migration: cards are JSONB.

---

## 11. API surface

```
POST /api/content/sources/gimkit    { url: string }
POST /api/content/sources/paste     { text: string, title?: string }
  → 201 { deck: QuizDeck, source: { id, title },
          summary: { imported: number, skipped: Array<{ text: string; reason: string }>, choices: number } }
  → 200 (same body) when the kit was already in the library
  → 4xx/5xx { error: { code, message }, fallback?: 'paste' }   (§8)
```

Both under the content route scope (`requireCaller`, the hourly limit),
both `withUser` — RLS owns the deck row the same way it does for a deck
saved from the editor. The `content_sources` insert stays `withAdmin`, as
it is for every source kind, because 0017 grants clients select and delete
only.

`GET /api/content/status` grows `gimkit: boolean` so the screen can hide the
link hint when the fetch is switched off.

---

## 12. Web surface

The add-content screen (`/library/add`) already has a URL field. It learns
to recognize a Gimkit host as it is typed:

- the placeholder and helper text change to *"A Gimkit practice or view link"*;
- the **No rush** checkbox and the quote step disappear — there is nothing to quote;
- the button reads **Import**, and on success the running/finished panel is replaced by a result card: the deck's title, *"10 cards"*, the skipped list when there is one, and two buttons — **Open the deck** and **Set as work** (the assign form, pre-filled);
- on a Gimkit-side failure the message from §8 appears with the paste box open beneath it.

The paste disclosure lives under the URL field regardless, for the private
kit case. The deck screen shows distractors read-only under each card.
Nothing else in the web app changes; the Library already groups by source
and shows the source title.

---

## 13. Changes by layer

| Layer | Change |
| --- | --- |
| `supabase/migrations/0025_gimkit_source.sql` | the kind constraint |
| `packages/shared/src/progress.ts` | `distractors?: string[]` |
| `packages/shared/src/ingest.ts` | `distractors` on `RawGeneratedCard` and in the validator; `{ provenance }` option that skips the `generated` stamp |
| `packages/shared/src/grading.ts` | `buildChoices` and `buildTrueFalse` prefer the card's distractors; `isChoiceBound(term)` |
| `packages/shared/src/activities*` | `multiple-choice` ready when distractors are present; choice-bound cards excluded from recall kinds |
| `apps/api/src/content/gimkit.ts` | `screenGimkitUrl`, the zod kit schema, `kitToCards`, `parseExportText`, the canonical hash |
| `apps/api/src/content/fetch.ts` | a `userAgent` option; the per-host in-flight/spacing limiter |
| `apps/api/src/routes/content.ts` | the two routes, the `gimkit` flag on status |
| `apps/api/src/schemas.ts` | `distractors` on `quizCardSchema` |
| `apps/api/src/env.ts` | `GIMKIT_FETCH` (default on) |
| `apps/web/src/screens/content/ContentScreen.tsx` | host detection, the import flow, the result card, the paste disclosure |
| `apps/web/src/lib/content/api.ts` | `importGimkit`, `importPaste` |
| `apps/web/src/screens/quiz/DeckScreen.tsx` | distractors read-only |
| docs | this file; a row in build-sequence; ingestion §2 gains a pointer here |

No new dependency. The endpoint returns JSON, so there is no HTML to parse;
the paste parser is `split`.

---

## 14. Build order

1. **Fixtures first.** Record the two kits from §1 as JSON fixtures with images replaced by a short placeholder, plus one export-text sample. Every step below is tested against them.
2. **The field.** `distractors` through shared, the API schema, the validator, `buildChoices`. Tests: a card with four distractors is asked with exactly those; a card with one gets filled from the pool; true/false prefers a distractor.
3. **The extractor.** `gimkit.ts` with the URL screen, the schema, and `kitToCards`. Tests: the fixtures translate to the counts in §16; each row of the §3d table has a case; a mutated fixture (renamed key) fails the schema, not the translation.
4. **Migration 0025 and the route.** Fetch through `fetchSource` with the agent and the limiter; land; the failure table. Tests against a mocked fetch: every §8 row.
5. **The paste route and parser.** Same landing; tab and comma; flipped input round-trips through the swap.
6. **The screen.** Host detection, import, result card, paste disclosure, and the status flag hiding the hint.
7. **The note to Gimkit**, then the flag on in production.

Later, in this order: images into storage and onto `media` (the single
biggest fidelity gain — three of sixteen questions in one fixture);
*"Update the deck you have"* through the merge rule; editing distractors;
an optional paid enrichment pass that sends the kit as a text document
through the existing build pipeline for hints and explanations.

---

## 15. Open questions

| Question | Default | Why |
| --- | --- | --- |
| Accepted at import, or a draft like ingestion? | accepted | a person wrote it (§6); and the review screen ingestion's drafts are waiting for does not exist yet |
| Where do images go? | v1 skips them, v2 a storage bucket | no media storage exists; a data URL per card in JSONB is the wrong place; hotlinking a third party's image into a child's app is worse |
| Distractors on model-written cards too? | yes, later | same field, one prompt line; not this spec |
| Learner-owned import (a child pastes a link)? | no | content routes are adult-only; a child's decks are made in the editor. Revisit with the tutor-code work |
| Quizlet next? | not by link | Quizlet actively challenges non-browser requests; the paste path already accepts its export format, which is the same tab-separated shape |
| Tell Gimkit? | yes, before the flag goes on | §7 |

---

## 16. How we know it worked

- The ask's link, `gimkit.com/practice/64dcfb9c94b4e3002b739fba`, imports as *Ordering Numbers*: 10 cards, 10 with three distractors, 0 skipped, `accepted_at` set, grouped under its title in the Library, assignable in one tap.
- The student kit imports as *Gimkit*: 13 cards, 3 skipped for pictures, one card (*Name one appearing Gim…*) with three `altAnswers`, and every multiple-choice card asked with its own four options in a round.
- *"Which of the following is in ascending order?"* is never asked as typed recall, and is asked as multiple choice with the kit's own four orderings.
- The export text of either kit, pasted, lands the same titles and answers with no distractors and no error.
- A fixture with one key renamed produces the §3c message and the open paste box, one `gimkit_shape_drift` log line, and no source row.
- `GIMKIT_FETCH=off` produces the paste message and makes no request.
- Importing the same link twice makes one source row and one deck.
