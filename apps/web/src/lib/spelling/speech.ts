// Text to speech for dictation. Uses the browser's built-in speech synthesis so
// there are no audio files to ship and no API to pay for.
//
// Not every browser has a usable voice (older Android, some Linux builds), so
// `isSpeechAvailable()` lets the UI fall back to briefly flashing the word
// instead of dictating it. The activity stays playable either way.
//
// The chosen voice is the one setting that stays on this device, on purpose.
// A voice is identified by a URI the browser makes up from what is installed,
// and the same URI does not exist on another device, or even in another
// browser on this one. Saving it to the learner would hand the iPad a name
// the laptop cannot find. Everything else a learner can set follows them
// (lib/learners/useLearnerSettings.ts).

const VOICE_KEY = 'cat-academy:voice:v1'

let cachedVoice: SpeechSynthesisVoice | null = null
let primed = false

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  return window.speechSynthesis ?? null
}

/**
 * A browser can expose speechSynthesis and still have no voice installed —
 * headless Chrome and some Linux desktops do exactly that, and calling speak()
 * there silently does nothing. Both halves have to be true before the app
 * trusts dictation.
 */
export function isSpeechAvailable(): boolean {
  const s = synth()
  if (!s || typeof window.SpeechSynthesisUtterance !== 'function') return false
  return s.getVoices().length > 0
}

/**
 * Voices arrive asynchronously in most browsers. Calls back once they are
 * loaded, or after a short grace period with whatever the answer is by then.
 * Returns a cleanup function.
 */
export function whenVoicesReady(callback: (available: boolean) => void): () => void {
  const s = synth()
  if (!s || typeof window.SpeechSynthesisUtterance !== 'function') {
    callback(false)
    return () => {}
  }
  if (s.getVoices().length > 0) {
    callback(true)
    return () => {}
  }

  let settled = false
  const finish = (available: boolean) => {
    if (settled) return
    settled = true
    callback(available)
  }
  const onChange = () => finish(s.getVoices().length > 0)
  s.addEventListener('voiceschanged', onChange)
  const timer = setTimeout(() => finish(s.getVoices().length > 0), 1500)

  return () => {
    clearTimeout(timer)
    s.removeEventListener('voiceschanged', onChange)
  }
}

// Voice quality varies wildly by device, and the browser gives us nothing but a
// name to judge it on. These lists encode what those names mean in practice.

/** Novelty and robot voices. Fine for jokes, useless for dictation. */
const NOVELTY = [
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News',
  'Jester', 'Junior', 'Kathy', 'Organ', 'Fred', 'Ralph', 'Superstar', 'Trinoids',
  'Whisper', 'Wobble', 'Zarvox', 'Grandma', 'Grandpa', 'Eddy', 'Flo', 'Reed',
  'Rocko', 'Sandy', 'Shelley',
]

/**
 * Neural voices, best first. Apple ships the Siri voices (Nicky, Aaron, and the
 * regional Arthur/Martha/Catherine/Gordon) to Safari and Chrome under plain
 * first names with nothing marking them as higher quality — but they sound
 * enormously better than Samantha, which is the 2010-era compact voice that
 * every macOS browser reports as the default. Edge exposes Microsoft's neural
 * voices with "Natural" in the name; Chrome's "Google" voices are cloud-backed
 * and also well ahead of the local default.
 */
const PREFERRED = [
  'Microsoft Ava', 'Microsoft Emma', 'Microsoft Andrew', 'Microsoft Aria',
  'Ava (Premium)', 'Ava (Enhanced)', 'Zoe (Premium)', 'Zoe (Enhanced)',
  'Allison (Premium)', 'Allison (Enhanced)', 'Samantha (Enhanced)',
  'Nicky', 'Aaron', 'Arthur', 'Martha', 'Catherine', 'Gordon',
  'Google US English', 'Google UK English Female', 'Google UK English Male',
  'Ava', 'Allison', 'Susan', 'Zoe', 'Evan', 'Nathan',
  'Samantha', 'Karen', 'Moira', 'Tessa', 'Daniel',
]

function isNovelty(v: SpeechSynthesisVoice): boolean {
  return NOVELTY.some((n) => v.name === n || v.name.startsWith(`${n} (`))
}

/** Higher is better. Used for both the automatic pick and the picker's order. */
function score(v: SpeechSynthesisVoice): number {
  const name = v.name
  if (isNovelty(v)) return -100
  let s = 0
  // Explicit quality markers, wherever a platform bothers to provide them.
  if (/natural|neural/i.test(name)) s += 60
  if (/premium/i.test(name)) s += 50
  if (/enhanced/i.test(name)) s += 40
  const rank = PREFERRED.findIndex((n) => name === n || name.startsWith(`${n} `) || name.includes(n))
  if (rank >= 0) s += 100 - rank
  const lang = v.lang?.toLowerCase() ?? ''
  if (lang.startsWith('en-us')) s += 8
  else if (lang.startsWith('en')) s += 4
  return s
}

/**
 * Every English voice worth offering, best first. This is what the voice picker
 * shows, so novelty voices are dropped rather than merely ranked last.
 */
export function listVoices(): SpeechSynthesisVoice[] {
  const s = synth()
  if (!s) return []
  const voices = s.getVoices()
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const pool = english.length ? english : voices
  return pool.filter((v) => !isNovelty(v)).sort((a, b) => score(b) - score(a))
}

/** The learner's saved choice, if they made one and the device still has it. */
export function savedVoiceURI(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

/**
 * Remember a voice, or pass null to go back to picking automatically. Takes
 * effect on the next utterance.
 */
export function setVoice(uri: string | null): void {
  try {
    if (uri) localStorage.setItem(VOICE_KEY, uri)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    // Private browsing with storage denied: the choice just will not persist.
  }
  cachedVoice = pickVoice()
}

/** The saved voice if it is still installed, otherwise the best one available. */
function pickVoice(): SpeechSynthesisVoice | null {
  const ranked = listVoices()
  if (ranked.length === 0) return null
  const saved = savedVoiceURI()
  if (saved) {
    const match = ranked.find((v) => v.voiceURI === saved)
    if (match) return match
  }
  return ranked[0]
}

/** The voice dictation will actually use right now. */
export function currentVoice(): SpeechSynthesisVoice | null {
  return cachedVoice ?? pickVoice()
}

/** Voices load asynchronously in most browsers; warm them up on first use. */
export function primeVoices(): void {
  const s = synth()
  if (!s || primed) return
  primed = true
  cachedVoice = pickVoice()
  s.addEventListener('voiceschanged', () => {
    cachedVoice = pickVoice()
  })
}

export interface SpeakOptions {
  rate?: number
  pitch?: number
  onEnd?: () => void
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  const s = synth()
  if (!s) {
    opts.onEnd?.()
    return
  }
  s.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = currentVoice()
  utterance.lang = utterance.voice?.lang ?? 'en-US'
  // Slower than conversational — this is dictation for a child.
  utterance.rate = opts.rate ?? 0.85
  utterance.pitch = opts.pitch ?? 1
  utterance.onend = () => opts.onEnd?.()
  utterance.onerror = () => opts.onEnd?.()
  s.speak(utterance)
}

/**
 * The standard spelling-bee cadence: the word, a pause, the word in a
 * sentence, a pause, then the word again.
 */
export function dictate(word: string, sentence: string, onEnd?: () => void): void {
  speak(word, {
    onEnd: () => speak(sentence, { onEnd: () => speak(word, { rate: 0.75, onEnd }) }),
  })
}

export function stopSpeaking(): void {
  synth()?.cancel()
}
