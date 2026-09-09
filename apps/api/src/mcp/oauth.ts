// The API's own OAuth 2.1 authorization server, for assistants.
//
// Five endpoints and two well-known documents (docs/mcp-tutor-spec.md). It
// exists because the MCP endpoint is a resource server and the app's identity
// provider issues tokens for the app: an assistant needs a token for `/mcp`
// and nothing else, minted after a grown-up has said, on a screen of ours,
// which children it may work with.
//
// What it implements, and why each piece is there:
//
//   * Protected resource metadata (RFC 9728) — how a client finds us from a 401.
//   * Authorization server metadata (RFC 8414) — how it finds the endpoints.
//   * Client ID Metadata Documents and dynamic registration (RFC 7591) — how a
//     client we have never met gets an id. DCR is deprecated in the current
//     MCP revision and still what both assistants send today, so both.
//   * PKCE, S256 only; resource indicators (RFC 8707); `iss` on the redirect
//     (RFC 9207); refresh rotation with family revocation on reuse.
//
// The consent screen is the web app's. This module only validates the request
// on the way in, and mints the code on the way out.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withAdmin, withUser } from '../db.js'
import { badRequest } from '../errors.js'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  appUrl,
  AUTH_CODE_TTL_SECONDS,
  canonicalMcpUrl,
  clientLabel,
  issuer,
  MCP_SCOPES,
  mcpConfigured,
  mintAccessToken,
  mintPendingRequest,
  newId,
  opaqueToken,
  pkceChallenge,
  REFRESH_TOKEN_TTL_SECONDS,
  sha256,
  verifyPendingRequest,
} from './tokens.js'

const CIMD_FETCH_TIMEOUT_MS = 5000

/** Redirect URIs must be HTTPS, or loopback for a developer's own client. */
function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
    return false
  } catch {
    return false
  }
}

function oauthError(reply: FastifyReply, status: number, error: string, description: string) {
  reply.code(status).send({ error, error_description: description })
  return reply
}

interface ClientRow {
  id: string
  kind: 'dcr' | 'cimd'
  name: string
  redirect_uris: string[]
}

/**
 * A client whose id is an HTTPS URL is describing itself: fetch the document,
 * check it agrees about who it is, and remember it. Cached by the row; the
 * document is re-read when a redirect it did not list turns up, which is the
 * one way the cache can be stale in a way that matters.
 */
async function resolveCimdClient(clientId: string, redirectUri: string): Promise<ClientRow | null> {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.pathname === '/' || url.hash) return null

  const cached = await withAdmin(async (db) => {
    const { rows } = await db.query('select * from public.mcp_clients where id = $1', [clientId])
    return (rows[0] as ClientRow | undefined) ?? null
  })
  if (cached && cached.redirect_uris.includes(redirectUri)) return cached

  let doc: { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown }
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      redirect: 'error',
    })
    if (!response.ok) return null
    doc = (await response.json()) as typeof doc
  } catch {
    return null
  }

  if (doc.client_id !== clientId) return null
  if (!Array.isArray(doc.redirect_uris) || !doc.redirect_uris.every((u) => typeof u === 'string')) return null
  const redirects = (doc.redirect_uris as string[]).filter(redirectAllowed)
  if (!redirects.includes(redirectUri)) return null
  const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim() : url.hostname

  return withAdmin(async (db) => {
    const { rows } = await db.query(
      `insert into public.mcp_clients (id, kind, name, redirect_uris, metadata, last_seen_at)
       values ($1, 'cimd', $2, $3, $4, now())
       on conflict (id) do update set
         name = excluded.name, redirect_uris = excluded.redirect_uris,
         metadata = excluded.metadata, last_seen_at = now()
       returning *`,
      [clientId, name.slice(0, 120), redirects, JSON.stringify(doc)],
    )
    return rows[0] as ClientRow
  })
}

async function resolveDcrClient(clientId: string): Promise<ClientRow | null> {
  return withAdmin(async (db) => {
    const { rows } = await db.query(
      `update public.mcp_clients set last_seen_at = now() where id = $1 returning *`,
      [clientId],
    )
    return (rows[0] as ClientRow | undefined) ?? null
  })
}

const registerSchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  application_type: z.string().optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  scope: z.string().optional(),
})

const authorizeQuerySchema = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string().optional(),
  state: z.string().max(1000).optional(),
  resource: z.string().url().optional(),
  scope: z.string().max(200).optional(),
})

const decisionSchema = z.object({
  req: z.string().min(1),
  approve: z.boolean(),
  learnerIds: z.array(z.string().uuid()).max(50).default([]),
})

interface IssuedGrant {
  grant: { id: string; user_id: string; scope: string }
  refresh: string
}
type Issued = IssuedGrant | { error: string; description: string }

const tokenSchema = z.object({
  grant_type: z.string(),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  client_id: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  resource: z.string().optional(),
})

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  // The token endpoint is form-encoded by specification, and Fastify does not
  // parse that on its own. Scoped to this plugin: nothing else here wants it.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : '')))
    },
  )

  // --- Discovery ---------------------------------------------------------------------

  const resourceMetadata = () => ({
    resource: canonicalMcpUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Whizzo',
    resource_documentation: `${appUrl()}/faq`,
  })

  app.get('/.well-known/oauth-protected-resource', async () => resourceMetadata())
  // RFC 9728 §3.1: a resource with a path may be described at the path-suffixed
  // location too, and some clients look there first.
  app.get('/.well-known/oauth-protected-resource/mcp', async () => resourceMetadata())

  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: issuer(),
    authorization_endpoint: `${issuer()}/api/oauth/authorize`,
    token_endpoint: `${issuer()}/api/oauth/token`,
    registration_endpoint: `${issuer()}/api/oauth/register`,
    revocation_endpoint: `${issuer()}/api/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${appUrl()}/faq`,
  }))

  // --- Registration ------------------------------------------------------------------

  app.post('/api/oauth/register', async (request, reply) => {
    if (!mcpConfigured()) return oauthError(reply, 503, 'temporarily_unavailable', 'Connected apps are not switched on in this build.')
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return oauthError(reply, 400, 'invalid_client_metadata', parsed.error.issues[0]?.message ?? 'Invalid registration')
    }
    const body = parsed.data
    const redirects = body.redirect_uris.filter(redirectAllowed)
    if (!redirects.length) {
      return oauthError(reply, 400, 'invalid_redirect_uri', 'Redirect URIs must use HTTPS, or loopback for local clients.')
    }
    const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token']
    if (grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      return oauthError(reply, 400, 'invalid_client_metadata', 'Only authorization_code and refresh_token are supported.')
    }

    const id = newId()
    const name = (body.client_name ?? 'An assistant').slice(0, 120)
    await withAdmin(async (db) => {
      await db.query(
        `insert into public.mcp_clients (id, kind, name, redirect_uris, metadata, last_seen_at)
         values ($1, 'dcr', $2, $3, $4, now())`,
        [id, name, redirects, JSON.stringify(body)],
      )
    })

    reply.code(201)
    return {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirects,
      grant_types: grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(body.application_type ? { application_type: body.application_type } : {}),
    }
  })

  // --- Authorize: validate, then hand off to the consent screen ----------------------------

  app.get('/api/oauth/authorize', async (request, reply) => {
    if (!mcpConfigured()) return oauthError(reply, 503, 'temporarily_unavailable', 'Connected apps are not switched on in this build.')
    const parsed = authorizeQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return oauthError(reply, 400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid authorization request')
    }
    const q = parsed.data

    // Nothing is redirected until the client and its redirect URI are known to
    // belong together: an open redirect is the one OAuth mistake worth a 400.
    const client = q.client_id.startsWith('https://')
      ? await resolveCimdClient(q.client_id, q.redirect_uri)
      : await resolveDcrClient(q.client_id)
    if (!client) return oauthError(reply, 400, 'invalid_client', 'Unknown client.')
    if (!client.redirect_uris.includes(q.redirect_uri)) {
      return oauthError(reply, 400, 'invalid_request', 'That redirect URI is not registered for this client.')
    }

    const back = (error: string, description: string) => {
      const url = new URL(q.redirect_uri)
      url.searchParams.set('error', error)
      url.searchParams.set('error_description', description)
      if (q.state) url.searchParams.set('state', q.state)
      url.searchParams.set('iss', issuer())
      reply.redirect(url.toString(), 302)
      return reply
    }

    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.')
    if ((q.code_challenge_method ?? 'S256') !== 'S256') return back('invalid_request', 'Only the S256 code challenge method is supported.')
    const resource = (q.resource ?? canonicalMcpUrl()).replace(/\/$/, '')
    if (resource !== canonicalMcpUrl()) return back('invalid_target', `This authorization server issues tokens for ${canonicalMcpUrl()} only.`)
    const scopes = (q.scope ?? 'tutor').split(/\s+/).filter(Boolean)
    if (scopes.some((s) => !(MCP_SCOPES as readonly string[]).includes(s))) {
      return back('invalid_scope', `Supported scopes: ${MCP_SCOPES.join(' ')}.`)
    }

    const pending = await mintPendingRequest({
      clientId: client.id,
      clientName: client.name,
      redirectUri: q.redirect_uri,
      codeChallenge: q.code_challenge,
      state: q.state ?? null,
      resource,
      scope: scopes.join(' '),
    })
    const consent = new URL('/connect', `${appUrl()}/`)
    consent.searchParams.set('req', pending)
    reply.redirect(consent.toString(), 302)
    return reply
  })

  /**
   * A connection is approved by a grown-up, or by a learner old enough to
   * hold their own account. A child signed in with a code and PIN is neither:
   * that session exists so a child can practice, not so they can hand an
   * assistant a token in their own name that no parent's screen would show.
   */
  async function refuseChildSession(callerId: string): Promise<void> {
    const child = await withUser(callerId, async (db) => {
      const { rows } = await db.query(
        `select 1 from public.learners where auth_user_id = $1 and auth_kind = 'provisioned' limit 1`,
        [callerId],
      )
      return rows.length > 0
    })
    if (child) throw badRequest('A grown-up needs to sign in to connect an assistant.', 'grown_up_required')
  }

  /** What the consent screen shows, read back from the signed request. */
  app.get('/api/oauth/authorize/pending', { preHandler: requireCaller }, async (request) => {
    const { req } = z.object({ req: z.string().min(1) }).parse(request.query)
    await refuseChildSession(callerOf(request).id)
    const pending = await verifyPendingRequest(req)
    if (!pending) throw badRequest('That connection request has expired. Start again from the assistant.', 'expired_request')
    return {
      clientName: pending.clientName,
      clientLabel: clientLabel(pending.clientName),
      scope: pending.scope,
    }
  })

  app.post('/api/oauth/authorize/decision', { preHandler: requireCaller }, async (request) => {
    const caller = callerOf(request)
    const body = decisionSchema.parse(request.body)
    await refuseChildSession(caller.id)
    const pending = await verifyPendingRequest(body.req)
    if (!pending) throw badRequest('That connection request has expired. Start again from the assistant.', 'expired_request')

    const redirect = new URL(pending.redirectUri)
    if (pending.state) redirect.searchParams.set('state', pending.state)
    redirect.searchParams.set('iss', issuer())

    if (!body.approve || !body.learnerIds.length) {
      redirect.searchParams.set('error', 'access_denied')
      redirect.searchParams.set('error_description', 'The user declined.')
      return { redirect: redirect.toString() }
    }

    // Only learners this session can reach, as RLS defines reach. A learner id
    // the caller cannot see simply does not come back.
    const visible = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        'select id from public.learners where id = any($1::uuid[])',
        [body.learnerIds],
      )
      return rows.map((r: { id: string }) => r.id)
    })
    if (!visible.length) throw badRequest('None of those learners are yours to share.', 'no_learners')

    const code = opaqueToken()
    await withAdmin(async (db) => {
      const { rows } = await db.query(
        `insert into public.mcp_grants (user_id, client_id, client_label, learner_ids, current_learner_id, scope)
         values ($1, $2, $3, $4::uuid[], $5, $6)
         returning id`,
        [
          caller.id,
          pending.clientId,
          clientLabel(pending.clientName),
          visible,
          visible.length === 1 ? visible[0] : null,
          pending.scope,
        ],
      )
      const grantId = (rows[0] as { id: string }).id
      await db.query(
        `insert into public.mcp_auth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
        [sha256(code), grantId, pending.clientId, pending.redirectUri, pending.codeChallenge, pending.resource, String(AUTH_CODE_TTL_SECONDS)],
      )
    })

    redirect.searchParams.set('code', code)
    return { redirect: redirect.toString() }
  })

  // --- Token -----------------------------------------------------------------------------

  app.post('/api/oauth/token', async (request, reply) => {
    if (!mcpConfigured()) return oauthError(reply, 503, 'temporarily_unavailable', 'Connected apps are not switched on in this build.')
    reply.header('cache-control', 'no-store')
    const parsed = tokenSchema.safeParse(request.body ?? {})
    if (!parsed.success) return oauthError(reply, 400, 'invalid_request', 'Malformed token request.')
    const body = parsed.data

    if (body.resource && body.resource.replace(/\/$/, '') !== canonicalMcpUrl()) {
      return oauthError(reply, 400, 'invalid_target', `Tokens are issued for ${canonicalMcpUrl()} only.`)
    }

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier) return oauthError(reply, 400, 'invalid_request', 'code and code_verifier are required.')
      const issued = await withAdmin<Issued>(async (db) => {
        const { rows } = await db.query(
          `delete from public.mcp_auth_codes where code_hash = $1 returning *`,
          [sha256(body.code!)],
        )
        const row = rows[0] as
          | { grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_at: Date }
          | undefined
        if (!row) return { error: 'invalid_grant', description: 'Unknown or already used code.' }
        if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'invalid_grant', description: 'That code has expired.' }
        if (body.client_id && body.client_id !== row.client_id) return { error: 'invalid_grant', description: 'Wrong client for that code.' }
        if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) return { error: 'invalid_grant', description: 'Wrong redirect URI for that code.' }
        if (pkceChallenge(body.code_verifier!) !== row.code_challenge) return { error: 'invalid_grant', description: 'PKCE verification failed.' }

        const { rows: grants } = await db.query(
          `select id, user_id, scope from public.mcp_grants where id = $1 and revoked_at is null`,
          [row.grant_id],
        )
        const grant = grants[0] as { id: string; user_id: string; scope: string } | undefined
        if (!grant) return { error: 'invalid_grant', description: 'That connection was revoked.' }

        const refresh = opaqueToken()
        await db.query(
          `insert into public.mcp_refresh_tokens (token_hash, grant_id, family, expires_at)
           values ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
          [sha256(refresh), grant.id, newId(), String(REFRESH_TOKEN_TTL_SECONDS)],
        )
        await db.query('update public.mcp_grants set last_used_at = now() where id = $1', [grant.id])
        return { grant, refresh }
      })
      if ('error' in issued) return oauthError(reply, 400, issued.error, issued.description)
      return {
        access_token: await mintAccessToken({ userId: issued.grant.user_id, grantId: issued.grant.id, scope: issued.grant.scope }),
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: issued.refresh,
        scope: issued.grant.scope,
      }
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError(reply, 400, 'invalid_request', 'refresh_token is required.')
      const issued = await withAdmin<Issued>(async (db) => {
        const { rows } = await db.query(
          `select * from public.mcp_refresh_tokens where token_hash = $1`,
          [sha256(body.refresh_token!)],
        )
        const row = rows[0] as
          | { token_hash: string; grant_id: string; family: string; expires_at: Date; used_at: Date | null }
          | undefined
        if (!row) return { error: 'invalid_grant', description: 'Unknown refresh token.' }
        if (row.used_at) {
          // A spent token presented again means it leaked. Everything that
          // descended from it goes; the assistant reconnects.
          await db.query('delete from public.mcp_refresh_tokens where family = $1', [row.family])
          return { error: 'invalid_grant', description: 'That refresh token was already used; the connection must be re-authorised.' }
        }
        if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'invalid_grant', description: 'That refresh token has expired.' }

        const { rows: grants } = await db.query(
          `select id, user_id, scope from public.mcp_grants where id = $1 and revoked_at is null`,
          [row.grant_id],
        )
        const grant = grants[0] as { id: string; user_id: string; scope: string } | undefined
        if (!grant) return { error: 'invalid_grant', description: 'That connection was revoked.' }

        await db.query('update public.mcp_refresh_tokens set used_at = now() where token_hash = $1', [row.token_hash])
        const refresh = opaqueToken()
        await db.query(
          `insert into public.mcp_refresh_tokens (token_hash, grant_id, family, expires_at)
           values ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
          [sha256(refresh), grant.id, row.family, String(REFRESH_TOKEN_TTL_SECONDS)],
        )
        await db.query('update public.mcp_grants set last_used_at = now() where id = $1', [grant.id])
        return { grant, refresh }
      })
      if ('error' in issued) return oauthError(reply, 400, issued.error, issued.description)
      return {
        access_token: await mintAccessToken({ userId: issued.grant.user_id, grantId: issued.grant.id, scope: issued.grant.scope }),
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: issued.refresh,
        scope: issued.grant.scope,
      }
    }

    return oauthError(reply, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.')
  })

  // --- Revoke (RFC 7009) ------------------------------------------------------------------

  app.post('/api/oauth/revoke', async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).safeParse(request.body ?? {})
    // The RFC says 200 whatever happens: a revoke of an unknown token is a
    // revoke that has already taken effect.
    if (body.success) {
      await withAdmin(async (db) => {
        await db.query(
          `delete from public.mcp_refresh_tokens
            where family = (select family from public.mcp_refresh_tokens where token_hash = $1)`,
          [sha256(body.data.token)],
        )
      })
    }
    reply.code(200)
    return {}
  })
}
