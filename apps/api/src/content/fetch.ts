// Fetching a URL somebody pasted.
//
// The server fetching an arbitrary URL is server-side request forgery unless it
// is fenced, and the upload button here is aimed at whatever a stranger emailed
// a parent. The fence is not advisory.
//
// The check that matters most is the one people leave out: **resolving DNS and
// inspecting the address, before connecting and again after every redirect.**
// A hostname allowlist alone is defeated by a public name that resolves to
// 169.254.169.254, and by a redirect from a permitted host to a private one.

import { lookup } from 'node:dns/promises'

export const MAX_BYTES = 25 * 1024 * 1024
export const TIMEOUT_MS = 30_000
export const MAX_REDIRECTS = 3

/** Google's export endpoints, which return the file directly when it is shared. */
const GOOGLE_HOSTS = new Set(['docs.google.com', 'drive.google.com'])

export type FetchRefusal =
  | { ok: false; code: 'scheme'; message: string }
  | { ok: false; code: 'private-address'; message: string }
  | { ok: false; code: 'too-many-redirects'; message: string }
  | { ok: false; code: 'needs-sign-in'; message: string }
  | { ok: false; code: 'too-large'; message: string }
  | { ok: false; code: 'unreachable'; message: string }

/**
 * Whether an IP address is one the server must never be talked into reaching.
 *
 * Loopback, private ranges, link-local — and the last of those is the one that
 * matters: 169.254.169.254 is the cloud metadata endpoint, and reaching it is
 * how a fetcher becomes a credential leak.
 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const v6 = address.toLowerCase()
    if (v6 === '::1' || v6 === '::') return true
    // Unique-local and link-local.
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true
    // IPv4-mapped: ::ffff:10.0.0.1 must be judged as the IPv4 address it is.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return false
  }

  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts as [number, number, number, number]

  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast and reserved
  return false
}

/** Whether a URL is one we will even consider fetching. */
export function screenUrl(raw: string): { ok: true; url: URL } | FetchRefusal {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, code: 'scheme', message: 'That does not look like a link.' }
  }

  if (url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'scheme',
      message: 'Links have to start with https:// — paste the file instead if you cannot get one.',
    }
  }
  return { ok: true, url }
}

/** A Google Doc, Slides or Sheet turned into a direct export link. */
export function googleExportUrl(url: URL): URL | null {
  if (!GOOGLE_HOSTS.has(url.hostname)) return null
  const doc = /\/document\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)
  if (doc) return new URL(`https://docs.google.com/document/d/${doc[1]}/export?format=pdf`)
  const slides = /\/presentation\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)
  if (slides) return new URL(`https://docs.google.com/presentation/d/${slides[1]}/export/pdf`)
  const sheet = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)
  if (sheet) return new URL(`https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv`)
  return null
}

export interface Resolver {
  (hostname: string): Promise<string[]>
}

const realResolver: Resolver = async (hostname) => {
  const results = await lookup(hostname, { all: true })
  return results.map((r) => r.address)
}

/**
 * Check where a hostname actually points.
 *
 * Every address it resolves to has to be public, not just the first — a name
 * that returns both a public and a private address would otherwise pass and
 * then connect to whichever the OS picked.
 */
export async function assertPublicHost(
  hostname: string,
  resolve: Resolver = realResolver,
): Promise<FetchRefusal | null> {
  let addresses: string[]
  try {
    addresses = await resolve(hostname)
  } catch {
    return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
  }
  if (!addresses.length) {
    return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
  }
  if (addresses.some(isPrivateAddress)) {
    return {
      ok: false,
      code: 'private-address',
      message: 'That link points somewhere we will not fetch from.',
    }
  }
  return null
}

/**
 * Whether a response is the sign-in page a private Google Doc redirects to.
 *
 * Worth detecting rather than letting through: the alternative is a "document"
 * that is really a login form, silently turned into forty cards about signing
 * in to Google.
 */
export function looksLikeSignIn(finalUrl: URL, contentType: string): boolean {
  if (finalUrl.hostname === 'accounts.google.com') return true
  return contentType.startsWith('text/html') && GOOGLE_HOSTS.has(finalUrl.hostname)
}

export const SIGN_IN_MESSAGE =
  'That document is private. Either change sharing to "anyone with the link", or download it and upload the file.'

export interface Fetched {
  bytes: Buffer
  /** The content type the server actually sent, without its parameters. */
  mime: string
  finalUrl: URL
}

/**
 * Actually go and get it.
 *
 * Redirects are followed by hand rather than left to `fetch`, and that is the
 * whole reason this function exists: **every hop is re-checked against DNS
 * before we connect to it.** `redirect: 'follow'` would resolve and connect to
 * each new host inside undici, where no check of ours runs — so a permitted
 * public host redirecting to 169.254.169.254 would be fetched, and the fence in
 * this file would be decorative.
 *
 * The body is read in chunks against a running total rather than trusted to
 * `content-length`, for the same reason: a header is a claim by the server, and
 * a server that wants to hand us four gigabytes will happily claim otherwise.
 */
export async function fetchSource(
  start: URL,
  deps: { resolve?: Resolver; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; fetched: Fetched } | FetchRefusal> {
  const resolve = deps.resolve ?? realResolver
  const doFetch = deps.fetchImpl ?? fetch
  let url = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const unsafe = await assertPublicHost(url.hostname, resolve)
    if (unsafe) return unsafe

    let response: Response
    try {
      response = await doFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: '*/*' },
      })
    } catch {
      return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
      }
      try {
        url = new URL(location, url)
      } catch {
        return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
      }
      continue
    }

    const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()

    // A private Google Doc does not fail — it serves a sign-in page with a
    // perfectly good 200. Turning that into forty cards about signing in to
    // Google is the failure this catches.
    if (looksLikeSignIn(url, mime)) {
      return { ok: false, code: 'needs-sign-in', message: SIGN_IN_MESSAGE }
    }

    if (!response.ok || !response.body) {
      return { ok: false, code: 'unreachable', message: 'We could not reach that link.' }
    }

    const chunks: Buffer[] = []
    let total = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {})
          const mb = Math.round(MAX_BYTES / 1024 / 1024)
          return {
            ok: false,
            code: 'too-large',
            message: `That document is bigger than ${mb}MB. Split it and share the part you need.`,
          }
        }
        chunks.push(Buffer.from(value))
      }
    } catch {
      return { ok: false, code: 'unreachable', message: 'That download stopped part way through.' }
    }

    return { ok: true, fetched: { bytes: Buffer.concat(chunks), mime, finalUrl: url } }
  }

  return {
    ok: false,
    code: 'too-many-redirects',
    message: 'That link redirects too many times to follow.',
  }
}
