# UX coherence — one product, not four

**Status: built 2026-09-11** (everything below except the “leaves open” list; migrations 0026 and 0027 applied). This document is the authority on
vocabulary, on which screen owns what, and on the handful of models that used
to exist twice. Where another spec disagrees on a *word*, this one wins; where
it disagrees on a *mechanism*, the other spec wins and this one is wrong.

## Why

Whizzo grew in layers: a typing game, then adaptive spelling, then decks, then
tasks, the planner, rewards and the tutor. Each layer brought its own nouns,
its own home screen, its own idea of who the user was, and in two cases its own
copy of a thing that already existed. The audit that started this (below)
found three separate collectible systems, four names for the deck subject,
a typing course that lived only in one browser's localStorage, and a home
screen that greeted the child with the parent's name.

The fix is not a redesign. It is a set of decisions, written down, and the
code brought into line with them.

## The vocabulary

One word per thing. UI copy uses the left column; code and the database may
keep the right one.

| Say | Never | Notes |
| --- | --- | --- |
| **Whizzo** | Cat Academy, Keyboard Cats, Spelling Cats | The wordmark is lowercase as a logo; prose capitalizes. |
| **Spelling**, **Typing**, **Flashcards** | Quiz, Study (as a subject) | The three subjects. Routes keep `/quiz`; the word does not appear on screen. |
| **deck** | set, quiz | The container flashcards come in. "My decks" is the learner's list. |
| **card** | — | A flashcard. Never a collectible — those take the theme's word. |
| **round** | session | One sitting of one activity, in copy. `sessions` stays the table. |
| **task** | assignment, work | "Set a task", "Tasks you have set", "Set as a task". The model keeps `assignment`. |
| **My word lists** | custom lists, lists | The learner's or grown-up's own spelling lists (`/custom-lists`). |
| **Spelling lists** | Word Lists | The built-in grade curriculum (`/spelling/lists`). |
| **Library** | — | A grown-up's own decks and word lists (`/library`). |
| **theme** | world (for the theme) | Cats, Dogs, Space… "Pick your theme" (`/theme`). |
| **the theme's collection** (Card wall, Dig site…) | world, trophies | The collectibles screen (`/world`). Its title is `theme.worldNoun`. |
| **`theme.unit`** (cat cards, fossil bones…) | collectibles, stickers | The learner-facing name for what they collect. |
| **badge** | trophy, achievement | The unlockable named milestones. "New badge!" |
| **reward** | prize, payout | A grown-up's promise (ice cream, screen time). Never the theme collectible. |
| **Typing lessons** | Choose a Level, world map | The `/typing/map` screen. |
| **Progress** | History | The grown-up's report (`/progress`). The people screen's button says Progress. |
| **Family** / **Learners** | — | The people screen (`/family`) and its nav button. "Family" for a parent, "Learners" for a tutor or teacher — decided by `useAudience()` from the links the account holds (owner or parent-by-code → Family; teacher-by-code only → Learners; nobody yet → what they said at sign-up). |

## Who is on screen

The app has exactly one role distinction, `isLearnerSession` from
`useLearners()`: the signed-in user *is* the active learner (signed in with a
code, or a teenager with their own account). Everything else is a grown-up
looking at a learner.

| | Learner session | Grown-up |
| --- | --- | --- |
| Home hero | "Hi, {learner}!" and the next thing to do | the same — a parent handing over the tablet is handing over the learner's home |
| Home nav | Flashcards, Spelling lists, Badges, Theme, Settings | + Tasks, Family (or Learners), Progress, Planner, Library |
| Learner chip (solo) | opens Theme | opens Family / Learners |
| Account chip | Me: name, avatar, sign out | Account: profile, coverage, library, tutor code, apps |
| `/family`, `/library*`, `/upgrade`, `/connect` | redirect home | as today |
| `/tasks` | To-do and Done only | + Set a task, Tasks you have set |
| Deck delete | own decks only | own library decks; withdraw a task instead of deleting a set one |

The greeting on home always names the **active learner**, never the account.
The learner chip and account chip in the header say who is who.

## Home: one door, not ten

The hero button does the next useful thing and says so. In priority order:

1. an open task → "Start: {title}" (overdue first)
2. cards due across decks → "Review {n} cards"
3. spelling words due → "Practice {n} words"
4. spelling not yet placed → "Find my level"
5. otherwise → "Practice spelling"

The theme verb ("Pounce in") stays on the theme picker cards only. The eyebrow
keeps the theme name and streak.

## Decks: nothing reaches a learner uninvited

Three ways a deck is in a learner's list, and each can be undone:

| How it got there | Shown as | Removed by |
| --- | --- | --- |
| The learner (or a grown-up on their behalf) made it | *Mine* | Delete, on the deck |
| A grown-up set it as a task from their library | *Set by a grown-up* | Withdrawing or canceling the task |
| The learner added a starter deck | *Starter* | Remove, on the deck |

Starter decks are a **catalog**, not a default. They appear under "Add a
starter deck" on the Flashcards screen and do nothing until added. The set a
learner has added lives on `learners.starter_decks` (migration 0026), and the
one-time backfill adds any starter deck the learner had already practiced.

Every total — "N of M cards mastered", "due for review", the review round,
the offer-a-reward deck picker — counts only the learner's list.

A canceled task no longer keeps its deck in the learner's snapshot.

## Rounds: what a grown-up can see

Every round a learner plays already lands in `sessions` + `attempts` with a
start, an end, and every answer. The gaps were in *showing* it:

- **Deck screen** gets "Rounds on this deck": each round with date, mode,
  score, duration, and the per-card answers on expand.
- **Progress** lists every round in the coverage window, filterable by
  subject, not the first fifteen.
- **Tutor study rounds** (MCP `study` mode) now write a session row like every
  other round — marked practice-only with nothing checked, so they close no
  task and earn no reward, but they show up.
- Typing's per-lesson state (stars, plays, best) is read from `list_progress`
  in the account, not from this browser's localStorage. A lesson done on the
  iPad is done on the laptop.

## One collectible system

There were three. There is one:

- **What the learner collects** is `theme.unit`, computed by `earnedFor()` from
  checked rounds. It is the same number on home, on the theme's collection
  screen, on every results screen, and in the badges room. The typing game's
  private `collectedCats` list is gone from every screen.
- **How it is earned** (unchanged for spelling and flashcards; typing joins):
  1. a graded, checked round that clears its predicted accuracy;
  2. a level promotion;
  3. a typing lesson cleared at 90%+ accuracy, once per lesson.
  Typing rounds are app-checked, so they now carry `verifiedItemsTotal`.
- **Rewards** are the grown-up's promises. The learner sees what they are
  working toward on home, read-only. The ledger, paying and offering live in
  Family. The "checkpoint" criterion is not offered until checkpoints exist.
- **Badges** are the third thing, and the only word for them.

## Back means back

`ScreenHeader` takes `back: Route` — the natural parent — and goes to the
previous history entry when there is one, the parent only on a cold link. No
screen hard-codes where you came from.

## What this leaves open

- The dictation voice is the one setting still per device, on purpose: a
  voice is a URI the browser makes up from what is installed, and the same
  URI does not exist on another device. Everything else a learner can set —
  sound, the typing helpers, the flashcard layout, the strike-out on multiple
  choice — is on `learners.settings`
  (migration 0027), and arcade high scores and typing badges are read from
  the account like every other subject's.
- Reward templates, the points store, the `claimed` step and the `record`
  reward shape are their own build stage, not part of this pass
  (learning-activities-spec §10–11, build-sequence stage 7). Rewards with an
  end date now lapse in the ledger when that day passes.
- The one word for the people screen is decided from links the account holds;
  a tutor who also owns a child of their own sees "Family".
