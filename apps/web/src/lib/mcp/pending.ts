// The assistant's consent request, kept across a sign-in round trip.
//
// Google and magic-link sign-in come back to "/" without the query string
// that carried the request, so the signed-out door puts it aside here and the
// app picks it up once the session exists. Session-scoped on purpose: a
// request outlives one tab, never a browser.

const KEY = 'whizzo:pending-connect'

export function readPendingConnect(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function keepPendingConnect(req: string): void {
  try {
    sessionStorage.setItem(KEY, req)
  } catch {
    /* the password path still works: the address keeps the request */
  }
}

export function clearPendingConnect(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nothing kept, nothing to clear */
  }
}
