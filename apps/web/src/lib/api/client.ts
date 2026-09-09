// The one place the browser talks to the API.
//
// Since the gateway landed, the anon key is only used for *auth* — signing in,
// refreshing, the OAuth dance. Data never goes to Supabase directly any more,
// which is why there is no table name anywhere in this file.
//
// Requests are same-origin in production (the SPA and the API are two
// components of one DigitalOcean app), and proxied there by Vite in
// development, so the base path is just `/api` in both.

import { ORIGIN_HEADER, type ErrorResponse } from '@whizzo/shared'
import { supabase } from '../supabase'

const BASE = '/api'

/**
 * This tab, for the lifetime of this tab.
 *
 * Every mutating request carries it, and the live channel echoes it back on
 * the event the write produced — which is how a tab recognizes the echo of its
 * own optimistic change and ignores it. Two tabs of the same person get
 * different ids and therefore *do* see each other, which is what you want.
 */
export const ORIGIN_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** True when the caller simply cannot see this — usually a stale learner id. */
  get isMissing(): boolean {
    return this.status === 404
  }

  get isAuth(): boolean {
    return this.status === 401
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Skip the Authorization header, for the one endpoint with no session yet. */
  anonymous?: boolean
  signal?: AbortSignal
}

export async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {}
  // getSession refreshes an expired token on the way through, so this is also
  // what keeps a long practice session from dying mid-round.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = options

  // FormData carries its own content type, including a boundary the browser
  // generates. Setting the header ourselves would overwrite the boundary and
  // the server would see one unparseable part.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData

  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json'
  // Only on writes: a GET produces no event for anyone to filter.
  if (method !== 'GET') headers[ORIGIN_HEADER] = ORIGIN_ID
  if (!anonymous) Object.assign(headers, await authHeader())

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    // A dropped connection is not a server error, and the message a child sees
    // should not say 500.
    throw new ApiError(0, 'Could not reach the server', 'offline')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError(response.status, 'The server sent something unreadable', 'bad_response')
    }
  }

  if (!response.ok) {
    const error = (payload as ErrorResponse | null)?.error
    throw new ApiError(
      response.status,
      error?.message ?? `Request failed (${response.status})`,
      error?.code ?? 'error',
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  upload: <T>(path: string, form: FormData) => apiRequest<T>(path, { method: 'POST', body: form }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}
