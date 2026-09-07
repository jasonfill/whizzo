// The connected-apps surface: the OAuth server an assistant talks to, and the
// MCP endpoint it then calls.
//
// What is worth pinning is the part that keeps a token honest: nothing is
// redirected until the client and redirect URI belong together, a code is
// spent on first use, PKCE is checked, a reused refresh token kills its
// family, a revoked grant is refused on the next call, and the tool list is
// the same list in the same order every time.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)
const withAdmin = vi.hoisted(() => vi.fn(async (fn: (db: unknown) => Promise<unknown>) => fn({ query })))

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  withAdmin: (...a: Parameters<typeof withAdmin>) => withAdmin(...a),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    MCP_TOKEN_SECRET: 'an-mcp-secret-that-is-at-least-thirty-two-characters',
    APP_URL: 'https://whizzo.test',
    WEB_ORIGINS: '',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false, webOrigins: [] }))

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const LEARNER = '11111111-2222-4333-8444-555555555555'
const LEARNER2 = '11111111-2222-4333-8444-666666666666'
const GRANT = '22222222-3333-4444-8555-666666666666'
const CLIENT = '33333333-4444-4555-8666-777777777777'
const SECRET = new TextEncoder().encode('a-test-secret-long-enough-for-hs256-signing')

async function auth() {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(CALLER)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET)
  return { authorization: `Bearer ${token}` }
}

async function buildApp() {
  const Fastify = (await import('fastify')).default
  const { oauthRoutes } = await import('./oauth.js')
  const { mcpRoutes } = await import('./server.js')
  const { HttpError, fromValidationError } = await import('../errors.js')
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message } })
      return
    }
    const invalid = fromValidationError(error)
    if (invalid) {
      reply.code(invalid.status).send({ error: { code: invalid.code, message: invalid.message } })
      return
    }
    const s = error as unknown as { statusCode?: number }
    reply.code(s.statusCode && s.statusCode < 500 ? s.statusCode : 500).send({ error: { code: 'error', message: (error as Error).message } })
  })
  await app.register(oauthRoutes)
  await app.register(mcpRoutes)
  await app.ready()
  return app
}

/** Route each SQL statement to canned rows by a substring of it. */
function respond(routes: Array<[string, unknown[] | ((params: unknown[]) => unknown[])]>) {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    for (const [needle, rows] of routes) {
      if (sql.includes(needle)) {
        const out = typeof rows === 'function' ? rows(params) : rows
        return { rows: out, rowCount: out.length }
      }
    }
    return { rows: [], rowCount: 0 }
  })
}

const clientRow = { id: CLIENT, kind: 'dcr', name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
const grantRow = {
  id: GRANT,
  user_id: CALLER,
  client_id: CLIENT,
  client_label: 'claude',
  learner_ids: [LEARNER],
  current_learner_id: LEARNER,
  scope: 'tutor',
}
const learnerRow = (id: string, name: string) => ({
  id,
  owner_id: CALLER,
  display_name: name,
  avatar_emoji: '🐱',
  grade_hint: 4,
  birth_year: null,
  auth_kind: 'none',
  auth_user_id: null,
  created_at: new Date().toISOString(),
  theme: null,
  covered: false,
})

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  withUser.mockClear()
  withAdmin.mockClear()
  envMock.MCP_TOKEN_SECRET = 'an-mcp-secret-that-is-at-least-thirty-two-characters'
})

describe('discovery', () => {
  it('names the MCP URL as the resource and this API as its authorization server', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      resource: 'https://whizzo.test/mcp',
      authorization_servers: ['https://whizzo.test'],
    })
  })

  it('offers S256 only, and client id metadata documents', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
    expect(res.json()).toMatchObject({
      issuer: 'https://whizzo.test',
      token_endpoint: 'https://whizzo.test/api/oauth/token',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    })
  })
})

describe('registration', () => {
  it('registers a client with an HTTPS redirect', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/register',
      payload: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none' })
    expect(typeof res.json().client_id).toBe('string')
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into public.mcp_clients'))).toBe(true)
  })

  it('refuses a plain-http redirect that is not loopback', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/register',
      payload: { redirect_uris: ['http://evil.example/cb'] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_redirect_uri')
  })
})

describe('authorize', () => {
  const params = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: 'https://whizzo.test/mcp',
      ...over,
    }).toString()

  it('sends a known client to the consent screen with a signed request', async () => {
    respond([['update public.mcp_clients', [clientRow]]])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${params()}` })
    expect(res.statusCode).toBe(302)
    const location = new URL(res.headers.location as string)
    expect(location.origin + location.pathname).toBe('https://whizzo.test/connect')
    expect(location.searchParams.get('req')).toBeTruthy()
  })

  it('does not redirect anywhere for a redirect URI the client did not register', async () => {
    respond([['update public.mcp_clients', [clientRow]]])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/authorize?${params({ redirect_uri: 'https://elsewhere.example/cb' })}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses to issue for any other resource', async () => {
    respond([['update public.mcp_clients', [clientRow]]])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/authorize?${params({ resource: 'https://other.example/mcp' })}`,
    })
    expect(res.statusCode).toBe(302)
    const location = new URL(res.headers.location as string)
    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('state')).toBe('xyz')
  })
})

describe('the whole dance', () => {
  it('consent mints a code, the code plus PKCE mints tokens, and the token reaches the tools', async () => {
    const { pkceChallenge } = await import('./tokens.js')
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = pkceChallenge(verifier)
    let storedCode: { code_hash: string; code_challenge: string } | null = null

    respond([
      ['update public.mcp_clients', [clientRow]],
      ['select id from public.learners', [{ id: LEARNER }]],
      ['insert into public.mcp_grants', [{ id: GRANT }]],
      ['insert into public.mcp_auth_codes', (p) => {
        storedCode = { code_hash: String(p[0]), code_challenge: String(p[4]) }
        return []
      }],
      ['delete from public.mcp_auth_codes', (p) =>
        storedCode && storedCode.code_hash === p[0]
          ? [{ grant_id: GRANT, client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: storedCode.code_challenge, expires_at: new Date(Date.now() + 60_000) }]
          : []],
      ['select id, user_id, scope from public.mcp_grants', [{ id: GRANT, user_id: CALLER, scope: 'tutor' }]],
      ['from public.mcp_grants g', [grantRow]],
      ['from public.learners l', [learnerRow(LEARNER, 'Maya Example')]],
    ])
    const app = await buildApp()

    // 1. The assistant sends the grown-up to consent.
    const start = await app.inject({
      method: 'GET',
      url:
        '/api/oauth/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: CLIENT,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 's1',
          resource: 'https://whizzo.test/mcp',
        }).toString(),
    })
    const req = new URL(start.headers.location as string).searchParams.get('req')!

    // 2. The grown-up approves for Maya.
    const decision = await app.inject({
      method: 'POST',
      url: '/api/oauth/authorize/decision',
      headers: await auth(),
      payload: { req, approve: true, learnerIds: [LEARNER] },
    })
    expect(decision.statusCode).toBe(200)
    const redirect = new URL(decision.json().redirect)
    expect(redirect.origin + redirect.pathname).toBe('https://claude.ai/api/mcp/auth_callback')
    expect(redirect.searchParams.get('state')).toBe('s1')
    expect(redirect.searchParams.get('iss')).toBe('https://whizzo.test')
    const code = redirect.searchParams.get('code')!
    expect(code).toBeTruthy()

    // 3. The assistant exchanges the code.
    const token = await app.inject({
      method: 'POST',
      url: '/api/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: CLIENT,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        resource: 'https://whizzo.test/mcp',
      }).toString(),
    })
    expect(token.statusCode).toBe(200)
    const issued = token.json()
    expect(issued.token_type).toBe('Bearer')
    expect(issued.refresh_token).toBeTruthy()

    // A code is spent on first use.
    storedCode = null
    const again = await app.inject({
      method: 'POST',
      url: '/api/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }).toString(),
    })
    expect(again.statusCode).toBe(400)
    expect(again.json().error).toBe('invalid_grant')

    // 4. The token reaches the tools, and the tools know who it is for.
    const who = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${issued.access_token}`, 'mcp-protocol-version': '2025-06-18' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
    })
    expect(who.statusCode).toBe(200)
    const result = who.json().result
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Maya Example')
    expect(result.structuredContent.learners[0]).toMatchObject({ name: 'Maya Example', current: true })
  })

  it('a child signed in with a PIN cannot approve a connection', async () => {
    respond([
      ['from public.learners where auth_user_id', [{ '?column?': 1 }]],
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/authorize/decision',
      headers: await auth(),
      payload: { req: 'anything', approve: true, learnerIds: [LEARNER] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('grown_up_required')
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into public.mcp_grants'))).toBe(false)
  })

  it('refuses a code whose PKCE verifier does not match', async () => {
    respond([
      ['delete from public.mcp_auth_codes', [{ grant_id: GRANT, client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'not-this', expires_at: new Date(Date.now() + 60_000) }]],
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', code: 'c', code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' }).toString(),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error_description).toMatch(/PKCE/)
  })

  it('a reused refresh token revokes its whole family', async () => {
    respond([
      ['select * from public.mcp_refresh_tokens', [{ token_hash: 'h', grant_id: GRANT, family: 'fam-1', expires_at: new Date(Date.now() + 60_000), used_at: new Date() }]],
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'leaked' }).toString(),
    })
    expect(res.statusCode).toBe(400)
    const wiped = query.mock.calls.find(([sql]) => String(sql).includes('delete from public.mcp_refresh_tokens where family'))
    expect(wiped?.[1]).toEqual(['fam-1'])
  })
})

describe('the endpoint', () => {
  async function bearer(grantId = GRANT) {
    const { mintAccessToken } = await import('./tokens.js')
    return { authorization: `Bearer ${await mintAccessToken({ userId: CALLER, grantId, scope: 'tutor' })}` }
  }

  it('challenges a call with no token, and says where the metadata is', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://whizzo.test/.well-known/oauth-protected-resource"')
  })

  it('refuses a token whose grant was revoked, on the very next call', async () => {
    respond([['from public.mcp_grants g', []]])
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/mcp', headers: await bearer(), payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a browser origin that is not ours', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...(await bearer()), origin: 'https://evil.example' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('lists the tools in a fixed order, every one annotated', async () => {
    respond([['from public.mcp_grants g', [grantRow]]])
    const { TOOL_DEFS } = await import('./tools.js')
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/mcp', headers: await bearer(), payload: { jsonrpc: '2.0', id: 7, method: 'tools/list' } })
    expect(res.statusCode).toBe(200)
    const tools = res.json().result.tools as Array<{ name: string; annotations: Record<string, boolean> }>
    expect(tools.map((t) => t.name)).toEqual(TOOL_DEFS.map((t) => t.name))
    for (const t of tools) {
      expect(typeof t.annotations.readOnlyHint).toBe('boolean')
      expect(typeof t.annotations.destructiveHint).toBe('boolean')
      expect(t.name.length).toBeLessThanOrEqual(64)
    }
    expect(tools.find((t) => t.name === 'answer')?.annotations.readOnlyHint).toBe(false)
    expect(tools.find((t) => t.name === 'list_materials')?.annotations.readOnlyHint).toBe(true)
  })

  it('answers initialize for older clients and server/discover for newer ones', async () => {
    respond([['from public.mcp_grants g', [grantRow]]])
    const app = await buildApp()
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: await bearer(),
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } },
    })
    expect(init.json().result.protocolVersion).toBe('2025-06-18')
    const discover = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...(await bearer()), 'mcp-protocol-version': '2026-07-28' },
      payload: { jsonrpc: '2.0', id: 2, method: 'server/discover' },
    })
    expect(discover.json().result.protocolVersions[0]).toBe('2026-07-28')
    expect(discover.json().result.resultType).toBe('complete')
  })

  it('rejects an unknown protocol version and an unknown method', async () => {
    respond([['from public.mcp_grants g', [grantRow]]])
    const app = await buildApp()
    const bad = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...(await bearer()), 'mcp-protocol-version': '1999-01-01' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(bad.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'POST', url: '/mcp', headers: await bearer(), payload: { jsonrpc: '2.0', id: 1, method: 'nope' } })
    expect(unknown.json().error.code).toBe(-32601)
  })

  it('asks which child when the grant covers two and none was named', async () => {
    respond([
      ['from public.mcp_grants g', [{ ...grantRow, learner_ids: [LEARNER, LEARNER2], current_learner_id: null }]],
      ['from public.learners l', [learnerRow(LEARNER, 'Maya'), learnerRow(LEARNER2, 'Theo')]],
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: await bearer(),
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_materials', arguments: {} } },
    })
    const result = res.json().result
    expect(result.isError).toBe(false)
    expect(result.structuredContent.needsLearner).toBe(true)
    expect(result.content[0].text).toBe('Which child is this for — Maya or Theo?')
  })

  it('a notification gets a 202 and nothing else', async () => {
    respond([['from public.mcp_grants g', [grantRow]]])
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/mcp', headers: await bearer(), payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })
    expect(res.statusCode).toBe(202)
  })

  it('does not open a stream on GET', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/mcp' })
    expect(res.statusCode).toBe(405)
  })

  it('stays off in production until a real origin is set', async () => {
    envMock.NODE_ENV = 'production'
    envMock.APP_URL = ''
    try {
      const app = await buildApp()
      const res = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
      expect(res.statusCode).toBe(503)
      const reg = await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } })
      expect(reg.statusCode).toBe(503)
    } finally {
      envMock.NODE_ENV = 'test'
      envMock.APP_URL = 'https://whizzo.test'
    }
  })

  it('refuses everything politely when the secret is not set', async () => {
    envMock.MCP_TOKEN_SECRET = undefined
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(res.statusCode).toBe(503)
  })
})
