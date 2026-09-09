# Paste this to Claude Code

I have a design handoff to implement in this repo. Read
`design_handoff_whizzo_brand/README.md` in full before writing any code — it
carries the exact tokens, screen specs, and a definition of done.

## Context

This is the Whizzo monorepo (`apps/web` React SPA, `apps/api` Fastify,
`packages/shared`, `supabase/`). The app currently ships as "Cat Academy" and is
built visually around cats. The work is to introduce the Whizzo brand and make
Cats **one of ten swappable themes**, so kids engage with a subject they actually
like.

This is a **presentation-layer change**. `apps/api`, `packages/shared` and
`supabase/` need no changes, and `apps/web/src/lib/adaptive.ts` must not be
touched. If a step seems to require changing the adaptive engine, the assignment
model, or the plan gating, stop and ask — the design is wrong, not the engine.

The design references are HTML prototypes. **Do not port their markup.**
Recreate the screens in the app's own React + Tailwind patterns, lifting exact
values from the README's token tables.

## Order of work — one PR per step, tests green at each

**1. Tokens.** Replace the palette and fonts in `apps/web/tailwind.config.js`
per README §3. Keep every existing keyframe and animation. Retire `Baloo 2`;
self-host Outfit, Nunito, Space Grotesk. Expect this to break screens visually —
that is fine, step 3 fixes it.

**2. Theme layer.** Add `apps/web/src/lib/themes.ts` with the `Theme` interface
and all ten themes (README §4 — copy the `THEMES` array out of
`Whizzo Student App.dc.html`'s logic block; it is the source of truth). Add a
provider above the progress provider in `App.tsx` that writes `--wz-accent` to
the document element and exposes the theme's copy strings. Persist per learner
(localStorage in guest mode, learner profile when signed in). Theme is display
state — it must never enter `attempts`.

**3. Color sweep.** `grep -rn "cream\|grape\|bubble\|violet-\|fuchsia-\|purple-" apps/web/src`
and reclassify each usage as brand chrome (`spark`/`ink`), data (`pine` — never
themed), or play surface (`accent`). README §5 lists the hotspots. Two rules that
must hold afterwards: **a progress bar is `pine` in every theme**, and **no
grown-up surface (Family, Progress, Account, Library, Tasks, Plans) carries a
theme accent at all.**

**4. Mascot migration.** Rename `CatMascot.tsx` → `Mascot.tsx`, keep the prop
names, default `color` to the theme accent. Collapse six moods to four states
across the 24 call sites in README §7. **Retire `sad`** — its one call site
(`SpellingResults.tsx:44`, `accuracy < 50`) shows a sad mascot to the lowest
scorer, which is exactly backwards. Preserve all six deliberate `color`
overrides. Ship the v1 primitive mascots from `Whizzo Mascots.dc.html`, with the
striped placeholder as the fallback for any theme without art.

**5. Student screens.** Theme picker, Home (K–5 and 6–12 variants), Session,
Reward, and the World screen — which is **three shared archetypes, not ten
screens**: collection, journey, assembly. README §6.1. Ignore the black preview
bar in the prototype; it is review scaffolding.

**6. Parent screen.** Rebuild `screens/suite/ProgressScreen.tsx` per README §6.2,
taking the child switcher as the bridge from the existing `FamilyScreen.tsx`.
Wire the Free/Pro gate to the plan limits that already exist — do not invent a
new plan concept.

**7. Icons.** Export variants G (store) and I (favicon) from README §2 and
retire `apps/web/public/cat.svg`.

## Non-negotiables

- Copy is load-bearing. "Counts toward your level", "Practice only · doesn't
  affect level", "Hint — this word stops counting", and the "How the level is
  worked out" card are the product's honesty made visible. Do not reword them.
- A theme may never change curriculum, difficulty, or what earns a reward. Earn
  rate is fixed across all ten.
- Grade bands on themes are advisory ordering only. Never a restriction.
- `npm test` and `npm run simulate:adaptive` must pass with **unchanged**
  adaptive output at every step.

## Where to push back

Tell me rather than guessing if: a token has no sensible home in the existing
component structure; a screen in the design conflicts with behavior already
shipped (particularly Family vs Progress, assignments, or plan gating); or the
theme indirection would force a change to stored data. The design was made
without reading every screen in this repo, so the repo is the authority on
behavior and the design is the authority on appearance.
