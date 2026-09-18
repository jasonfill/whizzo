import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { routeToPath } from '../paths'
import type { Route } from '../routes'

/**
 * A Back button that goes back.
 *
 * Every screen used to hard-code one parent, so a screen reachable from two
 * places sent half its visitors somewhere they had not been. This returns to
 * the previous history entry when the app created one, and falls back to the
 * screen's natural parent only on a cold deep link — the one case where there
 * is nothing to go back to.
 */
export function useBack(fallback: Route): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => {
    // React Router gives the very first entry the key 'default'; anything
    // else was pushed by this app, so history has somewhere to go.
    if (location.key !== 'default') navigate(-1)
    else navigate(routeToPath(fallback))
  }, [navigate, location.key, fallback])
}
