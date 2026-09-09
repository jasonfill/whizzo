# 🐱 Cat Academy — a learning suite for kids, disguised as a cat game

Three subjects so far, one account, one progress record:

- **🐈‍⬛ Spelling Cats** — adaptive spelling from 2nd through 8th grade. The app
  works out what a learner can actually spell and keeps them at the edge of it.
- **⌨️ Keyboard Cats** — the original gamified touch-typing course: worlds,
  lessons, arcade modes, and a cat card collection.
- **🃏 Quiz Cats** — flashcards for anything else. Build a deck (or paste one
  in) and study it four ways, on the same adaptive engine as the spelling.

Free curriculum, ad-free, and behind an account: signed out, the app serves the
marketing site and nothing else. Practice is only worth recording when it is
attributed to a learner, so there is no guest mode to fall into.

## Architecture

An npm workspace with three packages:

| Package | What it is |
| --- | --- |
| `apps/web` | The React SPA. Holds a Supabase session for auth; gets all data from the API. |
| `apps/api` | Fastify. The only thing that talks to Postgres. See [apps/api/README.md](apps/api/README.md). |
| `packages/shared` | Domain types and the wire contract, imported by both. |

A **learner** is a profile owned by an adult, not an auth user — that is what
lets a child have a full record without the app collecting an email address from
them. An auth identity is optional and comes in three shapes (`none`,
`provisioned`, `self`), and `self` is gated on age 13+ in the database. See
[supabase/README.md](supabase/README.md).

Deployment is one DigitalOcean App Platform app serving the SPA and the API
under one hostname ([.do/app.yaml](.do/app.yaml)).

```bash
npm install
npm run dev:all    # the SPA and the API together
npm test           # typecheck, lint, curriculum and adaptive-engine checks
```

For a fully local Postgres and Auth rather than developing against the hosted
project, see [LOCAL.md](LOCAL.md).


## Run it

Requires **Node 18+**.

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build            # production build into dist/
npm run preview          # preview that build
npm run lint             # eslint
npm run validate:words   # sanity-check the spelling curriculum
npm run simulate:adaptive # put simulated learners through the adaptive engine
npm test                 # all of the above, plus typecheck and the unit tests
```

Accounts and cloud sync need a Supabase project — see
[`supabase/README.md`](./supabase/README.md). **Without it the app still runs**
unauthenticated against `localStorage`, because signing in would be impossible
otherwise; every configured build gates the whole app behind sign-in.

## How the spelling actually adapts

The claim "adaptive" is cheap, so here is precisely what drives it. Nothing in
the system is configured by hand; every number below comes out of words the
learner attempted.

### 1. One scale for learners and words

Learner ability and word difficulty live on the same axis, and that axis is
roughly "school grade". A word's difficulty starts at the grade band it is
taught in, then moves within that band for length, syllable count, and the
spelling patterns that reliably catch people out — `ough`, silent openers,
doubled consonants, `-ance`/`-ence`, French borrowings. So `cat` and `grass`
are not treated as equally hard just because both are 2nd grade.

Because the two share a scale, the model can answer a useful question about any
word the learner has never seen: *how likely are they to get this right?*

```
P(correct) = 1 / (1 + e^((difficulty - ability) × 1.15))
```

### 2. Ability moves on evidence

After each graded attempt the estimate shifts by the gap between what happened
and what the model expected — the same update an Elo rating uses, and the
discrete-response cousin of the item response theory behind standardized
reading assessments. The learning rate starts high so placement converges in a
handful of words, then decays so a single bad round cannot undo a month.

**Only unaided spelling counts.** Unscrambling letters, filling blanks, and
picking the right option out of four are all good practice, and none of them
move the level. Ask for a hint and that word stops counting too. This is the
one rule that keeps the number honest.

### 3. Words come back on their own schedule

Every word carries its own spaced-repetition state. Get it right and the
interval climbs `1 → 2 → 4 → 8 → 16 → 32 → 60` days, stretched a little for
words below the learner's level and compressed for words above. Get it wrong
and it is due again **immediately** — so it reappears in the next round of the
same sitting, not tomorrow. Waiting a day to revisit a word somebody got wrong
five minutes ago wastes the moment they are most primed to fix it.

Mastery per word is a recency-weighted share of graded attempts, so the last
answer counts most, and a word needs two correct in a row before it is called
mastered.

### 4. Sessions are built, not shuffled

A round of Smart Practice is assembled from the learner's own history:

| Share | What | Why |
| --- | --- | --- |
| up to 40% | words they have missed and that are due | the whole point of review |
| up to 20% | mastered words due for maintenance | stop them decaying |
| the rest | unfinished words from the current grade, most winnable first | forward progress |
| a few | words from the grade above, when ability is running high | a stretch worth attempting |

Review is deliberately capped: a round made mostly of words you already got
wrong is accurate and demoralising.

### 5. Moving up a grade takes three signals

Promotion needs the ability estimate to clear the level, most of the level's
words to be genuinely mastered, and recent graded accuracy to be high. Three
independent things have to agree, so a lucky streak is not enough.

There is a second route up. A learner who arrives already spelling well above
the band tests out on evidence alone rather than grinding through sixty words
they can already spell. Demotion is easier to trigger than promotion, because
being stuck one band too high is far more damaging than one band too low.

### 6. Stars are graded on a curve

A learner practicing at their frontier is *meant* to miss things. Scoring them
against a flat 90% would hand out one star forever and teach them that working
at their level is failure. So each round is also scored against what the model
predicted for that exact set of words — beat your own prediction and you get
the third star, whatever grade you are on. The results screen shows both
numbers.

### Does it work?

`npm run simulate:adaptive` runs simulated learners with a hidden true level
through the real engine. It checks two different things:

- **Measurement** — learners whose ability never changes should be placed on
  their true level and stay there. They converge within about a tenth of a
  grade, and crucially do *not* drift upward.
- **Progression** — learners who genuinely improve should be noticed and moved
  up. Their error rate on a word's third look drops by 20–45% against its
  first.

This is a real check, not decoration: it is what caught strong spellers
stalling mid-curriculum, and it is what caught missed words never returning
within a session.

## The activities

| Activity | What it does | Counts toward level |
| --- | --- | --- |
| 📖 Study the List | See it, hear it, type it with the word in front of you | no |
| 🎧 Listen & Spell | Hear it in a sentence, spell it from memory | yes, unless you take a hint |
| 🧩 Missing Letters | Fill in the letters most likely to trip you up | no |
| 🔀 Word Scramble | Rebuild the word from its letters | no |
| 🔍 Proofread | Pick the right spelling out of four | no |
| 📝 Spelling Test | No hints, no second chances | yes |

Dictation uses the browser's speech synthesis — no audio files, no API. Devices
with no voice installed fall back to look-cover-write-check: the word flashes,
hides, and then you spell it.

The proofreading distractors are generated from real error patterns rather than
random typos: dropped halves of doubled consonants, `ie`/`ei` swaps, `-able`
for `-ible`, silent letters lost, `ph` written as `f`, schwa vowels guessed
wrong, apostrophes misplaced in contractions.

## Quiz Cats

Quizlet-shaped, but running on the engine above rather than a plain shuffle.
A deck is a list of two-sided cards — vocabulary, capitals, dates, formulas,
anything with a question and an answer.

| Mode | What it does | Counts toward level |
| --- | --- | --- |
| 🃏 Flashcards | Flip at your own pace, then say whether you knew it | no — self-graded |
| 🧠 Learn | Multiple choice at first, written recall once you are ready | written answers only |
| ⚡ Match | Race the clock pairing every card with its answer | no |
| 📝 Test | A mixed paper — choice, true/false, and written — with no hints | written answers only |

Three things make this more than a card shuffler:

**Learn escalates per card, not per round.** A card you have never met is asked
as multiple choice, because recognition is where recall starts. Once you are
answering it reliably, the same card comes back as free writing, which is the
only format that proves you can produce the answer unaided. One deck can hold
forty cards at forty different stages and every question still lands at the
right level.

**Only unaided recall moves your ability.** Recognizing an answer among four is
evidence about that card, so it updates the card's mastery and its review
schedule — but it never moves the learner's ability estimate. A run of lucky
four-way guesses should not read as getting cleverer.

**A card you miss comes back before the round is out.** Flashcards and Learn
push a missed card back into the queue four places ahead, so you meet it again
while the correction is still fresh; the round ends when every card has been
retired, not when the cards run out. A card you cannot get after three tries is
parked and left to the review schedule rather than looped forever. Because a
card can come round more than once, the score is your accuracy *first time* on
each card — going back over something you missed can only help you. Test is the
exception, and deliberately so: it is a measurement, and a paper that keeps
handing your mistakes back until you fix them measures something else.

**Self-grading is trusted asymmetrically.** Flashcards are the only mode where
the learner grades themselves, and the two answers are not worth the same.
"I missed it" is bad news volunteered against your own interest, so it counts
in full. "I got it" is a claim nobody checked: it earns a fraction of the
mastery a checked answer does, is capped below the mastered band, does not
advance the card's streak, and buys at most a few days before the card is due
again. Tapping "Got it" on a card you did not know gets it back tomorrow rather
than out of your queue — mastered always means the system watched it happen.
Every attempt is stored with a `verified` flag saying which kind it was.

**Review crosses decks.** Every card carries its own due date, so the home
screen offers one queue drawn from every deck you own, ordered by what you are
closest to forgetting.

Typed answers are graded with a tolerance that scales with the answer's length:
one slip in a four-letter word is probably a different word, one slip in a
fifteen-letter word is a typo. Near misses are marked "so close", shown the
correct spelling, and credited — penalizing a transposed letter on a biology
deck tests typing, not biology. Answers written as `couch / sofa` accept
either, and a leading article is always optional.

Decks are built by hand or pasted in whole. The importer auto-detects whether
the two sides are separated by a tab, comma, dash, or colon, handles
definitions that run over several lines, and reports the rows it could not
parse instead of quietly mangling them.

**Cards can carry math and figures.** `$\frac{3}{4}$` sets a fraction as real
MathML, equations pasted out of Word come in as they are, and
`[[figure {"kind":"triangle", …}]]` draws a labeled triangle, a bar chart, a
number line or a coordinate grid — which is what it takes to ask a geometry
question at all. Typed answers are graded against what the math says, so
`$\frac{3}{4}$` is answered by typing `3/4`. See
[docs/card-formatting.md](docs/card-formatting.md).

## The curriculum

420 words across 42 lists, 2nd through 8th grade, each with an example sentence
that is read aloud for context. Lists are organized by the rule they teach —
short vowels, magic e, bossy R, compound words, `-tion`, homophones, Greek and
Latin roots, silent letters, `-able`/`-ible`, rule breakers, bee-level words.

Nothing is locked. `npm run validate:words` enforces the invariants the engine
relies on: unique words, every sentence contains its word, and difficulty that
rises monotonically with grade.

Parents and teachers can also paste in their own list — one word per line, with
an optional sentence after a tab, a `|`, or a `-`.

## The marketing site

Signed out, the app is a site rather than a page. `screens/marketing/` holds
seven of them — the front page, Features, How it works, Pricing, Privacy, FAQ,
and one page per audience at `/for/parents`, `/for/teachers`, `/for/tutors` and
`/for/homeschool` — sharing a header, footer and set of section primitives from
`chrome.tsx`.

Four rules keep it honest, and `marketing.test.tsx` pins all four:

- **A button is a door; a link is a page.** Anything moving between marketing
  pages is a real `<a href>` built from `routeToPath`, so it can be opened in a
  tab, hovered for its URL and followed by a crawler; a modifier-click is left
  to the browser. Every `<button>` on the site goes to `/signin` — the sole
  exception being the control that opens the mobile menu of those buttons.
- **Nothing leads into an activity.** A visitor has no learner, and practice
  that is not attributed to one moves no level and lands on no report.
- **Claims are quoted, never restated.** Prices come from
  `@whizzo/shared/billing` — the module a charge would be built from — and the
  activity table on Features is generated from `ACTIVITIES` and `MODES`, so a
  new activity appears on the site and cannot appear with the wrong rule beside
  it.
- **One product, four pages.** A parent, a tutor and a teacher get the same
  screens and the same permissions, so `AudienceScreen` is one component with
  four sets of words in `audiences.ts`. What genuinely differs is who pays, and
  that is the fact each audience page leads with.

The pages are reachable only while signed out. A signed-in grown-up asking what
coverage costs has `/upgrade`, which can answer it about their own children
rather than in general.

## Accounts and progress

- **Account first.** A visitor gets the marketing site
  (`screens/marketing/`) and two doors: sign in, or a child's
  code and PIN. No activity is reachable until one of them is used.
- **Sign up with email or Google.** Progress found in `localStorage` from before
  the gate — or from a build with no database behind it — is merged into the
  account on first sign-in: counters add, bests win, and the local copy is only
  cleared once the merge is written.
- **Attempts are the record.** Every table other than `attempts` is a cache that
  can be rebuilt from it, and `rebuild_item_mastery()` in the database does
  exactly that — from checked answers only, because a rebuild is meant to derive
  mastery from what was demonstrated and a self-grade is not a demonstration.
- **Row Level Security everywhere.** A learner can only read and write their own
  rows, and cannot change their own plan.

## What a grown-up can see, and why it can be believed

Progress → **Recent sessions** opens any round to show every answer in the order
it was given: what was asked, what the child answered, how long each one took,
whether a hint was used, and whether the app checked the answer or the child
graded themselves. A card that came round twice appears twice, marked as a
second try.

Three properties make that history worth reading rather than just pretty:

- **The summary is derived, not asserted.** A round arrives as attempts plus the
  client's summary of them. The API recomputes the counts from the attempts and
  stores its own answer; the session says so (`evidence = 'attempts'`). Rounds
  that genuinely have no per-question record — typing counts keystrokes — are
  labeled `'client'` instead of being quietly treated the same.
- **Verification is decided by the mode, not claimed by the caller.** Flashcards
  are self-graded by construction, so an attempt from that mode is recorded as
  unverified whatever the request says. Every session carries
  `verified_items_total` alongside its score, and the history screen shows
  "0/14 checked" on a round nobody checked.
- **The trail is append-only.** `attempts` grants `insert` and `select` and
  nothing else, so a child signed into their own account can add to their
  history and never revise it. Erasing progress still works — it is the owner's
  to do, through `erase_learner_progress()`, not the child's.

All three are pinned in `supabase/tests/0007_attempt_integrity_test.sql`.

The honest limit: the server checks *how* an answer was given, not whether the
answer was right. Re-grading would mean holding every deck's contents server
side, and the starter decks ship in the client. A modified client can still post
a wrong answer marked correct — what it cannot do is grade itself into mastery,
edit the record afterwards, or make a summary disagree with the answers behind
it.

## Tasks and the family dashboard

A grown-up sets work — a deck to learn, a spelling list to be tested on, a
typing lesson — and it appears on the child's home screen as a task list with a
Start button that opens exactly that activity.

**Nothing is ticked off.** A task is closed by
`complete_matching_assignments()` when a round lands that matches its subject,
activity and target, in the same transaction that records the round. The task
then stores that round's id, so "done" always has evidence behind it and the
task list can open the answers in place. Erasing progress reopens the tasks
those rounds had closed, rather than leaving them claiming to be finished.

**A score bar is judged on checked answers.** A task can require, say, 80%, and
that is measured against `verified_items_*` — the answers the app checked. A
self-graded round has none, so it cannot clear a bar, and the form only offers
the option on graded work rather than letting somebody set a task that could
never be completed.

**Setting work is not content management.** `can_manage_learner_content()`
deliberately counts a learner as able to manage their own decks; homework they
could write and edit themselves would be pointless, so assignments use
`can_assign_to_learner()` — the owner, or a guardian trusted with content. A
learner can read their list and nothing else. All of it is pinned in
`supabase/tests/0008_assignments_test.sql`.

**Oversight lives in Family**, not on a screen of its own. Each child's row
there already says who they are; it now also says how they are doing —
outstanding tasks, what is overdue, when they last practiced, minutes and
questions this week, accuracy over checked answers, and their streak — with
buttons straight into that child's tasks or history. One aggregated query for
the whole family rather than a progress snapshot per child.

**One piece of work, many learners.** The work and the doing of it are separate
tables: `assignment_sets` holds the definition, `assignments` holds one row per
learner with only their own state. So the same task goes to two siblings or a
tutor's whole class in one action, is edited in one place, and answers "who has
done this yet?" in one query — while each child finishes their own copy
independently.

The visibility rules matter most when the learners are in different families:

- a set is readable by its author and by anyone linked to a learner it was given
  to — that is the work's text, and they need it;
- a set is editable only by its author, so one parent cannot rewrite what
  another family's child is looking at;
- the per-learner rows keep their own rule, so a parent sees their own child on
  a shared task and never learns who else was given it. Authoring the work does
  not grant sight of other people's children.

Tasks are set through `POST /assignments`, which takes a list of tasks and a list
of learners — a grown-up planning a week sets several at once, and so would
anything that eventually drafts them automatically.

## The library

Decks and word lists belonged to a *learner* from the moment the app had
accounts, which is right for a child making their own flashcards and wrong for
anybody teaching more than one person: material ends up filed under whichever
student was on screen, and reusing it means copying it.

So content has two possible owners, and exactly one of them at a time:

- **a learner** — their own material, as before; or
- **a grown-up** — their library, reusable across every learner they work with.

The rule that makes a library worth having is the third one: a learner can read
library content that has been *assigned* to them, and nothing else from that
library. `content_assigned_to_visible_learner()` asks the plain question — is
this deck set as work for somebody I can see? — so a student can open the deck
their tutor set them, their parent can see it too, and neither gets anything
else the tutor has made. Withdrawing the work closes the deck again.

Library content is readable that way but never writable: a tutor's deck is in
use by their other students, so a family cannot rewrite it out from under them.

The Library screen is also where work gets set, because "set this for three of
them" starts from the material rather than from a child. It is reached from
**Your account**, alongside your connection code: the child's home screen is
the child's, Family is the people you look after, and your account is your own
things. Pinned in `supabase/tests/0011_library_test.sql`.

## Tutors, teachers, and who lets them in

A tutor mints one **connection code** that stands for them — not for a learner —
and hands it to the families they work with. Each family enters it, sees whose
code it is, chooses which of their children it applies to, and confirms.

The arrow runs this way round for a reason. The older invite has a parent mint a
code for one child and give it to another grown-up, which is right between two
parents and wrong for a tutor with twenty students: it makes twenty families
each perform a setup step before the tutor can do anything.

What keeps it safe is that **minting grants nothing**. A code is a business card,
not a key. The grant happens on redemption, and `redeem_connection_code()`
refuses anyone who does not *own* the learner — a parent for their child, or a
13+ learner who owns their own profile acting for themselves. A guardian who was
themselves let in cannot pass that access on. Families can disconnect a tutor
whenever they like, and withdrawing a code stops new families joining without
evicting the ones already there.

`describe_connection_code()` exists so a family can see who they are letting in
*before* they let them in — typing eight characters and hoping is not consent.
It returns the tutor's name and what the link would allow, and nothing about
their other students.

**Tutor is a property of the link, not of the account.** `guardian_links.role`
carries it, because the same person is a parent to their own children and a
tutor to somebody else's, and an account-wide type could not say that.

This is also why there is no tutor *mode*. A parent and a tutor use the same
screens, the same library, the same assignments and the same permission checks;
what differs between them is wording and scale, not capability. Building two
products would mean maintaining two, and getting the second one wrong.

Pinned in `supabase/tests/0010_tutor_codes_test.sql`.

## Plans

The whole curriculum is free, on purpose: a spelling app that paywalls fourth
grade is not much use to the kid who needs fourth grade. **Family Pro** pays for
the reporting and list-building tools grown-ups ask for — unlimited custom
lists and study decks, full history instead of the last 30 days, the
word-by-word mastery report, printable sheets, CSV export.

Free keeps three study decks of your own; the starter decks that ship with the
app never count against that.

Plans are modeled end to end in the schema and gated in the UI. No payment
processor is connected yet; wiring Stripe in means a webhook that updates
`profiles.plan`.

## Testing and deployment

`npm test` is typecheck, lint, the vitest suites in `apps/api` and `apps/web`,
the curriculum validator and the adaptive-engine simulation — in that order,
stopping at the first failure. It needs nothing from the environment: the API's
route tests mint real tokens and verify them for real, but stub the database
entirely.

So it proves everything above Postgres and nothing inside it. **Row Level
Security is the actual security boundary between families, and no unit test
touches it** — that needs a real database and lives in
`apps/api/scripts/smoke.mjs`, run against a scratch project.

### Pushing to `main` deploys

Both components have `deploy_on_push`, so a merge to `main` ships. Two things
follow from that, and the second one surprises people:

**Tests gate the deploy.** `npm test` runs inside the `api` component's build
command. A failure fails the build, the deployment is not promoted, and the
previous one keeps serving. This is deliberately *not* a GitHub Actions job:
`deploy_on_push` answers the push webhook and never reads GitHub's commit
status, so a test workflow would race the build rather than gate it — going red
some minutes after the bad commit was already live. A deployment is atomic
across components, so running the suite on `api` alone covers `web` too.

**Pushing does not deploy configuration.** App Platform does not read
`.do/app.yaml` from the repository; the spec lives in DigitalOcean and the file
is a version-controlled copy of it. Environment variables, routes, instance
sizes and the build commands themselves only change when you apply it:

```bash
doctl apps update <app-id> --spec .do/app.yaml
```

Secrets are declared in that file with no values. Re-render before applying if
you touched one — see [.do/README.md](.do/README.md), which covers the first
deploy, both Supabase connection strings, migrations at startup, and rollback.

The GitHub Pages workflow in `.github/workflows/deploy.yml` is manual-dispatch
only. It is kept, not deleted, so the last static-only build can still be
produced by hand if the DO app ever has to be rolled back to it — but a Pages
build has no API behind it and would fail every request that needs data.

## Tech

React 18 · TypeScript · Vite · Tailwind · Fastify · Supabase (Postgres + Auth),
deployed as one DigitalOcean App Platform app.

## Project layout

```
src/
  auth/         AuthProvider (email + Google), sign-in screen
  data/
    spelling/   grade 2-8 word lists, difficulty model
    quiz/       starter decks that ship with the app
    lessons.ts  typing curriculum
  lib/
    adaptive.ts       ability estimation, spaced repetition, promotion
    plans.ts          free vs pro limits
    progress/         storage boundary: types, local repo, cloud repo, merge
    quiz/             decks and import, question generation, study planner
    spelling/         session planner, activities, speech, selectors
  hooks/        useSpellingSession, useQuizSession, useGameState, useTypingEngine
  screens/
    quiz/       deck list, deck detail, editor, and the four study modes
    spelling/   spelling home, play, results, list browser
    suite/      hub, progress dashboard, account, plans, custom lists
scripts/        curriculum validation, adaptive-engine simulation
supabase/       schema migration and setup guide
```
