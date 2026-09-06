import { useMemo, useState } from 'react'
import ChildSwitcher from '../../components/suite/ChildSwitcher'
import ThemeChoice from '../../components/suite/ThemeChoice'
import MasteryBar from '../../components/suite/MasteryBar'
import ScreenHeader from '../../components/suite/ScreenHeader'
import SessionDetail from '../../components/suite/SessionDetail'
import { Button, Card, Pill } from '../../components/ui'
import { ALL_WORDS, GRADES } from '../../data/spelling'
import type { GameApi } from '../../hooks/useGameState'
import { useCoverage } from '../../lib/billing/coverage'
import { STARTER_DECKS } from '../../data/quiz/starterDecks'
import { allDecks, deckStats } from '../../lib/quiz/decks'
import { MODES } from '../../lib/quiz/session'
import { ACTIVITIES } from '../../lib/spelling/activities'
import { useProgress } from '../../lib/progress/ProgressProvider'
import { addDays, todayString } from '../../lib/progress/types'
import { breakdown, gradeBreakdown, troubleWords, turnaroundWords } from '../../lib/spelling/stats'
import { errorPattern } from '../../lib/spelling/activities'
import { trackReadings, unaidedAccuracy } from '../../lib/progress/summary'
import { forecast, retentionReading } from '@whizzo/shared'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useAssignments } from '../../hooks/useAssignments'
import { useLearners } from '../../lib/learners/LearnerProvider'
import type { Navigate } from '../../routes'

export default function ProgressScreen({ game, navigate }: { game: GameApi; navigate: Navigate }) {
    const { snapshot, skill } = useProgress()
  const coverage = useCoverage()

  const [openSession, setOpenSession] = useState<string | null>(null)

  const spelling = skill('spelling')
  const typing = skill('typing')
  const quiz = skill('quiz')
  const overall = breakdown(snapshot, ALL_WORDS)
  const trouble = troubleWords(snapshot, 15)
  // Read from the same mastery records everything else here uses; nothing in
  // the retention view feeds back into scheduling.
  const retention = useMemo(
    () => retentionReading(Object.values(snapshot.mastery), todayString()),
    [snapshot.mastery],
  )
  const week = useMemo(
    () => forecast(Object.values(snapshot.mastery), todayString()),
    [snapshot.mastery],
  )
  const turnaround = turnaroundWords(snapshot, 8)

  // The history window is the one place an uncovered learner is limited.
  const horizon = Number.isFinite(coverage.historyDays)
    ? addDays(todayString(), -coverage.historyDays)
    : '0000-00-00'
  const visibleSessions = snapshot.sessions.filter(
    (s) => new Date(s.endedAt).toISOString().slice(0, 10) >= horizon,
  )
  const hiddenSessions = snapshot.sessions.length - visibleSessions.length

  const quizTotals = useMemo(() => {
    const today = todayString()
    return allDecks(snapshot, STARTER_DECKS).reduce(
      (acc, deck) => {
        const s = deckStats(snapshot, deck, today)
        return {
          cards: acc.cards + s.total,
          mastered: acc.mastered + s.mastered,
          due: acc.due + s.due,
          started: acc.started + (s.seen > 0 ? 1 : 0),
        }
      },
      { cards: 0, mastered: 0, due: 0, started: 0 },
    )
  }, [snapshot])

  const totalMinutes = Math.round(
    snapshot.daily.reduce((n, d) => n + d.seconds, 0) / 60,
  )
  const typingLessons = Object.values(game.state.lessons).filter((l) => l.plays > 0).length
  const bestWpm = Math.max(0, ...Object.values(game.state.lessons).map((l) => l.bestWpm))

  const { active } = useLearners()
  const { theme } = useTheme()
  const { open: openTasks, done: doneTasks } = useAssignments()
  const unaided = unaidedAccuracy(snapshot)

  const byTrack = useMemo(() => {
    const decks = new Map(allDecks(snapshot, STARTER_DECKS).map((d) => [d.id, d.track ?? null]))
    return trackReadings(snapshot, (deckId) => decks.get(deckId))
  }, [snapshot])
  const last21 = useMemo(() => buildActivityChart(snapshot.daily), [snapshot.daily])
  const insight = useMemo(() => activityInsight(last21), [last21])

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ScreenHeader
        title={active ? `${active.displayName}’s progress` : 'Progress'}
        subtitle="Everything here comes from words they actually attempted."
        onBack={() => navigate({ name: 'home' })}
      />

      <ChildSwitcher />

      {/* Offered whether or not it is covered: a locked door you can see is a
          better advertisement than a feature nobody knows exists, and the
          sheet's own screen explains what it would be. */}
      <div className="mb-4">
        <Button variant="ghost" onClick={() => navigate({ name: 'progress-print' })}>
          🖨️ Weekly sheet to print
        </Button>
      </div>

      {/* Four numbers. The last inverts because the reading level is the one a
          parent came for; the other three are context around it. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Day streak"
          value={`${Math.max(spelling.streakDays, typing.streakDays, quiz.streakDays)}`}
          note="Days in a row with practice"
        />
        <StatCard
          label="Words mastered"
          value={`${overall.mastered}`}
          note={`of ${overall.total} in the curriculum`}
        />
        <StatCard
          label="Unaided accuracy"
          value={unaided === null ? '—' : `${unaided}%`}
          note={unaided === null ? 'No graded rounds yet' : 'Graded rounds only'}
        />
        <StatCard
          label="Reading level"
          value={`Grade ${GRADES[spelling.levelIndex]?.grade ?? 2}`}
          note={`${totalMinutes}m practised in total`}
          invert
        />
      </div>

      {/* By subject, when there is more than one to tell apart.
          A single "study decks" number averages Spanish, biology and state
          capitals — three unrelated things — and tells a parent nothing they
          can act on. Split, it says where to help. Hidden entirely for a
          learner with one pool, because a list of one is not a comparison. */}
      {byTrack.length > 1 && (
        <Card className="mb-4">
          <h2 className="mb-1 font-display text-xl font-extrabold text-ink">By subject</h2>
          <p className="mb-3 text-sm font-bold text-stone">
            Each subject is scored on its own, so a strong one never hides a weak one.
          </p>
          <div className="flex flex-col gap-2">
            {byTrack.map((t) => (
              <div
                key={t.trackId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-quiet px-4 py-3"
              >
                <div>
                  <p className="font-extrabold text-ink">{t.name}</p>
                  <p className="text-xs font-bold text-stone">{t.areaName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill className="bg-white text-body">
                    {t.mastered} of {t.items} mastered
                  </Pill>
                  {/* Nothing rather than 0% when no answer has been checked:
                      "not measured yet" and "measured badly" are different. */}
                  {t.accuracy !== null && (
                    <Pill className="bg-white text-body">{t.accuracy}% checked</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Three weeks. A day with nothing on it is floored rather than dropped:
          absence is the thing a parent most needs to be able to see. */}
      <Card className="mb-4">
        <h2 className="mb-3 font-display text-xl font-extrabold text-ink">The last three weeks</h2>
        <div className="flex h-24 items-end gap-1.5">
          {last21.map((d) => (
            <div
              key={d.day}
              className="flex-1"
              title={`${d.day}: ${d.items} ${d.items === 1 ? 'item' : 'items'}`}
            >
              <div
                className="w-full rounded-t-md rounded-b-[3px] bg-pine"
                style={{ height: Math.max(4, Math.round(d.items === 0 ? 0 : (d.items / Math.max(1, ...last21.map((x) => x.items))) * 96)) }}
                aria-label={`${d.items} items on ${d.day}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          <span>{last21[0]?.day}</span>
          <span>Today</span>
        </div>
        {/* Prose, not another stat. A parent reading a chart wants to be told
            what it says. */}
        <p className="mt-3 rounded-xl bg-spark/10 px-4 py-3 text-[14px] leading-relaxed text-[#7C4A22]">
          {insight}
        </p>
      </Card>

      {/* Spelling */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-ink">Spelling 🔤</h2>
          <div className="flex flex-wrap gap-2">
            <Pill className="bg-wash text-ink">
              Grade {GRADES[spelling.levelIndex]?.grade ?? 2}
            </Pill>
            <Pill className="bg-wash text-muted">
              Ability {spelling.ability.toFixed(2)}
            </Pill>
            <Pill className="bg-wash text-muted">
              {spelling.totalCorrect}/{spelling.totalAttempts} graded correct
            </Pill>
          </div>
        </div>

        <MasteryBar
          total={overall.total}
          mastered={overall.mastered}
          practiced={overall.practiced}
          learning={overall.learning}
        />

        <div className="mt-4 space-y-2">
          {GRADES.map((g) => {
            const b = gradeBreakdown(snapshot, g.grade)
            const pct = b.total ? (b.mastered / b.total) * 100 : 0
            return (
              <div key={g.grade} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-extrabold text-muted">
                  Grade {g.grade}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-tray">
                  <div className="h-full bg-pine" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-bold text-stone">
                  {b.mastered}/{b.total}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Retention: the one report here about the future rather than the past.
          Every other card answers "how did they do?"; a parent's actual
          question is whether it will still be there next week, and the
          spaced-repetition record has always known. */}
      {coverage.can('retentionReport') && retention.tracked > 0 && (
        <Card className="mb-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-extrabold text-ink">Will it stick?</h2>
            {retention.health !== null && (
              <Pill className="bg-wash text-body">{retention.health}% holding</Pill>
            )}
          </div>
          <p className="mb-3 text-[14px] font-bold text-muted">
            Out of {retention.tracked} {retention.tracked === 1 ? 'thing' : 'things'} they have
            actually been tested on. Never seen yet does not count against them.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RetentionStat label="Secure" value={retention.counts.secure} hint="Known for weeks" />
            <RetentionStat label="Holding" value={retention.counts.holding} hint="On schedule" />
            <RetentionStat label="Due" value={retention.counts.due} hint="Ready for another look" />
            <RetentionStat
              label="Slipping"
              value={retention.counts.slipping + retention.counts.fragile}
              hint="Going, or keeps going"
            />
          </div>

          {/* The week ahead. "Eleven due this week" and "eleven due on
              Thursday" call for different evenings. */}
          <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
            The next seven days
          </div>
          <div className="flex h-16 items-end gap-1.5">
            {week.map((d) => {
              const tallest = Math.max(1, ...week.map((x) => x.count))
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    title={`${d.count} due on ${d.day}`}
                    style={{ height: `${Math.max(4, (d.count / tallest) * 100)}%` }}
                    className={`w-full rounded-t ${d.count > 0 ? 'bg-ink' : 'bg-hair'}`}
                  />
                  <span className="font-mono text-[9px] font-bold text-faint">
                    {d.day.slice(8)}
                  </span>
                </div>
              )
            })}
          </div>

          {retention.attention.length > 0 && (
            <p className="mt-3 rounded-xl bg-spark/10 px-4 py-3 text-[14px] font-bold text-[#7C4A22]">
              {retention.attention.length}{' '}
              {retention.attention.length === 1 ? 'thing is' : 'things are'} slipping or keep
              slipping. They are at the top of the list below.
            </p>
          )}
        </Card>
      )}

      {/* The one section a parent can act on directly, which is why it is
          named for the action rather than the data. */}
      <Card className="mb-4">
        <h2 className="mb-1 font-display text-xl font-extrabold text-ink">
          Worth 10 minutes together
        </h2>
        <p className="mb-3 text-[14px] font-bold text-muted">
          Ranked by how often they have actually been missed.
        </p>
        {trouble.length === 0 ? (
          <p className="font-bold text-stone">
            Nothing here yet — spell a few rounds and the tricky words will show up.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead>
                <tr className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  <th className="py-1">Word</th>
                  <th className="py-1">Unaided</th>
                  <th className="py-1">Slipped</th>
                  <th className="py-1">What trips it</th>
                  <th className="py-1">Back on</th>
                </tr>
              </thead>
              <tbody>
                {(coverage.can('itemReport') ? trouble : trouble.slice(0, 4)).map((m) => (
                  <tr key={m.itemKey} className="border-t border-hair">
                    <td className="py-2 font-mono text-[15px] font-bold text-ink">{m.itemKey}</td>
                    <td className="py-2 text-[14px] font-bold text-body">
                      {m.totalCorrect}/{m.totalAttempts}
                    </td>
                    {/* Slipped after knowing it is the number that matters, so
                        it is the one that gets a colour. */}
                    <td className="py-2 text-[14px] font-extrabold text-[#C2410C]">{m.lapses}</td>
                    <td className="py-2 text-[14px] text-muted">
                      {errorPattern(m.itemKey) ?? '—'}
                    </td>
                    <td
                      className={`py-2 text-[14px] font-bold ${
                        !m.dueOn || m.dueOn <= todayString() ? 'text-pine' : 'text-muted'
                      }`}
                    >
                      {!m.dueOn || m.dueOn <= todayString() ? 'today' : m.dueOn}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!coverage.can('itemReport') && trouble.length > 4 && (
          <p className="mt-3 rounded-xl bg-spark/10 px-4 py-3 text-[14px] font-bold text-[#7C4A22]">
            Showing 4 of {trouble.length}.{' '}
            <button className="underline" onClick={() => navigate({ name: 'upgrade' })}>
              Covering this learner
            </button>{' '}
            shows every word they have missed.
          </p>
        )}
      </Card>

      {/* Work this grown-up set, and how far through it is. Ink, because it is
          the one card here that is about them rather than the child. */}
      {(openTasks.length > 0 || doneTasks.length > 0) && (
        <div className="mb-4 rounded-3xl bg-ink p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-extrabold text-white">You set</h2>
            <Button onClick={() => navigate({ name: 'library' })}>Assign something new</Button>
          </div>
          <ul className="space-y-2">
            {[...openTasks, ...doneTasks].slice(0, 6).map((t) => {
              const done = doneTasks.some((d) => d.id === t.id)
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink2 px-4 py-3"
                >
                  <span className="font-extrabold text-white">{t.title}</span>
                  <span className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-white/15">
                    <span
                      className={`block h-full rounded-full ${done ? 'bg-pineSoft' : 'bg-sun'}`}
                      style={{ width: done ? '100%' : '45%' }}
                    />
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-onink">
                    {done ? 'Done' : 'In progress'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {turnaround.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-1 text-xl font-extrabold text-ink">Turned around 💪</h2>
          <p className="mb-3 text-sm font-bold text-muted">
            Words that used to get missed and are now mastered.
          </p>
          <div className="flex flex-wrap gap-2">
            {turnaround.map((m) => (
              <span
                key={m.itemKey}
                className="rounded-xl bg-emerald-50 px-3 py-1.5 font-mono text-sm font-bold text-emerald-700"
              >
                {m.itemKey}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Typing */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-ink">Typing ⌨️</h2>
          <div className="flex flex-wrap gap-2">
            <Pill className="bg-pineSoft/30 text-pine">{typingLessons} lessons played</Pill>
            <Pill className="bg-wash text-muted">{game.state.totalStars} stars</Pill>
            <Pill className="bg-wash text-muted">best {bestWpm} WPM</Pill>
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate({ name: 'typing' })}>
          Open typing →
        </Button>
      </Card>

      {/* Quiz decks */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-ink">Quiz decks 🃏</h2>
          <div className="flex flex-wrap gap-2">
            <Pill className="bg-pine/10 text-pine">
              {quizTotals.mastered}/{quizTotals.cards} cards mastered
            </Pill>
            <Pill className="bg-wash text-muted">{quizTotals.started} decks started</Pill>
            {quizTotals.due > 0 && (
              <Pill className="bg-sun/30 text-ink">🔁 {quizTotals.due} due</Pill>
            )}
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate({ name: 'quiz' })}>
          Open quiz →
        </Button>
      </Card>

      {/* Session log */}
      <Card>
        <h2 className="mb-1 text-xl font-extrabold text-ink">Recent sessions</h2>
        <p className="mb-3 font-bold text-muted">
          Open any round to see every answer, what was typed, and how long each one took.
        </p>
        {visibleSessions.length === 0 ? (
          <p className="font-bold text-stone">No sessions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-hair">
            {visibleSessions.slice(0, 15).map((s) => {
              const open = openSession === s.id
              return (
                <li key={s.id} className="py-1">
                  <button
                    onClick={() => setOpenSession(open ? null : s.id)}
                    aria-expanded={open}
                    className="flex w-full flex-wrap items-center gap-2 rounded-xl px-1 py-2 text-left hover:bg-quiet"
                  >
                    <span className="text-xs font-bold text-stone">{open ? '▾' : '▸'}</span>
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                        !s.isTest
                          ? 'bg-edge'
                          : typeof s.verifiedItemsTotal === 'number' &&
                              s.evidence === 'attempts' &&
                              s.verifiedItemsTotal < s.itemsTotal
                            ? 'bg-pineSoft'
                            : 'bg-pine'
                      }`}
                    />
                    <span className="text-lg">{SUBJECT_EMOJI[s.subject] ?? '⌨️'}</span>
                    <span className="font-extrabold text-ink">
                      {activityLabel(s.activity, s.subject)}
                    </span>
                    <span className="font-bold text-muted">
                      {s.itemsCorrect}/{s.itemsTotal} · {Math.round(s.accuracy)}%
                    </span>
                    {/* Load-bearing: a practice round says so, in the words
                        the learner saw when they played it. */}
                    <span
                      className={`text-[13px] font-bold ${s.isTest ? 'text-pine' : 'text-muted'}`}
                    >
                      {s.isTest ? 'Graded' : 'Practice only · doesn’t affect level'}
                    </span>
                    {/* Only worth saying when some of the round was not checked;
                        a fully verified round needs no caveat. */}
                    {typeof s.verifiedItemsTotal === 'number' &&
                      s.evidence === 'attempts' &&
                      s.verifiedItemsTotal < s.itemsTotal && (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-700"
                          title={`${s.verifiedItemsTotal} of ${s.itemsTotal} answers were checked by the app; the rest were self-graded.`}
                        >
                          {s.verifiedItemsTotal}/{s.itemsTotal} checked
                        </span>
                      )}
                    <span className="ml-auto text-xs font-bold text-stone">
                      {new Date(s.endedAt).toLocaleDateString()}
                    </span>
                  </button>
                  {open && <SessionDetail session={s} />}
                </li>
              )
            })}
          </ul>
        )}
        {hiddenSessions > 0 && (
          <p className="mt-3 rounded-xl bg-spark/10 px-4 py-3 text-[14px] font-bold text-[#7C4A22]">
            {hiddenSessions} older {hiddenSessions === 1 ? 'session is' : 'sessions are'} outside
            the {coverage.historyDays}-day window.{' '}
            <button className="underline" onClick={() => navigate({ name: 'upgrade' })}>
              Covering this learner
            </button>{' '}
            keeps the full history.
          </p>
        )}
      </Card>

      {/* A trust feature, not a help note. A parent who does not know what
          moves the level cannot tell whether the level means anything. */}
      <div className="mt-4 rounded-[20px] border border-hair bg-quiet p-6">
        <h2 className="mb-2 font-display text-lg font-extrabold text-ink">
          How the level is worked out
        </h2>
        <p className="text-[15px] leading-relaxed text-body">
          Only answers spelled from scratch, with no hints, move the level. Practice rounds and
          hinted words still help — they are how a word gets learned — but they are left out of the
          number, so the level always means what it says. When a hint is taken mid-word, that word
          stops counting for the round it is in.
        </p>
      </div>

      {/* Stated plainly, because a parent seeing a theme in a report should be
          told immediately that it changes nothing in the report — and then
          given the control, because a six-year-old will not go looking for the
          picker themselves. Rendered with no accent at all: this is a grown-up
          surface, and it stays one even while setting a child's colour. */}
      <div className="mt-4 rounded-[20px] border border-hair bg-chalk p-6">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          Their world
        </div>
        <h2 className="mt-1 font-display text-lg font-extrabold text-ink">{theme.name}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-body">
          {active?.displayName ?? 'They'} can change this themselves at any time, and so can you.
          It swaps the mascot and the name of what gets collected, and nothing else: not the
          words, not the difficulty, not what earns a reward. Nothing on this page changes with
          it.
        </p>

        <div className="mt-4">
          <ThemeChoice learner={active} />
        </div>
      </div>
    </div>
  )
}

/** Session rows store the raw activity id; show the name a person would use. */
const SUBJECT_EMOJI: Record<string, string> = {
  spelling: '🔤',
  typing: '⌨️',
  quiz: '🃏',
}

/**
 * Subject matters here: both spelling and quiz have an activity called 'test',
 * and looking the id up without it would label a quiz round "Spelling Test".
 */
function activityLabel(activity: string, subject: string): string {
  if (subject === 'quiz') {
    const quizMode = MODES.find((m) => m.id === activity)
    if (quizMode) return quizMode.name
    if (activity === 'review') return 'Card review'
    return activity
  }
  const known = ACTIVITIES.find((a) => a.id === activity)
  if (known) return known.name
  if (activity === 'lesson') return 'Typing lesson'
  if (activity === 'cat-rain') return 'Word Rain'
  return activity
}

/** One band of the retention split: the count, and what the word means. */
function RetentionStat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl bg-quiet px-3 py-2">
      <div className="font-display text-2xl font-extrabold text-ink">{value}</div>
      <div className="text-[13px] font-extrabold text-body">{label}</div>
      <div className="text-[11px] font-bold text-stone">{hint}</div>
    </div>
  )
}

function StatCard({
  label,
  value,
  note,
  invert = false,
}: {
  label: string
  value: string
  note: string
  invert?: boolean
}) {
  return (
    <div
      className={`rounded-[18px] p-4 ${invert ? 'bg-ink' : 'border border-hair bg-chalk'}`}
    >
      <div
        className={`font-mono text-[11px] font-bold uppercase tracking-[0.12em] ${
          invert ? 'text-onink' : 'text-faint'
        }`}
      >
        {label}
      </div>
      <div
        className={`font-display text-[32px] font-extrabold leading-tight tracking-[-0.02em] ${
          invert ? 'text-white' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <div className={`text-[13px] font-bold ${invert ? 'text-onink' : 'text-muted'}`}>{note}</div>
    </div>
  )
}

function buildActivityChart(daily: Array<{ day: string; items: number }>) {
  const byDay = new Map<string, number>()
  for (const row of daily) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.items)
  }
  const today = todayString()
  return Array.from({ length: 21 }, (_, i) => {
    const day = addDays(today, i - 20)
    return { day, items: byDay.get(day) ?? 0 }
  })
}

/**
 * What the chart says, in a sentence.
 *
 * Prose rather than another number: a parent looking at twenty-one bars wants
 * to be told what the shape of them means, and the honest reading is sometimes
 * that not much happened.
 */
function activityInsight(days: Array<{ day: string; items: number }>): string {
  const active = days.filter((d) => d.items > 0)
  if (active.length === 0) {
    return 'No practice in the last three weeks. Ten minutes is enough to restart a streak.'
  }
  const items = days.reduce((n, d) => n + d.items, 0)
  const recent = days.slice(-7).filter((d) => d.items > 0).length
  const earlier = days.slice(0, 7).filter((d) => d.items > 0).length

  if (recent === 0) {
    return `Nothing this week, after ${active.length} active ${
      active.length === 1 ? 'day' : 'days'
    } earlier in the month. The review queue keeps waiting — nothing is lost by coming back to it.`
  }
  if (recent > earlier) {
    return `Picking up: ${recent} of the last 7 days had practice, against ${earlier} three weeks ago. ${items} answers in all.`
  }
  if (recent < earlier) {
    return `Slowing down: ${recent} of the last 7 days had practice, against ${earlier} three weeks ago. ${items} answers in all.`
  }
  return `Steady — ${recent} of the last 7 days had practice, and ${items} answers over the three weeks.`
}
