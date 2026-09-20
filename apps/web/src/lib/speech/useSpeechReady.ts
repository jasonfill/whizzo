import { useEffect, useState } from 'react'
import { isSpeechAvailable, whenVoicesReady } from '../spelling/speech'

/**
 * Whether this device can read anything out at all.
 *
 * Voices load asynchronously almost everywhere, so the first answer is often
 * "no" and becomes "yes" a moment later. Anything that hides a speaker button
 * has to wait for that rather than deciding on mount, or the button never
 * appears on a perfectly capable browser.
 *
 * A device with no voice installed — some Linux builds, a few locked-down
 * Android tablets — stays at "no" for good, and the speaker buttons simply do
 * not exist there. That is the right failure: an icon that does nothing when a
 * child presses it is worse than no icon.
 */
export function useSpeechReady(): boolean {
  const [ready, setReady] = useState(isSpeechAvailable)
  useEffect(() => {
    if (ready) return
    return whenVoicesReady(setReady)
  }, [ready])
  return ready
}
