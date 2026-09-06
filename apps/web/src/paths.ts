// The URL for every screen, and the way back.
//
// `routes.ts` describes screens as a discriminated union; this describes the
// same screens as paths. Keeping the two in one place each is what lets the
// address bar and the back button stay honest without every screen knowing
// anything about URLs — they still call `navigate({ name: … })`.
//
// Path parameters carry what identifies the screen (which lesson, which deck);
// query parameters carry what only tunes it (round size, direction), so a
// shared link without them still lands somewhere sensible.

import type { AudienceId, Route } from './routes'
import { MODES, type DirectionSetting, type StudyMode } from './lib/quiz/session'
import { ACTIVITIES, type ActivityId } from './lib/spelling/activities'
import type { SessionMode } from './lib/spelling/session'

const SPELL_MODES: SessionMode[] = ['adaptive', 'list', 'custom', 'placement']
const DIRECTIONS: DirectionSetting[] = ['term-first', 'definition-first', 'mixed']
const AUDIENCES: AudienceId[] = ['parents', 'teachers', 'tutors', 'homeschool']

/** Where a route lives. The inverse of the `<Route path>` list in App. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    // The marketing site and the child's home share one address: which of them
    // a visitor sees depends on whether they are signed in, and a signed-in
    // grown-up landing on "/" is home, not a sales pitch.
    case 'marketing':
    case 'home':
      return '/'

    // The rest of the marketing site. These are the only screens in the app
    // whose addresses are also *published* ones — linked from an email, shared
    // between two parents, indexed — so they read as words rather than as ids.
    case 'features':
      return '/features'
    case 'how':
      return '/how-it-works'
    case 'pricing':
      return '/pricing'
    case 'audience':
      return `/for/${route.who}`
    case 'privacy':
      return '/privacy'
    case 'faq':
      return '/faq'

    case 'auth':
      return '/signin'
    case 'progress-print':
      return '/progress/print'
    case 'account':
      return '/account'
    case 'family':
      return '/family'
    case 'upgrade':
      return '/upgrade'
    case 'progress':
      return '/progress'
    case 'custom-lists':
      return '/custom-lists'
    case 'tasks':
      return '/tasks'
    case 'library':
      return '/library'
    case 'content-new':
      return '/library/add'
    case 'theme':
      return '/theme'
    case 'world':
      return '/world'
    case 'settings':
      return '/settings'

    // Typing
    case 'typing':
      return '/typing'
    case 'map':
      return '/typing/map'
    case 'lesson':
      return `/typing/lesson/${encodeURIComponent(route.id)}`
    case 'practice':
      return '/typing/practice'
    case 'rain':
      return '/typing/rain'
    case 'trophies':
      return '/typing/trophies'

    // Spelling
    case 'spelling':
      return '/spelling'
    case 'spell-lists':
      return '/spelling/lists'
    case 'spell-play':
      return withQuery(`/spelling/play/${route.activity}/${route.mode}`, {
        list: route.listId,
        custom: route.customListId,
        size: route.size,
      })

    // Quiz
    case 'quiz':
      return '/quiz'
    case 'quiz-deck':
      return `/quiz/deck/${encodeURIComponent(route.deckId)}`
    case 'quiz-edit':
      return route.deckId ? `/quiz/edit/${encodeURIComponent(route.deckId)}` : '/quiz/new'
    case 'quiz-play':
      return withQuery(`/quiz/play/${route.mode}`, {
        deck: route.deckId,
        size: route.size,
        direction: route.direction,
      })
  }
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

// A pasted or hand-edited URL can say anything, so every parameter that came
// out of the address bar is checked against the real list before a screen sees
// it. Null means "no such screen" and the caller redirects rather than
// rendering a round with a mode nobody defined.

export function parseAudience(value: string | undefined): AudienceId | null {
  return AUDIENCES.find((a) => a === value) ?? null
}

export function parseActivity(value: string | undefined): ActivityId | null {
  return ACTIVITIES.find((a) => a.id === value)?.id ?? null
}

export function parseSpellMode(value: string | undefined): SessionMode | null {
  return SPELL_MODES.find((m) => m === value) ?? null
}

export function parseStudyMode(value: string | undefined): StudyMode | null {
  return MODES.find((m) => m.id === value)?.id ?? null
}

export function parseDirection(value: string | null): DirectionSetting | undefined {
  return DIRECTIONS.find((d) => d === value) ?? undefined
}

/** Round sizes come from links, so a nonsense one is dropped, not clamped. */
export function parseSize(value: string | null): number | undefined {
  if (value === null) return undefined
  const size = Number(value)
  return Number.isInteger(size) && size > 0 && size <= 500 ? size : undefined
}
