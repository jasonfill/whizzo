# Whizzo API

The only thing that talks to Postgres. The browser holds a Supabase session for
*authentication* and sends that token here; every byte of learner data goes
through these routes.

## Why it does not use the service-role key for reads and writes

A gateway that connects with the service-role key bypasses Row Level Security
entirely, which would throw away the policy layer in
[`0003_learners.sql`](../../supabase/migrations/0003_learners.sql) and make every
route handler solely responsible for not leaking another family's data.

Instead, `withUser` in [`src/db.ts`](src/db.ts) runs each request inside a
transaction that sets the caller's claim and then drops to the `authenticated`
role:

```sql
begin;
select set_config('request.jwt.claim.sub', $1, true);
select set_config('request.jwt.claims', $2, true);
set local role authenticated;
-- ... the route's queries ...
commit;
```

So `auth.uid()` resolves exactly as it does through PostgREST, and the policies
still enforce underneath the API's own checks. Both settings are
transaction-local, so a pooled connection cannot leak one caller's identity into
the next request. `withAdmin` is the deliberate exception, for work with no
caller: provisioning a child credential, billing webhooks.

The practical consequence is visible in the tests: a route handler that forgot
to filter by learner would still return nothing for a stranger.

## Migrations

They run at startup, before the listener binds. An instance that cannot bring
the schema up to date exits rather than serving traffic against a schema it does
not understand.

- A Postgres **advisory lock** means several instances booting at once cannot
  race; the losers wait, then find everything already recorded. This only works
  on a session-scoped connection, so `MIGRATION_DATABASE_URL` must be Supabase's
  **session** pooler (5432), not the transaction pooler (6543). The runner warns
  if it sees the wrong port.
- A ledger in `public.schema_migrations` records name, checksum and duration.
- Each migration runs in its own transaction.

### Adoption

The migrations are idempotent individually but **not in sequence** — `0001`
rewrites policies against a `user_id` column that `0003` renames, so replaying
`0001` on a fully migrated database fails. Databases migrated by hand through
the Supabase SQL editor start with an empty ledger, which would mean exactly
that replay on first boot.

So a migration may declare how to recognise that it is already present:

```sql
-- @applied-if: select to_regclass('public.learners') is not null
```

On an empty ledger the runner evaluates the predicate, and records the migration
as applied without running it. Sentinels are chosen to be late-created and
durable — tables, not policies, since later migrations rewrite policies. A file
with no predicate always runs, so new migrations are unaffected.

### CLI

```bash
npm run migrate:status   # applied / pending / changed-since-applied
npm run migrate          # apply everything pending
```

There is no `down`. Reversing a column rename across ten tables plus a backfill
is not something anyone should trigger by typing one word; recovery is a forward
migration or a restore.

## Connected apps

`/mcp` is a Model Context Protocol endpoint (Streamable HTTP, no sessions) so
Claude and ChatGPT can tutor a learner out loud on their own decks —
[docs/mcp-tutor-spec.md](../../docs/mcp-tutor-spec.md). It is a resource
server, and the API carries its own small OAuth 2.1 authorization server for
it: the two well-known documents, dynamic registration and Client ID Metadata
Documents, PKCE (S256 only), resource indicators, refresh rotation. The
consent screen is the web app's `/connect`.

Assistants never hold a Supabase token, and `/mcp` never accepts one. An
access token is signed under `MCP_TOKEN_SECRET`, bound to the canonical `/mcp`
URL as its audience, and carries the grant it belongs to; the grant is read on
every call so a disconnect on the Account screen takes effect on the next
request, not at the hour mark. Inside the endpoint every tool runs under
`withUser`, so RLS applies exactly as it does for the browser.

Two rules the tests pin: no question payload ever contains the answer to the
card it asks (the answer arrives only from the grading call), and a round's
attempts are written through `writeProgressChange` with `channel = 'mcp'` —
the same code the browser's rounds use, so the evidence means the same thing
whichever way it arrived.

## Child sign-in

A four-digit PIN is not a password, so the PIN is never the Supabase password.
`derivePassword` HMACs it under `CHILD_LOGIN_SECRET`, and that is the password
the auth server sees. Someone who learns a child's PIN still cannot sign in
without the server secret, and the API stores neither the PIN nor the derived
password — `learner_credentials.pin_hash` exists only so a wrong PIN can be
rejected before we talk to the auth server.

`learner_credentials` has RLS on with **no policies at all**, so it is invisible
to every browser session; only `service_role` and the SECURITY DEFINER functions
reach it.

Rotating `CHILD_LOGIN_SECRET` invalidates every provisioned child login. Treat it
as permanent.

## Running it

```bash
cp .env.example .env
npm run dev --workspace @whizzo/api
```

The web app proxies `/api` to `http://127.0.0.1:8787` in development, so the
browser talks to the same path it will in production.

## Tests

```bash
npm run smoke --workspace @whizzo/api
```

37 checks against a running API and a scratch database. They exist mainly to
prove the thing that is easy to break and impossible to eyeball: that RLS still
enforces *through* the gateway. A stranger gets `[]` from `/api/learners`, a 404
on someone else's child, and a 403 minting an invite — and the 13+ age gate still
arrives as an HTTP 400 with the database's own wording.

To run them you need a scratch database with the migrations plus
[`0003_learners_test.sql`](../../supabase/tests/0003_learners_test.sql) applied,
which creates the fixtures. The child sign-in round trip is skipped unless
`SUPABASE_SERVICE_ROLE_KEY` and `CHILD_LOGIN_SECRET` are set, since it needs the
real admin API.
