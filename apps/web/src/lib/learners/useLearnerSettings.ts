// The learner's own switches: sound, the typing helpers, the flashcard layout.
//
// They live on the learner row (`learners.settings`, migration 0027), so the
// same child sees one set on every device and two siblings sharing a tablet do
// not share one. A write goes out optimistically: the screen changes at once,
// the PATCH follows, and a failure is logged rather than shown — a switch that
// did not stick is not worth interrupting a lesson for.
//
// With nobody signed in (the guest build) there is no row to write to, so a
// small record in localStorage stands in. It is the only thing this hook keeps
// on the device, and it is never read once there is a learner.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { LearnerSettings } from '@whizzo/shared'
import { useLearners } from './LearnerProvider'

export type { LearnerSettings } from '@whizzo/shared'

export const DEFAULT_SETTINGS: Required<LearnerSettings> = {
  sound: true,
  showHands: true,
  showKeyboard: true,
  flashcardLayout: 'flip',
  strikeOutChoices: true,
}

// --- the guest record ------------------------------------------------------

const GUEST_KEY = 'whizzo:settings:guest'

let guestCache: LearnerSettings | null = null
const guestListeners = new Set<() => void>()

function readGuest(): LearnerSettings {
  try {
    const raw = localStorage.getItem(GUEST_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LearnerSettings)
      : {}
  } catch {
    return {}
  }
}

function guestSnapshot(): LearnerSettings {
  if (!guestCache) guestCache = readGuest()
  return guestCache
}

function writeGuest(patch: LearnerSettings): void {
  guestCache = { ...guestSnapshot(), ...patch }
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(guestCache))
  } catch {
    // Storage unavailable: the choice lasts for this visit and no longer.
  }
  for (const listen of guestListeners) listen()
}

function subscribeGuest(listen: () => void): () => void {
  guestListeners.add(listen)
  return () => {
    guestListeners.delete(listen)
  }
}

/** Test seam: forget the guest record, as a fresh browser would. */
export function clearGuestSettings(): void {
  guestCache = null
  try {
    localStorage.removeItem(GUEST_KEY)
  } catch {
    /* ignore */
  }
}

// --- the hook ----------------------------------------------------------------

export interface LearnerSettingsApi {
  /** Every switch, with the default filled in where nothing has been set. */
  settings: Required<LearnerSettings>
  /** Change one or more switches. Optimistic; a failed write is logged. */
  set: (patch: LearnerSettings) => void
}

export function useLearnerSettings(): LearnerSettingsApi {
  const { active, update } = useLearners()
  const guest = useSyncExternalStore(subscribeGuest, guestSnapshot)

  // What this component has asked for and not yet seen come back on the
  // learner. Keyed to the learner it was asked for, so switching children
  // does not carry one child's pending flip onto the other.
  const [overlay, setOverlay] = useState<{ learnerId: string; patch: LearnerSettings } | null>(null)
  // The latest write per key, so an older PATCH resolving after a newer one
  // does not drop the newer value out of the overlay.
  const seqRef = useRef<Record<string, number>>({})
  const nextSeq = useRef(0)

  const learnerId = active?.id ?? null
  useEffect(() => {
    if (!learnerId) setOverlay(null)
  }, [learnerId])

  const settings = useMemo<Required<LearnerSettings>>(() => {
    const stored = active ? active.settings ?? {} : guest
    const pending = overlay && overlay.learnerId === learnerId ? overlay.patch : {}
    return { ...DEFAULT_SETTINGS, ...stored, ...pending }
  }, [active, guest, overlay, learnerId])

  const set = useCallback(
    (patch: LearnerSettings) => {
      if (!active) {
        writeGuest(patch)
        return
      }
      const id = active.id
      const seq = ++nextSeq.current
      const keys = Object.keys(patch) as Array<keyof LearnerSettings>
      for (const key of keys) seqRef.current[key] = seq
      setOverlay((prev) => ({
        learnerId: id,
        patch: { ...(prev && prev.learnerId === id ? prev.patch : {}), ...patch },
      }))
      // Either way the overlay is done with these keys: on success the
      // learner row now carries them, on failure the screen goes back to what
      // the row says. A key a newer write has since claimed is left alone.
      const settle = () => {
        setOverlay((prev) => {
          if (!prev || prev.learnerId !== id) return prev
          const next = { ...prev.patch }
          for (const key of keys) {
            if (seqRef.current[key] === seq) delete next[key]
          }
          return Object.keys(next).length ? { learnerId: id, patch: next } : null
        })
      }
      update(id, { settings: patch }).then(settle, (err: unknown) => {
        console.warn('[whizzo] could not save settings', err)
        settle()
      })
    },
    [active, update],
  )

  return useMemo(() => ({ settings, set }), [settings, set])
}
