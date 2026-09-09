# MCP — renting the tutor

**Status:** built, needs config (build-sequence §3d) · **Date:** 2026-09-06 · **Migration:** 0020 (registry in [build-sequence.md](build-sequence.md)) · **Scope:** apps/api (one new route scope and an OAuth server), packages/shared (grading and round planning move server-side), apps/web (a consent screen and a Connected apps list), one additive migration

The feature everyone wants next is a tutor: something that talks a child
through a deck, asks the questions, listens to the answers, explains the
misses, and keeps going until the material sticks. Building that means
speech in, speech out, a model in the middle, and a per-minute bill we pay on
every child's behalf. Renting it means **exposing the app as a set of tools
that Claude and ChatGPT can call**, and letting the parent's existing
subscription — and the assistant's existing voice mode — do the talking.

That is what the Model Context Protocol is for. A family connects Whizzo to
the assistant they already pay for, says *"tutor Maya on her biology deck"*,
and the assistant runs a round through our tools: it asks what we tell it to
ask, sends us what the child said, and we grade it, record it, and hand back
the next question. The evidence lands in `attempts` exactly as it would from
the app. Nothing is self-reported. We pay for nothing but the HTTP.

Two things carry the design:

1. **The model never holds the answer before the learner has tried.** The
   server sends the question and withholds the answer; the answer is
   revealed only in the result of the grading call. A tutor that cannot leak
   an answer does not need to be trusted not to.
2. **The model is a channel, not a grader.** It transcribes and relays. The
   server compares the answer against the card, the same way the app does,
   and writes the same append-only row. *"Mastered means the system watched
   it happen"* survives intact, because the system did.

---

## 1. What is true about the clients today

This spec rests on the two assistants' actual behavior, checked on the date
above. It will drift, and the first thing to re-check before building is the
last row of this table.

| | Claude | ChatGPT |
| --- | --- | --- |
| Custom remote MCP servers | Free (one), Pro, Max, Team, Enterprise — *Customize → Connectors → Add custom connector* | Paid plans with **Developer mode** on (Settings → Apps → Advanced); Business and Enterprise admins may need to allow it |
| Transport | Streamable HTTP; HTTP+SSE still accepted, deprecated | Streamable HTTP; SSE still accepted |
| Where connections come from | Anthropic's cloud — the server must be publicly reachable | OpenAI's cloud, same |
| Registration | OAuth with Dynamic Client Registration, Client ID Metadata Documents, or Anthropic-held credentials; callback `https://claude.ai/api/mcp/auth_callback` | OAuth 2.1 with DCR; no-auth also allowed |
| Tool approval | Per-tool confirmation; a user can allow a tool to run unsupervised | Confirmation on write tools; configurable |
| Extra requirements | Directory listing wants `readOnlyHint` / `destructiveHint` on every tool, separate read and write tools, names ≤ 64 chars, a published privacy page | Outside Developer mode the server is rejected unless it exposes `search` and `fetch`; those also make it usable in deep research |
| **Voice mode** | **Voice mode calls connected tools, custom connectors included** — confirmed in use, 2026-09-06. The help center says the same; an old issue about web and Android is stale | The help center says apps and custom MCP servers are **not available in voice** |

So the position is: **Claude voice is the product, and it is the thing to
build for.** ChatGPT gets the same tools and the same text-chat tutor, and
picks up voice whenever OpenAI ships it — voice is a property of the client,
not of our tools, so nothing in this document is Claude-specific except the
callback URL and the setup instructions. But the design choices that only
matter in voice — one call per turn, `say` on every result, the two write
tools allowed to run unsupervised, a hint being a tool rather than a favor —
are not optional polish. They are the difference between a tutor and a
chatbot with a database.

**The first day is still a spike**, for a narrower question: a stub server
with one read and one write tool, connected to Claude on iOS, to measure the
round-trip latency of a tool call inside a voice turn and to confirm that a
tool marked *allow always* runs without a prompt mid-conversation. Those two
numbers set the round length and decide whether `answer` can afford to be
one call or must be two.

Two fallbacks exist regardless, and cost nothing:

- **Dictation.** Both apps let a user dictate into text chat and read
  replies aloud. It uses our tools. It is what a ChatGPT family gets today,
  and it is a great deal better than nothing.
- **The tutor packet** (§10): a copyable prompt plus the deck as text, for a
  voice conversation with no tools at all. It records nothing and says so.
  It exists for the family that has not connected yet and wants something
  in the car this afternoon.

---

## 2. Non-negotiables

Carried from the activities spec and the rewards work. Any tool below that
cannot satisfy these does not ship.

1. **The answer is withheld until graded.** No tool result, resource or
   prompt contains a card's answer side for a card whose question is
   currently open. This is enforced by construction — the server builds the
   payload — and pinned by `simulate:tutor`, which fails if any pre-grading
   payload contains the answer text.
2. **Grading is server-side and deterministic.** The model sends what the
   learner said. The server decides. The tool schema has no *correct*
   argument, so there is nothing for the model to assert.
3. **Same rows, same rules.** A tutor round writes a `sessions` row and
   `attempts` rows through the same code path as the app, with `askedAt` set
   per question, `verified = true` because the server checked it, and
   `channel = 'mcp'` so it can be told apart. Attempts stay append-only.
   The ladder, the Mastery Path, the retention model, assignments and rewards
   are downstream and untouched.
4. **Connecting is consent.** A connector is authorised by a signed-in
   grown-up (or a 13+ learner who owns themselves), for the children ticked
   at consent time, and **every tool call is about one of them**. A token
   cannot reach a learner the account could not reach in the app, because
   the MCP endpoint runs under the same row-level security as every other
   route.
5. **Few tools, small results, every result speakable.** Voice tolerates
   one tool call per turn and a sentence of latency. Every result carries a
   `say` string the model can read aloud verbatim, and every tool that
   naturally comes in a pair (grade this, then ask the next) is one call.

---

## 3. The experience

### Connecting

A parent opens Claude or ChatGPT, adds a custom connector, and pastes the
server URL — shown on the app's Account screen under **Connected apps**,
with the two clients' own instructions. The client opens our consent page.
The parent signs in with their normal Whizzo login, ticks which children the
assistant may work with (all of them by default), reads three lines:

> **Claude** will be able to: see Maya's decks and how she is doing on
> them; run practice rounds and record the answers she gives; make new decks
> for her library, marked as made by Claude.
>
> It will not be able to see other children, change settings, or delete
> anything.

and approves. The client receives its token and lists our tools. The whole
thing is under a minute and never involves a code, a PIN or a child.

**One connection per account, and every tool call is about one child.**
Claude keys custom connectors by URL, so one connection is the practical
reality; what changes between children is the conversation. With one child
nothing is asked. With several, *"tutor Maya"* names her; `select_learner`
makes her the default so the parent says it once; and a tool called with no
learner in a two-child family answers with the question to ask — *"Which
child is this for — Maya or Theo?"* — rather than an error. A round stays
bound to the child it started with, whatever the default becomes mid-way.

**A child under thirteen is never the one connecting.** Claude requires an
adult account and ChatGPT requires thirteen, so the assistant account is a
grown-up's in every case that matters — and the API enforces its half: a
session signed in with a child's code and PIN is refused at the consent
endpoints, so a child who opens the link on the family iPad is told a
grown-up needs to sign in. The child speaks into the parent's phone. The
token is the parent's, scoped to the child. This is the tutor
connection-code rule again — *the family grants access* — applied to a
different kind of visitor.

The consent request survives the sign-in round trip whichever way the
grown-up signs in: Google and magic-link sign-in come back to the app's root
without the query string, so the signed-out door puts the request aside and
the app returns to the consent screen once the session exists.

### A round

> **Parent:** Tutor Maya on her cells deck for ten minutes.
>
> *(the assistant calls `list_materials`, finds "Cell Biology — Chapter 4",
> then `start_round` with `mode: 'practice'`)*
>
> **Assistant:** Hi Maya. Ten cards from Cell Biology. First one: what is
> the powerhouse of the cell?
>
> **Maya:** Mitochondria.
>
> *(`answer` → correct; the result carries the next question)*
>
> **Assistant:** Yes — mitochondria. Next: this organelle packages proteins
> for transport. It starts with G.
>
> **Maya:** Um. Golgi... body?
>
> *(`answer` → close; recorded as a pass, the answer now revealed)*
>
> **Assistant:** Close enough — it's the Golgi apparatus, also called the
> Golgi body. Next one…

Ten cards later the round closes itself, the summary comes back, and the
assistant says *"Eight out of ten, and two you'd not got before. The one to
look at again is 'ribosome'."* In the app, the session appears in Maya's
history as **Tutor round · with Claude**, the two new items have moved a
rung, the review schedule has updated, and if a task pointed at the deck it
has closed.

The second question above is what the ladder looks like from outside. That
card sat at *recall (cued)*, so the server sent a first-letter scaffold with
the question and the attempt was recorded at rung 2. The first card was at
free recall and got nothing. The model did not choose any of this — it read
the `say` field.

### Being taught, not just tested

*"Maya hasn't seen this deck yet — teach it to her first."* is `start_round`
in `study` mode. The server sends cards **with** their answers, examples and
explanations, in batches of six, the same batch size the Mastery Path uses.
The model explains, the child asks questions, and nothing here is evidence:
study exposures are recorded at rung 0, unverified, as *met* — attempts
only, no session, so nothing a study round does can close a task, earn a
reward, or put a line on the daily strip. The engine treats a rung-0
attempt as an encounter: it touches the card's visit count and last-seen
time and nothing else, so studying a mastered deck again does not reset a
single streak or bring a single review forward. When the child is ready, a
practice round starts and the answers are withheld again.

The model now knows six answers from the study round, and could in
principle tell the child. So could the deck screen in a second browser tab
during a Learn round. The app already lives with *the answer exists
somewhere else*; what it never does is show the answer in the same place as
the question before the attempt, and the tutor keeps that rule.

### The grown-up asking

*"How is Maya doing in biology?"* is `get_progress`, which returns the same
per-track line the Family screen shows, the retention bands, and the items
that are slipping — names, not answers. This is reporting, and it follows the
reporting gates: thirty days for an uncovered learner, everything for a
covered one, the retention number covered-only.

---

## 4. Protocol

**Streamable HTTP at `/mcp`**, on the API, same origin as everything else.
One endpoint, POST for every message, JSON responses; we open no SSE
streams because nothing here takes longer than a database round trip and a
round of practice is short by design.

**Target protocol version `2026-07-28`, with `2025-06-18` and `2025-11-25`
accepted.** The newest revision removed sessions and the `initialize`
handshake — every request is self-describing and any instance can serve it
— and that is exactly the shape a stateless API behind a load balancer
wants. The two clients that matter will lag the spec for a while, so the
server also answers `initialize` and tolerates an `Mcp-Session-Id` it never
issued. Cross-call state is a **server-minted handle** passed as an ordinary
argument, which is what `roundId` is.

Rules the transport spec makes mandatory and that are easy to forget:

- validate `Origin` and answer 403 to anything unexpected, without blocking
  the two clients' cloud origins;
- answer 401 with a `WWW-Authenticate` header naming the protected-resource
  metadata URL (§5) — the clients start their OAuth dance from that header;
- 400 on an unsupported `MCP-Protocol-Version`;
- return `tools/list` in a **deterministic order** with a `ttlMs`, so the
  clients cache it and the model's prompt cache stays warm.

Capabilities advertised: `tools` and `prompts`. Not `resources` in v1 (a
deck as a resource is a second way to leak an answer side, and the tools
already cover reading), not `sampling`, `roots` or `logging` (deprecated in
the current revision; nothing here needs them).

Client identity — `io.modelcontextprotocol/clientInfo` in `_meta`, or the
`clientInfo` from a legacy `initialize` — is recorded on the grant and on
every session as `client: 'claude' | 'chatgpt' | 'other'`, because *"which
assistant do families actually use"* is a question we will want answered
from data rather than from support tickets.

---

## 5. Authorization

The app's identity provider is Supabase Auth, and its access tokens are for
the app. **They are never accepted at `/mcp`, and MCP tokens are never
forwarded to Supabase.** The MCP spec forbids token passthrough for good
reason, and the two token populations have different audiences, lifetimes
and revocation stories.

So the API grows a small OAuth 2.1 authorization server of its own — five
endpoints and two well-known documents — and the MCP endpoint is its
resource server.

```
GET  /.well-known/oauth-protected-resource     RFC 9728: resource = canonical /mcp URL,
                                               authorization_servers = [ APP_URL ]
GET  /.well-known/oauth-authorization-server   RFC 8414: endpoints below, S256 only,
                                               client_id_metadata_document_supported: true,
                                               scopes_supported
POST /api/oauth/register                       RFC 7591 dynamic client registration —
                                               deprecated in the 2026-07-28 spec, still what
                                               both clients send today
GET  /api/oauth/authorize                      redirects into the web app's consent screen
POST /api/oauth/authorize/decision             the consent screen's answer; returns the
                                               redirect with code and iss (RFC 9207)
POST /api/oauth/token                          authorization_code + PKCE + resource;
                                               refresh_token with rotation
POST /api/oauth/revoke                         RFC 7009
```

**Client registration.** Both mechanisms, in the order the spec prefers:
Client ID Metadata Documents when the `client_id` is an HTTPS URL (fetched,
validated for an exact `client_id` match and the presented redirect URI,
cached by its HTTP headers), and dynamic registration otherwise. Registered
clients are rows in `mcp_clients`; a CIMD client is stored on first sight
with its document URL as its id. Redirect URIs are matched exactly, and a
registration or metadata document offering a redirect that is neither HTTPS
nor loopback is refused.

**Consent.** `/api/oauth/authorize` validates the request (client, exact
redirect URI, `code_challenge` with S256, `resource` naming our canonical
URL, `state`), stashes it, and sends the browser to `#/connect?req=…` in the
web app. The consent screen requires a signed-in Whizzo session — the
ordinary one — and offers the learners that session can access, ticked.
Approving posts the decision back with the chosen ids; the API keeps only
those the session can actually see (RLS decides), records them on the grant,
mints a single-use code bound to the request, and returns the redirect. Denying
returns `access_denied` the same way. A request older than ten minutes is
gone.

**Production needs a real origin.** With the secret set and no `APP_URL`,
the endpoint would advertise `http://localhost` as its issuer and nothing
downstream would refuse it, so in production the feature stays off — with a
line in the boot log saying why — until the origin is set, and the spec
renderer refuses a localhost value the way it refuses a placeholder.

**Tokens.** Our own, signed HS256 under a dedicated `MCP_TOKEN_SECRET`:

```
sub    the Whizzo user id           (what withUser() sets — RLS runs unchanged)
grant  the mcp_grants row           (which carries the learners agreed at consent)
aud    the canonical MCP URL        (RFC 8707 — checked on every request)
scope  'tutor' (default) | 'tutor read'
exp    access: 1 hour · refresh: 90 days, rotated on every use, family revoked on reuse
```

The access token is stateless to verify; the grant is looked up anyway on
every call, because a revoked grant must stop working *now*, not within the
hour, and one indexed read is a price worth paying for a parent's revoke
button meaning what it says. `last_used_at` on the grant is written on the
same read, throttled to once a minute.

**What the MCP endpoint then does** is exactly what every other route does:
`withUser(sub)` opens the transaction under the caller's identity, and
`can_access_learner(lrn)` is what the policies check. A tutor connected to a
student they are linked to can run rounds for that student; the moment the
family removes the link, every tool on that grant returns *not found*,
without the MCP code knowing anything about links.

**Revocation** lives on Account → Connected apps: one row per grant, with the
client's name, the learner, when it was connected and last used, and
*Disconnect*. Disconnecting sets `revoked_at`; refresh fails from then on,
access tokens are refused on the grant lookup, and the assistant shows the
family its own *reconnect* prompt on the next attempt.

---

## 6. The tools

Ten tools. Names are stable, descriptions say when to call them, every
result carries `say`, and read tools are annotated `readOnlyHint` so the
clients can run them without a confirmation prompt — which matters, because
a confirmation dialog on every `answer` would make a voice round unusable.
`answer` and `start_round` are writes and cannot honestly be annotated
otherwise; the clients let a user allow a tool to run unsupervised, and the
Account screen's instructions say to do that for exactly these two.

| Tool | Kind | What it does |
| --- | --- | --- |
| `whoami` | read | Who is connected, for which learners, which one is current |
| `select_learner` | write | Makes one learner the default for the rest of the connection |
| `list_materials` | read | Decks and tasks available to a learner, with due counts |
| `get_progress` | read | The per-deck or per-track picture; slipping items by name |
| `start_round` | write | Opens a round and returns the first question(s) |
| `answer` | write | Grades what the learner said; returns the verdict, the answer, and the next question |
| `hint` | write | Returns the scaffold for the open question and lowers the rung it is recorded at |
| `end_round` | write | Closes early; returns the summary |
| `create_deck` | write | Files a deck the assistant made, marked as generated, into the connecting grown-up's library |
| `search` / `fetch` | read | ChatGPT's connector contract; card-free search over titles and terms, fetch of a deck's *prompt sides* |

A prompt, `tutor`, carries the tutoring instructions for clients that
surface prompts. Because neither client reliably does, **the same
instructions are repeated in the `start_round` result** under `instructions`
— a model follows what arrives in a tool result at least as well as what
arrives in a prompt, and this way there is no path into a round that skips
them.

### `whoami`

Returns every learner the connection covers — name, grade, band, and which
one is current — and the client label we recorded. `say`: *"Connected to
Whizzo for Maya and Theo. Currently working with Maya."* Called by the model
on its own when it needs to know who it is talking to.

### `select_learner`

`{ learner }` by first name or id. Remembers the choice on the grant so every
later call defaults to it. Every read and every `start_round` also accepts
`learner` directly, for *"how is Theo doing"* in the middle of Maya's round.

### `list_materials`

```ts
{ query?: string, limit?: number }  →
{
  materials: Array<{
    id: string, title: string, kind: 'deck', track: TrackId, cards: number,
    dueToday: number, unseen: number, speakable: number,   // cards a tutor round can ask
    task?: { id: string, activity: string, dueOn: DayString | null }
  }>,
  say: string     // "Maya has three decks. Cell Biology has six cards due today."
}
```

Learner-owned decks, plus library decks assigned to the learner — the same
set `loadSnapshot` returns, because it is the same query. `query` is a
title/term substring so *"the cells one"* resolves in one call. Paginated,
default ten, ordered by due count descending so the useful one is first.
`speakable` (§7) is the number a round can actually use; a deck of geometry
figures reports zero and the `say` line says why.

### `start_round`

```ts
{
  materialId: string,
  mode?: 'practice' | 'study' | 'test' | 'review',   // default practice
  size?: number,                                     // default BAND_STYLE[band].roundSize
  direction?: 'term-first' | 'definition-first'      // default from the deck
}  →
{
  roundId: string,
  mode, total: number,
  instructions: string,                 // the tutoring rules, §6 below
  question?: TutorQuestion,             // practice / test / review
  cards?: TutorStudyCard[],             // study: answers included, one batch
  say: string
}
```

**`practice`** is Learn from outside: `planPath()` picks the cards — the
current batch, review that is due, a little maintenance, capped at the
same shares — and each card is asked at the rung `supportLevelFromMastery()`
gives it. Rung 1 arrives with four choices (built by `buildChoices`, the
correct one not marked); rung 2 with a first-letter or letter-hint scaffold;
rung 3 with nothing. **`test`** asks every card at rung 3 with no hints —
the Mastery Check shape — and refuses `hint`. **`review`** is due items
across all of the learner's decks, the app's Review round. **`study`** is
§3's teaching mode and is the only mode whose payload contains answers.

One open round per grant. Starting another closes the previous one with
whatever it has, which is also what happens after thirty minutes without an
`answer`. A closed round is written; an abandoned round is written; there is
no state that exists only in the model's context.

### `answer`

```ts
{ roundId: string, given: string | null, skip?: boolean }  →
{
  verdict: 'correct' | 'close' | 'wrong',
  answer: string,                        // revealed now, and only now
  explanation?: string, example?: string,
  praise: string,                        // band-aware, from praise()
  progress: { asked: number, total: number, correct: number },
  question?: TutorQuestion,              // the next one, or absent when the round is over
  summary?: RoundSummary,                // present when it is over
  say: string
}
```

Grading is `gradeWritten` — moved to `packages/shared` so the server can
call it (§9) — after a **spoken-answer normalization** that the app does not
need: number words to digits (*"three quarters"* → `3/4`), leading articles
and *"it's"* / *"the answer is"* dropped, trailing punctuation gone, common
transcription variants folded (*"Golgi body"* is already in the card's
acceptable answers; *"golgi-body"* was not). Numeric cards use the numeric
grader. `close` is a pass in practice and review, a miss in test — `isPass`
with the same `strict` the app uses.

`skip: true` records a miss with `given: null`. A learner who cannot answer
does not know it, and recording nothing would make skipping a way to keep a
card's evidence clean. A wrong answer or a skip **requeues the card to the
end of the round**, where — per the ladder's own rule — it can restore the
item but never promote it.

The attempt written is:

```ts
{
  subject: 'quiz', itemKey, activity: 'tutor', askedAt: question.rung,
  isTest: true, verified: true, correct, hintsUsed, given,
  responseMs: null,                     // we cannot see the clock; see §14
  difficulty, track, channel: 'mcp',
}
```

`isTest: true` and `askedAt` together are what let the ladder and the
ability model treat this exactly as they treat Learn: only rung-3, hint-free
corrects move ability, the same line of code as `movesAbility` in
`useQuizSession`. `responseMs` is null because the round trip through a
model is not the learner's thinking time, and a null is honest where a
number would be a lie; fluency is reported from app rounds only.

### `hint`

Help, in two steps, for the open question in practice or review mode.
The first call returns a **clue**: something true about the answer, built
from what the card carries — its authored hint, else its example sentence,
else its category, else its explanation — with the answer masked out, every
acceptable answer and every word inside them replaced by a blank. The
assistant puts the clue in its own words. The second call returns the
letters: the rung-2 scaffold the app would have shown. Either marks the
attempt `hintsUsed` and drops its `askedAt` to 2. A choice question — every
card a learner has not met yet is asked as one — gets the clue but not the
letters, which the choices already give away; a test has none.

This is what makes the tutor a tutor rather than a quiz. A child who asks
*"how do I work this out?"* gets a clue about *this* card, not a first
letter and not a lecture, and the assistant is told to coach in a sentence
or two from what it knows of the subject — while never stating, spelling,
or rhyming the answer, and never confirming a guess before it has been
answered. The clue is server-built so it cannot say the answer by accident;
`simulate:tutor` checks every clue against every card.

### `end_round`

Closes the round and returns the summary: counts, the cards missed by
prompt side, items that moved a rung, and whether a task closed. `say` is
the sentence in §3.

### `create_deck`

The one write that is not a round, and the strongest reason a parent has to
connect at all: *"here are Maya's notes from today — make her a deck"*, and
the assistant's own model does the extraction, on the family's own
subscription, for zero credits.

```ts
{
  title: string, track?: TrackId, termLabel?: string, definitionLabel?: string,
  cards: Array<{ term: string, definition: string, hint?: string,
                 example?: string, explanation?: string, category?: string }>
}
```

The card schema is the ingestion build call's `GeneratedCard`, reused, so a
deck made by Claude carries the same optional fields a deck made by
ingestion does and unlocks the same activities. It lands in the **connecting
grown-up's library**, `source: 'generated'`, `generatedBy: client`, as a
draft — reviewable in the app like any generated content, assignable from
there, and subject to the free-tier deck limit like any other. It does not
land on the learner and it is not assigned, because *nothing shared is ever
auto-assigned*, and a deck the assistant just wrote is unreviewed by
definition.

### `search` and `fetch`

ChatGPT's connector contract, and the reason a Whizzo deck can be cited in a
deep-research answer or turned into a study guide. `search` returns
`{ id, title, url }` results over deck titles and card terms; `fetch`
returns one deck's title, track, card count and **prompt sides only** —
never the answer side. That is enough to write a study guide *from* the
deck's terms, and it is the one place a general-purpose read tool touches
card content, so it keeps to the withholding rule by construction.

### The instructions the model receives

Sent with every `start_round`, in full, under `instructions`:

> You are a patient tutor working with {name}, who is in {grade}. Ask the
> question in `say` as written. Wait for the answer. Send exactly what the
> learner said to `answer`, without correcting, completing or improving it.
> Never guess an answer on the learner's behalf, and never tell the learner
> an answer before `answer` has returned it. If the learner asks for a hint,
> call `hint`; do not make one up. After `answer`, use `praise` and, on a
> miss, the returned `answer` and `explanation` to teach in one or two
> sentences, then ask the next question. Keep your turns short. Match the
> learner's language and energy. Do not skip questions, reorder them, or
> stop before the round ends unless the learner asks to stop; then call
> `end_round`.

The band shapes the wording (`early` gets a mascot mention and shorter
sentences; `upper` gets none of that), the same way `BAND_STYLE` shapes the
app.

---

## 7. What a tutor can ask — the `speakable` requirement

The capability matrix already decides, per card, what an activity can do
with it. The tutor is one more activity with one more requirement:

**`speakable`** — the prompt side and the answer side are both sayable.
A card fails it when either side carries a `[[figure …]]`, or when the
answer is an equation the plain-text projection cannot render as speech.
`3/4` speaks; `\frac{dy}{dx}` does not, yet. Photographs (`media`) fail
it too, obviously.

Cards that fail are skipped by the round planner and counted in
`list_materials.speakable`. A deck with none reports it, and the `say` line
tells the parent to use the app for that one. Nothing is refused; the deck
plays in the app as it always did.

`tutor` joins the activity catalog:

```ts
def({
  id: 'tutor', name: 'Tutor round', emoji: '🗣️',
  blurb: 'Practice out loud with the assistant you already use.',
  subjects: ['quiz'], stage: 3, isTest: true, verified: true,
  requires: ['speakable'], fallback: 'learn',
  assignable: false,          // see §11 — it satisfies a `learn` task instead
})
```

`stage: 3` is the mode's rung, as for Learn; every attempt carries its own.

**Spelling is deliberately v2.** Spelling a word aloud, letter by letter,
is a real activity — it is what a spelling bee is — but transcription of
spoken letters is unreliable (*"B"*, *"D"*, *"E"* and *"P"* are one
phoneme apart) and a child marked wrong for the transcriber's mistake is the
one outcome this must never produce. It needs its own grader that tolerates
letter-name confusions, and that is a small project of its own. Typing is
never a voice activity.

---

## 8. Data model — migration 0020

Additive. Five new tables and one column, all under RLS.

```sql
-- Registered OAuth clients: one row per DCR registration or per CIMD URL.
create table public.mcp_clients (
  id              text primary key,             -- client_id: a uuid for DCR, the URL for CIMD
  kind            text not null check (kind in ('dcr', 'cimd')),
  name            text not null,
  redirect_uris   text[] not null,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz
);

-- A grant: this user let this client act for this learner.
create table public.mcp_grants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  client_id          text not null references public.mcp_clients (id),
  client_label       text not null,             -- 'claude' | 'chatgpt' | 'other', from clientInfo
  learner_ids        uuid[] not null,           -- agreed at consent; RLS still narrows it
  current_learner_id uuid references public.learners (id) on delete set null,
  scope              text not null default 'tutor',
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
create index mcp_grants_user on public.mcp_grants (user_id, revoked_at);

-- Single-use authorization codes. Ten-minute life; the row is deleted on use.
create table public.mcp_auth_codes (
  code_hash       text primary key,
  grant_id        uuid not null references public.mcp_grants (id) on delete cascade,
  client_id       text not null,
  redirect_uri    text not null,
  code_challenge  text not null,                -- S256 only
  resource        text not null,
  expires_at      timestamptz not null
);

-- Refresh tokens, rotated on every use. `family` lets reuse of a spent token
-- revoke every descendant, per OAuth 2.1 §4.3.1.
create table public.mcp_refresh_tokens (
  token_hash      text primary key,
  grant_id        uuid not null references public.mcp_grants (id) on delete cascade,
  family          uuid not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- A round in progress. Server-held because the model's context is not
-- storage, and because a round must be written whether or not the
-- conversation that started it ever comes back.
create table public.mcp_rounds (
  id              uuid primary key default gen_random_uuid(),
  grant_id        uuid not null references public.mcp_grants (id) on delete cascade,
  learner_id      uuid not null references public.learners (id) on delete cascade,
  deck_id         uuid,
  mode            text not null check (mode in ('practice', 'study', 'test', 'review')),
  plan            jsonb not null,               -- the planned cards, rungs and scaffolds
  cursor          int  not null default 0,
  attempts        jsonb not null default '[]',  -- accumulated until close; written as rows then
  started_at      timestamptz not null default now(),
  last_answer_at  timestamptz,
  ended_at        timestamptz,
  session_id      uuid references public.sessions (id) on delete set null
);
create index mcp_rounds_open on public.mcp_rounds (grant_id) where ended_at is null;

-- Where an attempt came from. Additive; every existing row is the app's.
alter table public.attempts
  add column if not exists channel text not null default 'app'
  check (channel in ('app', 'mcp'));
```

`mcp_rounds.plan` holds the answer sides — it has to, to grade — and the
table is readable only by `service_role` and the round's own grant owner
through the API. The `attempts` array on the round is a buffer, not a
record: on close it is written through the same insert as the app's round,
and the buffer is what makes an abandoned round recoverable rather than
lost.

**Row-level security.** `mcp_grants` selectable and updatable (revoke
only) by `user_id`; the other four have RLS on and no policies, reached
through `withAdmin` in the OAuth handlers and through definer functions in
the round handlers, the same treatment as `learner_credentials`. Nothing
here is ever visible to a browser session.

**Why `channel` is a column and not a `meta` key.** *"Only checked work
counts"* is a column (`verified`) rather than an inference from `activity`
for the stated reason that anything that pays out must be able to ask for
evidence without parsing. The same reasoning says *where it came from* is a
column. It is also the one field the falsifiable check in §16 needs to be
cheap.

---

## 9. Shared model and API

**`packages/shared/src/grading.ts`** — `gradeWritten`, `normalize`,
`acceptableAnswers`, `isPass`, `buildChoices`, `buildTrueFalse` and
`levenshtein` **move here from `apps/web/src/lib/quiz/questions.ts`**, with
the old path re-exporting. This is the `rich` move again, for the same
reason: the server has to grade, and two graders that drift apart is how a
child is marked wrong in one place for an answer that was right in the
other. File move, not a rewrite; not one import in the web app changes.
The rewards memory records that *"the server checks how an answer was given,
not whether it was right; it has no deck content to re-grade against"* — this
is the change that closes that gap, for tutor rounds first and for the app's
own rounds whenever we choose.

**`packages/shared/src/tutor.ts`** — the one definition of:

- `TutorQuestion { cardId, rung: SupportLevel, say, prompt, choices?, scaffold?, index, total }`
- `TutorStudyCard`, `RoundSummary`
- `planTutorRound(input: PathInput, mode, size, band): PlannedCard[]` —
  `planPath()` for practice, due-across-decks for review, every card at
  rung 3 for test; filtered by `speakable()`; **pure and deterministic
  given an rng**, so it is simulable.
- `questionFor(card, rung, pool, direction, rng): TutorQuestion` —
  builds the payload, and is the only function that decides what the model
  sees. The answer side is not a parameter of the result type.
- `normalizeSpoken(given: string): string` — the spoken-answer layer in
  front of `gradeWritten`.
- `speakable(card): boolean`.
- `tutorInstructions(band, name, grade): string`.

**`simulate:tutor`**, in the same pull request, in `npm test`. A simulated
learner with a known knowledge state plays a few thousand rounds through
`planTutorRound` and `questionFor`, answering from what it "knows", and the
simulation asserts:

- **no pre-grading payload contains the answer text** of the open card,
  in any mode but study — the withholding rule, pinned;
- rung 1 payloads carry the correct answer among the choices and never mark
  it; rung 2 scaffolds reveal no more than the app's do;
- a skip is a miss; a requeued card never promotes within the round;
- the round's written attempts reconstruct its summary exactly;
- `normalizeSpoken` is idempotent and never turns a correct typed answer
  into a wrong one (the app's own graded fixtures run through it).

**`validate:mcp`** — a static check over the tool definitions: names ≤ 64
characters, every tool annotated, every result schema carries `say`,
`tools/list` order stable across two builds. Cheap, and it is the directory
submission checklist in executable form.

**Routes**, in a new scope on the API with its own limiter:

```
POST /mcp                                the endpoint; bearer MCP token
GET  /.well-known/oauth-protected-resource
GET  /.well-known/oauth-authorization-server
POST /api/oauth/register
GET  /api/oauth/authorize
POST /api/oauth/authorize/decision       from the consent screen; ordinary Supabase bearer
POST /api/oauth/token
POST /api/oauth/revoke

GET  /api/mcp/grants                     Connected apps; ordinary Supabase bearer
POST /api/mcp/grants/:id/revoke
```

Rate limits keyed on the grant: **120 calls a minute** (a voice round is a
call every few seconds, with headroom) and **3,000 a day**. The OAuth
endpoints share the invite scope's shape — keyed on IP, tight — because a
token endpoint is a guess surface. `withUser` is entered once per `/mcp`
call after token verification, so every tool runs under RLS with no
per-tool authorization code, and a tool that forgot to filter by learner
would return nothing rather than someone else's child.

---

## 10. The tutor packet

For the ChatGPT family until OpenAI ships tools in voice, and for anyone who
wants something in the car this afternoon without connecting first.

On any deck's screen: **Copy for a voice assistant.** It puts on the
clipboard a short prompt — the instructions block from §6, minus the tool
calls — followed by the deck's speakable cards as *prompt → answer* lines,
and the sentence:

> This practice is not recorded in Whizzo. To count it, connect Whizzo as an
> app (Account → Connected apps).

It is a text file, it costs nothing, it needs no server, and it is honest.
It also nudges toward the real thing every time it is used. Covered learners
get it for any deck; free-tier learners for their three.

---

## 11. What this changes elsewhere

- **Activities catalog** gains `tutor` and the `speakable` requirement;
  the capability matrix evaluates it from `parseRich` exactly as it does
  `plain-answer`.
- **Grading** moves to `packages/shared` (§9). Old path re-exports.
- **`attempts`** gains `channel`. Nothing reads it yet except the history
  screen and the §16 query; `rebuild_item_mastery` is unchanged and counts
  it, deliberately (§12).
- **Assignments.** A task set for `learn` on a deck is closed by a `tutor`
  session on that deck that asked questions. Learn and Tutor are the same
  container asking at the same per-card rungs, and a parent who set *"Learn
  Chapter 4"* and finds it not done after the child spent twenty minutes
  doing it with Claude has been told something false. One clause in the
  completion predicate, guarded by the session's `meta.complete` — the round
  was seen through to its last card. A round ended early or by silence still
  writes its answers; it does not finish a task, any more than closing the
  app after the second card does. Nothing else matches — a task for `test`
  is closed by a test in the app.
- **Sessions / history.** `activity: 'tutor'`, `meta.channel`,
  `meta.client`; the history row reads *Tutor round · with Claude*.
- **Family.** One line per learner when it applies: *Practiced with ChatGPT
  yesterday, 8/10.* And on Account, **Connected apps** (§5).
- **Rewards.** No new criterion, and no exclusion — §12.
- **Retention.** Reads attempts; sees tutor evidence as evidence. It
  schedules the same.
- **Ingestion.** `GeneratedCard` is reused by `create_deck`. A deck made by
  an assistant is `source: 'generated'` like an ingested one, and reviewed
  the same way.
- **Billing.** §13.
- **README / build-sequence.** This document, stage 10, migration 0020.

---

## 12. Rewards, and the decision not to fence this off

The obvious rule is *"rewards never pay on tutor evidence"*. It was the
first draft of this section, and it is wrong, for a reason worth writing
down so nobody reinstates it by reflex.

The worry is the model. It has answers from earlier in the conversation — a
study batch, the reveal after a miss — and a child can ask it. But the app
already has this hole in exactly the same shape: the deck list is one tab
away from a Learn round, and the answer to the card on screen is on it. The
app's defense has never been *the answer is unobtainable*; it is *the answer
is not shown with the question before the attempt*, plus the ladder's
requirement of two corrects on two days with a delay before anything
promotes, plus rewards resting on the strict three-word definitions rather
than on a single good afternoon. Every one of those defences applies to a
tutor round unchanged, and the withholding rule (§2) is the same rule the
app has, enforced in the same place.

So: **a tutor attempt is verified evidence, and it counts wherever verified
evidence counts** — mastery, the ladder, ability at rung 3, assignments,
retention, and rewards. The `channel` column exists so this can be checked
rather than believed (§16), and if the data shows tutor rounds are earning
promotions the app's rounds would not, the fence is one predicate in
`award_matching_rewards` and can go in that afternoon.

What does *not* count, in the tutor or anywhere: study exposures (rung 0,
unverified — a flashcard flip), hinted answers toward ability (rung 2 by
construction), timed criteria (there are none, and the tutor records no
time).

---

## 13. Billing

Per the gate principle — never gate learning, gate leverage and marginal
cost:

**Free, always.** Connecting, every round mode, `create_deck`, the tutor
packet. There is no marginal cost to us: the model, the speech and the
minutes are the family's own subscription, and the server does one database
transaction per round. A child practicing out loud with the assistant their
parent already pays for is learning, and it is also the best sentence the
marketing page will have — *works with the ChatGPT or Claude you already
have* — which is not something to put behind our own paywall.

**Covered learner.** `get_progress` follows the reporting gates exactly as
the Family screen does: thirty days uncovered, all history covered, the
retention number covered. The tutor packet for a fourth deck follows the
deck limit.

**Metered.** Nothing. No model call is ever made from this code, so
`llm_usage` gains no rows from it — worth stating because it is the reason
the feature is cheap enough to give away.

The one thing worth watching is the day limit: three thousand calls a day
per grant is about three hundred rounds, which no family reaches and a
script would. If a grant hits it, it is not a family.

---

## 14. What v1 ships, and what waits

**v1 — connect, tutor, count it.**

- the latency spike (§1), first, with the measured numbers written into
  this section and the default round length set from them;
- the OAuth server: DCR and CIMD registration, consent screen with the
  children ticked, `select_learner` and per-call `learner`, PKCE, resource indicators, refresh rotation, revocation,
  Connected apps on Account;
- `/mcp` on Streamable HTTP, `2026-07-28` with legacy `initialize`
  accepted, origin validation, deterministic `tools/list`;
- `whoami`, `list_materials`, `get_progress`, `start_round` (all four
  modes), `answer`, `hint`, `end_round`, `create_deck`, `search`, `fetch`,
  the `tutor` prompt;
- `speakable`, the `tutor` activity, grading moved to shared,
  `normalizeSpoken`, `channel` on attempts, migration 0020;
- Learn tasks closed by tutor sessions; history and Family lines;
- `simulate:tutor` and `validate:mcp` in `npm test`;
- the tutor packet;
- the Account screen's setup instructions for both clients, including the
  *allow unsupervised* step for `start_round` and `answer`;
- a privacy page for the connector, because the directory listing needs one
  and the consent screen should link to it anyway.

**v2 —** spelling aloud with a letter-name-tolerant grader; word lists;
spoken math projection (`\frac{3}{4}` → *"three quarters"*) so equation
cards become speakable; `checkpoint` rounds through the tutor once
Checkpoints exist; learner switching inside a conversation via the
multi-round-trip pattern rather than reconnecting; directory submission on
both sides once a month of real voice rounds says the server is stable;
`responseMs` from client-supplied timing if either client ever exposes it.

**v3 —** a ChatGPT app widget (the Apps SDK) showing the round's progress
bar and the miss list inline; resources for ingested documents so an
assistant can teach from the source, not only the cards; a teacher's
`assign` tool, gated on the consent question in §15.

---

## 15. Open questions

| Question | Blocks | Why it can wait |
| --- | --- | --- |
| What is the tool round trip inside a Claude voice turn, and does *allow always* hold mid-conversation? | the default round length; whether `answer` stays one call | the spike measures both in a day |
| When does ChatGPT voice get tools? | nothing — the same server serves it the day it does | outside our control; dictation and the packet cover the gap |
| Should a tutor or teacher's grant be allowed to *write* (rounds) or only read? | nothing in v1 | linked grown-ups can already record rounds for a learner from the app; a tutor running a voice session is the same act. Revisit if a family objects |
| Does `close` count as a pass in practice when the answer was spoken? | nothing | the app's rule, kept; transcription makes near-misses *more* common, which argues for keeping it lenient, not less |
| Should `create_deck` be able to target a learner directly when the connecting account owns them? | nothing | the library is the right home for reviewable content; a parent assigning it is one tap in the app |
| Where does `responseMs` come from, if ever? | fluency reporting for tutor rounds only | null is honest; fluency is reportable, never payable, so nothing rests on it |
| Do we want to be in the two directories at all? | discoverability | a family that types our URL is a family that already knows us; the directory is acquisition, and acquisition can wait for a stable server |

---

## 16. How we know it worked

Three numbers, and one of them is a test rather than a metric.

- **Connections that run a round within a day** of connecting, and
  **rounds per connected learner per week** after a month. If the second
  is under one, the feature is a demo. Split by client: the Claude number
  is the voice number, and it is the one the whole bet is on.
- **The accuracy gap.** Per learner, rung-3 accuracy on `channel = 'mcp'`
  attempts against `channel = 'app'` attempts on the same items, same
  fortnight. They should be within noise of each other. If tutor rounds are
  systematically *easier* — say ten points — the model is helping in a way
  we did not design, §12's fence goes in, and we look at the transcripts.
  If they are systematically *harder*, `normalizeSpoken` is marking
  transcription errors as misses, and that is a grader bug to fix before it
  costs a child a rung.
- **Retention of tutor-learned items.** Items that reached *learned*
  mostly through tutor rounds, versus items learned in the app: their
  Checkpoint pass rate at fourteen days. This is the number that says
  whether talking it through is as good as typing it, and no competitor can
  report it because no competitor records the attempt.

And the one that is not a number: **every parent who connects sees, on
their own phone, a round they did not have to build a feature to get.**
That is the bet — that the tutor everyone asks for is a tool surface and a
consent screen, and the rest is rented.
