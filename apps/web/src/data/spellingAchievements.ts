import { MASTERED_THRESHOLD } from '../lib/adaptive'
import type { ProgressSnapshot, SkillState } from '../lib/progress/types'

export interface SpellingAchievement {
  id: string
  name: string
  emoji: string
  description: string
  test: (snapshot: ProgressSnapshot, skill: SkillState) => boolean
}

function masteredWords(snapshot: ProgressSnapshot): number {
  return Object.values(snapshot.mastery).filter(
    (m) => m.subject === 'spelling' && m.mastery >= MASTERED_THRESHOLD,
  ).length
}

function perfectTests(snapshot: ProgressSnapshot): number {
  return snapshot.sessions.filter(
    (s) => s.subject === 'spelling' && s.isTest && s.itemsTotal > 0 && s.accuracy >= 100,
  ).length
}

export const SPELLING_ACHIEVEMENTS: SpellingAchievement[] = [
  {
    id: 'spell-first',
    name: 'First Word',
    emoji: '🐾',
    description: 'Spell your very first word correctly.',
    test: (s) => Object.values(s.mastery).some((m) => m.subject === 'spelling' && m.totalCorrect > 0),
  },
  {
    id: 'spell-ten-mastered',
    name: 'Word Collector',
    emoji: '📚',
    description: 'Master 10 words.',
    test: (s) => masteredWords(s) >= 10,
  },
  {
    id: 'spell-fifty-mastered',
    name: 'Spelling Scholar',
    emoji: '🎓',
    description: 'Master 50 words.',
    test: (s) => masteredWords(s) >= 50,
  },
  {
    id: 'spell-hundred-mastered',
    name: 'Century Cat',
    emoji: '💯',
    description: 'Master 100 words.',
    test: (s) => masteredWords(s) >= 100,
  },
  {
    id: 'spell-perfect-test',
    name: 'Flawless',
    emoji: '✨',
    description: 'Get every word right on a spelling test.',
    test: (s) => perfectTests(s) >= 1,
  },
  {
    id: 'spell-five-perfect',
    name: 'Bee Ready',
    emoji: '🐝',
    description: 'Ace five spelling tests.',
    test: (s) => perfectTests(s) >= 5,
  },
  {
    id: 'spell-level-up',
    name: 'Level Up',
    emoji: '📈',
    description: 'Move up a grade level.',
    test: (_s, skill) => skill.levelIndex >= 1,
  },
  {
    id: 'spell-middle-school',
    name: 'Middle School Material',
    emoji: '🏔️',
    description: 'Reach the sixth grade level.',
    test: (_s, skill) => skill.levelIndex >= 4,
  },
  {
    id: 'spell-summit',
    name: 'Summit Cat',
    emoji: '🐯',
    description: 'Reach the eighth grade level.',
    test: (_s, skill) => skill.levelIndex >= 6,
  },
  {
    id: 'spell-streak-3',
    name: 'Three in a Row',
    emoji: '🔥',
    description: 'Practice three days in a row.',
    test: (_s, skill) => skill.streakDays >= 3,
  },
  {
    id: 'spell-streak-7',
    name: 'Week Warrior',
    emoji: '🗓️',
    description: 'Practice seven days in a row.',
    test: (_s, skill) => skill.streakDays >= 7,
  },
  {
    id: 'spell-comeback',
    name: 'Comeback Kitty',
    emoji: '💪',
    description: 'Master a word you had missed twice before.',
    test: (s) =>
      Object.values(s.mastery).some(
        (m) => m.subject === 'spelling' && m.lapses >= 2 && m.mastery >= MASTERED_THRESHOLD,
      ),
  },
]

export function newlyUnlocked(
  snapshot: ProgressSnapshot,
  skill: SkillState,
  alreadyUnlocked: Set<string>,
): SpellingAchievement[] {
  return SPELLING_ACHIEVEMENTS.filter(
    (a) => !alreadyUnlocked.has(a.id) && a.test(snapshot, skill),
  )
}
