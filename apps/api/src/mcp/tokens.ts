// Tokens for the API's own OAuth server.
//
// Assistants never hold a Supabase token. They hold one of these: signed under
// a secret that signs nothing else, bound to the `/mcp` URL as its audience
// (RFC 8707), carrying the grant it belongs to so a revoked grant can be
// refused on the next call rather than at the hour mark. Refresh tokens are
// opaque and stored hashed; only the access token is a JWT, because only the
// access token has to be verified without a database round trip.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { jwtVerify, SignJWT, type JWTPayload } from 'jose'
import { env } from '../env.js'
import { badRequest } from '../errors.js'

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
export const AUTH_CODE_TTL_SECONDS = 10 * 60
export const PENDING_REQUEST_TTL_SECONDS = 10 * 60

export const MCP_SCOPES = ['tutor', 'read'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * Whether connected apps are on. The secret alone is not enough in
 * production: without a real public origin the endpoint would advertise
 * `http://localhost` as its issuer, and nothing downstream would refuse it.
 */
export function mcpConfigured(): boolean {
  if (!env.MCP_TOKEN_SECRET) return false
  if (env.NODE_ENV === 'production' && !env.APP_URL && !env.MCP_PUBLIC_URL) return false
  return true
}

/** Why `mcpConfigured()` is false, for the boot log. Null when it is true. */
export function mcpUnconfiguredReason(): string | null {
  if (!env.MCP_TOKEN_SECRET) return 'MCP_TOKEN_SECRET is not set'
  if (env.NODE_ENV === 'production' && !env.APP_URL && !env.MCP_PUBLIC_URL) {
    return 'APP_URL (or MCP_PUBLIC_URL) is not set; refusing to advertise a localhost issuer in production'
  }
  return null
}

function secret(): Uint8Array {
  if (!env.MCP_TOKEN_SECRET) {
    throw badRequest('Connected apps are not switched on in this build.', 'mcp_unconfigured')
  }
  return new TextEncoder().encode(env.MCP_TOKEN_SECRET)
}

/** Where the app lives, for the issuer and the consent redirect. */
export function appUrl(): string {
  const base = env.APP_URL || (env.MCP_PUBLIC_URL ? new URL(env.MCP_PUBLIC_URL).origin : '')
  return (base || `http://localhost:${env.PORT}`).replace(/\/$/, '')
}

/**
 * The canonical URL of the MCP endpoint — the resource every token is issued
 * for and the only audience the endpoint accepts. Without a trailing slash,
 * as the spec recommends.
 */
export function canonicalMcpUrl(): string {
  return (env.MCP_PUBLIC_URL ?? `${appUrl()}/mcp`).replace(/\/$/, '')
}

/** The authorization server's issuer identifier: the app's origin. */
export function issuer(): string {
  return appUrl()
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** PKCE S256: base64url(sha256(verifier)), no padding. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function opaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function newId(): string {
  return randomUUID()
}

// --- Access tokens ---------------------------------------------------------------

export interface AccessClaims {
  userId: string
  grantId: string
  scope: string
}

export async function mintAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ grant: claims.grantId, scope: claims.scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .setSubject(claims.userId)
    .setIssuer(issuer())
    .setAudience(canonicalMcpUrl())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret())
}

/**
 * Verify an access token. Audience is checked as strictly as the spec asks:
 * a token minted for any other resource — including this API's own routes,
 * which mint none — is refused.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: issuer(),
      audience: canonicalMcpUrl(),
    })
    if (typeof payload.sub !== 'string' || typeof payload.grant !== 'string') return null
    return {
      userId: payload.sub,
      grantId: payload.grant,
      scope: typeof payload.scope === 'string' ? payload.scope : 'tutor',
    }
  } catch {
    return null
  }
}

// --- The pending authorization request ------------------------------------------------

/**
 * What `/api/oauth/authorize` validated, carried to the consent screen and back
 * as a signed, short-lived token rather than a table row. Nothing in it is
 * secret; what matters is that the consent screen cannot alter it.
 */
export interface PendingRequest {
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  resource: string
  scope: string
}

export async function mintPendingRequest(pending: PendingRequest): Promise<string> {
  return new SignJWT({ ...pending })
    .setProtectedHeader({ alg: 'HS256', typ: 'authz+jwt' })
    .setIssuer(issuer())
    .setAudience(`${issuer()}/connect`)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_REQUEST_TTL_SECONDS}s`)
    .sign(secret())
}

export async function verifyPendingRequest(token: string): Promise<PendingRequest | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: issuer(),
      audience: `${issuer()}/connect`,
    })
    const p = payload as JWTPayload & Partial<PendingRequest>
    if (!p.clientId || !p.redirectUri || !p.codeChallenge || !p.resource) return null
    return {
      clientId: p.clientId,
      clientName: p.clientName ?? p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      state: p.state ?? null,
      resource: p.resource,
      scope: p.scope ?? 'tutor',
    }
  } catch {
    return null
  }
}

/**
 * Which assistant a client is, from what it calls itself. For the Family line
 * and for the one question data should answer — which one families use.
 */
export function clientLabel(name: string): 'claude' | 'chatgpt' | 'other' {
  const n = name.toLowerCase()
  if (/claude|anthropic/.test(n)) return 'claude'
  if (/chatgpt|openai/.test(n)) return 'chatgpt'
  return 'other'
}
