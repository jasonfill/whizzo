# Weekly planner — courses, the week, and studying backwards from a test

**Status:** built · **Date:** 2026-09-06 · **Migration:** 0019 (registry in [build-sequence.md](build-sequence.md)) · **Scope:** packages/shared, apps/web, apps/api, one additive migration

The problem this solves is not that students lack a place to write things
down. It is that **most students do not know how to plan**, and a blank grid
of seven days does nothing for someone who has never been shown what goes in
it. Given a test on Friday, the untrained move is to do nothing until Thursday
night, and no calendar changes that.

So this is a planner that **proposes**. It knows the learner's classes, it
knows when the test is, it knows how hard the learner thinks it will be, and
it puts study sessions on the days they belong to — each with a purpose, not
just a time. The learner keeps every session, moves it, or drops it. The
scaffold is always there and never in the way.

Two principles carry the whole design:

1. **The planner is the learner's.** It lives on the learner's side of the
   product, in the learner's voice. Grown-ups see it, add to it and comment on
   it — attributed, every time — but it is never a place where work is done
   *to* the learner. This is the same placement rule the suite already holds:
   the child's home screen is the child's.
2. **Two kinds of done, never confused.** A study session that runs a real
   round in the app is closed by that round, with the session as evidence —
   the same rule as assignments. A session the learner did with a textbook is
   ticked by hand and shown as a claim. Both are fine. Both are labelled.
   Nothing here is ever payable through a reward unless it was checked.
3. **Everything is a card, and one gesture moves it.** Adding a task is one
   line of typing. Moving it is one drag. Finishing it is one swipe or tap.
   If keeping the planner up to date costs more than the plan saves, nobody
   maintains it — so the interaction budget in §5 is a design constraint,
   not a polish item.
4. **Every card remembers.** Each add, move, tick, un-tick, skip and delete
   is written to an append-only log by the database, not the client, with
   who did it and when. A parent or tutor can open any card, this week or
   last term, and read what happened to it. The learner reads the same log —
   it is a record, not surveillance, and the difference is that both sides
   see it.

---

## 1. Courses — a learner's enrolments

Everything else hangs off this, so it comes first.

A **course** is a class the learner is enrolled in: *Biology*, *Mr Okafor's
Algebra 1, period 3*, *Spanish II*. It is the learner's, it is open-ended, and
it exists so that a task can be filed under a class with one tap instead of a
retyped word.

It is **not** a track. The distinction matters and the existing
content-structure spec already drew it, between a global objective and a local
scope:

| | **Track** | **Course** |
| --- | --- | --- |
| What it is | an ability pool — *Biology* as a body of knowledge | an enrolment — *Ms Reyes' Biology, this year* |
| Who defines it | us, closed list | the learner or a grown-up, freely |
| Scope | global, permanent | one learner, one term |
| Computes anything | yes — ability, mastery, retention | no |
| Example count | ~25 | 5–8 per learner, per year |

**A course cites a track.** That one field is what lets the picker on a task
"back into the same selection we have for other content": choosing *Biology*
on a task files it under `science.biology` for free, a deck made for that
course inherits the track, and the readiness number before a test is computed
from the right ability pool without anybody being asked twice. The track is
suggested from the course name (a short synonym map — "bio", "chem", "algebra",
"spanish") and always overridable; General is a real track, not an error.

```ts
export interface Course {
  id: string
  learnerId: string
  name: string               // 'Biology'
  track: TrackId             // 'science.biology' — suggested from the name
  teacherName: string | null // 'Ms Reyes'
  period: string | null      // '3rd', 'Block B'
  color: string              // one of a fixed palette; the chip colour everywhere
  emoji: string | null
  /** 'Fall 2026', 'Year 7'. Free text; sorting is by startsOn. */
  termLabel: string | null
  startsOn: DayString | null
  endsOn: DayString | null
  archivedAt: number | null
  sortOrder: number
  createdBy: string
}
```

### Where courses appear

- **The course picker**, wherever a task, test or deck is filed: a row of
  coloured chips, the learner's active courses, plus *Other*. No typing.
- **Decks and word lists owned by the learner** gain an optional `courseId`.
  Library content owned by a grown-up does *not* — a library deck is reused
  across many learners in many classes, and a course belongs to one learner.
  When a grown-up assigns a `science.biology` deck to a learner with exactly
  one course on that track, the per-learner assignment row is filed under that
  course automatically; with two or more, it is left unfiled and the learner
  can file it.
- **Per-track reporting** gets a course name next to the track when one
  exists: *Biology (Ms Reyes) · 62%* reads better to a parent than the track
  id, and costs one join.
- **Course settings** live in the learner's planner. A parent can also manage
  them from the learner's row on Family, because setting up a twelve-year-old's
  timetable in September is usually a parent's job.

### Terms and rollover

A course has an optional start and end. At the end, it is archived rather than
deleted: the tasks and tests filed under it stay readable in history, and the
picker stops offering it. A "new term" action offers to copy last term's
courses with the dates cleared, because most of a child's timetable survives
from one semester to the next.

---

## 2. The week

Monday to Sunday. A school week, matching the seven-day "coming up" horizon
the retention model already uses. Weekend days are shown smaller, not hidden:
Sunday evening is when a lot of the week's planning actually happens.

Each day holds **items**, in three kinds:

| Kind | What | Closed by |
| --- | --- | --- |
| `task` | a piece of homework or a to-do: *Bio worksheet p.42*, filed under a course | by hand — a claim |
| `study` | a study session, usually one the planner proposed for a test | a real round if linked to content; by hand otherwise |
| `event` | a test, quiz, due date or milestone. Not done; it happens | it is a date, nothing closes it |

Alongside the stored items, the assembled week **pulls in what the app
already knows** and shows it on the right day, unstored and read-only:

- **Assignments** with a `due_on` in the week, from the existing task list,
  with their real status. A grown-up who set work for Thursday sees it on
  Thursday without anybody copying it across.
- **Spaced review due**: a count per day of items falling due, from
  `ItemMastery.dueOn`, shown as one quiet line — *8 items due for review* —
  with a Start button. The scheduler already knows this; the planner is the
  first place a learner sees it laid out by day.
- **Tests and quizzes** as events, from the assessments table below.

Nothing pulled in is duplicated into `planner_items`. Two sources of truth for
the same due date is how a plan goes stale.

A card can also sit on the **shelf** — this week, no day yet. It is a card
like any other; it just has not been placed. §5 says how it gets placed.

Each item carries an optional **minutes estimate**, defaulting by kind and
maturity band. Adding them up per day gives the **capacity meter**: a day with
more than the learner's daily limit turns amber and says so — *Tuesday looks
heavy — 95 minutes*. That single line teaches load-balancing better than any
tutorial, because it appears at the moment the mistake is being made.

Days can be marked **busy** (*soccer*, *Dad's*, *no time*), which the study
proposer routes around. Busy days are per week, stored on the week row, and a
recurring pattern (*every Tuesday*) is a v2 nicety — marking three days a week
takes four seconds.

---

## 3. The four sections around the grid

The user asked for these four, and each has a job beyond being a text box.

### Priorities this week

**At most three.** The cap is the feature. A learner who lists eleven
priorities has listed none, and a twelve-year-old choosing three from a list of
what is coming up is doing the actual skill the planner exists to teach.

The guided flow (§6) proposes candidates from what it can see — the nearest
test, the assignment due soonest, the course with the most items slipping —
and the learner picks or writes their own. A priority can be linked to a
course, so it shows the chip.

### Wins of the week

Filled in during the wrap-up (§6), and **seeded from evidence**. The app
already knows what genuinely happened this week: *mastered 14 items in
Biology*, *five-day streak*, *Spelling level 4 → 5*, *Mastery Check passed on
Chapter 7*. Those are offered as chips, and a chip the learner keeps carries
its evidence snapshot and shows a small verified mark. Anything the learner
writes themselves — *finished my history project*, *didn't leave the essay to
the last night* — is a win in their own words, shown plainly.

The two are never merged. A verified win and a written win sit side by side in
the same list, and the mark says which is which. This is exactly the rewards
split — the child's side verified, claims attributed — applied to reflection.

Wins are the part a parent most wants to see, and the part a learner is least
likely to write unprompted. Seeding them is what makes the section fill up.

### Next week's goals

Written at wrap-up, and **carried forward**: when next week's planning flow
opens, these goals are the first candidates for its priorities. The loop
closes — goals become priorities become wins — without anybody retyping.

### Reflection

One optional prompt, rotated weekly and phrased for the band: *What got in the
way?* · *What would you do differently?* · *What was easier than you expected?*
Skippable. Its value is in the parent conversation it starts, not in the text.

---

## 4. Tests, quizzes, and studying backwards

This is the part that does the teaching.

### The assessment

```ts
export type AssessmentKind = 'quiz' | 'test' | 'exam' | 'project'
export type Difficulty = 1 | 2 | 3   // "feels easy" · "not sure" · "worried"

export interface Assessment {
  id: string
  learnerId: string
  courseId: string | null
  kind: AssessmentKind
  title: string                // 'Chapter 7 test'
  on: DayString
  difficulty: Difficulty
  /** What to study with, if the app has it: a deck, a spelling list, a unit. */
  target: { subject: Subject; targetId: string } | null
  /** Filled in afterwards. Both fields are claims and are shown as such. */
  outcome: { feltLike: Difficulty; score: string | null; note: string | null } | null
  planGeneratedAt: number | null
  createdBy: string
}
```

Adding one takes four taps: course chip, kind, date, and a three-face
difficulty. Difficulty is deliberately phrased as *how do you feel about it*
rather than *how hard is it* — the honest answer to the first question is
available to a child; the second is not.

**Linking content is optional and encouraged.** If the learner or a grown-up
points the assessment at a deck, the study sessions become real rounds of the
Mastery Path on that set, and the planner can say how ready the learner
actually is. If there is nothing to link, the planner offers to make
something — paste the vocabulary, upload the study guide — through the
existing ingestion flow, filed under the course. That is the single strongest
funnel into the app's real work, and it opens at the moment the learner has a
reason to want it.

### How many sessions, and when

The proposal is a pure function in `packages/shared`, `proposeStudyPlan()`,
taking the assessment, the learner's planning preferences, the days already
busy or heavy, and today. It ships with `simulate:planner`, per the house rule
that new shared behaviour comes with a simulation.

**Session count**, by kind and difficulty:

| | feels easy | not sure | worried |
| --- | --- | --- | --- |
| quiz | 2 | 3 | 4 |
| test | 3 | 5 | 6 |
| exam | 5 | 7 | 9 |
| project | 3 milestones: *plan · draft · finish* — not study sessions |

**Placement** works backwards from the day before the assessment, using an
expanding gap — offsets of 1, 2, 3, 5, 7, 10, 14, 18, 23 days before, taking
the first N. Dense near the end, sparse early. This is spaced practice with
the density where the evidence says it helps, and it produces the pattern a
good student arrives at by instinct: start early, touch it a few times, tighten
up before the day.

Then the constraints, in order:

1. **Never in the past.** If today is later than an offset, that session is
   dropped, not moved to today. Sessions that survive are what fits.
2. **At most one session per course per day.** Two Biology sessions on
   Wednesday is one long one, and long ones do not happen.
3. **At most N sessions per day across all courses**, N from the band (below).
   A session that would exceed it shifts one day earlier, then two, then is
   dropped.
4. **Busy days are skipped**, shifting earlier the same way.
5. **Not much runway** is said out loud: a "worried" test in two days gets two
   sessions and the line *There's not much time — here's what fits. Next time,
   add the test as soon as you hear about it.* That last sentence is the
   lesson, and it is delivered exactly when it will land.

**Session length and daily cap**, by maturity band. This is paint on the
schedule, not curriculum: it changes how many minutes a session is and how
many a day holds, never what happens inside a round.

| Band | Session | Sessions per day | Planner shape |
| --- | --- | --- | --- |
| early | 10 min | 1 | *Today* and *Tomorrow* only; a grown-up drives |
| growing | 15 min | 2 | the week, one priority, no reflection |
| middle | 20 min | 2 | the full planner |
| upper | 30 min | 3 | the full planner, register adjusted |

### Every session has a purpose

The proposal does not just say *study Biology on Tuesday*. A learner who does
not know how to study cannot act on that; it is the instruction they were
already failing to follow. Each session is given a **purpose**, and the
purposes follow the ladder:

| Position | Purpose | What the session says | If content is linked |
| --- | --- | --- | --- |
| first | **Get organised** | *Gather your notes. Make or open the deck. Skim once.* | opens the deck; a placement round |
| middle | **Practise** | *Work through the set. Missed ones come back.* | a Mastery Path round — Continue |
| second to last | **Prove it** | *Test yourself without looking. Find what's still shaky.* | the readiness gate offers the Mastery Check |
| last, the day before | **Quick review, then stop** | *Only the ones you missed. Ten minutes. Then sleep.* | a round restricted to misses — the missed-cards option |

For two sessions it is *practise, review*; for three, *organise, practise,
review*; for four or more the middle repeats. A learner who follows the labels
has, without being told, done distributed practice, retrieval practice, a
self-test, and a targeted final review — the four things the research says
work, and the four things nobody taught them.

### Accepting, moving, skipping

The proposal is shown as a set of ghost items on the week — *5 sessions
suggested* — with one **Add all** button and a per-session choice. After
acceptance each session is a real `study` item, `proposed = true`, and the
learner can drag it to another day, change its length, or skip it.

Skipping is allowed and not nagged. What the planner does say is the count:
*Chapter 7 test on Friday · 2 of 5 sessions done*. A learner who skips three
sessions and does badly has a fact to look at during the wrap-up, which is
worth more than a notification they dismissed.

**Moving the test moves the plan.** Changing the assessment's date
re-proposes the sessions not yet done, keeps the done ones, and asks before
replacing any the learner had moved by hand.

### Readiness

With linked content, the assessment card shows the number that matters:
*23 of 40 mastered · 6 slipping · 3 days left*. It is derived from item
mastery and the retention bands, so it is honest and it moves as the learner
works. A parent reading *23 of 40 mastered* on Wednesday knows something
actionable; a parent reading *studied three times* does not.

Without linked content, the card shows sessions done and nothing else. The
planner never invents a readiness number it cannot back.

### Afterwards

The day after the assessment, one prompt: *How did the Chapter 7 test go?* —
the same three faces, an optional score, an optional line. It is a claim and
is shown as one. Two things happen with it:

- it becomes a candidate **win** for the wrap-up;
- it **calibrates**: a learner who said *feels easy* and then reports *worried*
  gets one more session next time for that course, and the planner says
  so — *Last time Biology felt harder than expected, so this plan has one
  extra session.* That sentence is the planner learning about the learner in
  a way the learner can see.

---

## 5. Cards — the interaction model

Most of what goes on a planner is not a test. It is *finish the worksheet*,
*read chapter 4*, *bring the permission slip*. A planner that makes those
three things cost a form each is a planner that is abandoned by October. So
this section is written as a budget: what each action costs, and what it is
not allowed to cost.

### Every item is a card

Tasks, study sessions, assessments, and the pulled-in assignments and review
counts all render as the same card, so the learner learns one object:

```
┌▌─────────────────────────────┐
│▌ Bio worksheet p.42     25m  │   ▌ course colour bar
│▌ ○                      Mum  │   ○ box (claim) · ✓ verified mark · avatar = who added it
└──────────────────────────────┘
```

- **Colour bar** from the course. No course, no bar.
- **Title**, one line, truncated. The card is not the place to read a note.
- **Minutes chip**, editable in place by tapping it.
- **State mark**: an empty box for a claim, the existing verified mark for
  app work, a faint outline for a proposed study session not yet accepted.
- **Who** — a small avatar when someone other than the learner added it.
- **Start** appears on any card the app can run, and nowhere else.
- Study session cards carry their purpose as a single word — *Practise* —
  and the assessment they belong to as a faint suffix.

Done cards collapse to a struck-through row at the bottom of their day. They
do not disappear: a day that ends with five struck-through lines is the
reward, and hiding it removes the reward.

### The interaction budget

| Action | Costs | Never costs |
| --- | --- | --- |
| add a task | type a line, Enter | a form, a modal, a required field |
| file it under a course | one chip tap, or nothing — the last course used is preselected | typing the course name |
| put it on a day | drag it, or add it from that day's *+* | a date picker |
| move it | one drag | opening it |
| reorder within a day | one drag | anything else |
| finish it | one tap on the box, or one swipe | opening it |
| push it to tomorrow | one swipe the other way | a date picker |
| change anything else | tap to open a small sheet: title, course, day, minutes, note, delete | a second screen |
| undo | one tap on the toast, for five seconds, on every action above | finding a menu |

If a proposed change to the planner cannot fit in this table, it is the
wrong change.

### Checking things off

The most frequent action in the planner, so it is spelled out rather than
implied.

- **A claim card** — a task, or a study session with nothing linked — is
  finished by tapping its box, or by swiping right on touch, or by pressing
  space with it focused. The box fills, the card drops to the struck-through
  pile at the bottom of its day, and an undo toast shows for five seconds.
  `status = done`, `done_at`, and `done_by` are written; `done_by` is whoever
  tapped, which is almost always the learner.
- **Un-checking** is the same tap again, any time. The card comes back to the
  open list in its old position, and the three fields clear. Nothing is
  logged about it beyond the row's own `updated_at`; a child who ticked the
  wrong thing should not feel watched for fixing it.
- **A linked card** — a study session or assignment the app can run — has no
  box. It has Start. It is closed by the round that satisfies it, in the
  round's own transaction, and it shows the verified mark instead of a filled
  box. Trying to swipe it done is refused with a shake and *Start it
  instead*. This is the one exception to "one tap finishes anything", and it
  is the exception the whole product rests on.
- **A study session can also be skipped**, which is distinct from done: the
  card greys out with *skipped*, keeps its day, and counts against
  *2 of 5 sessions* honestly. Skip is in the card sheet, not on a swipe, so it
  is a decision rather than a flick.
- **Events** — tests, due dates, milestones — are never checked. They happen.
  The day after an assessment, the card offers *How did it go?* instead.
- **A grown-up may tick a claim card** for a learner in the early and growing
  bands, where a parent sitting beside a seven-year-old is the realistic path.
  The card then shows the parent's avatar on the box: it is their claim, and
  the wrap-up counts *ticked by a grown-up* separately.
- **Done all for today** — when the last open card on today is finished, the
  day shows a single line in the band's register, no confetti: *That's
  today.* The reward is the struck-through list, and the line just names it.
- **The pulled-in review count** has no box either. It goes down as the
  learner reviews, and reaches *nothing due* on its own.

Done is never hidden and never auto-cleaned. A week that ends with every card
struck through is the thing a learner scrolls back to look at.

### Quick add

One field, always visible at the top of the week and of Today: *Add
something…*. Type, Enter, done. The card lands on the day you were looking at
— today in the Today view, the column's own day if you tapped that column's
*+* — filed under the last course used, with the band's default minutes.

A few tokens are understood in the line, none required: a day name or
*tomorrow* places the card; *30m* sets the minutes; *#bio* files it. The
words *test*, *quiz* or *exam* make the planner ask — *Is this a test? Add it
as one and I'll plan the studying* — with one tap for yes and the line kept
as a plain task on no. This is the seam between "write it down" and "plan
backwards from it", and it should be crossed by accident.

Grown-ups get the same field with their name on the card.

### The shelf — "sometime this week"

A card does not have to have a day. The shelf sits above the grid and holds
things the learner knows about but has not placed. Dragging a card to the
shelf unschedules it; dragging it down schedules it. Step 1 of *plan your
week* is, in practice, *give each of these a day*.

The shelf is what makes the quick-add field honest: you can write something
down the moment you hear it and decide when later, which is how a
twelve-year-old actually remembers things.

### Drag

Cards drag with the pointer on desktop and with press-and-hold on touch, and
both use the same rules:

- **Day to day** moves the card; the move is logged with the day it left,
  so the wrap-up can say *3 things moved* as a fact.
- **Within a day** reorders. Order is the learner's and is respected in
  Today.
- **Drop targets** highlight, and show the capacity change as you hover —
  *Tue · 65 → 95 min*. This is the moment the load lesson lands; the meter in
  §2 is this same number at rest.
- **To the edge** of the grid scrolls it, so a card can go to next week
  without a second gesture. On a phone the grid is a horizontal strip of day
  columns and works the same way.
- **A study session** drags like anything else, with two guards: past its
  assessment's date it snaps back, and onto a busy day it asks.
- **An assessment** drags to change its date. Not-yet-done sessions are
  re-proposed, as §4 says.
- **A pulled-in assignment** cannot be dragged — its due date belongs to
  whoever set it — but dragging it *does* something useful: it drops a linked
  study session on the target day. *Do this on Wednesday* becomes one
  gesture, and the session is verified work because the assignment is.
- **The review-due count** is not a card and does not drag. It has a Start
  button and that is all.

Every drag is optimistic and undoable. The API call is one PATCH with the new
day and sort position; a failed call snaps the card back with a toast.

**Duplicate** is the only extra: on desktop, hold the modifier while dragging
to copy; on touch, it lives in the card sheet. *Read ch. 4* three nights in a
row should not cost three typings.

### Swipe, on touch

Right to finish, left to move to tomorrow. Both show the undo toast. Finishing
a linked card by swipe is refused with a short shake and *Start it instead* —
the rule about linked work closing only by evidence does not have an
exception for gestures.

### Keyboard

Everything above has a keyboard path — arrow keys move focus between cards,
modifier plus arrows move the card, space toggles done on a claim, Enter
opens the sheet — because a planner that only works by pointer excludes the
learners using a screen reader or a school laptop with a broken trackpad.
Not a v2 item: the shared drag library is chosen on this criterion.

### Carry-over, without the guilt pile

An unfinished task from yesterday appears at the top of today in a *still?*
strip — keep it, or let it go, per card or all at once. Nothing silently
accumulates into a wall of red. The count of let-go tasks is visible at
wrap-up as a fact, not a failure. On Monday the strip also offers the shelf's
leftovers, so the week starts clean.

### Every card keeps its history

Tapping *History* on a card's sheet shows a short timeline:

> Sun 7:41 pm · **Ava** added it, on Wednesday
> Mon 4:10 pm · **Mum** moved it to Tuesday
> Tue 6:02 pm · **Ava** ticked it done
> Tue 6:03 pm · **Ava** un-ticked it
> Tue 6:40 pm · **Ava** ticked it done

Study sessions add *proposed for a Chapter 7 test*, *closed by a round —
18 of 20 checked*, and *reopened — the round was erased*. Assessments add
*date moved from Thu to Fri*, *difficulty changed*, *outcome recorded*.
Deleted cards stay readable: a card is soft-deleted, so its timeline ends
with *Ava removed it* rather than vanishing.

What makes this trustworthy rather than decorative:

- **The database writes it, not the app.** Triggers on the planner tables
  insert the event in the same transaction as the change, with the actor
  from `auth.uid()`. There is no route that writes an event and no route that
  can avoid one.
- **Nothing updates or deletes it.** The events table grants `select` and
  nothing else to authenticated users, the same posture as `attempts`. A
  test pins it, the way `0007_attempt_integrity_test.sql` pins attempts.
- **Verified closures are events too**, carrying the session id, so the
  timeline of a linked study session is the evidence chain end to end.
- **Erasing progress does not erase the timeline.** Erasing deletes sessions,
  which reopens linked cards — and that reopening is itself an event. The
  learner's right to erase their practice history stops at the planner's log
  of what they planned, because the log is the parent's record as much as
  theirs.

Where it shows: the card sheet for one card; a **week timeline** in the
grown-up view — every event in the week, newest first, filterable by who —
for the Sunday conversation; and the wrap-up's facts (*3 things moved, 2 let
go, 1 ticked by Mum*) are read from it rather than from flags on the row.
The Family line does not change; one line stays one line.

The learner sees exactly what the grown-up sees. A history the child cannot
read is a monitoring feature, and this product does not build those.

### Two kinds of card, explained once

Assignments set by grown-ups show on their due day with their real,
evidence-closed status, and are not tasks in this table. A learner cannot tick
one; they Start it. The two are visually distinct — a plain box for a claim,
the verified mark for app work — and the difference is explained once, in the
first-run copy: *Things with this mark are checked by the app. Boxes are your
word.*

---

## 6. Guidance — the two flows that make it easy

A blank planner is the failure mode. Two guided flows, each under five
minutes, are the product.

### Plan your week

Offered from Sunday afternoon through Monday, and available any time. Five
steps, each one screen:

1. **Here's what's coming.** Tests, due assignments, the busiest course by
   items slipping, and last week's goals — everything the app can see, pulled
   in. The learner marks busy days.
2. **Anything else?** Quick-add for what the app cannot know. Course chips.
3. **Pick up to three priorities.** Candidates from step 1 and last week's
   goals; write your own.
4. **Study sessions.** For each test in the next two weeks, the proposal, with
   *Add all*. Tests with nothing linked get the *study with…* nudge.
5. **Done.** The week, laid out. One line: *Looks like a full week — Tuesday
   is heavy.* or *This looks manageable.*

A learner who does nothing but tap through gets a real, sensible week. That is
the bar: **the lazy path produces a good plan.**

### Wrap up the week

Offered from Friday afternoon through Sunday.

1. **How it went.** Tasks done, sessions done, assessments and their outcomes,
   let-go tasks — facts, no adjectives.
2. **Wins.** Verified chips offered; write your own.
3. **Next week's goals.** Two or three. They seed next week's priorities.
4. **Reflection.** One prompt, skippable.

### Today

The default view on a phone, and a strip on the learner's home screen: what is
on today, in order, with a Start button on anything the app can run. A learner
who never opens the week view still gets the plan's benefit one day at a time.

### Nudges, kept honest

The planner surfaces three things and only three, in the app rather than by
notification (push is not built and is an open question):

- a test within three days with no study sessions done;
- a day over capacity;
- an unplanned week, on Monday.

Each is one line and a button. No streaks for planning itself — a "planned
weeks" count is shown as a stat and is never payable, because the rewards spec
is clear that only checked work earns.

---

## 7. Grown-ups — collaboration, not surveillance

### Who sees what

Everyone linked to the learner sees the planner. It is the learner's document,
so the grown-up view is the same screen with the learner's name on it, not a
separate report.

Writing follows the existing predicate exactly: `can_manage_learner_content()`
— the learner themselves, the owner, and any guardian with
`can_manage_content`. That predicate deliberately counts the learner, which is
wrong for assigning homework and precisely right here. A tutor with view-only
access reads and comments; a parent who manages content adds a test they heard
about from the teacher.

**Everything is attributed.** An item, a test, a comment, a change of date —
each shows who did it. A learner opens their week and sees *Mum added: Bio
test Thursday*. A parent opens it and sees which sessions the learner moved
and which they dropped. Provenance is what keeps a shared document from
feeling like a monitored one.

### What a grown-up adds

- **Tests and due dates** from the teacher's email or the school portal. The
  most common thing a parent knows that the child forgot to write down.
- **Tasks**, the same quick-add, marked with their name.
- **Study sessions on behalf of the learner** in the early and growing bands,
  where a parent accepting the proposal is the realistic path.
- **Comments.** A short note on a day or an item: *Proud of you for starting
  early*, *Remember Grandma's Saturday*. Stored with the week, attributed,
  visible to everyone on the link. Not a chat — there is no thread, no read
  receipt, and no reply button. A comment is a sticky note on the fridge.

### What the grown-up sees on Family

Per the placement rule — oversight lives on the Family screen, not a second
dashboard — each learner's row gains one planner line:

> *Planned this week · 3 priorities · Chapter 7 test Fri: 23 of 40 mastered,
> 2 of 5 sessions done · Tuesday heavy*

or

> *Not planned yet*

Tapping opens the learner's planner in the grown-up view. The existing weekly
line the activities spec promises grown-ups gains the same sentence.

From the grown-up view, any card's *History* and the week timeline are one
tap away. That is where *did they actually do Tuesday's session, or move it
three times and skip it* gets an answer that neither side has to argue about.

### The weekly conversation

The wrap-up is designed to be done together. A parent sitting down with the
learner on Sunday sees the facts (not their own judgement), the wins (some
verified, some in the child's words), and the goals. The reflection prompt
gives them something to ask. Ten minutes, once a week, with the app holding
the evidence so the conversation can be about the child rather than about
whether the homework was really done.

### Tutors and teachers

Access is per learner, not per course, so a tutor sees the whole planner.
That is the existing model and this spec does not change it; a course-scoped
view is an open question. A tutor with content rights adding a quiz for a
learner is the same action as a parent doing it. Setting the same test for
several learners at once reuses the multi-learner POST shape assignments
already have — one body, an array of learner ids — and creates one assessment
row per learner. Class-level scheduling proper waits for groups, which the
build sequence deliberately defers.

---

## 8. Other ideas worth carrying

The request asked for more. These are the ones with a real reason, each with
its place in the sequence.

**Print the week — in v1.** The existing weekly progress sheet already has a
paper layout. A planner print — the grid, priorities, tests, sessions with
their purposes, and empty boxes to tick by hand — goes on a fridge or in a
binder, and a surprising number of children plan better on paper they can
see. Cheap, because the print route exists. Sits with the other printables,
which are a covered-learner feature. Printed on Sunday and ticked with a pen,
it is the same plan; what the paper cannot carry is the verified mark, and
the print says so in its footer.

**Study-with suggestions on unlinked sessions.** A study session for a course
whose track has assigned or library content available offers it: *Study with:
Chapter 7 Vocabulary?* One tap links it and the session becomes verified
work. This is the funnel from planning into the activities, and it should be
everywhere a session is shown.

**Milestones for projects.** *Plan · draft · finish* at 60 %, 30 % and 10 % of
the runway, as `event` items with a purpose line. A project due in three weeks
with no milestones is the exact thing a fourteen-year-old gets wrong every
time.

**Import due dates.** An `.ics` feed from the school portal, or a pasted
syllabus through the ingestion pipeline with a "find the dates" build. The
second one is nearly free once ingestion is in place: the document is already
in context. Google Classroom is a real integration and a v2 conversation.

**Term calendar.** A term's start, end and holidays on the learner, so a
"days left" count and the study proposer know that next week is half-term.
One small table, later.

**Class view for teachers.** *Which of my 25 students have planned this
week?* — depends on groups, which are stage 8 and deliberately not built. The
per-learner data is shaped so this is a query when the time comes.

**Recurring busy days.** *Every Tuesday, soccer.* v2. Marking three days takes
four seconds and teaches the habit better than a setting does.

**Push reminders.** Genuinely useful for *test in 3 days, nothing done*, and
genuinely a new piece of infrastructure. Not v1. The in-app nudge is the same
information one tap later.

**Deliberately not:** a time-of-day calendar (day buckets only; *after
school* and *evening* halves at most, and only if learners ask), a chat
between parent and child, a grade book, and any reward for planning itself.

---

## 9. Data model

One additive migration — **0019** per the registry in
[build-sequence.md](build-sequence.md). Nothing existing is rewritten;
`attempts` is untouched.

```sql
-- Enrolments. The learner's, freely defined, citing a closed track.
create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  learner_id    uuid not null references public.learners (id) on delete cascade,
  name          text not null,
  track         text,                      -- null resolves to General, as everywhere
  teacher_name  text,
  period        text,
  color         text not null,
  emoji         text,
  term_label    text,
  starts_on     date,
  ends_on       date,
  archived_at   timestamptz,
  sort_order    int  not null default 0,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per learner per week. Holds the four sections and the busy days.
create table public.planner_weeks (
  id            uuid primary key default gen_random_uuid(),
  learner_id    uuid not null references public.learners (id) on delete cascade,
  week_start    date not null,             -- always a Monday; checked
  priorities    jsonb not null default '[]', -- [{ text, courseId? }], max 3 checked in API
  wins          jsonb not null default '[]', -- [{ text, kind: 'own'|'verified', evidence? }]
  goals         jsonb not null default '[]', -- [{ text, courseId? }]
  reflection    text,
  busy_days     date[] not null default '{}',
  planned_at    timestamptz,               -- plan-your-week completed
  wrapped_at    timestamptz,               -- wrap-up completed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (learner_id, week_start),
  constraint planner_weeks_monday check (extract(isodow from week_start) = 1)
);

-- Tests, quizzes, exams, projects.
create table public.assessments (
  id                uuid primary key default gen_random_uuid(),
  learner_id        uuid not null references public.learners (id) on delete cascade,
  course_id         uuid references public.courses (id) on delete set null,
  kind              text not null check (kind in ('quiz','test','exam','project')),
  title             text not null,
  on_day            date not null,
  difficulty        int  not null check (difficulty between 1 and 3),
  target_subject    text,
  target_id         text,
  outcome           jsonb,                 -- { feltLike, score, note } — a claim
  plan_generated_at timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint assessments_target_pair check ((target_subject is null) = (target_id is null))
);

-- What is on a day.
create table public.planner_items (
  id             uuid primary key default gen_random_uuid(),
  learner_id     uuid not null references public.learners (id) on delete cascade,
  week_start     date not null,             -- the week the card belongs to; a Monday
  on_day         date,                      -- null: on the shelf, no day yet
  kind           text not null check (kind in ('task','study','event')),
  title          text not null,
  course_id      uuid references public.courses (id) on delete set null,
  assessment_id  uuid references public.assessments (id) on delete cascade,
  minutes        int,
  -- Study sessions: their purpose on the ladder, and whether the app proposed them.
  purpose        text check (purpose in ('organise','practise','prove','review')),
  proposed       boolean not null default false,
  -- What the app can run for this item. Null means "not app work".
  target_subject text,
  target_activity text,
  target_id      text,
  -- State.
  status         text not null default 'open' check (status in ('open','done','skipped')),
  done_at        timestamptz,
  done_by        uuid references auth.users (id) on delete set null,  -- a claim
  session_id     uuid references public.sessions (id) on delete set null, -- evidence
  -- Soft delete: the card leaves the grid, its history stays readable.
  deleted_at     timestamptz,
  deleted_by     uuid references auth.users (id) on delete set null,
  sort_order     int  not null default 0,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Linked work is closed by a session, never by hand. Unlinked work is a claim
  -- and says whose.
  constraint planner_items_done_shape check (
    status <> 'done'
    or (target_id is not null and session_id is not null and done_at is not null)
    or (target_id is null     and done_by    is not null and done_at is not null)
  ),
  -- A placed card is placed inside its own week; events and sessions always have a day.
  constraint planner_items_day_in_week check (
    on_day is null or (on_day >= week_start and on_day < week_start + 7)
  ),
  constraint planner_items_shelf_kinds check (on_day is not null or kind = 'task')
);
create index planner_items_week_idx
  on public.planner_items (learner_id, week_start, on_day, sort_order);

-- What happened to every card, test and week. Append-only; written by triggers.
create table public.planner_events (
  id          bigint generated always as identity primary key,
  learner_id  uuid not null references public.learners (id) on delete cascade,
  entity      text not null check (entity in ('item','assessment','week')),
  entity_id   uuid not null,
  at          timestamptz not null default now(),
  actor_id    uuid references auth.users (id) on delete set null, -- null: the system
  kind        text not null,   -- created · edited · moved · shelved · done · undone
                               -- · skipped · unskipped · closed_by_session · reopened
                               -- · deleted · restored · date_moved · outcome · planned · wrapped
  -- The fields that changed, before and after. Small: a title, a day, a status.
  before      jsonb,
  after       jsonb,
  session_id  uuid references public.sessions (id) on delete set null
);
create index planner_events_entity_idx on public.planner_events (entity, entity_id, at);
create index planner_events_learner_week_idx on public.planner_events (learner_id, at desc);
comment on table public.planner_events is
  'Append-only. The database writes it; nobody updates or deletes it.';

-- Posture identical to attempts: the trigger inserts as definer, users only read.
revoke all on public.planner_events from authenticated;
grant select on public.planner_events to authenticated;
-- AFTER INSERT OR UPDATE OR DELETE triggers on planner_items, assessments and
-- planner_weeks call public.log_planner_event(), security definer, which
-- diffs old and new, names the kind, and takes the actor from auth.uid().
-- The reopen trigger on sessions runs first and so is logged like any update,
-- with actor null and session_id set.

-- Sticky notes from grown-ups (and the learner). No threads.
create table public.planner_comments (
  id          uuid primary key default gen_random_uuid(),
  learner_id  uuid not null references public.learners (id) on delete cascade,
  week_start  date not null,
  item_id     uuid references public.planner_items (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Stable preferences. One row per learner, created lazily.
create table public.planner_prefs (
  learner_id       uuid primary key references public.learners (id) on delete cascade,
  daily_minutes    int,          -- null: band default
  sessions_per_day int,          -- null: band default
  study_days       int[] not null default '{1,2,3,4,5,7}',  -- isodow; Saturday off by default
  updated_at       timestamptz not null default now()
);

-- Filing existing content under a course. Learner-owned content only.
alter table public.decks       add column course_id uuid references public.courses (id) on delete set null;
alter table public.word_lists  add column course_id uuid references public.courses (id) on delete set null;
alter table public.assignments add column course_id uuid references public.courses (id) on delete set null;
```

### Closing a linked study session

`complete_matching_planner_items(p_learner_id, p_session_id)` is called in the
same transaction as `complete_matching_assignments()`, and does the same
thing: a session landing with matching subject, activity and target closes
the **earliest open `study` item** for that work, whatever day it was planned
for, storing the session id as evidence. Whatever day, because a learner who
does Tuesday's session on Wednesday has still done it, and one who does it on
Sunday has done it early. The item moves to the day it actually happened in
the same update, so the log carries one event — *closed by a round* — with
the day change inside it and the system as the actor.

A session deleted later reopens the item, by extending the existing
`reopen_assignments_for_session()` BEFORE DELETE trigger. Same rule, same
trigger, no second mechanism.

Hand-ticked items never carry a `session_id`; the check constraint makes the
two shapes mutually exclusive, so a report can tell them apart without trusting
the client.

Both the closure and any later reopening land in `planner_events` through the
same triggers as every other change, so a linked card's timeline reads
*proposed → moved → closed by a round → reopened → closed by a round* without
any code writing history on purpose.

### Row-level security

| Table | Read | Write |
| --- | --- | --- |
| `courses`, `planner_weeks`, `assessments`, `planner_items`, `planner_prefs` | `can_access_learner()` | `can_manage_learner_content()` — includes the learner |
| `planner_comments` | `can_access_learner()` | insert: `can_access_learner()`, own `author_id`; update/delete: author only |
| `planner_events` | `can_access_learner()` | nobody — trigger only, as definer |

Deleting a planner item through the API is a soft delete: the row's
`deleted_at` is set, the event is logged, and the card can be restored from
its timeline. A hard `delete` is not granted on `planner_items` to
authenticated users; the only path that removes rows is the cascade from a
learner being deleted, which is the one case where the history should go too.

Comments are the one table a view-only guardian can write to, because leaving
a note is the whole point of view-only access for a tutor.

### Why `planner_weeks` holds the sections as jsonb

Priorities, wins and goals are short lists, read and written as a unit, never
queried individually, and their shapes will change as the wrap-up flow is
tuned. Three tables with three sets of policies for what is one screen's
worth of text would be ceremony. The one thing that must survive inside them
is the verified win's evidence snapshot, which is written the way the rewards
ledger snapshots evidence: copied in, never joined to, so erased progress does
not un-win a week.

---

## 10. Shared model and API

**`packages/shared/src/planner.ts`** — the one definition of `Course`,
`Assessment`, `PlannerItem`, `PlannerWeek`, `PlannerPrefs`, and:

- `proposeStudyPlan(assessment, prefs, week, today): ProposedSession[]` —
  pure, deterministic, and the subject of `simulate:planner`, which runs a
  few thousand random assessments through it and asserts: nothing in the
  past, at most one per course per day, the daily cap, busy days empty, the
  last session on the eve when the eve is available, and the runway warning
  exactly when fewer than the wanted count fit.
- `sessionPurposes(count)` — the position-to-purpose mapping in §4, so the UI
  and the proposer agree.
- `weekLoad(items, band)` — minutes per day and the heavy-day flag; also
  what the drop target shows while a card hovers.
- `canDrop(item, onDay, week)` — the drag guards in §5 (past an assessment,
  onto a busy day, a pinned assignment) as one function, so the pointer,
  touch and keyboard paths cannot disagree.
- `parseQuickAdd(line, courses, today)` — the day, minutes and course tokens,
  and whether the line looks like an assessment.
- `readiness(masteries, target)` — mastered, slipping and due counts for a
  linked assessment, read from the retention bands. Reporting only; it
  schedules nothing, per the retention model's own rule.
- `suggestTrack(courseName)` — the synonym map.
- `suggestWins(weekProgress)` — the verified win candidates, from the existing
  per-week progress summary.
- `describeEvent(event, people)` — one event to one line of copy, in the
  band's register, so the card sheet, the week timeline and the wrap-up's
  facts all say the same thing about the same row.

**Routes**, on the existing API:

```
GET    /learners/:id/courses
POST   /learners/:id/courses
PATCH  /learners/:id/courses/:courseId
POST   /learners/:id/courses/:courseId/archive
POST   /learners/:id/courses/rollover            copies unarchived courses, dates cleared

GET    /learners/:id/planner/weeks/:weekStart    the assembled week: items, assessments,
                                                 assignments due, review due per day,
                                                 comments, load
PATCH  /learners/:id/planner/weeks/:weekStart    sections, busy days, planned_at, wrapped_at
POST   /learners/:id/planner/items
PATCH  /learners/:id/planner/items/:itemId       move { onDay | null, sortOrder }, edit,
                                                 tick (unlinked only), skip
POST   /learners/:id/planner/items/:itemId/duplicate   body: { onDay }
DELETE /learners/:id/planner/items/:itemId       soft delete; logged
POST   /learners/:id/planner/items/:itemId/restore
GET    /learners/:id/planner/items/:itemId/history
GET    /learners/:id/planner/weeks/:weekStart/history   the week timeline, ?actor= filter

POST   /assessments                              body: assessment + learnerIds[]
PATCH  /assessments/:id                          moving the date re-proposes
DELETE /assessments/:id
POST   /assessments/:id/propose                  returns ProposedSession[]; stores nothing
POST   /assessments/:id/accept                   body: the sessions kept; creates items
POST   /assessments/:id/outcome

POST   /learners/:id/planner/comments
DELETE /planner/comments/:commentId

GET    /learners/:id/planner/prefs
PATCH  /learners/:id/planner/prefs
```

A drag is one PATCH carrying the new day (or null for the shelf) and the
position within it. Sort order is a sparse integer — gaps of a thousand — so
a reorder writes one row; the API reindexes a day when the gaps run out.
Moving a card out of its week changes `week_start` too, in the same call.

The item PATCH refuses `status: 'done'` on a linked item, the same way the
assignments PATCH refuses it outright. On a claim card it sets `done_by` to
the caller — never from the body — and `status: 'open'` clears all three
done fields. A grown-up's tick is accepted only when the learner's band is
early or growing; otherwise the API answers with a hint to leave the box to
the learner. Linked work is closed by
`complete_matching_planner_items()` or not at all.

`/learners/overview` gains the Family line: planned this week, priorities
count, the nearest assessment with its readiness and sessions done, heavy
days.

---

## 11. Screens

Learner side, in `routes.ts`:

| Route | What |
| --- | --- |
| `planner` | the week; *Today* on narrow screens with a swipe to the grid |
| `planner-plan` | plan-your-week, five steps |
| `planner-wrap` | wrap-up, four steps |
| `planner-courses` | the learner's courses; add, edit, archive, rollover |
| `planner-print` | the week for paper — same treatment as `progress-print` |

The learner's home screen gets a **Today** strip at the top: today's items in
order with Start buttons, and the plan/wrap prompt when one is due. The task
list (`tasks`) is unchanged; assignments simply also appear on their due day.

Grown-up side: no new top-level screen. Family's learner row gains the planner
line and opens `planner` in the grown-up view, which is the same component
with the learner's name in the header, comments enabled, and the course
editor reachable. Nothing planner-shaped goes on Account — the planner is not
the grown-up's own thing.

Course chips use the course colour everywhere a course appears: the planner,
the deck list, the task list, the progress report.

---

## 12. Billing

Per the gate principle — never gate learning, gate leverage and marginal cost:

**Free, always:** courses, the week, tasks, assessments, the study proposer,
both guided flows, Today, the current and next week. A child planning their
studying is learning, and a planner that stops proposing when a parent's card
lapses would be the wrong kind of memorable.

**Covered learner:** planner history beyond two weeks — the earlier weeks and
their card timelines (history is already a covered feature, and *nothing is
deleted on lapse* — earlier weeks are hidden, never removed, and the event
log keeps being written whether or not anyone can currently read it), the readiness number (it reads the retention model, which is
covered), the print layout (printables are covered), and grown-up comments.

The comments gate is the only one worth arguing about. It is here because
comments are grown-up leverage rather than the learner's learning, which is
the principle; it is soft because the wrap-up conversation is the thing a
parent would pay for, so it should be the thing they see first. Open
question.

---

## 13. What this changes elsewhere

- **Assignments** gain `course_id` on the per-learner row and appear on the
  planner by `due_on`. The assign form, in a learner context, shows the course
  chips when the track matches more than one course.
- **Content structure** — a course cites a track; nothing about tracks
  changes. The per-track report shows the course name when one exists.
- **Ingestion** — the review screen offers the course picker alongside the
  track picker when the source was uploaded for a specific learner, and the
  course pre-fills the track.
- **Mastery Path** — a linked study session's *Continue* is the path's
  Continue; the *prove* purpose surfaces the readiness gate; the *review*
  purpose is the missed-cards round.
- **Retention** — `readiness()` reads the bands; it must not write back.
- **Rewards** — no new criterion. A `checkpoint` or `set_mastered` reward on
  content linked to a test is the right way to attach money to studying, and
  it already exists.
- **Band** — session length, daily cap and which planner shape shows come
  from `BAND_STYLE`; a new `planner` field there rather than a second table.
- **Progress print** — the planner print reuses its layout primitives.
- **`/learners/overview`** — one more line per learner.

---

## 14. What v1 ships, and what waits

**v1 — courses, the week, tests planned backwards.**

- courses with track suggestion, archive, rollover; `course_id` on
  learner-owned decks, lists and assignment rows;
- the week grid and Today; cards with drag (pointer, touch, keyboard), the
  shelf, quick-add with tokens, swipe to finish or push, undo on every action,
  duplicate, carry-over, minutes and the capacity meter; busy days;
- assessments with linked content; `proposeStudyPlan()` with purposes;
  accept, move, skip; re-propose on date change; readiness when linked;
  the after-test prompt and the one-session calibration;
- priorities (capped at three), wins (seeded from evidence, verified marked),
  next week's goals (carried forward), the reflection prompt;
- both guided flows;
- verified closure of linked sessions in the round's transaction, the reopen
  trigger extended;
- `planner_events`: trigger-written, append-only, pinned by a test; soft
  delete and restore; the card timeline and the week timeline;
- grown-up view, attributed writes, comments, the Family line;
- **print the week** — the grid, priorities, tests, and sessions with their
  purposes, on the existing print layout primitives. Cheap, and the version
  of the planner that lives on a fridge;
- band shaping: early and growing get the reduced planner;
- `simulate:planner` in `npm test`.

**v2 —** project milestones, study-with suggestions on unlinked sessions
everywhere, recurring busy days, the term calendar, `.ics` import.

**v3 —** class-level planning and the teacher's *who has planned* view, on
groups when groups exist; Google Classroom.

---

## 15. Open questions

1. **Should a linked study session count as an assignment?** Today a parent's
   assignment and a learner's own study session are different rows closed by
   the same mechanism. Merging them would mean a learner could set themselves
   work that shows on Family as "set" — probably wrong, but the duplication of
   the closure function is a smell worth revisiting after v1.
2. **Comments behind coverage, or free?** Argued both ways in §12. **As built:
   free.** The Sunday conversation is the thing a parent would pay for, so it
   is the thing they see first; revisit with a renewal cohort.
3. **Course-scoped tutor access.** A maths tutor seeing the whole planner is
   the current model and probably fine at family scale. Revisit with groups.
4. **Difficulty from evidence.** When content is linked, the app could rate
   difficulty from the learner's mastery on the set rather than asking. Ask
   anyway in v1 — a learner's own estimate, checked against the outcome, is
   the calibration signal, and replacing it with a computed number removes the
   thing being taught.
5. **Sunday or Monday start.** Monday, because it is what schools use and what
   `isodow` checks cheaply. American families may expect Sunday first in the
   grid; that is a display choice on the week row, not a data change.
6. **Push notifications.** The *test in three days, nothing done* nudge is the
   one that would earn a push. Nothing else here needs one.
7. **How long is the log kept, and who can ask for it to go?** Nothing is
   deleted on lapse and the learner cannot erase it by erasing progress. A
   learner who turns 13 and takes over their own account is the case to
   decide: probably the log stays and they gain the same read the parent had,
   which is already true of their practice history.
8. **What the learner sees when a grown-up moves a session.** Attributed, but
   should the learner have to accept it? For tests and tasks, no — a fact is a
   fact. For moved sessions, probably a small *Mum moved this* and nothing
   more. Watch it in use.

---

## 15b. As built — where the build departed from the text

- **Closure matches the open card planned nearest to the day the round
  happened**, today's own first, whatever week it was planned for. A session
  done early is done. The card moves to the day it happened in the same
  update as the closure, so the log carries one *closed by a round* event.
- **Days are the learner's, never the server's.** The round carries the
  learner's calendar day (`ProgressChange.today`) into the closure, and the
  week request carries it for the "still?" strip and the review counts. The
  database's `current_date` is only a fallback for callers that send nothing.
- **A read never writes.** The week request creates no row; a view-only
  guardian gets the week as it stands, and `canWrite` in the response tells
  the client whether to offer a box, a drag or an add at all.
- **One session per test per day**, not per course, is the proposer's clash
  rule — otherwise "no course" became a course.
- **Heavy days are computed once**, in the API from the shared band table and
  the learner's own limit; there is no SQL copy of the band numbers.
- **Drag is a small pointer-events helper, not a library.** Press-and-move on
  a mouse, press-and-hold on touch; drop targets are the day columns and the
  shelf; the title is draggable and still opens the sheet on a plain click.
- **The week response carries `sessionCounts`** per test across weeks, so
  *2 of 6* counts sessions that sit in next week too.
- **Below the `xl` breakpoint the grid scrolls sideways** with fixed-width
  columns; compact cards put the title on its own line with minutes and Start
  underneath, so nothing truncates to a letter.
- **The Family overview query** had read `due_on` from `assignments`, a column
  0009 moved to `assignment_sets`; the status line had been failing silently.
  Fixed in passing, because the planner line lives on it.

## 16. How we know it worked

- **Seconds from tapping quick-add to a card on the grid**, median. Under
  five, or §5 has failed. Measured in the client, no server call needed.
- Cards added per active learner per week, and the share added from Today
  versus the week grid versus a grown-up. A planner nobody adds to is a
  planner nobody keeps.
- The share of active learners with `planned_at` set in a given week, and
  whether it holds after the first month.
- Study sessions **done ÷ accepted**, split linked versus unlinked. If linked
  sessions are done at a much higher rate, the study-with suggestion should be
  pushed harder; if unlinked sessions are barely done, the hand-tick is
  telling us something.
- **Readiness on the eve** for linked assessments: the mastered fraction on
  day −1, over time. This is the number that says whether studying backwards
  from a test produces students who know the material — and it is verified.
- Outcome versus difficulty: how often *worried* becomes *felt easy*. That gap
  closing is the planner doing its job.
- Wins kept per wrap-up, verified versus written. A week with zero written
  wins and three verified ones is a learner who let the app speak for them,
  which is fine at first and worth watching.
