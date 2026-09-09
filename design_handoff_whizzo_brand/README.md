# Whizzo — design handoff

Brand identity, ten-theme system, student app, parent dashboard and mascot set,
specified for implementation in the **whizzo_app monorepo**.

---

## 0. Read this first

**The files in this bundle are design references written in HTML.** They are
prototypes of intended look and behavior, not production code. Do not port the
markup. Recreate each screen in `apps/web` using the app's existing patterns
(React 18 + TypeScript + Vite + Tailwind), lifting the exact values from the
token tables below.

**Fidelity: high.** Colors, type, spacing, radii and copy are final. The copy
in particular is load-bearing — phrases like "Counts toward your level",
"Practice only · doesn't affect level" and "Hint — this word stops counting" are
the product's honesty made visible. Keep them.

**Paths.** Everything below is relative to `apps/web/src/` unless stated. The
API (`apps/api`), shared contract (`packages/shared`) and database
(`supabase/`) need **no changes** for any of this: it is a presentation-layer
re-skin plus one new client-side theme concept.

**A note on the GitHub repo.** `github.md` in this bundle records
`jasonfill/keyboard-cats`, which is an earlier single-app snapshot. The local
monorepo is the real target and is significantly ahead of it (Fastify API,
Supabase, Family screen, assignments, library, tutor links, plans). Where the
two disagree, **the monorepo wins**.

---

## 1. The governing idea

**The brand is the chassis. A theme is the paint.**

A theme swaps exactly two visual tokens — one accent color and one mascot — plus
a small set of copy strings (a verb and a collectible noun). Nothing else in any
screen changes. The app today is built around Cats; Cats becomes one of ten equal
themes.

Three rules that must survive implementation:

1. **A theme never changes curriculum, difficulty, or what earns a reward.** A
   ribbon (Horses) and a fossil (Dinosaurs) are the same graded round underneath.
   Otherwise switching themes becomes a way to farm easy wins. `lib/adaptive.ts`
   is not touched by any of this.
2. **Progress color is never the theme accent.** Mastery bars, grade rows and
   charts use `pine`, always, so a progress bar means the same thing in every
   theme. The accent is for play surfaces and CTAs.
3. **Grown-up surfaces are theme-free.** Family, Progress, Account, Library,
   Tasks, Plans: accent dials back to `ink`. A progress report must never carry
   a child's theme.

---

## 2. Brand: direction "Spark" (approved)

### Wordmark
`whizzo`, Outfit 900, `letter-spacing: -0.035em`, color `ink #1C1A16`,
**always lowercase**. Mark to its left: a 34px squircle (`border-radius: 11px`)
in `ink`, containing the glyph `wz` in Outfit 900, `letter-spacing: -0.08em`,
colored with the active theme accent.

### App icons (approved set — see `01-icons-wz-squircle.png`)
| Variant | Use | Spec |
| --- | --- | --- |
| **G · White on spark** | store / installed icon | 96px tile, radius 26px, bg `#FF6A2B`, glyph `wz` Outfit 900 48px `-0.08em` in `#FFFFFF`, 4px bottom padding for optical centring. At 28px: radius 8px, glyph 14px. |
| **I · Outlined paper** | web favicon, print | bg `#FFF7ED`, 3px `#1C1A16` border (1.5px at 28px), glyph `ink`. Needs `box-sizing: border-box`. |
| **H · Spark on ink** | optional alternate | bg `#1C1A16`, glyph `#FF6A2B`; the glyph may tint to the active theme accent. |

`wz` at `-0.08em` starts reading as a single glyph below ~28px, which is why the
store icon and the favicon are different variants. Replaces
`apps/web/public/cat.svg`.

### Type
Outfit (display) · Nunito (UI + body) · Space Grotesk (uppercase micro-labels).
**`Baloo 2` is retired.** Self-host all three — the build is a static bundle and
should not gain a CDN dependency.

| Role | Font | Notes |
| --- | --- | --- |
| Wordmark, icon glyph | Outfit 900 | `-0.035em` / `-0.08em` |
| h1 | Outfit 800 | 32–46px, line-height 1.02–1.1, `-0.02em` |
| h2, stat values | Outfit 800 | 18–32px |
| Buttons, labels, table cells | Nunito 800 | 12–19px |
| Body | Nunito 400 | 14–18px, line-height 1.45–1.55 |
| Eyebrow labels | Space Grotesk 700 | 10–12px, uppercase, tracking 0.10–0.18em |

Minimum sizes: never below 13px on parent surfaces; 15px on student body copy.

---

## 3. Tailwind changes

`apps/web/tailwind.config.js` currently defines `cream / grape / bubble / sky /
lime / sun`, used directly in screen markup (`bg-cream`, `text-grape`). Replace
them. Keep every existing `keyframes` and `animation` entry — `floaty`, `pop`,
`pounce`, `wiggle`, `shake`, `confetti-fall` are all still in use.

```js
theme: {
  extend: {
    fontFamily: {
      display: ['Outfit', 'system-ui', 'sans-serif'],
      sans:    ['Nunito', 'system-ui', 'sans-serif'],
      mono:    ['"Space Grotesk"', 'ui-monospace', 'monospace'],
    },
    colors: {
      // surfaces
      paper:   '#FAF6EF',   // app background
      chalk:   '#FFF7ED',   // warm white
      wash:    '#F2ECE1',   // section header
      tray:    '#F1EADC',   // segmented control / inert track
      quiet:   '#F6F1E7',   // explanatory cards
      hair:    '#EDE5D7',   // 1px card border
      edge:    '#DCD3C2',   // 2px ghost-button border
      // ink
      ink:     '#1C1A16',
      ink2:    '#2A2621',   // rows inside an ink card
      body:    '#57524A',
      muted:   '#6B6558',
      stone:   '#8A8375',
      faint:   '#A29A8A',
      onink:   '#C9C2B4',
      // brand
      spark:   '#FF6A2B',
      sparkD:  '#E14E12',   // pressed + solid bottom shadow
      // data — never themed
      pine:    '#1F7A6B',
      pineSoft:'#8FC9BE',
      sun:     '#FFC542',
      // theme-driven
      accent:  'rgb(var(--wz-accent) / <alpha-value>)',
    },
  },
}
```

**Elevation:** cards use a 1px `hair` border, not a shadow. Only two shadows in
the system — the active segmented-control card (`0 1px 3px rgba(28,26,22,0.12)`)
and the solid button press (`0 4px 0` in the darker accent; the shadow does not
move, the button lifts 1px on hover so it appears to press).

**Radii:** 8 (28px icon) · 10–12 (buttons, small tiles) · 14 (inputs, inner rows)
· 16–18 (stat cards, trays) · 20–22 (sections) · 26–28 (outer cards, hero) · 999
(pills, progress).

**Spacing scale:** 4 / 6 / 8 / 10 / 14 / 18 / 22 / 26 / 34 / 40.

---

## 4. The theme layer (new)

One provider mounted above the existing progress provider in `App.tsx`. It sets
`--wz-accent` on `document.documentElement` and exposes the theme's copy.

```ts
// lib/themes.ts
export type ThemeId =
  | 'cats' | 'dogs' | 'football' | 'space' | 'dinosaurs'
  | 'ocean' | 'racing' | 'horses' | 'music' | 'robots'

export type RewardShape = 'collection' | 'journey' | 'assembly'

export interface Theme {
  id: ThemeId
  name: string
  accent: string        // hex
  accentRgb: string     // '124 92 255' — written to --wz-accent
  deep: string          // pressed state, on-tint text, button shadow
  tintA: string         // hero / panel wash
  tintB: string         // chip fill, stripe partner
  bands: string         // 'K–5' — display only
  verb: string          // primary CTA: 'Pounce in'
  unit: string          // plural collectible: 'cat cards'
  unitOne: string       // singular: 'card'
  worldNoun: string     // 'Card wall'
  shape: RewardShape
  total: number         // collectible set size
  cheer: string         // in-session praise
  cheerSub: string
  rewardTitle: string
  because: string       // why this was earned
  // shape-specific
  names?: string[]      // collection cell labels
  stops?: string[]      // journey stop labels
  parts?: string[]      // assembly part labels
}
```

All ten themes' values are in `Whizzo Student App.dc.html` — the `THEMES` array
in its logic block is the source of truth and transfers almost verbatim.

| Theme | Accent | Deep | Bands | Verb | Collectible | Reward shape |
| --- | --- | --- | --- | --- | --- | --- |
| Cats | `#7C5CFF` | `#4C2FD1` | K–5 | Pounce in | cat cards (24) | collection |
| Dogs | `#C2410C` | `#7C2D12` | K–5 | Fetch it | tricks (18) | collection |
| Football | `#1F7A6B` | `#10493F` | 3–12 | Kick off | yards (8 stops) | journey |
| Space | `#4338CA` | `#2A2199` | 2–9 | Launch | moons (8 stops) | journey |
| Dinosaurs | `#4D7C0F` | `#33520A` | K–4 | Start digging | fossil bones (8) | assembly |
| Ocean | `#0E7490` | `#0A4E61` | 1–8 | Dive in | depths (8 stops) | journey |
| Racing | `#B91C1C` | `#7F1313` | 2–10 | Green light | car parts (8) | assembly |
| Horses | `#92400E` | `#63290A` | 2–8 | Saddle up | ribbons (15) | collection |
| Music | `#BE185D` | `#831043` | 4–12 | Sound check | set list (20) | collection |
| Robots | `#475569` | `#2F3947` | 3–12 | Power up | bot parts (8) | assembly |

Mascot slot stripe, used everywhere art is missing:
`repeating-linear-gradient(135deg, {tintB} 0 9px, {tintA} 9px 18px)` with the
label in `deep`, Space Grotesk 700 9–11px, tracking 0.08em.

**Persistence.** Theme is per learner, not per account — siblings differ. Store
it beside the rest of progress: `localStorage` in guest mode, a column on the
learner profile when signed in, so it survives a device change like everything
else. It is display state, so it must **not** enter `attempts`.

**Grade bands are advisory.** They order the picker and nothing else. A grade 11
student who wants Dinosaurs gets Dinosaurs.

---

## 5. Sweeping theme color out of the existing screens

```bash
grep -rn "cream\|grape\|bubble\|violet-\|fuchsia-\|purple-\|pink-" apps/web/src
```

Decide per usage:

- **Brand chrome** (headers, CTAs, focus rings) → `spark` / `ink`
- **Data and progress** (mastery bars, grade rows, accuracy, streak strips) →
  `pine` / `pineSoft`. Never the accent.
- **Play surfaces** (mascot, world map, rewards, celebration, session chrome) →
  `accent`

Known hotspots: `screens/suite/SuiteHome.tsx` hardcodes per-subject gradients
(`from-violet-300 to-fuchsia-400` and friends) — those become neutral cards with
the accent only on the mascot slot and CTA. `components/Background.tsx` and
`index.css` carry the cat-era wash. Keep the `prefers-reduced-motion` handling
in `index.css` exactly as it is.

---

## 6. Screens

### 6.1 `Whizzo Student App.dc.html` — student surfaces
The preview bar at the top (screen tabs, K–5/6–12 toggle, ten theme dots) is
**scaffolding for review only**. Do not build it.

**Theme picker** — "Pick your world". 5-column grid of 20px-radius cards; the
active card gets a 2px accent border and `0 8px 24px -12px {accent}`. Sub-line
"Collect {unit}", CTA text "{verb} →", or "Your world ✓" when active. Standing
copy: *"You can change it whenever you like. It never changes what you're
learning — only who you're learning it with."*

**Home, K–5 view.** 26px-radius hero in `tintA`, two columns (content + 300px
mascot). Eyebrow `{THEME} · DAY 12` in `deep`; h1 Outfit 800 46px; one 19px
primary CTA with `0 4px 0 {deep}`. Mascot floats on the existing `floaty`
keyframe (3.4s). Below: three activity cards, each a status pill (accent tint
"6 WORDS" / `tray` "PRACTICE" / spark tint "FROM DANA"), Outfit 800 24px title,
15px explanation, button pinned to the bottom with `margin-top: auto`. Only the
graded card gets a filled button.

**Home, 6–12 view.** Same data, no hero. Inline h1 + CTA row, four 16px-radius
stat chips (streak / unaided accuracy / level / collectible — the last in
`tintA`), then an "Up next" list card whose header states the ordering:
*"ORDERED BY WHAT YOU'RE CLOSEST TO FORGETTING"*. Each row: status dot (accent =
graded, `edge` = practice, `sun` = assigned), title, sub-line naming what counts,
Start button. This queue is the existing cross-deck due queue.

Both views share a bottom pair: a progress card (14px accent-filled bar,
"{owned} of {total} {unit}") and a `tintA` world teaser with four stripe swatches
— three filled, the fourth dashed white — linking into the world screen.

**Session** — 800px column. Header: "← Leave", an 8-segment progress strip
(filled accent / current `tintB` / pending `tray`), "4 / 8". Card carries a
"LISTEN & SPELL · COUNTS" chip in `tintB` and a right-aligned
"GRADE 4 · DOUBLED CONSONANT" — that second label is the error pattern from the
existing difficulty model, the same source the proofread distractors use. 68px
replay button, sentence with the blank as a `tray` chip, live input with a 2px
accent border and a 3px caret, "Check". Below: the hint button labeled
**"Hint — this word stops counting"** and "You've had this one right 2 of 7
times." Then a `tintA` mascot strip with themed cheer copy — **the mascot is the
only themed element on this screen**, stated in the footnote.

**Reward** — 26px `tintA` panel: three stars, themed `rewardTitle`, and the
explanation *"7 of 8 unaided, and you beat what we predicted for this set by 12
points. The third star is for that."* — this is the existing curve-graded star
rule made legible. Three `#FFFFFFB8` stat tiles (unaided / predicted / streak).
Then the collectible card: 108px reward-art slot, "NEW {UNIT}", item name, and
the `because` line. Footnote: *"Rewards are earned on graded work only. A hinted
word can't buy a fossil."*

**World — three archetypes, not ten screens.** This is the load-bearing
decision.

| Shape | Themes | Layout |
| --- | --- | --- |
| **collection** | Cats, Dogs, Horses, Music | 6-column grid. Owned: white card, 1px `tintB` border, art slot, name, `#n`. Locked: `#FBF8F1`, 1px dashed `edge`, name "Locked", sub "EARN IT". |
| **journey** | Football, Space, Ocean | Horizontal stop rail in `tintA`. Past stops: accent dot with ✓ and accent connector. Current: white dot, 3px accent ring, ●. Future: `#FFFFFF99`. Below, a `#FFFFFFCC` card with mascot + "where you are" + "what's next". |
| **assembly** | Dinosaurs, Racing, Robots | Two columns: a `tintA` stage showing assembled art "5 OF 8 PARTS", and a part list — fitted rows white with `tintB` border and "FITTED", locked rows `#FBF8F1` dashed with "LOCKED". |

Ten bespoke reward screens is ten things to maintain. Art and nouns differ per
theme; layout and logic do not. Earn rate is **fixed across themes**: one reward
per graded round that clears its predicted accuracy, plus one per level
promotion.

### 6.2 `Whizzo Parent Dashboard.dc.html` — grown-up surface

Note the monorepo already splits this: **Family** is per-child oversight and
**Progress** is the deep history. This design is the *single-child* view — build
it as the redesigned `screens/suite/ProgressScreen.tsx`, and take the child
switcher as the bridge from `FamilyScreen.tsx`. The four aggregate stats map onto
the aggregated family query that already exists.

Sticky header (`#FAF6EFEE` + `backdrop-filter: blur(8px)`, 1px `#E9E0D0` bottom
border), main column `max-width: 1180px`, padding `34px 40px 90px`, `gap: 22px`.
Body grid `1.55fr 1fr`, `gap: 18px`, `align-items: start`.

1. **Header** — mark + wordmark + `FAMILY` pill; 5 nav tabs (active = ink pill,
   idle `muted` with `tray` hover); ghost "Print report"; account chip.
2. **Child switcher** — segmented control in a `tray` tray, 6px padding; active
   child a white 12px card with the one small shadow. 30px avatar tile in the
   child's theme tint with accent initials; sub-line `GRADE 4 · CATS`.
3. **Stat row** — 4 cards. Eyebrow Space Grotesk 11px `faint`; value Outfit 800
   32px; 13px footnote. The fourth (reading level) inverts to ink — it is the one
   number a parent came for.
4. **Activity chart** — 21 bars, 96px tall, `gap: 6px`, fill `pine`, radius
   `6px 6px 3px 3px`, **zero-days floored at 4px so absence is visible**. Insight
   strip below in spark tint with `#7C4A22` text — written prose, not a stat.
5. **Subjects** — 12px mastery bars, `tray` track, `pine` then `pineSoft`
   segments, legend at 13px.
6. **"Worth 10 minutes together"** — trouble-word table: WORD / UNAIDED /
   SLIPPED / WHAT TRIPS IT / BACK ON. Slipped count in `#C2410C`; "today" in
   `pine`, future in `muted`. "What trips it" is the error pattern (doubled
   consonant, schwa vowel, homophone, ei/ie swap, silent opener, -able/-ible).
   Gated: Free shows 4 rows + upgrade strip, Pro shows all. Wire to the existing
   plan limits (word-report and 30-day history flags) — **the prototype's
   `plan` prop stands in for that; do not build a new plan concept.**
7. **"You set"** — ink assignments card. Rows in `ink2`, 8px bars, status
   `pineSoft` (done) / `sun` (in progress). Spark CTA "Assign something new".
   This is the existing assignment set, and "Done" already has a round id behind
   it — keep it opening the answers in place.
8. **Recent sessions** — status dot `pine` graded / `pineSoft` partly aided /
   `edge` practice-only, sub-line naming the aid ("2 hints taken", "Practice only
   · doesn't affect level"). This is where "0/14 checked" belongs.
9. **"How the level is worked out"** — `quiet` card explaining that only unaided
   answers move the level. **This is a trust feature; keep the copy.**
10. **Theme card** — the child's theme, stating plainly that it changes nothing
    in the report.

Empty states: with no attempts the trouble table says "Nothing here yet" rather
than rendering an empty grid — the current screen already behaves this way.

---

## 7. Mascots

`Whizzo Mascots.dc.html` is a **v1 set that can ship**: ten characters built
from circles, rounded rectangles and triangles, drawn on a 176×176 box.
`Whizzo Mascot Spec.dc.html` is the commissioning document for drawn
replacements, and carries the migration table.

### Component migration
Rename `components/CatMascot.tsx` → `Mascot.tsx`. **Keep the prop names**
(`mood`, `color`, `size`, `className`); `color` defaults to the theme accent
instead of `#f59e0b`; `size` takes 200 / 108 / 62 / 34.

Six moods collapse to four states across **24 call sites in 14 files** — 17
literals, 5 ternaries, and 2 passing `mood` as state (`GamePlay:129`,
`SpellingPlay:256`, both importing the `Mood` type, so those are a type change
rather than a find-and-replace).

| Mood today | New state |
| --- | --- |
| `neutral`, `happy` | `idle` |
| `excited`, `wow` | `cheer` |
| `sleepy` | `resting` |
| `sad` | `thinking` — **retired on purpose** |

`sad` has exactly one call site: `SpellingResults.tsx:44`, the `accuracy < 50`
branch — i.e. it shows a sad cat to the learner who scored lowest. Missing words
at the edge of your ability is the system working as designed; a crestfallen
mascot teaches a child that working at their level is failing. Point that branch
at `thinking` and remove `sad` from the union.

Six sites pass `color` deliberately and must keep it: `#94a3b8` at
`SuiteHome:54` and `TypingHome:34` (the secondary companion — give these a named
muted variant, not a hex), `#f472b6` at `CatRainScreen:222`, `#38bdf8` at
`PracticeScreen:95`, per-world `w.color` at `CatRainScreen:299`, and `catColor`
into `GamePlay:129`.

### Slots and states
Sizes 200 (K–5 hero) / 108 (reward) / 62 (session) / 34 (avatar). **34px decides
the design** — if the silhouette is not recognizable as one flat shape at 34px it
is the wrong silhouette. States: idle, cheer, thinking, resting. No sad state.

Build the slot as a fixed-aspect container rendering `theme.mascotSrc` with the
striped placeholder as fallback, so themes ship art independently and drawn and
primitive mascots can coexist.

### Honest limits
Only the idle pose exists in v1; cheer, thinking and resting need building.
**Racing is the weakest** — a red triangular ear on a round red head fights being
a fox — so redraw it first, then Cats / Space / Robots as the style test
(youngest, middle, oldest). Reward art is a separate, larger commission: roughly
145 pieces at 108px (24 cat cards, 18 tricks, 15 ribbons, 20 tracks, 8 bones,
8 car parts, 8 bot parts, and 8 stops each for Football, Space, Ocean).

---

## 8. Definition of done

- [ ] Tailwind palette and fonts replaced; `Baloo 2` gone; all keyframes kept
- [ ] `lib/themes.ts` + provider; `--wz-accent` live; theme persists per learner
- [ ] No `grape`/`cream`/`bubble`/violet/fuchsia left in `src`
- [ ] Progress and data colors are `pine` in every theme
- [ ] Grown-up surfaces render with no theme accent at all
- [ ] Theme picker, both Home views, Session, Reward, and all three World shapes
- [ ] `Mascot` renamed, `sad` retired, all 24 sites migrated, 6 `color`
      overrides preserved
- [ ] App icons G and I exported and wired; `cat.svg` retired
- [ ] `npm test` passes — typecheck, lint, curriculum, adaptive simulation
- [ ] `npm run simulate:adaptive` output unchanged: **none of this may alter the
      engine**

---

## 9. Files

| File | What |
| --- | --- |
| `Whizzo Brand.dc.html` | Brand sheet. Turn 3 = approved wz icons; turn 2 = ten themes + icon explorations; turn 1 = three directions (**1a Spark approved**; 1b/1c are archived context — do not build them). |
| `Whizzo Student App.dc.html` | All student screens, ten themes, both age bands. The `THEMES` array is the token source of truth. |
| `Whizzo Parent Dashboard.dc.html` | Single-child parent view. Has a Free/Pro prop. |
| `Whizzo Mascots.dc.html` | v1 mascot set, ten characters. |
| `Whizzo Mascot Spec.dc.html` | Commissioning brief + the mood→state migration table. |
| `screenshots/` | Reference captures. The HTML is the source of truth; screenshots are lossy. |

Open any `.dc.html` directly in a browser. They need only `support.js` (a preview
runtime, not part of the design) and the Google Fonts links.

## 10. Assets still needed

- Mascot art for cheer / thinking / resting (v1 covers idle)
- Reward art, ~145 pieces, per theme
- Exported icon set from variants G and I
- Self-hosted Outfit, Nunito, Space Grotesk
