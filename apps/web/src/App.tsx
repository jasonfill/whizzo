import { useCallback, useEffect, useRef } from 'react'
import {
  BrowserRouter,
  Navigate as Redirect,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import AuthScreen from './auth/AuthScreen'
import Background from './components/Background'
import Mascot from './components/Mascot'
import { useGameState, type GameApi } from './hooks/useGameState'
import { LearnerProvider, useLearners } from './lib/learners/LearnerProvider'
import { ProgressProvider, useProgress } from './lib/progress/ProgressProvider'
import { ThemeProvider } from './lib/theme/ThemeProvider'
import { setSoundEnabled } from './lib/sound'
import {
  parseActivity,
  parseAudience,
  parseDirection,
  parseSize,
  parseSpellMode,
  parseStudyMode,
  routeToPath,
} from './paths'
import type { Navigate } from './routes'
import CatRainScreen from './screens/CatRainScreen'
import LessonScreen from './screens/LessonScreen'
import AudienceScreen from './screens/marketing/AudienceScreen'
import FaqScreen from './screens/marketing/FaqScreen'
import FeaturesScreen from './screens/marketing/FeaturesScreen'
import HowItWorksScreen from './screens/marketing/HowItWorksScreen'
import MarketingScreen from './screens/marketing/MarketingScreen'
import PricingScreen from './screens/marketing/PricingScreen'
import PrivacyScreen from './screens/marketing/PrivacyScreen'
import PracticeScreen from './screens/PracticeScreen'
import DeckEditor from './screens/quiz/DeckEditor'
import DeckScreen from './screens/quiz/DeckScreen'
import QuizHome from './screens/quiz/QuizHome'
import QuizPlay from './screens/quiz/QuizPlay'
import SettingsScreen from './screens/SettingsScreen'
import SpellingHome from './screens/spelling/SpellingHome'
import SpellingLists from './screens/spelling/SpellingLists'
import SpellingPlay from './screens/spelling/SpellingPlay'
import AccountScreen from './screens/suite/AccountScreen'
import ConnectScreen from './screens/suite/ConnectScreen'
import { clearPendingConnect, keepPendingConnect, readPendingConnect } from './lib/mcp/pending'
import FamilyScreen from './screens/suite/FamilyScreen'
import ContentScreen from './screens/content/ContentScreen'
import PlannerScreen from './screens/planner/PlannerScreen'
import WatchScreen from './screens/live/WatchScreen'
import PlanWeekScreen from './screens/planner/PlanWeekScreen'
import WrapWeekScreen from './screens/planner/WrapWeekScreen'
import CoursesScreen from './screens/planner/CoursesScreen'
import PlannerPrint from './screens/planner/PlannerPrint'
import LibraryScreen from './screens/suite/LibraryScreen'
import TasksScreen from './screens/suite/TasksScreen'
import CustomListsScreen from './screens/suite/CustomListsScreen'
import ProgressScreen from './screens/suite/ProgressScreen'
import PrintableReport from './screens/suite/PrintableReport'
import SuiteHome from './screens/suite/SuiteHome'
import ThemePicker from './screens/theme/ThemePicker'
import WorldScreen from './screens/theme/WorldScreen'
import UpgradeScreen from './screens/suite/UpgradeScreen'
import TypingHome from './screens/TypingHome'
import TrophyRoom from './screens/TrophyRoom'
import WorldMap from './screens/WorldMap'

export type { Route } from './routes'

export default function App() {
  return (
    // Outermost, so the providers below can navigate and so a deep link is
    // already resolved by the time the first screen asks what it should show.
    <BrowserRouter>
      <AuthProvider>
        <LearnerProvider>
          {/* Above progress, below learners: the theme is chosen per learner, so
              it has to see who is active, and everything below it paints in the
              color it publishes. */}
          <ThemeProvider>
            <ProgressProvider>
              <Background />
              <main className="min-h-full px-3 pb-10 pt-4 md:px-6">
                <Router />
              </main>
            </ProgressProvider>
          </ThemeProvider>
        </LearnerProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

/**
 * Screens navigate by naming a screen, not by writing a URL — `paths.ts` owns
 * the translation. That keeps every call site honest about *where* it is going
 * rather than about string concatenation, and means a path can be renamed in
 * one file.
 */
function useAppNavigate(): Navigate {
  const navigate = useNavigate()
  return useCallback((route) => navigate(routeToPath(route)), [navigate])
}

/**
 * The signed-out door in front of the consent screen. Remembers the
 * assistant's request for the sign-in round trip, then stays put: once the
 * session exists the signed-in table renders the consent screen at this
 * address, or the effect above brings the browser back to it.
 */
function ConnectDoor({ onBack }: { onBack: () => void }) {
  const [query] = useSearchParams()
  const req = query.get('req')
  useEffect(() => {
    if (req) keepPendingConnect(req)
  }, [req])
  return <AuthScreen onDone={() => undefined} onBack={onBack} />
}

function Router() {
  const game = useGameState()
  const { ready } = useProgress()
  const { status: authStatus, configured } = useAuth()
  const { learners, status: learnerStatus } = useLearners()
  const navigate = useAppNavigate()
  const location = useLocation()
  const sentToSetup = useRef(false)

  // Keep the sound engine in sync with the saved setting.
  useEffect(() => {
    setSoundEnabled(game.state.settings.sound)
  }, [game.state.settings.sound])

  // Scroll back to top on navigation for small screens. Keyed on the history
  // entry rather than the path so the back button gets the same treatment as a
  // forward move, and so re-entering the screen you are on still resets.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.key])

  // A newly signed-up grown-up owns no learners yet, and `home` is the *child's*
  // screen — dropping them there makes the account look like a student account
  // and quietly saves their practice to localStorage, because there is no
  // learner to attribute it to. Send them to set one up first.
  //
  // Once only: if they deliberately navigate away without adding anyone, that is
  // their choice and bouncing them back would trap them.
  useEffect(() => {
    if (authStatus !== 'signed-in') {
      sentToSetup.current = false
      return
    }
    if (learnerStatus !== 'ready' || learners.length > 0 || sentToSetup.current) return
    // A grown-up on the consent screen is not here to set up; that screen
    // says so itself when there is nobody to share, and offers the way.
    if (location.pathname === '/connect') return
    sentToSetup.current = true
    navigate({ name: 'family' })
  }, [authStatus, learnerStatus, learners.length, location.pathname, navigate])

  // An assistant sent a grown-up to /connect?req=…, and signing in with Google
  // or a magic link comes back to "/" without the query. The request is put
  // aside when the signed-out door is shown — and again by the consent screen
  // when it sends a new parent off to add a child — and picked up here, on
  // the next signed-in page that is not the consent screen itself. One
  // reader, and the key is spent the moment it is read.
  useEffect(() => {
    if (authStatus !== 'signed-in') return
    const req = readPendingConnect()
    if (!req) return
    clearPendingConnect()
    if (location.pathname !== '/connect') navigate({ name: 'connect', req })
  }, [authStatus, location.pathname, navigate])

  // Nothing in the app is reachable while signed out. Practice only means
  // something when it is attributed to a learner — the level, the review
  // schedule and the report all hang off that one record — so a visitor gets
  // the marketing site and a door, not a round of spelling that lands nowhere.
  //
  // The exception is a build with no Supabase behind it, where signing in is
  // impossible: gating there would leave a developer with a locked door and no
  // key. Every deployed build is configured, so this is a local-only path.
  //
  // The gate sits in front of the routes rather than inside them, so a deep
  // link is held — not redirected — until auth has answered.
  if (authStatus === 'loading') return <Loading />
  if (authStatus !== 'signed-in' && configured) {
    return (
      <Routes>
        <Route
          path="/signin"
          element={
            <AuthScreen
              onDone={() => navigate({ name: 'home' })}
              onBack={() => navigate({ name: 'marketing' })}
            />
          }
        />
        <Route path="/" element={<MarketingScreen navigate={navigate} />} />

        {/* An assistant has sent a grown-up here to approve a connection. They
            sign in and stay put: the address keeps the request, and the
            signed-in table below renders the consent screen at it. */}
        <Route
          path="/connect"
          element={
            <ConnectDoor
              onBack={() => navigate({ name: 'marketing' })}
            />
          }
        />

        {/* The rest of the marketing site. Signed out is the only state the
            sales pages are reachable in: a signed-in grown-up wanting to know
            what coverage costs has `/upgrade`, which can answer it about
            *their* children rather than in general. `/privacy` and `/faq` are
            reference rather than pitch and are registered in both tables. */}
        <Route path="/features" element={<FeaturesScreen navigate={navigate} />} />
        <Route path="/how-it-works" element={<HowItWorksScreen navigate={navigate} />} />
        <Route path="/pricing" element={<PricingScreen navigate={navigate} />} />
        <Route path="/for/:who" element={<Audience navigate={navigate} />} />
        <Route path="/privacy" element={<PrivacyScreen navigate={navigate} />} />
        <Route path="/faq" element={<FaqScreen navigate={navigate} />} />

        {/* A signed-out visitor holding a deep link cannot be shown that screen,
            so the address bar is corrected rather than left describing a page
            they are not looking at. */}
        <Route path="*" element={<Redirect to="/" replace />} />
      </Routes>
    )
  }

  if (!ready) return <Loading />

  return (
    <Routes>
      {/* Suite. "/" is home: signing in elsewhere — another tab, a restored
          session — can leave a grown-up standing on the marketing site, and
          their home is the app. */}
      <Route path="/" element={<SuiteHome game={game} navigate={navigate} />} />
      <Route
        path="/signin"
        element={
          <AuthScreen
            onDone={() => navigate({ name: 'home' })}
            onBack={() => navigate({ name: 'home' })}
          />
        }
      />
      <Route path="/family" element={<FamilyScreen navigate={navigate} />} />
      <Route path="/account" element={<AccountScreen navigate={navigate} />} />
      <Route path="/connect" element={<ConnectScreen navigate={navigate} />} />
      <Route path="/upgrade" element={<UpgradeScreen navigate={navigate} />} />
      <Route path="/progress" element={<ProgressScreen game={game} navigate={navigate} />} />
      <Route path="/progress/print" element={<PrintableReport navigate={navigate} />} />
      <Route path="/custom-lists" element={<CustomListsScreen navigate={navigate} />} />
      <Route path="/tasks" element={<TasksScreen navigate={navigate} />} />
      <Route path="/library" element={<LibraryScreen navigate={navigate} />} />
      <Route path="/library/add" element={<ContentScreen navigate={navigate} />} />
      <Route path="/planner" element={<Planner navigate={navigate} />} />
      <Route path="/planner/week/:weekStart" element={<Planner navigate={navigate} />} />
      <Route path="/watch/:learnerId" element={<Watch navigate={navigate} />} />
      <Route path="/planner/plan" element={<PlanWeekScreen navigate={navigate} />} />
      <Route path="/planner/wrap" element={<WrapWeekScreen navigate={navigate} />} />
      <Route path="/planner/courses" element={<CoursesScreen navigate={navigate} />} />
      <Route path="/planner/print" element={<PlannerPrintRoute navigate={navigate} />} />
      <Route path="/planner/print/:weekStart" element={<PlannerPrintRoute navigate={navigate} />} />
      <Route path="/theme" element={<ThemePicker navigate={navigate} />} />
      <Route path="/world" element={<WorldScreen navigate={navigate} />} />
      <Route path="/settings" element={<SettingsScreen game={game} navigate={navigate} />} />

      {/* Reference, not sales pitch — and that is the whole distinction.
          Features, how-it-works and pricing stay signed-out-only on purpose:
          a signed-in grown-up has `/upgrade`, which answers "what does this
          cost?" about their own children rather than in general.

          These two are a different kind of page. A privacy policy is the one
          a paying customer is likeliest to want on demand, and in some places
          is entitled to; the FAQ is where "how do I remove a tutor" is
          answered. Bouncing either to the app home was the product hiding its
          own terms from exactly the people who had handed over data. The
          marketing chrome drops its sales links for a signed-in reader (see
          `chrome.tsx`) so neither page leads anywhere that would redirect. */}
      <Route path="/privacy" element={<PrivacyScreen navigate={navigate} />} />
      <Route path="/faq" element={<FaqScreen navigate={navigate} />} />

      {/* Typing */}
      <Route path="/typing" element={<TypingHome game={game} navigate={navigate} />} />
      <Route path="/typing/map" element={<WorldMap game={game} navigate={navigate} />} />
      <Route path="/typing/lesson/:id" element={<Lesson game={game} navigate={navigate} />} />
      <Route path="/typing/practice" element={<PracticeScreen game={game} navigate={navigate} />} />
      <Route path="/typing/rain" element={<CatRainScreen game={game} navigate={navigate} />} />
      <Route path="/typing/trophies" element={<TrophyRoom game={game} navigate={navigate} />} />

      {/* Spelling */}
      <Route path="/spelling" element={<SpellingHome navigate={navigate} />} />
      <Route path="/spelling/lists" element={<SpellingLists navigate={navigate} />} />
      <Route path="/spelling/play/:activity/:mode" element={<SpellRound navigate={navigate} />} />

      {/* Quiz */}
      <Route path="/quiz" element={<QuizHome navigate={navigate} />} />
      <Route path="/quiz/deck/:deckId" element={<Deck navigate={navigate} />} />
      <Route path="/quiz/new" element={<DeckEditor navigate={navigate} />} />
      <Route path="/quiz/edit/:deckId" element={<EditDeck navigate={navigate} />} />
      <Route path="/quiz/play/:mode" element={<QuizRound navigate={navigate} />} />

      <Route path="*" element={<Redirect to="/" replace />} />
    </Routes>
  )
}

// URL parameters, checked and handed to the screens as the props they already
// take. A parameter that names nothing real sends the visitor to that
// subject's home rather than rendering a round with no rules; an id that is
// merely stale is passed through, because those screens say so themselves.

/** `/for/pirates` is not an audience, so it lands on the page that lists them. */
function Audience({ navigate }: { navigate: Navigate }) {
  const { who } = useParams()
  const audience = parseAudience(who)
  if (!audience) return <Redirect to="/" replace />
  return <AudienceScreen who={audience} navigate={navigate} />
}

function Lesson({ game, navigate }: { game: GameApi; navigate: Navigate }) {
  const { id } = useParams()
  if (!id) return <Redirect to="/typing/map" replace />
  return <LessonScreen game={game} lessonId={id} navigate={navigate} />
}

function Deck({ navigate }: { navigate: Navigate }) {
  const { deckId } = useParams()
  if (!deckId) return <Redirect to="/quiz" replace />
  return <DeckScreen deckId={deckId} navigate={navigate} />
}

function EditDeck({ navigate }: { navigate: Navigate }) {
  const { deckId } = useParams()
  return <DeckEditor deckId={deckId} navigate={navigate} />
}

function SpellRound({ navigate }: { navigate: Navigate }) {
  const params = useParams()
  const [query] = useSearchParams()
  const activity = parseActivity(params.activity)
  const mode = parseSpellMode(params.mode)
  if (!activity || !mode) return <Redirect to="/spelling" replace />

  const listId = query.get('list') ?? undefined
  const customListId = query.get('custom') ?? undefined
  return (
    <SpellingPlay
      // Remounting on a parameter change guarantees a fresh round rather
      // than a half-played one inheriting the previous plan.
      key={`${activity}:${mode}:${listId ?? customListId ?? 'adaptive'}`}
      activity={activity}
      mode={mode}
      listId={listId}
      customListId={customListId}
      size={parseSize(query.get('size'))}
      navigate={navigate}
    />
  )
}

function QuizRound({ navigate }: { navigate: Navigate }) {
  const params = useParams()
  const [query] = useSearchParams()
  const mode = parseStudyMode(params.mode)
  if (!mode) return <Redirect to="/quiz" replace />

  const deckId = query.get('deck') ?? undefined
  const direction = parseDirection(query.get('direction'))
  return (
    <QuizPlay
      // Same reasoning as spelling: a parameter change starts a fresh
      // round rather than resuming a half-played one under new rules.
      key={`${mode}:${deckId ?? 'all'}:${direction ?? 'term-first'}`}
      mode={mode}
      deckId={deckId}
      size={parseSize(query.get('size'))}
      direction={direction}
      navigate={navigate}
    />
  )
}

function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Mascot mood="resting" size={120} className="animate-floaty" />
      <p className="text-lg font-bold text-muted">Fetching your progress…</p>
    </div>
  )
}

const MONDAY = /^\d{4}-\d{2}-\d{2}$/

/** The week from the address, if it names one that looks like a day. */
function Watch({ navigate }: { navigate: Navigate }) {
  const { learnerId } = useParams()
  if (!learnerId) return null
  return <WatchScreen navigate={navigate} learnerId={learnerId} />
}

function Planner({ navigate }: { navigate: Navigate }) {
  const { weekStart } = useParams()
  const [params] = useSearchParams()
  const view = params.get('view')
  return (
    <PlannerScreen
      navigate={navigate}
      weekStart={weekStart && MONDAY.test(weekStart) ? weekStart : undefined}
      view={view === 'today' || view === 'week' ? view : undefined}
    />
  )
}

function PlannerPrintRoute({ navigate }: { navigate: Navigate }) {
  const { weekStart } = useParams()
  return <PlannerPrint navigate={navigate} weekStart={weekStart && MONDAY.test(weekStart) ? weekStart : undefined} />
}
