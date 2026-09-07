import type { DirectionSetting, StudyMode } from './lib/quiz/session'
import type { ActivityId } from './lib/spelling/activities'
import type { SessionMode } from './lib/spelling/session'

/**
 * Who a marketing page is addressed to.
 *
 * Four audiences rather than one, because the same product is bought for
 * different reasons: a parent wants to know where their child actually is, a
 * teacher wants twenty-five children set the same work, a tutor wants to show
 * the parent paying them what happened. The *capability* is identical — there
 * is deliberately no tutor mode — so what differs between these pages is the
 * question they answer first, not the feature list underneath.
 */
export type AudienceId = 'parents' | 'teachers' | 'tutors' | 'homeschool'

/**
 * Every screen in the suite.
 *
 * Screens name where they are going rather than writing a URL: this union is
 * what `navigate` takes, and `paths.ts` turns each one into the address React
 * Router puts in the bar. Keeping the two apart means a call site cannot
 * misspell a path, and a path can be renamed without touching a screen.
 */
export type Route =
  // Signed out: the marketing site, and the door.
  /** The front page — what this is, who it is for, what it costs. */
  | { name: 'marketing' }
  /** Everything in the product, in one place. */
  | { name: 'features' }
  /** The engine, spelled out: ability, evidence, spacing, the ladder. */
  | { name: 'how' }
  /** What coverage costs and what it buys. */
  | { name: 'pricing' }
  /** The same product, addressed to one kind of grown-up. */
  | { name: 'audience'; who: AudienceId }
  /** What is stored, what is not, and how a child signs in. */
  | { name: 'privacy' }
  | { name: 'faq' }
  | { name: 'auth' }
  // Suite
  | { name: 'home' }
  | { name: 'account' }
  /** An assistant asking to connect: the consent screen (docs/mcp-tutor-spec.md). */
  | { name: 'connect'; req?: string }
  | { name: 'family' }
  | { name: 'upgrade' }
  | { name: 'progress' }
  /** The weekly sheet, laid out for paper rather than for a screen. */
  | { name: 'progress-print' }
  | { name: 'custom-lists' }
  /** The learner's task list — what a grown-up has set them. */
  | { name: 'tasks' }
  /** A grown-up's own decks and lists, and the work they have set. */
  | { name: 'library' }
  /** Hand over a document; get practice material back. */
  | { name: 'content-new' }
  // The planner: the learner's week, and the two guided flows around it.
  /** The week grid, or Today. No weekStart means this week. */
  | { name: 'planner'; weekStart?: string; view?: 'today' | 'week' }
  | { name: 'planner-plan' }
  | { name: 'planner-wrap' }
  | { name: 'planner-courses' }
  /** The week for paper. */
  | { name: 'planner-print'; weekStart?: string }
  /** "Pick your world" — the ten themes. Display only; changes nothing learned. */
  | { name: 'theme' }
  /** The collectibles earned so far, in whichever shape the theme uses. */
  | { name: 'world' }
  // Typing
  | { name: 'typing' }
  | { name: 'map' }
  | { name: 'lesson'; id: string }
  | { name: 'practice' }
  | { name: 'rain' }
  | { name: 'trophies' }
  | { name: 'settings' }
  // Spelling
  | { name: 'spelling' }
  | { name: 'spell-lists' }
  | {
      name: 'spell-play'
      activity: ActivityId
      mode: SessionMode
      listId?: string
      customListId?: string
      size?: number
    }
  // Quiz
  | { name: 'quiz' }
  | { name: 'quiz-deck'; deckId: string }
  /** No deckId means "start a new deck". */
  | { name: 'quiz-edit'; deckId?: string }
  | {
      name: 'quiz-play'
      mode: StudyMode
      /** Absent in review mode, which draws from every deck at once. */
      deckId?: string
      size?: number
      direction?: DirectionSetting
    }

export type Navigate = (route: Route) => void
