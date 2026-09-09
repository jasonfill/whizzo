// Holds the active learner's theme and publishes it two ways: as CSS variables
// on the document element, which is what the Tailwind accent tokens read, and
// as the theme object itself for the copy strings and tints that cannot be
// expressed as a class.
//
// Mounted above the progress provider and below the learner provider, because
// the theme is chosen per learner — siblings differ, and a parent switching
// from one child to another should see the app change with them.
//
// Two people can set it, which is the whole reason it is not a local
// preference: a student picks their own world, and a grown-up can set one for
// a child too young to go looking for the picker. The learners RLS already
// admits exactly those writers — the owner, the learner themselves, and a
// guardian holding can_manage_content — so both paths are the same one PATCH.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useLearners } from '../learners/LearnerProvider'
import { updateLearner } from '../learners/api'
import {
  DEFAULT_THEME_ID,
  hexToRgbTriple,
  isThemeId,
  themeById,
  THEMES,
  type Theme,
  type ThemeId,
} from '../themes'

// Deliberately small. Grown-up surfaces stay theme-free by never reading
// `theme` for color; the parent screen reads it only to name the child's world
// and to set it, which is why `setTheme` lives here rather than on the picker.
interface ThemeContextValue {
  theme: Theme
  themes: Theme[]
  /** Set the world for whoever is currently active. */
  setTheme: (id: ThemeId) => void
  /**
   * Set the world for a named learner, who may not be the active one.
   *
   * The family screen needs this: a parent managing three children sets a
   * world for one of them without first switching the whole app over to that
   * child. Resolves once the write has landed so the caller can refresh.
   */
  setThemeFor: (learnerId: string, id: ThemeId) => Promise<void>
  /** Where the current value came from, so a screen can say so honestly. */
  source: 'learner' | 'guest'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Guest storage only.
 *
 * A signed-in learner's theme lives on their row, so it follows them to any
 * device and a parent can set it from theirs. This slot is for play before an
 * account exists.
 */
const GUEST_KEY = 'whizzo:theme:guest'

function readGuestTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(GUEST_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

function writeGuestTheme(id: ThemeId): void {
  try {
    localStorage.setItem(GUEST_KEY, id)
  } catch {
    /* a private window is not a reason to fail a lesson */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const { active, refresh } = useLearners()
  const signedIn = status === 'signed-in' && !!active

  // The guest's choice, held locally. For a signed-in learner the row is the
  // truth, and `pending` is only the optimistic overlay between the click and
  // the round trip.
  const [guestTheme, setGuestTheme] = useState<ThemeId>(readGuestTheme)
  const [pending, setPending] = useState<{ learnerId: string; id: ThemeId } | null>(null)

  const stored = signedIn && isThemeId(active.theme) ? active.theme : null
  const optimistic = pending && pending.learnerId === active?.id ? pending.id : null
  const themeId: ThemeId = signedIn ? (optimistic ?? stored ?? DEFAULT_THEME_ID) : guestTheme

  // Once the row comes back agreeing with us, the overlay has done its job.
  useEffect(() => {
    if (pending && stored === pending.id) setPending(null)
  }, [pending, stored])

  // The one global side effect. Everything styled with the accent tokens reads
  // these variables, so writing them here re-paints every play surface at once
  // without a single component re-rendering on the color.
  //
  // Four, not one: the pressed/shadow color and the two tints are as much a
  // part of "the paint" as the accent itself, and a play surface that had to
  // reach for an inline style to get them would be a play surface the sweep
  // could not check.
  useEffect(() => {
    const theme = themeById(themeId)
    const root = document.documentElement.style
    root.setProperty('--wz-accent', theme.accentRgb)
    root.setProperty('--wz-accent-deep', hexToRgbTriple(theme.deep))
    root.setProperty('--wz-tint-a', hexToRgbTriple(theme.tintA))
    root.setProperty('--wz-tint-b', hexToRgbTriple(theme.tintB))
  }, [themeId])

  const setThemeFor = useCallback(
    async (learnerId: string, id: ThemeId) => {
      // Optimistic for the active learner too, so setting a world from the
      // family screen repaints immediately when it happens to be the child
      // currently on screen.
      setPending({ learnerId, id })
      try {
        await updateLearner(learnerId, { theme: id })
        await refresh()
      } catch (err) {
        console.warn('[whizzo] could not save theme', err)
        setPending(null)
        throw err
      }
    },
    [refresh],
  )

  const setTheme = useCallback(
    (id: ThemeId) => {
      if (!signedIn || !active) {
        setGuestTheme(id)
        writeGuestTheme(id)
        return
      }
      // Optimistic: the world changes on the click, the write follows. A failed
      // write is warned about rather than thrown — losing a color is not worth
      // interrupting a child mid-round — and since the next load reads the row,
      // the app does not go on claiming something was saved when it was not.
      setPending({ learnerId: active.id, id })
      void updateLearner(active.id, { theme: id })
        .then(() => refresh())
        .catch((err) => {
          console.warn('[whizzo] could not save theme', err)
          setPending(null)
        })
    },
    [signedIn, active, refresh],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeById(themeId),
      themes: THEMES,
      setTheme,
      setThemeFor,
      source: signedIn ? 'learner' : 'guest',
    }),
    [themeId, setTheme, setThemeFor, signedIn],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
