// Who is calling?
//
// Supabase Auth still runs in the browser — it handles the OAuth dance, the
// PKCE flow and token refresh better than anything worth reimplementing. What
// changes with the API gateway is that its access token now travels to us as a
// bearer token instead of straight to PostgREST.
//
// Two signing schemes are in the wild: older projects sign HS256 with the
// project's JWT secret, newer ones sign asymmetrically and publish a JWKS. Both
// are supported so this does not become a deployment puzzle.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from './env.js'
import { unauthorized } from './errors.js'

export interface Caller {
  id: string
  email: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: Caller
  }
}

const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`

const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

const hmacKey = env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
  : null

async function verify(token: string): Promise<JWTPayload> {
  // A configured secret is the project telling us which scheme it signs with,
  // so try that first: it is local, it fails in microseconds, and it saves a
  // network round trip to the JWKS on every request.
  if (hmacKey) {
    try {
      const { payload } = await jwtVerify(token, hmacKey, { issuer, audience: 'authenticated' })
      return payload
    } catch {
      /* fall through to the asymmetric path */
    }
  }
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' })
  return payload
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return token
}

/**
 * Populate `request.caller`, or reject. Registered per-route rather than
 * globally so that adding an unauthenticated endpoint is a deliberate act.
 */
export async function requireCaller(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Already established by an earlier hook — verifying the same token twice
  // buys nothing. This is what lets a scope authenticate early (so a rate
  // limiter can key on the caller) without the routes inside it paying for it.
  if (request.caller) return

  const token = bearer(request)
  if (!token) throw unauthorized('This endpoint needs a signed-in user')

  let payload: JWTPayload
  try {
    payload = await verify(token)
  } catch (err) {
    request.log.debug({ err }, 'token verification failed')
    throw unauthorized('That session is not valid any more')
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw unauthorized('That token carries no subject')
  }

  request.caller = {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  }
}

/** The caller, or a 401. Never returns undefined, so routes can stay flat. */
export function callerOf(request: FastifyRequest): Caller {
  if (!request.caller) throw unauthorized()
  return request.caller
}
