# Realtime — one channel, many consumers

**Status:** proposed · **Date:** 2026-09-08 · **Stage:** 11 in [build-sequence.md](build-sequence.md)

Two people are in the same week of the planner and both see the cards move.
A parent opens their child's round and watches the answers land as they are
given. Later: a teacher sees which of thirty learners is mid-session.

Those are three features and they must not become three channels. This
document is the one channel, and the rules that keep it from turning into a
second, unreviewed copy of the authorization model.

---

## 1. The two rules

**Rule 1 — the live feed never becomes the record.**

A round's attempts are written once, at the end, in one transaction
(`useQuizSession.ts` for the app, `mcp/rounds.ts` for a voice tutor). That does
not change. Rewards are verified against attempts, and attempts stay
append-once.

What flows over the channel while a round is running is *ephemeral*: not
stored, not replayable, not evidence. If a watcher misses it, it is gone, and
nothing downstream cares. This is what lets a live tick be a fire-and-forget
message on a 0.5 GB instance rather than a database write between a child and
their next card.

The corollary is a hard one and it is deliberate: **never derive a reward, a
mastery update or a planner state change from a live event.** The live feed is
a view. The write path is the truth.

**Rule 2 — one authorization gate, and it is the one that already exists.**

Subscribing to a channel about a learner is authorized by the same rule that
authorizes reading that learner: `withUser(caller.id)` plus the RLS policies,
via `can_manage_learner_content()`. There is no channel ACL, no second table,
no topic-name parsing. If the gate is wrong it is wrong in one place, and that
place already has tests.

---

## 2. Why this shape

**Why not Supabase Realtime.** The deciding argument is the MCP tutor. A
voice-tutored round runs entirely inside the API (`mcp/rounds.ts`); there is no
browser on the child's end to broadcast from. A client-side channel cannot see
it. A bus inside the API gets it for nothing. Second: authorizing a Realtime
topic means RLS policies on `realtime.messages` that parse topic strings — a
second authorization system to keep in step with `can_manage_learner_content()`,
on a product where the failure mode is one family seeing another family's
child. Third: the gateway exists precisely so the browser holds no data path to
Supabase (`lib/api/client.ts`). Auth still runs there; data does not.

**Why not WebSockets.** Both consumers are one-way — a watcher only reads. The
bidirectional case people reach for (a parent sending a cheer) is an ordinary
POST and does not need a socket. WebSockets would cost hand-written heartbeats,
hand-written reconnect, and no resume, in exchange for a direction we do not
use.

**Why not polling.** Rejected for the planner: the interval is either too slow
to feel live or too chatty to be free, and it cannot carry a round at all.
Polling survives in exactly one place — catch-up after a reconnect (§5).

**So: Server-Sent Events, served by the gateway.** Same origin, same bearer
token, same RLS. One new route, one small bus, no new vendor and no new secret.

---

## 3. Channels

A channel is a string, `family:id`. A **family** is a subject the product has
authorization rules about, and it is defined in exactly one place — a table of
`{ family, authorize }` that the subscribe route consults and nothing else may
bypass:

| Family | Who may subscribe | Carries |
| --- | --- | --- |
| `learner:<learnerId>` | anyone RLS lets read that learner | planner edits, live round ticks, presence |
| `user:<userId>` | that user, and nobody else | things addressed to one grown-up: ingestion job progress, invite accepted, billing state |

Two families is not a prediction that there will only ever be two. It is the
shape: **a new family is a row in that table plus its gate, and a new feature
inside an existing family is an event `kind` and nothing else.**

Everything about one learner flows on that learner's channel and consumers
filter by `kind` — one channel per learner rather than one per feature, because
a grown-up watching a child holds one connection, not four, and because the
authorization question is always the same question.

**Presence is opt-in, and separate from subscribing.** Holding a subscription is
not the same as being somewhere: the home screen's Today strip watches a
learner's channel without anybody being in the week. Only a client that asks
(`?announce=1`) joins the presence list and publishes `watch.begin` /
`watch.end`; everything else listens silently. Getting this wrong makes "Ada is
here" mean "Ada has the app open", which is a weaker and different claim — on
the one surface the consent rule in §9 rests on.

### Adding a consumer

1. Name a `kind` (`'planner.item'`, `'content.job'`, `'reward.granted'`).
2. `bus.publish(learnerChannel(id), …)` from the route that already performs
   the write. It is one line, it cannot throw, and it happens after the
   transaction commits.
3. Subscribe to that `kind` in a hook. The connection is already open.

Nothing else. No route, no table, no auth, no client wiring. The first
candidate after the planner is **content ingestion**, which today polls
`GET /content/jobs/:id` every two seconds
([content-ingestion-spec.md](content-ingestion-spec.md) §; the polling choice
was made when there was no channel to push down). That becomes a `content.job`
kind on the `user:` family and the poll goes away.

### Event envelope

Defined in `@whizzo/shared` (`live.ts`) so both sides agree:

```ts
interface LiveEvent {
  kind: string          // 'planner.item' | 'planner.week' | 'round.tick' | ...
  learnerId: string
  at: number            // ms, server clock
  actorId: string | null   // who caused it; null means the system
  originId: string | null  // the emitting tab, for self-filtering
  payload: unknown      // per-kind, and never a secret
}
```

`originId` is how a client ignores the echo of its own optimistic write. Every
mutating request may carry an `x-live-origin` header — a random id minted once
per tab — which the route passes through to the published event. A client drops
events whose `originId` is its own. Two tabs of the same user therefore still
see each other, which is correct.

**Payloads carry no secrets and no personal data beyond what the recipient can
already read**, because the gate is the learner and nothing narrower.

---

## 4. Authorization

`GET /api/live/learners/:id` — the caller is established by `requireCaller`,
then `withUser(caller.id)` selects the learner. If RLS returns no row, 404,
exactly like every other learner-scoped route. The subscription outlives that
check, which is the one real weakness: a grown-up whose access is revoked
mid-stream keeps receiving until they reconnect. Access revocation is rare, and
a stream is capped (§5), so the exposure window is bounded by the cap. If that
ever stops being acceptable, re-check on the heartbeat.

---

## 5. The wire

**Framing.** Standard SSE: `event:` is the kind, `data:` is the JSON envelope.

**Heartbeat.** A `: ping` comment every 20 seconds. This does two jobs: it
keeps intermediaries from closing an idle connection, and it defeats proxy
response buffering, which otherwise holds events until a buffer fills and makes
a "realtime" feed arrive in clumps a minute late. **Verify on the deployed
DigitalOcean ingress before calling this done** — it is the one property of
this design that cannot be established from the repository.

**Client, not `EventSource`.** `EventSource` cannot set an `Authorization`
header, and the alternative — a ticket in the query string — puts a credential
into access logs. The client is a `fetch` with a `ReadableStream` reader
instead: the existing `authHeader()` applies unchanged, token refresh keeps
working, and reconnect backoff is ours to control. The cost is ~60 lines of
frame parsing.

**Reconnect.** Exponential backoff with jitter, capped at 30 s. On regaining
the connection the consumer **re-reads its own state** rather than asking the
channel for history — the channel has none, by Rule 1. For the planner that is
the existing week fetch. This is where polling lives, and it runs once per
reconnect rather than on a timer.

**Caps.** A connection is closed after 30 minutes; the client reconnects.
Bounded connections per caller, so one script cannot hold the instance's
sockets open.

**A 404 is final; a 401 is not.** RLS saying there is no such learner will say
the same next time, so retrying is a busy loop against a settled question. A
401, though, is usually a token refresh that could not finish — a laptop waking
before its network — and treating it as final leaves a dead channel with nothing
to restart it. It backs off like any other failure.

**Deploys drop every connection.** `instance_count: 1`, so a deploy is a
disconnect; backoff covers it — but only if the process actually gets to shut
down. A hijacked stream is an in-flight request and Fastify's close waits for
those, so the SIGTERM handler ends every live stream *before* calling
`app.close()`. An `onClose` hook cannot do this: it runs after the wait it is
meant to prevent. Ending the response is also not sufficient on its own —
a finished response returns to the keep-alive pool and a pooled connection still
counts as open — so the socket is released once the last chunk has flushed.

---

## 6. The bus

```ts
interface LiveBus {
  publish(channel: string, event: LiveEvent): void
  subscribe(channel: string, fn: (event: LiveEvent) => void): () => void
}
```

**Today: in-process.** `instance_count: 1` in `.do/app.yaml`, so an
`EventEmitter` is not a compromise, it is the correct implementation.

**At `instance_count > 1`: Postgres `LISTEN/NOTIFY`.** `pg` is already a
dependency and the database is already there, so scaling out costs one
implementation of this interface and no new infrastructure — not Redis, not
ever, for this. Two things to know when that day comes: `NOTIFY` payloads are
capped at 8000 bytes, so publish identity and let each instance read the row if
a payload is ever large; and a `LISTEN` connection must sit outside the pooled
transaction path.

**`publish` never throws and never blocks the request.** A failure to notify a
watcher must not fail a child's write. It is logged and dropped.

---

## 7. Consumer one — the planner

The first consumer, and deliberately the low-stakes one: it is easy to verify
by opening two browsers, and it retires the polling design.

Every planner write already returns the saved row. The route publishes that
same row — no extra query.

| Event | Published by | Payload |
| --- | --- | --- |
| `planner.item` | item create / patch / duplicate / restore | the `PlannerItem` |
| `planner.item.removed` | item delete | `{ itemId }` |
| `planner.week` | week patch | the `PlannerWeek` |
| `planner.comment` | comment create | the `PlannerComment` |

`usePlannerWeek` feeds these through the `replaceItem` / `setItems` it already
uses for its own optimistic writes, so a remote change animates exactly like a
local one. Presence rides the same subscription: the week's header names
whoever else is in it, in both directions (§9).

Three collisions, and how each is settled:

1. **The echo.** Handled by `originId` (§3).
2. **A remote event racing my own in-flight write.** Settled by making the
   row's own `updatedAt` the arbiter: a card is applied only when it is at
   least as new as the copy already held, and a write's *response* goes through
   the same door as a remote event. Every timestamp compared is Postgres's, so
   this is one clock ordering itself rather than two clients disagreeing — which
   is why it needs no bookkeeping of in-flight requests, and why a slow response
   cannot undo a change the server accepted after it.
3. **Text fields.** Titles, `reflection` and `priorities` are last-write-wins
   at the database. A remote value is never applied to a field that currently
   has focus — it is *deferred* and lands on blur, keyed off a `data-live-key`
   attribute on whatever wraps the editable region. Losing a half-typed sentence
   to someone else's save is a worse failure than being briefly stale.

And one that is not a collision but looks like one: **sort order.** The item
trigger skips history when only `sort_order` moved
(`0019_planner.sql:353`), so `planner_events` is *not* a usable change feed for
drag-reordering. This is why the live path publishes from the route and not
from the event log. `planner_events` remains what it was: history.

---

## 8. Consumer two — doing a round together

The goal is co-presence, not oversight: two people working through one set from
two screens instead of huddling round one. That is a different product from
monitoring, and it decides everything below.

**The watcher's view is a mirror.** Same card, same position, no navigation of
its own — otherwise you cannot talk about the card, which is the whole point.
It follows the *learner*, not a round: they finish flashcards and start
multiple choice, and the view comes along, because re-joining to keep up would
defeat the object.

**Emit only when watched.** The learner's client is already subscribed to its
own channel (one connection per tab, pooled) and receives `watch.begin` /
`watch.end` when a grown-up opens or closes the view. Only between those does a
round emit. A round nobody has joined — the overwhelming majority — sends one
message and never another.

```
POST /api/live/learners/:id   { kind: 'round.tick', … }   → 204, stores nothing
```

| Event | When | Carries |
| --- | --- | --- |
| `round.begin` | a round starts | activity, deck or list title, card count |
| `round.tick` | a card is shown, and again when answered | the prompt, position, outcome, `selfGraded` |
| `round.draft` | typing **pauses** | what is in the box |
| `round.end` | the round finishes | cards and correct |
| `watch.begin` / `watch.end` | a watcher arrives or leaves | who, and everyone present |

Three rules about content, and each earns its place:

- **The question travels.** A grown-up who cannot see the card cannot talk
  about it.
- **The answer does not, until the learner has answered.** The same rule the
  voice tutor works under: nobody is given the answer before the person whose
  turn it is.
- **Typing goes out on a pause, never on a keystroke** (`DRAFT_IDLE_MS`, with a
  floor of `DRAFT_MIN_GAP_MS`). A pause is when a person is thinking and a
  grown-up might usefully say something. It is also the difference between a
  few messages a card and a hundred: a twelve-card round is roughly fifty
  messages end to end. There is deliberately no feed of hesitation, and a
  half-made multiple-choice decision is nobody's business until it is made —
  choice activities emit on submit only.

`selfGraded` is worth surfacing rather than hiding: flashcards is the one
activity where the learner marks their own work, and "said they got it right"
is different information from "got it right".

**`begin` and `end` are a pair, and both go out unwatched.** Only the ticks and
drafts between them are gated on somebody being present. Gating the end as well
is the obvious-looking economy and it is wrong: `begin` is unconditional, so
every unwatched round would advertise itself on a grown-up's screen until it
aged out twenty minutes later.

**Where each activity lands.** The quiz hook covers flashcards, choice, learn,
test and review card by card. Spelling does the same, with one wrinkle: the
prompt a learner hears is a sentence *containing* the word, so it is masked
(`The dog ran across the ____`) until they answer and the word travels with the
outcome — otherwise following along would mean being handed the answer first.
Match, free recall and typing lessons report only their two ends, because they
are judged as a whole rather than card by card; the watch screen says so rather
than showing an empty frame.

**Discovery has to be readable, not only broadcast.** This is the part the first
cut got wrong. `round.begin` fans out to each linked grown-up's `user:` channel
— one subscription for a tutor with thirty students rather than thirty — and
`round.end` goes to the same people, without which the "practicing now" chip
outlives the round it advertises. But a broadcast alone means a grown-up sees it
only if they happen to be on the right screen at the instant it starts, and a
second later there is nothing to find. So the server also keeps the rounds in
progress in memory and answers two reads:

```
GET /api/live/now                      → the rounds this caller may see
GET /api/live/learners/:id/now         → one learner's round, with the card they are on
```

Neither is storage in the Rule 1 sense: it lives in memory, it dies with the
process, and losing it costs a nudge rather than a record. Rounds age out after
twenty minutes for the device that went quiet without saying goodbye.

The entry point belongs on the **home screen**, not only on Family. A way in
that has to be gone looking for is not really a way in, and a grown-up is
already on Home when a child opens a deck.

**And joining shows the round immediately.** Two things make that true, and both
are needed: the server hands over the current card on the read above, and the
learner's client re-sends the card it is on the moment a watcher announces
themselves — the shown-card effect takes `watched` as a dependency for exactly
this reason. Without the second, following someone who is thinking hard about
one card means staring at a blank screen until they move on. Without the first,
a second watcher or a reconnect gets the same blank. Neither costs anything
while nobody is watching, which is the property that had to survive. The lookup reads `guardian_links` with admin rights on
purpose — a child cannot select their own learner's links, and the answer never
reaches the caller; it only decides which channels get the ping.

**Emitting is narrower than reading.** Anyone RLS lets read a learner may
*watch* a round. Only the learner's own session, or the owner's device the
learner is borrowing, may *report* one. Everything posted here is rendered on a
grown-up's screen as their child's work, and a surface like that is worth
nothing if a second guardian or a connected tutor can stage it. Nothing is
stored either way, so the difference is not about records — it is about whether
what you are looking at is real.

**Two counters, not one.** The stream endpoint is limited on *connections
opened*, which are rare. The emit endpoint is limited separately and far more
generously, because a watched round is several messages a card: sharing one
bucket let a single round spend a learner's whole allowance and then leave them
unable to reconnect, with every symptom swallowed on the way.

**Presence gates ticks, not subscribers.** The server drops a tick when nobody
is *announced* on the channel. Counting bus listeners instead would count the
learner's own silent subscription — the one the round is using to find out
whether anybody is there — and every round would look watched.

The client side has a matching trap with the opposite sign. "Is anybody here?"
must be asked of *everyone announced*, not of everyone announced who is not me:
a learner working on a grown-up's account shares that account's user id, so
filtering by person hides the very watcher who just arrived and the round stays
silent through the whole session. The learner's own connection never announces,
so anybody in that list is by definition another screen. Filtering self out is
for the *display* — "Mom is here" should not list you — and nowhere else.

For an MCP-tutored round the emission is server-side in `mcp/rounds.ts` and
needs no client at all — which is the reason this design sits in the API.

---

## 9. Consent

A grown-up silently watching a child practice is a different product from one
where the child can see it. Whizzo takes the same posture here it takes with
tutor connection codes:

- Only a grown-up who passes `can_manage_learner_content()` can watch.
- While anyone is watching, **the child sees who**, and the indicator cannot be
  dismissed. `watch.begin` carries the watcher's display name.
- Nothing is recorded. There is no "replay the session" feature, and adding one
  is a product decision with a consent conversation attached, not a feature
  that falls out of this channel.

---

## 10. Deliberately not built

- **No history on the channel.** No replay, no `Last-Event-ID` backfill. A
  reconnect re-reads state. (Rule 1.)
- **No presence beyond a watcher count.** Cursors and "typing…" are a bigger
  feature than they look and neither consumer needs them.
- **No CRDT / OT.** Planner edits are coarse card operations; last-write-wins
  per field is the honest model for them, with the focus rule in §7 as the
  guard.
- **No cross-learner channels.** A teacher watching thirty learners opens
  thirty subscriptions or, more likely, gets a purpose-built roster endpoint
  when that feature is specced.

---

## 11. Acceptance

1. Two browsers, same week, different accounts: a card dragged in one moves in
   the other within a second, with no reload and no polling.
2. The mover sees no flicker — their own event is filtered by `originId`.
3. A card being edited in one browser is not overwritten by the other's save
   while the field has focus.
4. Kill the API mid-stream: both clients reconnect with backoff and re-read,
   and the week is correct afterwards.
5. A caller with no access to a learner gets 404 on that learner's channel.
6. On the deployed ingress, events arrive within a second — not in clumps
   (the buffering check from §5).
