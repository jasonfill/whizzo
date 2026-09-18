// What the typing screens read.
//
// Nothing in here is stored on the device any more. Lesson progress comes from
// the account (lib/typing/progress.ts), high scores and badges from the
// progress snapshot, and the switches from the learner (lib/learners/
// useLearnerSettings.ts). The old `keyboard-cats:v1` save is simply ignored.

import type { LearnerSettings } from '@whizzo/shared'
import type { LessonProgress } from './typing/progress'

export type { LessonProgress } from './typing/progress'

/** One arcade or practice score, as the trophy room shows it. */
export interface HighScore {
  score: number
  wpm: number
  accuracy: number
  mode: string
  date: number
}

/**
 * Everything the typing screens read. Every field is derived on render from
 * the account's snapshot and the learner's settings; nothing is written back
 * to this device.
 */
export interface GameState {
  highScores: HighScore[]
  achievements: string[] // unlocked badge ids
  settings: Required<LearnerSettings>
  lessons: Record<string, LessonProgress>
  totalStars: number
}
