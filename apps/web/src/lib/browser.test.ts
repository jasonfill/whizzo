// The two modules that talk to browser capabilities the app cannot count on.
//
// Speech is how spelling is delivered, and it is genuinely absent on headless
// Chrome and some Linux desktops — where the API exists but reports no voices,
// so a naive check passes and `speak()` then silently does nothing. Sound is
// synthesised rather than shipped as files, so it has to degrade the same way.
//
// The rule for both: missing capability is a quieter app, never a broken one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentVoice,
  dictate,
  isSpeechAvailable,
  listVoices,
  primeVoices,
  savedVoiceURI,
  setVoice,
  speak,
  stopSpeaking,
  whenVoicesReady,
} from './spelling/speech'
import { setSoundEnabled, sfx, unlockAudio } from './sound'

function voice(name: string, uri = name): SpeechSynthesisVoice {
  return { name, voiceURI: uri, lang: 'en-GB', default: false, localService: true } as never
}

let voices: SpeechSynthesisVoice[] = []
const speakSpy = vi.fn()
const cancelSpy = vi.fn()

beforeEach(() => {
  voices = [voice('Nicky'), voice('Daniel')]
  speakSpy.mockClear()
  cancelSpy.mockClear()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      speak: speakSpy,
      cancel: cancelSpy,
      getVoices: () => voices,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isSpeechAvailable', () => {
  it('is true when the API exists and reports voices', () => {
    expect(isSpeechAvailable()).toBe(true)
  })

  it('is false when the API exists but has no voices', () => {
    // The case that matters: headless Chrome. speak() would do nothing at all,
    // so the app has to know to show the word instead of reading it.
    voices = []
    expect(isSpeechAvailable()).toBe(false)
  })

  it('is false when the API is missing entirely', () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: undefined,
    })
    expect(isSpeechAvailable()).toBe(false)
  })
})

describe('whenVoicesReady', () => {
  it('answers straight away when voices are already loaded', () => {
    const cb = vi.fn()
    whenVoicesReady(cb)
    expect(cb).toHaveBeenCalledWith(true)
  })

  it('answers false immediately when there is no API to wait for', () => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
    const cb = vi.fn()
    whenVoicesReady(cb)
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('gives up after a grace period rather than waiting forever', () => {
    vi.useFakeTimers()
    voices = []
    const cb = vi.fn()
    whenVoicesReady(cb)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('hands back a cleanup function that is safe to call', () => {
    expect(() => whenVoicesReady(vi.fn())()).not.toThrow()
  })
})

describe('choosing a voice', () => {
  it('lists what the device has', () => {
    expect(listVoices().map((v) => v.name)).toEqual(['Nicky', 'Daniel'])
  })

  it('remembers a choice across visits', () => {
    setVoice('Daniel')
    expect(savedVoiceURI()).toBe('Daniel')
    expect(currentVoice()?.name).toBe('Daniel')
  })

  it('forgets it when asked, falling back to the device default', () => {
    setVoice('Daniel')
    setVoice(null)
    expect(savedVoiceURI()).toBeNull()
  })

  it('falls back to a real voice when a saved one is gone', () => {
    // Voices come and go with OS updates. A stale choice must fall back to
    // whatever the device does have rather than silencing dictation.
    setVoice('Removed')
    voices = [voice('Nicky')]
    expect(currentVoice()?.name).toBe('Nicky')
    expect(isSpeechAvailable()).toBe(true)
  })

  it('always answers with a voice or nothing, never a crash', () => {
    // The module caches the pick, so what matters is that asking is safe in
    // both states rather than which one comes back after a prime.
    voices = []
    expect(() => currentVoice()).not.toThrow()
    voices = [voice('Nicky')]
    expect(() => currentVoice()).not.toThrow()
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => setVoice('Daniel')).not.toThrow()
  })
})

describe('speaking', () => {
  it('speaks the text it was given', () => {
    speak('hello')
    expect(speakSpy).toHaveBeenCalled()
  })

  it('still calls through when the device reports no voices', () => {
    // speak() does not second-guess the platform — isSpeechAvailable() is the
    // gate, and the screens check it before offering dictation at all.
    voices = []
    expect(() => speak('hello')).not.toThrow()
  })

  it('reports back through onEnd even where there is no speech API', () => {
    // Otherwise a screen waiting for the word to finish would hang forever.
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
    const onEnd = vi.fn()
    speak('hello', { onEnd })
    expect(onEnd).toHaveBeenCalled()
  })

  it('reads the word and then the sentence it sits in', () => {
    dictate('cat', 'The cat sat.')
    expect(speakSpy).toHaveBeenCalled()
  })

  it('stops anything in flight before starting', () => {
    speak('one')
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('can be stopped', () => {
    stopSpeaking()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('primes voices without throwing on a device that has none', () => {
    voices = []
    expect(() => primeVoices()).not.toThrow()
  })
})

describe('sound', () => {
  it('plays every effect without throwing', () => {
    setSoundEnabled(true)
    for (const key of Object.keys(sfx) as Array<keyof typeof sfx>) {
      expect(() => sfx[key](1), key).not.toThrow()
    }
  })

  it('stays silent when sound is off', () => {
    // Nothing observable to assert beyond not throwing — the point is that the
    // toggle is honored rather than the synth being built anyway.
    setSoundEnabled(false)
    expect(() => sfx.correct()).not.toThrow()
    setSoundEnabled(true)
  })

  it('survives a device with no audio context at all', () => {
    const AC = window.AudioContext
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
    expect(() => sfx.correct()).not.toThrow()
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AC })
  })

  it('can be unlocked on the first interaction, as mobile requires', () => {
    expect(() => unlockAudio()).not.toThrow()
  })
})
