# Deploying to DigitalOcean App Platform

## The thing to understand first

**App Platform does not read `app.yaml` from your repository.** The spec lives in
DigitalOcean, and this file is a copy of it kept under version control.

That means push-to-`main` deploys your **code**, not your **configuration**. If
you change `app.yaml` — add an environment variable, change a route, resize an
instance — nothing happens until you apply it:

```bash
doctl apps update <app-id> --spec .do/app.yaml
```

Forgetting this is the usual way a "why is my new env var undefined" hour gets
spent.

## First deploy

**1. Let DigitalOcean see the repo.** In the App Platform dashboard, connect
GitHub and authorise the `jasonfill/whizzo` repository. The spec's
`github:` blocks fail without it.

**2. Fill in the secrets.** `app.yaml` declares ten secrets with no values, on
purpose — they must not be committed. An app created from the spec as-is comes up
with an empty `DATABASE_URL`, and the API validates its environment at boot and
exits, so you get a crash loop rather than a clear error. Render a filled copy:

```bash
set -a && source apps/api/.env && source apps/web/.env.local && set +a
node .do/render-spec.mjs
```

Both files, because the API's secrets live in one and the SPA's build-time
`VITE_*` values in the other.

That writes `.do/app.rendered.yaml` (gitignored, mode 600). It refuses if
anything is missing **or still holds a placeholder** like `[YOUR-PASSWORD]` —
injecting one of those gives you an app that deploys and then cannot reach its
database, which is a slower failure to diagnose than a refusal here.

Both connection strings come from the dashboard's **Connect** panel, and they
must differ:

| Variable | Which string | Port |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler | 6543 |
| `MIGRATION_DATABASE_URL` | Session pooler | 5432 |

Not the old `db.<ref>.supabase.co` host — it is IPv6-only unless the project has
the IPv4 add-on, and fails with `ENOTFOUND` from anywhere without IPv6. And not
the transaction pooler for migrations: the runner holds a `pg_advisory_lock`,
which is session-scoped, so under transaction pooling two instances could
migrate simultaneously and neither would notice. The API logs a warning if it
spots port 6543 there.

**3. Create the app.**

```bash
doctl apps create --spec .do/app.rendered.yaml
```

Then delete the rendered file — it contains live credentials.

**4. Check it on its own hostname** — `<app-name>-<hash>.ondigitalocean.app` —
before touching DNS. Two things to verify:

```bash
curl https://<your-app>.ondigitalocean.app/api/health
```

should return `{"status":"ok",...}`. If it returns the SPA's HTML instead, the
ingress is stripping the `/api` prefix and `preserve_path_prefix: true` did not
take — every API call will 404 until it does.

Then check the deploy log for the migration lines: `adopted 3` on an existing
database, or `applied 3` on a fresh one. The API refuses to start if migrations
fail, so a healthy `/api/health` already means the schema is current.

**5. Move DNS last.** `whizzo.app` currently points at GitHub Pages. The domain
sits pending in the app until DNS points at DigitalOcean; certificate issuance
only succeeds after it does. Until you move it, whizzo.app keeps serving the old
static build — which no longer has an API behind it, so leave the cutover short.

## Ongoing

- **Code**: push to `main`. Both components have `deploy_on_push`.
- **Config**: `doctl apps update <app-id> --spec .do/app.yaml`, and re-render
  first if you touched a secret.

## Tests gate the deploy

`npm test` runs inside the `api` component's build command. If it fails, the
build fails, the deployment is not promoted, and the previous one keeps
serving.

This lives here rather than in GitHub Actions because **`deploy_on_push` does
not read GitHub's commit status.** It answers the push webhook directly, so a
test workflow would run *alongside* this build, not before it — going red some
minutes after the bad commit was already live. Actions can tell you a push was
broken; only a failing build stops it shipping.

Two consequences worth knowing:

- **One component runs it, both are covered.** `npm test` is typecheck, lint and
  vitest across every workspace, and a deployment is atomic across components —
  a failure in `api` takes the whole deployment down, `web` included. So it sits
  on `api` only and costs its few minutes once rather than twice.
- **It has to come after the shared build.** `@whizzo/shared` has no TypeScript
  project references; the other workspaces resolve it through `dist/`. Run
  `npm test` before `npm run build --workspace @whizzo/shared` and every
  typecheck fails on a clean builder.

The unit tests stub the database, so they need nothing from the environment.
What they cannot cover is Row Level Security — that only exists inside Postgres,
so it needs `scripts/smoke.mjs` against a scratch database, which is not part of
the deploy.

## Known rough edges

- **Both components rebuild on every push.** `source_dir` is `/` for both,
  because the npm workspace needs the repository root to install. App Platform
  only skips a component when nothing under its `source_dir` changed, so a
  README edit rebuilds the API too. Slower deploys; nothing worse.
- **Two `npm ci` runs per deploy**, one per component, for the same reason.
- **The test run adds a few minutes to every deploy.** The suite is ~45s on a
  developer machine but around 4 CPU-minutes; a build container has far less
  parallelism to spend on it. That is the price of the gate.
- If build times become annoying, the fix is a Dockerfile for the API component
  (`dockerfile_path`), which still deploys from GitHub on push but builds once
  and under your control.

## Rollback

App Platform keeps previous deployments; roll back from the Activity tab or:

```bash
doctl apps list-deployments <app-id>
doctl apps create-deployment <app-id> --force-rebuild
```

Note that rolling back **code** does not roll back the **schema** — migrations
have no `down`. A rollback across a migration boundary needs a forward fix or a
database restore.
