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

## 8. Consumer two — watching a round

The one that needs new emission, because today the server learns nothing until
the round ends.

**Emit only when watched.** The child's client holds its own subscription to
its own channel and receives `watch.begin` / `watch.end` when a grown-up opens
or closes the view. Only between those does the round emit. A round nobody is
watching — the overwhelming majority — costs exactly nothing extra.

```
POST /api/learners/:id/live   { kind: 'round.tick', payload }   → 204, stores nothing
```

| Event | When | Payload |
| --- | --- | --- |
| `round.begin` | a round starts | deck title, size, activity |
| `round.tick` | a card is answered | index, total, correct, ms — **never the answer text** |
| `round.end` | the round finishes | the summary the child sees |
| `watch.begin` / `watch.end` | a watcher arrives or leaves | `{ watchers: n }` |

A tick carries the *shape* of the answer, not its content: a watching parent
sees "7 of 12, correct, 3.1 s", not what was typed. Enough to follow along,
not enough to turn into surveillance of a child's spelling mistakes in real
time. The full record is available afterwards, where it belongs, in history.

For an MCP-tutored round the emission is server-side in `mcp/rounds.ts` and
needs no client at all — which is the reason this design sits in the API.

---

## 9. Consent

A grown-up silently watching a child practise is a different product from one
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
