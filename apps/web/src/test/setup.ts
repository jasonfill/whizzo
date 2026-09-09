// Browser APIs the app touches that jsdom does not implement.
//
// Kept to genuine gaps only: anything stubbed here is behavior a test can no
// longer see, so the list is deliberately short.

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Speech synthesis drives dictation. jsdom has none.
Object.defineProperty(window, 'speechSynthesis', {
  // Configurable so a test can swap in a device with no voices at all, which
  // is the case the speech module exists to handle.
  configurable: true,
  writable: true,
  value: {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
})
;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
  constructor(public text?: string) {}
}

// The sound engine builds an AudioContext lazily; tests never want audio.
;(window as unknown as { AudioContext: unknown }).AudioContext = class {
  createOscillator() {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 0 }, type: '' }
  }
  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    }
  }
  get destination() {
    return {}
  }
  get currentTime() {
    return 0
  }
  resume() {
    return Promise.resolve()
  }
}

// jsdom implements neither, and several screens call them on mount.
window.scrollTo = vi.fn()
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList)

afterEach(async () => {
  cleanup()
  localStorage.clear()
  // The app navigates by pushing real history entries, and one jsdom window is
  // shared by every test in a file — so without this a test would start on
  // whatever screen the previous one walked to.
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  const { resetTestState } = await import('./state')
  const { resetSpies } = await import('./mockProviders')
  resetTestState()
  resetSpies()
})
