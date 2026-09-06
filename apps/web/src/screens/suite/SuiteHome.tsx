import { useAuth } from '../../auth/AuthProvider'
import Mascot, { MASCOT_MUTED } from '../../components/Mascot'
import Wordmark from '../../components/Wordmark'
import AccountChip from '../../components/suite/AccountChip'
import LearnerChip from '../../components/suite/LearnerChip'
import { Button, Card, Pill } from '../../components/ui'
import { TOTAL_LESSONS } from '../../data/lessons'
import { useAssignments } from '../../hooks/useAssignments'
import type { GameApi } from '../../hooks/useGameState'
import { routeForAssignment } from '../../lib/assignments/routing'
import { useLearners } from '../../lib/learners/LearnerProvider'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { bestStreak, unaidedAccuracy } from '../../lib/progress/summary'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { earnedFor } from '../../lib/theme/rewards'
import { progressLine, progressTitle } from '../../lib/themes'
import { dueWords, levelSnapshot, totalCurriculumWords } from '../../lib/spelling/stats'
import { breakdown } from '../../lib/spelling/stats'
import { ALL_WORDS } from '../../data/spelling'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { allDecks, deckStats } from '../../lib/quiz/decks'
import { todayString } from '../../lib/progress/types'
import type { Navigate } from '../../routes'

export default function SuiteHome({ game, navigate }: { game: GameApi; navigate: Navigate }) {
  const { profile } = useAuth()
  const { snapshot, skill, sync } = useProgress()

  const spelling = skill('spelling')
  const level = levelSnapshot(snapshot, spelling.levelIndex)
  const overall = breakdown(snapshot, ALL_WORDS)
  const due = dueWords(snapshot).length

  const typingLessons = Object.values(game.state.lessons).filter((l) => l.plays > 0).length

  const today = todayString()
  const quizTotals = allDecks(snapshot, STARTER_DECKS).reduce(
    (acc, deck) => {
      const s = deckStats(snapshot, deck, today)
      return { cards: acc.cards + s.total, mastered: acc.mastered + s.mastered, due: acc.due + s.due }
    },
    { cards: 0, mastered: 0, due: 0 },
  )
  const greeting = profile?.displayName || game.state.playerName
  const { open: openTasks } = useAssignments()
  const { learners, active } = useLearners()
  const overdueTasks = openTasks.filter((t) => t.dueOn !== null && t.dueOn < today).length

  const { theme } = useTheme()
  const earned = earnedFor(snapshot, theme)
  const unaided = unaidedAccuracy(snapshot)
  const streak = bestStreak(snapshot)

  // Layout only. The two views show the same data from the same sources; the
  // older one just does not want a mascot the size of its head.
  const grade = active?.gradeHint ?? profile?.gradeHint ?? level.grade
  const older = grade >= 6

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Wordmark />
        <div className="flex items-center gap-2">
          <LearnerChip onManage={() => navigate({ name: 'family' })} />
          <AccountChip onOpen={() => navigate({ name: 'account' })} />
        </div>
      </div>

      {older ? (
        <div className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
                {theme.name}
                {streak > 0 && ` · Day ${streak}`}
              </div>
              <h1 className="font-display text-4xl font-extrabold tracking-[-0.02em] text-ink">
                {greeting ? `Welcome back, ${greeting}.` : 'Whizzo'}
              </h1>
            </div>
            <Button variant="play" onClick={() => navigate({ name: 'spelling' })}>
              {theme.verb} →
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatChip label="Streak" value={streak > 0 ? `${streak} days` : '—'} />
            <StatChip label="Unaided accuracy" value={unaided === null ? '—' : `${unaided}%`} />
            <StatChip label="Level" value={`Grade ${level.grade}`} />
            <StatChip
              label={theme.unit}
              value={`${earned.owned}/${earned.total}`}
              tint={theme.tintA}
            />
          </div>
        </div>
      ) : (
        <div
          className="mb-6 grid grid-cols-1 items-center gap-4 rounded-[26px] p-7 md:grid-cols-[1fr_300px]"
          style={{ background: theme.tintA }}
        >
          <div>
            <div
              className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: theme.deep }}
            >
              {theme.name}
              {streak > 0 && ` · Day ${streak}`}
            </div>
            <h1 className="mt-1 font-display text-[38px] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink md:text-[46px]">
              {greeting ? `Hi, ${greeting}!` : 'Ready when you are.'}
            </h1>
            <p className="mt-2 max-w-md text-[17px] leading-relaxed text-body">
              {due > 0
                ? `${due} words are ready for another look.`
                : 'Pick something below and get going.'}
            </p>
            <Button
              variant="play"
              className="mt-5 text-[19px]"
              onClick={() => navigate({ name: 'spelling' })}
            >
              {theme.verb} →
            </Button>
          </div>
          {/* The secondary companion stays: it is the subject you are not
              currently in, standing a step behind. */}
          <div className="flex items-end justify-center">
            <Mascot mood="cheer" size={200} className="animate-floaty" />
            <Mascot mood="idle" color={MASCOT_MUTED} size={96} className="animate-floaty" />
          </div>
        </div>
      )}

      {sync === 'merging' && (
        <Pill className="mb-4 bg-sun/30 text-ink">
          🔄 Moving your saved progress into your account…
        </Pill>
      )}

      {/* Work someone has set comes before the free choice of subjects: if a
          child has homework, that is the thing to show them first. */}
      {openTasks.length > 0 && (
        <Card className="mb-6 ring-2 ring-edge">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-extrabold text-ink">
              ✅ Your tasks ({openTasks.length})
            </h2>
            {overdueTasks > 0 && (
              <Pill className="bg-rose-100 text-rose-700">{overdueTasks} overdue</Pill>
            )}
          </div>
          <ul className="mb-3 space-y-2">
            {openTasks.slice(0, 3).map((task) => {
              const route = routeForAssignment(task)
              return (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-hair"
                >
                  <span className="font-extrabold text-ink">{task.title}</span>
                  {task.dueOn && task.dueOn < today && (
                    <Pill className="bg-rose-100 text-xs text-rose-700">overdue</Pill>
                  )}
                  {route && (
                    <Button className="ml-auto" onClick={() => navigate(route)}>
                      ▶️ Start
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <Button variant="ghost" onClick={() => navigate({ name: 'tasks' })}>
            See all tasks →
          </Button>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SubjectCard
          emoji="🔤"
          title="Spelling"
          tagline="Adaptive spelling, second grade and up."
          stats={[
            { label: 'Level', value: `Grade ${level.grade}` },
            { label: 'Words mastered', value: `${overall.mastered}/${totalCurriculumWords()}` },
            ...(due > 0 ? [{ label: 'Due for review', value: String(due) }] : []),
          ]}
          cta={spelling.placed ? 'Keep practising' : 'Find my level'}
          onClick={() => navigate({ name: 'spelling' })}
        />
        <SubjectCard
          emoji="⌨️"
          title="Typing"
          tagline="Touch typing, one world at a time."
          stats={[
            { label: 'Lessons done', value: `${typingLessons}/${TOTAL_LESSONS}` },
            { label: 'Stars', value: String(game.state.totalStars) },
            { label: theme.unit, value: String(game.state.collectedCats.length) },
          ]}
          cta="Keep typing"
          onClick={() => navigate({ name: 'typing' })}
        />
        <SubjectCard
          emoji="🃏"
          title="Quiz"
          tagline="Flashcards for anything at all."
          stats={[
            { label: 'My decks', value: String(snapshot.decks.length) },
            { label: 'Cards mastered', value: `${quizTotals.mastered}/${quizTotals.cards}` },
            ...(quizTotals.due > 0 ? [{ label: 'Due for review', value: String(quizTotals.due) }] : []),
          ]}
          cta={snapshot.decks.length ? 'Keep studying' : 'Make a deck'}
          onClick={() => navigate({ name: 'quiz' })}
        />
      </div>


      {/* Shared by both views: what you have collected, and the door to it. */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-[22px] border border-hair bg-chalk p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
            {progressTitle(theme)}
          </div>
          <div className="mt-2 h-[14px] w-full overflow-hidden rounded-full bg-tray">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(earned.fraction * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[15px] font-extrabold text-ink">
            {earned.owned} of {earned.total} {theme.unit}
          </div>
          <p className="mt-1 text-[13px] text-muted">{progressLine(theme)}</p>
        </div>

        <button
          onClick={() => navigate({ name: 'world' })}
          className="rounded-[22px] p-5 text-left transition-transform hover:-translate-y-px"
          style={{ background: theme.tintA }}
        >
          <div
            className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: theme.deep }}
          >
            {theme.worldNoun}
          </div>
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 flex-1 rounded-xl"
                style={
                  i < 3
                    ? {
                        background: `repeating-linear-gradient(135deg, ${theme.tintB} 0 9px, ${theme.tintA} 9px 18px)`,
                      }
                    : { border: '2px dashed #FFFFFF' }
                }
              />
            ))}
          </div>
          <div className="mt-3 text-[15px] font-extrabold" style={{ color: theme.deep }}>
            See {theme.worldNoun.toLowerCase()} →
          </div>
        </button>
      </div>

      {/* The two a grown-up needs from the child's home screen: the work set
          for them, and the people. Your own things — the library, your tutor
          code — live in your account instead. */}
      {learners.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => navigate({ name: 'tasks' })}>
            ✅ Tasks{openTasks.length > 0 ? ` (${openTasks.length})` : ''}
          </Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'family' })}>
            👨‍👩‍👧 Family
          </Button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Button variant="ghost" onClick={() => navigate({ name: 'progress' })}>
          📊 Progress
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'trophies' })}>
          🏆 Trophies
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'custom-lists' })}>
          ✏️ My lists
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'quiz' })}>
          🃏 My decks
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'settings' })}>
          ⚙️ Settings
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'theme' })}>
          🎨 {theme.name}
        </Button>
      </div>


      <p className="mt-6 text-center text-xs font-bold text-stone">
        Free forever, no ads.{' '}
        <button className="underline hover:text-ink" onClick={() => navigate({ name: 'upgrade' })}>
          Covering a child
        </button>{' '}
        adds their full history, the reports, and rewards.
      </p>
    </div>
  )
}

function StatChip({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div
      className="rounded-2xl border border-hair p-3"
      style={{ background: tint ?? '#FFF7ED' }}
    >
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        {label}
      </div>
      <div className="font-display text-xl font-extrabold text-ink">{value}</div>
    </div>
  )
}

interface SubjectCardProps {
  emoji: string
  title: string
  tagline: string
  stats: Array<{ label: string; value: string }>
  cta: string
  onClick: () => void
}

// A neutral card with a hair border. The per-subject gradients this replaces
// were the cat era's paint, and they fought nine of the ten themes; the only
// colour left here is the accent on the CTA.
function SubjectCard({ emoji, title, tagline, stats, cta, onClick }: SubjectCardProps) {
  return (
    <button
      onClick={onClick}
      className="rounded-3xl border border-hair bg-chalk p-1 text-left transition-transform hover:-translate-y-px"
    >
      <div className="flex h-full flex-col rounded-[22px] p-5">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-4xl">{emoji}</span>
          <div>
            <h2 className="text-2xl font-extrabold text-ink">{title}</h2>
            <p className="font-bold text-muted">{tagline}</p>
          </div>
        </div>
        <div className="my-3 flex flex-wrap gap-x-5 gap-y-2">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-lg font-extrabold text-ink">{s.value}</div>
              <div className="text-xs font-bold uppercase tracking-wide text-stone">
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <span className="mt-auto inline-block font-extrabold text-accent">{cta} →</span>
      </div>
    </button>
  )
}
