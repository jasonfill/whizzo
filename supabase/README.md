# Setting up the database

Cat Academy stores accounts and learning progress in [Supabase](https://supabase.com)
(hosted Postgres + auth). Without it the app opens unauthenticated against
`localStorage` — the one case where the sign-in gate is lifted, because with no
auth service there is no way through it. Any real build needs this.

Budget about ten minutes.

## 1. Create a project

1. Sign in at <https://supabase.com/dashboard> and create a new project.
2. Pick a region near your users and set a database password (you will not need
   it for the app, only for direct psql access).
3. Wait for the project to finish provisioning.

## 2. Run the migrations

**The API applies these automatically at startup**, so on a normal deploy there
is nothing to do here — see [apps/api/README.md](../apps/api/README.md). What
follows is for setting up a project by hand, or for understanding what the
runner is doing.

A database migrated by hand is still fine: each migration declares an
`@applied-if` predicate on its first line, and the runner records an
already-present migration rather than replaying it. That matters because these
files are idempotent individually but **not in sequence** — `0001` rewrites
policies against a `user_id` column that `0003` renames.

Open **SQL Editor → New query** in the dashboard and run each migration in
order:

1. [`0001_init.sql`](./migrations/0001_init.sql) — every core table, the Row
   Level Security policies, the signup trigger, and two helper functions.
2. [`0002_quiz_decks.sql`](./migrations/0002_quiz_decks.sql) — the study-deck
   table behind Quiz Cats.
3. [`0003_learners.sql`](./migrations/0003_learners.sql) — the learner
   inversion described below. It backfills existing accounts, so it runs once
   per project.
4. [`0004_learner_auth_cleanup.sql`](./migrations/0004_learner_auth_cleanup.sql) —
   lets an auth user actually be deleted; without it, removing an account a
   learner signs in with fails on a check constraint.
5. [`0005_grants.sql`](./migrations/0005_grants.sql) — states every table grant
   the app needs. Row Level Security decides which *rows* a caller may touch;
   a plain GRANT decides whether the role may touch the table at all, and
   Postgres refuses on the grant before it ever consults a policy.

All three are idempotent, so re-running is safe. Order matters: each assumes
the one before it.

If you prefer the CLI:

```bash
npm install -g supabase
supabase link --project-ref <your-project-ref>
supabase db push
```

### What it creates

| Table | Holds |
| --- | --- |
| `profiles` | One row per **adult account**: display name, avatar, plan |
| `learners` | One row per **learner**, owned by an adult |
| `guardian_links` | Which adults may see which learners |
| `link_invites` | Short-lived pairing codes |
| `learner_credentials` | Provisioned sign-in codes and PIN hashes |
| `skill_states` | The adaptive engine's per-subject state (ability, level, streak) |
| `attempts` | Every single word attempted — the record everything else derives from |
| `item_mastery` | Per-word mastery and the spaced-repetition schedule |
| `sessions` | One row per completed round of practice |
| `list_progress` | Per-unit stars and best scores |
| `daily_activity` | Daily rollup powering streaks and the progress strip |
| `achievements` | Unlocked badges |
| `high_scores` | Arcade leaderboard rows |
| `word_lists` | Custom word lists a parent or teacher pastes in |

Every progress table has Row Level Security on, keyed by `learner_id` through
`can_access_learner()`: you reach a learner's rows if you own that learner, if
you are that learner, or if you have been linked as a guardian. Content tables
(`decks`, `word_lists`) go one step further and write through
`can_manage_learner_content()`, so a guardian linked as read-only can watch a
child's progress without being able to rewrite their decks.

Two policies are worth calling out. `profiles_update_own` lets an adult change
their name and avatar but **not** their `plan` — billing state is only writable
by something holding the service role. And `learner_credentials` has RLS on with
*no policies at all*, which makes it invisible to every browser session; only
the service role and the SECURITY DEFINER functions can read a PIN hash.

## The learner model

A learner is a profile owned by an adult, not an auth user. This is what keeps
the product out of COPPA's verifiable-consent regime: a child can have a full
record without the app ever collecting an email address from them.

An auth identity is optional, and `learners.auth_kind` says which shape it takes:

| `auth_kind` | Who signs in | Collected from the child |
| --- | --- | --- |
| `none` | nobody — the child plays on a grown-up's signed-in device | nothing |
| `provisioned` | the child, with a parent-minted code and PIN | nothing |
| `self` | the child, with their own email or Google account | email, name, avatar |

`self` is gated on age 13+, enforced by the `learners_guard` trigger rather than
by the UI. An unknown birth year is treated as a refusal.

### Pairing

The learner's owner mints a code with `mint_link_invite()`; the other adult
redeems it with `redeem_link_invite()`. Redemption is an RPC rather than a
client-side insert because a redeemer must never be able to *read*
`link_invites` — with read access a short code becomes enumerable.

The same table with `purpose = 'self_login'` is how a 13+ learner attaches their
own Google account: the parent mints, the teen redeems while signed in as
themselves, and the age gate fires on the way through.

### Provisioned sign-in needs an Edge Function

`attach_provisioned_login()` and `authenticate_learner()` are revoked from
`anon` and `authenticated` and granted only to `service_role`. They are meant to
be called by an Edge Function that holds the admin API: creating the synthetic
auth user, and exchanging a code + PIN for a session. Until that function
exists, `auth_kind = 'provisioned'` is reachable from SQL but not from the app.

## Tests

[`tests/0003_learners_test.sql`](./tests/0003_learners_test.sql) pins the
security properties — a stranger cannot read a child's record, an under-13
cannot be given their own sign-in, a revoked guardian goes blind, credentials
are unreadable. Run it against a scratch database that has all three migrations
applied; any failure raises, so a non-zero exit means the schema regressed.

## 3. Turn on Google sign-in

1. In Google Cloud Console, create an **OAuth 2.0 Client ID** (type: Web
   application).
2. Add this authorised redirect URI, using your project ref:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In Supabase, go to **Authentication → Providers → Google**, enable it, and
   paste the client ID and secret.
4. In **Authentication → URL Configuration**, set the **Site URL** to
   `https://whizzo.app` and add every origin you sign in from to
   **Redirect URLs**:
   - `https://whizzo.app/**` for the deployed app
   - `http://localhost:5173/**` for local development

   Both entries matter, and for the same reason. The app asks to come back to
   its own origin (`authRedirectUrl()` in
   [`apps/web/src/lib/supabase.ts`](../apps/web/src/lib/supabase.ts)), but
   Supabase honors that only when it matches an entry in **Redirect URLs** —
   otherwise it silently sends the browser to the **Site URL** instead. A new
   project ships with `http://localhost:3000` there, so a deployment that skips
   this step finishes Google sign-in by landing on `localhost:3000/?code=…`,
   an origin that has neither the app nor the PKCE verifier the code is
   exchanged with. The same allow-list governs the confirmation-email and
   password-reset links, so all three break together.

Email and password sign-in works with no extra configuration. If you would
rather skip the confirmation email while testing, turn off **Confirm email**
under **Authentication → Providers → Email**.

## 4. Point the app at the project

The browser needs these two only for *auth* — since the API gateway landed, all
data goes through `/api` and the anon key never touches a table. Copy them from
**Project Settings → API**:

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon public key>
```

Restart `npm run dev`. The account chip in the top right should now read
"Sign in" instead of "Guest".

The API needs more than this — a direct Postgres connection among other things.
See [apps/api/.env.example](../apps/api/.env.example).

## 5. Deploy

Deployment is one DigitalOcean App Platform app with two components, the SPA and
the API, sharing a hostname; see [.do/app.yaml](../.do/app.yaml). The GitHub
Pages workflow is manual-only now: Pages serves static files, and this app needs
`/api` on the same origin.

## Notes

- **Guest progress is merged on first sign-in.** A learner who practiced before
  registering keeps everything: counters add, bests win, and the local copy is
  only cleared once the merge has been written. See `mergeSnapshots` in
  `src/lib/progress/repo.ts`. The merge marker is keyed by *learner*, so a
  parent with two children cannot fold the same guest practice into both.
- **`rebuild_item_mastery(learner_id, subject)`** re-derives every mastery number straight
  from the `attempts` log. If the cached values are ever doubted, that function
  is the answer — the attempt log is the source of truth, everything else is a
  cache.
- **Plans are modeled but not billed.** `profiles.plan` is `free` or `pro` and
  the app gates features on it, but no payment processor is wired up. Adding
  Stripe means a webhook (an Edge Function is the natural home) that updates
  `plan`, `plan_source`, and `plan_renews_at` with the service role.
