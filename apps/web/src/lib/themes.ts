// The theme layer.
//
// The brand is the chassis; a theme is the paint. A theme swaps exactly one
// accent color and one mascot, plus a handful of copy strings — a verb and a
// collectible noun. Nothing else in any screen changes.
//
// Three rules this file exists to keep honest:
//
//   1. A theme never changes curriculum, difficulty, or what earns a reward.
//      A ribbon and a fossil are the same graded round underneath, so nothing
//      here is reachable from `lib/adaptive.ts`. Earn rate is fixed across all
//      ten themes; otherwise switching themes becomes a way to farm easy wins.
//   2. Progress color is never the accent. Mastery bars, grade rows and charts
//      are `pine` in every theme, so a progress bar means the same thing to
//      every learner. The accent is for play surfaces and CTAs only.
//   3. Grown-up surfaces are theme-free. Family, Progress, Account, Library,
//      Tasks and Plans dial the accent back to `ink`. A progress report must
//      never carry a child's theme.
//
// Theme is display state. It never enters `attempts`.

export type ThemeId =
  | 'cats'
  | 'dogs'
  | 'football'
  | 'space'
  | 'dinosaurs'
  | 'ocean'
  | 'racing'
  | 'horses'
  | 'music'
  | 'robots'

/**
 * How a theme's collectibles are laid out on the world screen.
 *
 * Three archetypes, not ten screens: art and nouns differ per theme, layout
 * and logic do not. Ten bespoke reward screens is ten things to maintain.
 */
export type RewardShape = 'collection' | 'journey' | 'assembly'

export interface Theme {
  id: ThemeId
  name: string
  /** Hex, for SVG fills and inline styles that cannot take a Tailwind class. */
  accent: string
  /** '124 92 255' — written to `--wz-accent`, which drives the `accent` token. */
  accentRgb: string
  /** Pressed state, text on a tint, and the solid-button bottom shadow. */
  deep: string
  /** Hero / panel wash. */
  tintA: string
  /** Chip fill, and the stripe partner in the mascot placeholder. */
  tintB: string
  /**
   * Advisory ordering for the picker and nothing else. A grade 11 student who
   * wants Dinosaurs gets Dinosaurs — this is never a restriction.
   */
  bands: string
  /** Primary CTA verb: 'Pounce in'. */
  verb: string
  /** Plural collectible: 'cat cards'. */
  unit: string
  /** Singular collectible: 'card'. */
  unitOne: string
  /** What the world screen is called: 'Card wall'. */
  worldNoun: string
  shape: RewardShape
  /** Collectible set size. */
  total: number
  /** In-session praise. */
  cheer: string
  cheerSub: string
  /** Reward-screen headline. */
  rewardTitle: string
  /** Why this was earned — always points back at graded work. */
  because: string
  /** Collection cell labels. `collection` themes only; length equals `total`. */
  names?: string[]
  /** Journey stop labels. `journey` themes only. */
  stops?: string[]
  /** Assembly part labels. `assembly` themes only. */
  parts?: string[]
  /** Assembly stage heading, e.g. 'Stegosaurus'. `assembly` themes only. */
  assemblyOf?: string
  /**
   * What each grade band is called in this world, easiest first — one per
   * grade from 2 to 8, matching GRADES order.
   *
   * The curriculum owns the grade and what it teaches; the theme owns only
   * what the rung is called. A learner on Ocean climbs Tide Pools to The
   * Trench and one on Robots goes Parts Bin to Full System, and both are
   * spelling the identical words in the identical order.
   */
  levels: Array<{ name: string; emoji: string }>
  /**
   * What the five typing worlds are called here, in curriculum order:
   * home row, top row, bottom row, sentences, numbers.
   *
   * Name only. Which keys a world teaches is curriculum and stays in its
   * blurb, so a themed name can never leave a learner unsure which row they
   * are on.
   */
  worlds: Array<{ name: string; emoji: string }>
  /** Art for the mascot slot. Absent themes fall back to the striped placeholder. */
  mascotSrc?: string
}

export const THEMES: Theme[] = [
  {
    id: 'cats',
    name: 'Cats',
    accent: '#7C5CFF',
    accentRgb: '124 92 255',
    deep: '#4C2FD1',
    tintA: '#F3EFFF',
    tintB: '#E9E1FF',
    bands: 'K–5',
    verb: 'Pounce in',
    unit: 'cat cards',
    unitOne: 'card',
    worldNoun: 'Card wall',
    shape: 'collection',
    total: 24,
    cheer: 'Nice one.',
    cheerSub: 'That is the word that got you last Tuesday.',
    rewardTitle: 'Three stars!',
    because: 'Earned by clearing a graded round above its predicted score.',
    names: [
      'Tabby',
      'Calico',
      'Tuxedo',
      'Ginger',
      'Siamese',
      'Maine coon',
      'Sphynx',
      'Ragdoll',
      'Bengal',
      'Persian',
      'Bombay',
      'Manx',
      'Russian blue',
      'Birman',
      'Ocicat',
      'Korat',
      'Savannah',
      'Chartreux',
      'Abyssinian',
      'Burmese',
      'Devon rex',
      'Norwegian forest',
      'Turkish van',
      'Snowshoe',
    ],
    worlds: [
      { name: 'Home Row Meadow', emoji: '🌼' },
      { name: 'Treetop Tower', emoji: '🌳' },
      { name: 'Burrow Basement', emoji: '🕳️' },
      { name: 'Sentence Savannah', emoji: '🦁' },
      { name: 'Number Nook', emoji: '🔢' },
    ],
    levels: [
      { name: 'Kitten Corner', emoji: '🧶' },
      { name: 'Whisker Woods', emoji: '🌲' },
      { name: 'Prowler Peaks', emoji: '⛰️' },
      { name: 'Lynx Lookout', emoji: '🔭' },
      { name: 'Panther Plateau', emoji: '🐆' },
      { name: 'Cougar Canyon', emoji: '🏜️' },
      { name: 'Tiger Summit', emoji: '🐯' },
    ],
  },
  {
    id: 'dogs',
    name: 'Dogs',
    accent: '#C2410C',
    accentRgb: '194 65 12',
    deep: '#7C2D12',
    tintA: '#FDEEE6',
    tintB: '#F8E0D2',
    bands: 'K–5',
    verb: 'Fetch it',
    unit: 'tricks',
    unitOne: 'trick',
    worldNoun: 'Trick book',
    shape: 'collection',
    total: 18,
    cheer: 'Good one!',
    cheerSub: 'Two more and your pup learns something new.',
    rewardTitle: 'Three stars!',
    because: 'Tricks come from graded rounds only — practice keeps them sharp.',
    names: [
      'Sit',
      'Stay',
      'Paw',
      'Roll over',
      'Fetch',
      'Speak',
      'Spin',
      'Play dead',
      'Jump',
      'Weave',
      'Bow',
      'Heel',
      'High five',
      'Crawl',
      'Wave',
      'Beg',
      'Catch',
      'Balance',
    ],
    worlds: [
      { name: 'The Kennel', emoji: '🏠' },
      { name: 'Over the Jumps', emoji: '🪜' },
      { name: 'The Dig Pit', emoji: '🕳️' },
      { name: 'The Long Walk', emoji: '🦮' },
      { name: 'Counting Treats', emoji: '🦴' },
    ],
    levels: [
      { name: 'Puppy Park', emoji: '🐾' },
      { name: 'Fetch Field', emoji: '🎾' },
      { name: 'Trick Trail', emoji: '🦴' },
      { name: 'Agility Ridge', emoji: '🏅' },
      { name: 'Scent Summit', emoji: '👃' },
      { name: 'Working Line', emoji: '🐕' },
      { name: 'Best in Show', emoji: '🏆' },
    ],
  },
  {
    id: 'football',
    name: 'Football',
    accent: '#1F7A6B',
    accentRgb: '31 122 107',
    deep: '#10493F',
    tintA: '#E6F4EF',
    tintB: '#D6ECE4',
    bands: '3–12',
    verb: 'Kick off',
    unit: 'yards',
    unitOne: 'drive',
    worldNoun: 'The drive',
    shape: 'journey',
    total: 8,
    cheer: 'First down.',
    cheerSub: 'Four more words and you are in the red zone.',
    rewardTitle: 'Touchdown drive!',
    because: 'Yards come from graded rounds. Hints stop the clock instead.',
    stops: [
      'Kickoff',
      'Own 35',
      'Midfield',
      'Their 40',
      'Red zone',
      'Goal line',
      'Touchdown',
      'Trophy',
    ],
    worlds: [
      { name: 'The Huddle', emoji: '🏈' },
      { name: 'The Long Ball', emoji: '🎯' },
      { name: 'The Ground Game', emoji: '🥾' },
      { name: 'Full Drive', emoji: '🏟️' },
      { name: 'The Scoreboard', emoji: '🔢' },
    ],
    levels: [
      { name: 'Practice Squad', emoji: '🏈' },
      { name: 'Kickoff Line', emoji: '🏟️' },
      { name: 'Midfield', emoji: '🥅' },
      { name: 'Red Zone', emoji: '🎯' },
      { name: 'Goal Line', emoji: '🚩' },
      { name: 'Playoff Push', emoji: '🏅' },
      { name: 'Championship', emoji: '🏆' },
    ],
  },
  {
    id: 'space',
    name: 'Space',
    accent: '#4338CA',
    accentRgb: '67 56 202',
    deep: '#2A2199',
    tintA: '#ECEBFF',
    tintB: '#DEDCFB',
    bands: '2–9',
    verb: 'Launch',
    unit: 'moons',
    unitOne: 'moon',
    worldNoun: 'Flight path',
    shape: 'journey',
    total: 8,
    cheer: 'Locked on.',
    cheerSub: 'Three more and Jupiter is in range.',
    rewardTitle: 'Orbit reached!',
    because: 'Each mastered list unlocks the next body on the path.',
    stops: [
      'Launchpad',
      'The Moon',
      'Mars',
      'Asteroids',
      'Jupiter',
      'Saturn',
      'Neptune',
      'Deep field',
    ],
    worlds: [
      { name: 'The Launchpad', emoji: '🚀' },
      { name: 'Upper Atmosphere', emoji: '☁️' },
      { name: 'Landing Site', emoji: '🌑' },
      { name: 'Full Mission', emoji: '🛰️' },
      { name: 'Flight Numbers', emoji: '🔢' },
    ],
    levels: [
      { name: 'Launchpad', emoji: '🚀' },
      { name: 'Low Orbit', emoji: '🛰️' },
      { name: 'The Moon', emoji: '🌙' },
      { name: 'Mars', emoji: '🔴' },
      { name: 'Asteroid Belt', emoji: '☄️' },
      { name: 'Outer Planets', emoji: '🪐' },
      { name: 'Deep Field', emoji: '🌌' },
    ],
  },
  {
    id: 'dinosaurs',
    name: 'Dinosaurs',
    accent: '#4D7C0F',
    accentRgb: '77 124 15',
    deep: '#33520A',
    tintA: '#EFF4E2',
    tintB: '#E2EBD0',
    bands: 'K–4',
    verb: 'Start digging',
    unit: 'fossil bones',
    unitOne: 'bone',
    worldNoun: 'The dig site',
    shape: 'assembly',
    total: 8,
    cheer: 'Something’s down there.',
    cheerSub: 'Two more words and you can brush it off.',
    rewardTitle: 'Bone found!',
    because: 'Bones only come out of graded digs. Hinted words leave the ground.',
    parts: ['Skull', 'Jaw', 'Ribs', 'Spine', 'Tail', 'Claws', 'Legs', 'Plates'],
    assemblyOf: 'Stegosaurus',
    worlds: [
      { name: 'Base Camp', emoji: '⛺' },
      { name: 'The High Ridge', emoji: '🏔️' },
      { name: 'The Dig Pit', emoji: '⛏️' },
      { name: 'Full Skeleton', emoji: '🦴' },
      { name: 'Field Notes', emoji: '🔢' },
    ],
    levels: [
      { name: 'First Dig', emoji: '⛏️' },
      { name: 'Bone Bed', emoji: '🦴' },
      { name: 'Fossil Ridge', emoji: '🪨' },
      { name: 'Amber Grove', emoji: '🟠' },
      { name: 'Tar Pits', emoji: '🕳️' },
      { name: 'Great Rift', emoji: '🌋' },
      { name: 'Museum Hall', emoji: '🦕' },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    accent: '#0E7490',
    accentRgb: '14 116 144',
    deep: '#0A4E61',
    tintA: '#E4F3F7',
    tintB: '#D2EAF1',
    bands: '1–8',
    verb: 'Dive in',
    unit: 'depths',
    unitOne: 'depth',
    worldNoun: 'The descent',
    shape: 'journey',
    total: 8,
    cheer: 'Down you go.',
    cheerSub: 'The next depth has something with teeth.',
    rewardTitle: 'New depth!',
    because: 'Depth is earned on graded rounds — the light does not come back.',
    stops: [
      'Shore',
      'Reef',
      'Kelp',
      'Open water',
      'Twilight',
      'Midnight',
      'Abyss',
      'Trench',
    ],
    worlds: [
      { name: 'The Shallows', emoji: '🐚' },
      { name: 'The Surface', emoji: '🌅' },
      { name: 'The Deep', emoji: '🌑' },
      { name: 'Open Ocean', emoji: '🌊' },
      { name: 'Depth Gauge', emoji: '🔢' },
    ],
    levels: [
      { name: 'Tide Pools', emoji: '🐚' },
      { name: 'The Reef', emoji: '🐠' },
      { name: 'Kelp Forest', emoji: '🌿' },
      { name: 'Open Water', emoji: '🌊' },
      { name: 'Twilight Zone', emoji: '🔦' },
      { name: 'Midnight Zone', emoji: '🦑' },
      { name: 'The Trench', emoji: '🕳️' },
    ],
  },
  {
    id: 'racing',
    name: 'Racing',
    accent: '#B91C1C',
    accentRgb: '185 28 28',
    deep: '#7F1313',
    tintA: '#FCEAEA',
    tintB: '#F7D9D9',
    bands: '2–10',
    verb: 'Green light',
    unit: 'car parts',
    unitOne: 'part',
    worldNoun: 'The garage',
    shape: 'assembly',
    total: 8,
    cheer: 'Clean lap.',
    cheerSub: 'Two more and you can bolt on the new wing.',
    rewardTitle: 'Part unlocked!',
    because: 'Parts come out of graded laps. A hint is a pit stop.',
    parts: [
      'Chassis',
      'Engine',
      'Tyres',
      'Front wing',
      'Brakes',
      'Exhaust',
      'Livery',
      'Nitro',
    ],
    assemblyOf: 'Your car',
    worlds: [
      { name: 'The Grid', emoji: '🏁' },
      { name: 'The Straight', emoji: '🛣️' },
      { name: 'The Chicane', emoji: '🌀' },
      { name: 'Full Lap', emoji: '🏎️' },
      { name: 'Lap Times', emoji: '⏱️' },
    ],
    levels: [
      { name: 'Pit Lane', emoji: '🔧' },
      { name: 'Time Trial', emoji: '⏱️' },
      { name: 'Club Circuit', emoji: '🏁' },
      { name: 'Street Course', emoji: '🏙️' },
      { name: 'Night Race', emoji: '🌃' },
      { name: 'Endurance', emoji: '🕛' },
      { name: 'Grand Prix', emoji: '🏆' },
    ],
  },
  {
    id: 'horses',
    name: 'Horses',
    accent: '#92400E',
    accentRgb: '146 64 14',
    deep: '#63290A',
    tintA: '#F6EEE2',
    tintB: '#EEE1CC',
    bands: '2–8',
    verb: 'Saddle up',
    unit: 'ribbons',
    unitOne: 'ribbon',
    worldNoun: 'The tack room',
    shape: 'collection',
    total: 15,
    cheer: 'Steady.',
    cheerSub: 'Ribbons only come from graded tests — this is one.',
    rewardTitle: 'Blue ribbon!',
    because: 'Ribbons are awarded for graded tests, never for practice.',
    names: [
      'First, spelling',
      'Second, vocab',
      'Show jumping',
      'Dressage',
      'Cross country',
      'Trail',
      'Barrels',
      'Reining',
      'Hunter',
      'Halter',
      'Western',
      'Endurance',
      'Vaulting',
      'Polo',
      'Grand prix',
    ],
    worlds: [
      { name: 'The Paddock', emoji: '🐴' },
      { name: 'Over the Jumps', emoji: '🚧' },
      { name: 'The Trail', emoji: '🌾' },
      { name: 'Full Course', emoji: '🏇' },
      { name: 'Ribbon Count', emoji: '🔢' },
    ],
    levels: [
      { name: 'Pony Paddock', emoji: '🐴' },
      { name: 'Trail Ride', emoji: '🌾' },
      { name: 'Cross Rails', emoji: '🚧' },
      { name: 'Show Ring', emoji: '🎪' },
      { name: 'Dressage Court', emoji: '🎗️' },
      { name: 'Cross Country', emoji: '🌳' },
      { name: 'Grand Prix', emoji: '🏆' },
    ],
  },
  {
    id: 'music',
    name: 'Music',
    accent: '#BE185D',
    accentRgb: '190 24 93',
    deep: '#831043',
    tintA: '#FCE9F2',
    tintB: '#F8D7E7',
    bands: '4–12',
    verb: 'Sound check',
    unit: 'set list',
    unitOne: 'track',
    worldNoun: 'The set list',
    shape: 'collection',
    total: 20,
    cheer: 'In time.',
    cheerSub: 'Two more and the next track is in the set.',
    rewardTitle: 'Track added!',
    because: 'Tracks are earned on graded rounds. The encore needs all twenty.',
    names: [
      'Opener',
      'Track 2',
      'Track 3',
      'Track 4',
      'Track 5',
      'Track 6',
      'Track 7',
      'Track 8',
      'Track 9',
      'Track 10',
      'Track 11',
      'Track 12',
      'Track 13',
      'Track 14',
      'Track 15',
      'Track 16',
      'Track 17',
      'Track 18',
      'Encore',
      'Closer',
    ],
    worlds: [
      { name: 'First Position', emoji: '🎵' },
      { name: 'The High Notes', emoji: '🎼' },
      { name: 'The Low Notes', emoji: '🎹' },
      { name: 'Full Song', emoji: '🎤' },
      { name: 'Counting Bars', emoji: '🥁' },
    ],
    levels: [
      { name: 'First Chords', emoji: '🎵' },
      { name: 'Garage Band', emoji: '🎸' },
      { name: 'Open Mic', emoji: '🎤' },
      { name: 'Club Night', emoji: '🎹' },
      { name: 'Studio Session', emoji: '🎧' },
      { name: 'Festival Stage', emoji: '🎪' },
      { name: 'Headline Show', emoji: '🌟' },
    ],
  },
  {
    id: 'robots',
    name: 'Robots',
    accent: '#475569',
    accentRgb: '71 85 105',
    deep: '#2F3947',
    tintA: '#EDF0F3',
    tintB: '#DFE4EA',
    bands: '3–12',
    verb: 'Power up',
    unit: 'bot parts',
    unitOne: 'part',
    worldNoun: 'The workshop',
    shape: 'assembly',
    total: 8,
    cheer: 'Systems nominal.',
    cheerSub: 'Two more and the sensor array comes online.',
    rewardTitle: 'Part fabricated!',
    because: 'Parts are fabricated from graded work only.',
    parts: [
      'Head',
      'Torso',
      'Left arm',
      'Right arm',
      'Legs',
      'Power core',
      'Sensors',
      'Jetpack',
    ],
    assemblyOf: 'Your bot',
    worlds: [
      { name: 'The Chassis', emoji: '🔩' },
      { name: 'Upper Servos', emoji: '🦾' },
      { name: 'Lower Servos', emoji: '🦿' },
      { name: 'Full Assembly', emoji: '🤖' },
      { name: 'Binary Bay', emoji: '🔢' },
    ],
    levels: [
      { name: 'Parts Bin', emoji: '🔩' },
      { name: 'Test Bench', emoji: '🔌' },
      { name: 'First Steps', emoji: '🦿' },
      { name: 'Sensor Array', emoji: '📡' },
      { name: 'Autonomy', emoji: '🧠' },
      { name: 'Field Trial', emoji: '🛠️' },
      { name: 'Full System', emoji: '🤖' },
    ],
  },
]

export const DEFAULT_THEME_ID: ThemeId = 'cats'

/** '#7C5CFF' -> '124 92 255', the space-separated form a CSS variable needs. */
export function hexToRgbTriple(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

const BY_ID = new Map<ThemeId, Theme>(THEMES.map((t) => [t.id, t]))

/** Never throws: an unknown id falls back to the default rather than blanking the app. */
export function themeById(id: string | null | undefined): Theme {
  return BY_ID.get(id as ThemeId) ?? BY_ID.get(DEFAULT_THEME_ID)!
}

export function isThemeId(id: unknown): id is ThemeId {
  return typeof id === 'string' && BY_ID.has(id as ThemeId)
}

/**
 * The labels a `collection` / `journey` / `assembly` theme uses for its slots.
 * Always `total` long, so a grid never renders a hole.
 */
export function slotLabels(theme: Theme): string[] {
  const given = theme.names ?? theme.stops ?? theme.parts ?? []
  if (given.length >= theme.total) return given.slice(0, theme.total)
  return [...given, ...Array.from({ length: theme.total - given.length }, (_, i) => `#${given.length + i + 1}`)]
}

/**
 * The stripe used wherever mascot or reward art is missing, so a theme can ship
 * art independently and drawn and primitive mascots can coexist.
 */
export function placeholderStripe(theme: Theme): string {
  return `repeating-linear-gradient(135deg, ${theme.tintB} 0 9px, ${theme.tintA} 9px 18px)`
}

/**
 * The lowest and highest grade a band names. 'K–5' is 0..5, '3–12' is 3..12.
 *
 * Used only to order the picker. Every theme is always selectable — a grade 11
 * student who wants Dinosaurs gets Dinosaurs — so this can never return
 * anything a caller might mistake for permission.
 */
function bandRange(bands: string): [number, number] {
  const [lo, hi] = bands.split('–')
  return [lo.trim() === 'K' ? 0 : Number(lo), Number(hi)]
}

/**
 * The ten themes, nearest-fit first for this learner's grade.
 *
 * Advisory ordering and nothing else. A theme whose band does not cover the
 * grade sorts later; it is never hidden, disabled, or marked as unavailable.
 * With no grade to go on the declared order is kept.
 */
export function themesForGrade(grade: number | null | undefined): Theme[] {
  if (grade == null) return THEMES
  return [...THEMES]
    .map((theme, i) => {
      const [lo, hi] = bandRange(theme.bands)
      // Distance outside the band, zero when the grade falls inside it.
      const distance = grade < lo ? lo - grade : grade > hi ? grade - hi : 0
      return { theme, distance, i }
    })
    .sort((a, b) => a.distance - b.distance || a.i - b.i)
    .map((x) => x.theme)
}

/** What a theme calls the way it hands out rewards. */
export const SHAPE_LABEL: Record<RewardShape, string> = {
  collection: 'Collection',
  journey: 'Journey',
  assembly: 'Assembly',
}

/**
 * The heading over the progress card, which reads differently depending on
 * what the theme's collectibles actually are: a journey has no "next one",
 * it has a distance already covered.
 */
export function progressTitle(theme: Theme): string {
  return theme.shape === 'journey' ? 'How far you have come' : `Next ${theme.unitOne}`
}

/**
 * The line under the progress bar. Names the theme's own noun, and says the
 * same true thing in all ten: practice keeps a streak alive but does not earn
 * a collectible.
 */
export function progressLine(theme: Theme): string {
  return `Clear a graded round above its predicted score and the next ${theme.unitOne} is yours. Practice rounds keep your streak but do not earn one.`
}

/** The sub-line under an assembly stage: what is still missing, in its nouns. */
export function assemblyLine(theme: Theme, owned: number): string {
  const left = Math.max(0, theme.total - owned)
  if (left === 0) return `Every part fitted. ${theme.assemblyOf ?? theme.name} is complete.`
  return `${left} more ${left === 1 ? theme.unitOne : theme.unit} and ${
    theme.assemblyOf ?? theme.name
  } is finished.`
}

/** Where a journey theme has got to, and what the next stop costs. */
export function journeyLines(
  theme: Theme,
  owned: number,
): { now: string; next: string } {
  const stops = slotLabels(theme)
  const at = Math.min(owned, stops.length - 1)
  if (at >= stops.length - 1) {
    return {
      now: `${stops[at]} — the end of the line.`,
      next: `Every stop on this one was earned on graded work.`,
    }
  }
  return {
    now: `${stops[at]}, ${owned} of ${theme.total} ${theme.unit}.`,
    next: `Next up is ${stops[at + 1]}. Clear a graded round above its predicted score to get there.`,
  }
}

/**
 * What this world calls the rung at `levelIndex` (0 = grade 2).
 *
 * Falls back to a plain grade label rather than a wrong name if a theme is
 * ever short an entry — a nameless rung is better than one borrowed from
 * another world.
 */
export function levelNameFor(
  theme: Theme,
  levelIndex: number,
  grade: number,
): { name: string; emoji: string } {
  return theme.levels[levelIndex] ?? { name: `Grade ${grade}`, emoji: '' }
}

/**
 * What this world calls typing world `index` (0 = home row).
 *
 * Same rule as the spelling rungs: the theme names it, the curriculum says
 * what it teaches.
 */
export function typingWorldFor(theme: Theme, index: number): { name: string; emoji: string } {
  return theme.worlds[index] ?? { name: `World ${index + 1}`, emoji: '' }
}
