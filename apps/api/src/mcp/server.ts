// The MCP endpoint: Streamable HTTP at /mcp.
//
// One URL, POST for every message, a JSON body back. No SSE streams, because
// nothing here takes longer than a database round trip and a round of
// practice is short by design; no sessions, because the current protocol
// revision (2026-07-28) removed them and a stateless endpoint behind a load
// balancer is what an API like this wants anyway. Cross-call state is a
// server-minted handle — `roundId` — passed as an ordinary argument.
//
// Both assistants still speak the earlier revisions, so `initialize` and the
// `Mcp-Session-Id` header they send are accepted and, respectively, answered
// and ignored.
//
// Hand-rolled rather than the reference SDK: the surface is eight methods,
// Fastify is already here, and owning the dispatch is what lets the protocol
// version, the deterministic tool order and the origin check be exactly what
// the spec asks for.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { webOrigins } from '../env.js'
import { loadGrant, type ToolContext } from './context.js'
import { appUrl, issuer, mcpConfigured, verifyAccessToken } from './tokens.js'
import { callTool, TOOL_DEFS } from './tools.js'

export const SERVER_INFO = { name: 'whizzo', title: 'Whizzo', version: '1.0.0' }

/** Newest first. The first is what a client that names none gets. */
export const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number]

/** Cache hints on list results, required from 2026-07-28 and harmless before. */
const LIST_TTL_MS = 60 * 60 * 1000

const SERVER_INSTRUCTIONS =
  'Whizzo is a learning app for children. These tools let you tutor a learner out loud on their own flashcard decks. ' +
  'Call whoami first. Use list_materials to find a learner’s deck, start_round to begin, and answer for every reply — send exactly what the learner said. ' +
  'To find a deck in the grown-up’s library, including one you made with create_deck, use search; update_deck changes a deck rather than making another. ' +
  'Every result is a spoken line followed by JSON: read the line aloud, and take ids (deck ids, roundId) and the next question from the JSON. ' +
  'Follow the instructions returned by start_round for the whole round. You are never given an answer before the learner has tried.'

const TUTOR_PROMPT = {
  name: 'tutor',
  title: 'Tutor a learner',
  description: 'Run a spoken practice round on one of the learner’s decks, as a patient tutor.',
  arguments: [
    { name: 'learner', description: 'Which child, by first name. Optional when there is one.', required: false },
    { name: 'deck', description: 'Words from the deck title. Optional; the tools can ask.', required: false },
  ],
}

// --- JSON-RPC ------------------------------------------------------------------------------------

const rpcMessage = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
})
type RpcMessage = z.infer<typeof rpcMessage>

/** A JSON-RPC *response* — something with a result or an error and no method. */
function isRpcResponse(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>
  return !('method' in o) && ('result' in o || 'error' in o)
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const UNSUPPORTED_PROTOCOL_VERSION = -32022

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

// --- Who may call ---------------------------------------------------------------------------

/**
 * The origin check the transport spec makes mandatory. Assistants call from
 * their own servers and send no Origin; a browser would, and a browser on a
 * site that is not ours is a DNS-rebinding attempt by definition.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  const allowed = new Set<string>([
    ...webOrigins,
    appUrl(),
    'https://claude.ai',
    'https://claude.com',
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://platform.openai.com',
  ])
  try {
    return allowed.has(new URL(origin).origin)
  } catch {
    return false
  }
}

function challenge(reply: FastifyReply, description: string, error = 'invalid_token'): FastifyReply {
  reply.header(
    'www-authenticate',
    `Bearer realm="whizzo", error="${error}", error_description="${description}", ` +
      `resource_metadata="${issuer()}/.well-known/oauth-protected-resource"`,
  )
  reply.code(401)
  return reply.send({ error: { code: 'unauthorized', message: description } })
}

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<ToolContext | null> {
  const header = request.headers.authorization
  const [scheme, token] = typeof header === 'string' ? header.split(' ') : []
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    challenge(reply, 'This endpoint needs a bearer token issued by Whizzo.', 'invalid_request')
    return null
  }
  const claims = await verifyAccessToken(token)
  if (!claims) {
    challenge(reply, 'That token is not valid for this resource.')
    return null
  }
  const grant = await loadGrant(claims.grantId)
  if (!grant || grant.userId !== claims.userId) {
    challenge(reply, 'That connection was disconnected. Reconnect from the assistant.')
    return null
  }
  return { grant, clientName: null }
}

// --- Dispatch ---------------------------------------------------------------------------------

function negotiate(requested: unknown): ProtocolVersion {
  if (typeof requested === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested as ProtocolVersion
  }
  // A client asking for a revision we do not know gets the newest we do; a
  // client naming none is assumed to predate the header.
  return typeof requested === 'string' ? PROTOCOL_VERSIONS[0] : '2025-06-18'
}

const CAPABILITIES = { tools: { listChanged: false }, prompts: { listChanged: false } }

function toolList() {
  return TOOL_DEFS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, ...t.annotations },
  }))
}

function promptMessages(args: Record<string, unknown> | undefined) {
  const learner = typeof args?.learner === 'string' && args.learner.trim() ? ` for ${args.learner.trim()}` : ''
  const deck = typeof args?.deck === 'string' && args.deck.trim() ? ` on the "${args.deck.trim()}" deck` : ''
  return [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          `Tutor me${learner}${deck}. Call whoami, then list_materials to find the deck, then start_round. ` +
          'Follow the instructions in the start_round result for the whole round: ask each question as written, send exactly what I say to answer, ' +
          'never tell me an answer before answer has returned it, and keep your turns short.',
      },
    },
  ]
}

async function dispatch(
  ctx: ToolContext,
  message: RpcMessage,
  version: ProtocolVersion,
): Promise<unknown> {
  const modern = version === '2026-07-28'
  const meta = modern ? { _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO }, resultType: 'complete' } : {}
  const cacheable = modern ? { ttlMs: LIST_TTL_MS, cacheScope: 'private' } : {}

  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: negotiate(message.params?.protocolVersion),
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      }

    case 'server/discover':
      return {
        protocolVersions: [...PROTOCOL_VERSIONS],
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
        ...meta,
      }

    case 'ping':
      return { ...meta }

    case 'tools/list':
      return { tools: toolList(), ...cacheable, ...meta }

    case 'tools/call': {
      const params = z
        .object({ name: z.string(), arguments: z.record(z.unknown()).optional() })
        .safeParse(message.params)
      if (!params.success) throw new RpcError(INVALID_PARAMS, 'tools/call needs a name and arguments')
      if (!TOOL_DEFS.some((t) => t.name === params.data.name)) {
        throw new RpcError(INVALID_PARAMS, `Unknown tool: ${params.data.name}`)
      }
      const result = await callTool(ctx, params.data.name, params.data.arguments ?? {})
      // The spoken line first, then the data as JSON in the same text block.
      // `structuredContent` carries the same data for clients that read it,
      // but the assistants' chat clients hand the model the *text* — and a
      // model that only ever saw "Caroline has three decks" could never call
      // start_round, because the deck ids were in a field it was not shown.
      const hasData = Object.keys(result.data).length > 0
      const text = hasData ? `${result.say}\n\n${JSON.stringify(result.data)}` : result.say
      return {
        content: [{ type: 'text', text }],
        structuredContent: { ...result.data, say: result.say },
        isError: Boolean(result.isError),
        ...meta,
      }
    }

    case 'prompts/list':
      return { prompts: [TUTOR_PROMPT], ...cacheable, ...meta }

    case 'prompts/get': {
      const params = z.object({ name: z.string(), arguments: z.record(z.unknown()).optional() }).safeParse(message.params)
      if (!params.success || params.data.name !== TUTOR_PROMPT.name) {
        throw new RpcError(INVALID_PARAMS, 'Unknown prompt')
      }
      return { description: TUTOR_PROMPT.description, messages: promptMessages(params.data.arguments), ...meta }
    }

    case 'resources/list':
      return { resources: [], ...cacheable, ...meta }
    case 'resources/templates/list':
      return { resourceTemplates: [], ...cacheable, ...meta }

    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${message.method}`)
  }
}

// --- The route ---------------------------------------------------------------------------------

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  // A GET opens a server-to-client stream in the older revisions. This server
  // has nothing to push, and 405 is the answer the transport spec gives for
  // that. DELETE ended a session; there are none.
  app.get('/mcp', async (_request, reply) => {
    reply.code(405).header('allow', 'POST')
    return { error: { code: 'method_not_allowed', message: 'This server does not open a stream; POST JSON-RPC messages here.' } }
  })
  app.delete('/mcp', async (_request, reply) => {
    reply.code(405).header('allow', 'POST')
    return { error: { code: 'method_not_allowed', message: 'This server keeps no sessions.' } }
  })

  app.post('/mcp', async (request, reply) => {
    if (!mcpConfigured()) {
      reply.code(503)
      return { error: { code: 'mcp_unconfigured', message: 'Connected apps are not switched on in this build.' } }
    }
    if (!originAllowed(request.headers.origin)) {
      reply.code(403)
      return { error: { code: 'forbidden', message: 'That origin may not call this endpoint.' } }
    }

    const versionHeader = request.headers['mcp-protocol-version']
    const requested = Array.isArray(versionHeader) ? versionHeader[0] : versionHeader
    if (requested && !(PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
      reply.code(400)
      return rpcError(null, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version: ${requested}`, {
        supported: [...PROTOCOL_VERSIONS],
      })
    }

    const ctx = await authenticate(request, reply)
    if (!ctx) return reply
    ctx.log = (msg, err) => request.log.warn({ err }, msg)

    // One message or, in the older revisions, a batch of them.
    const body = request.body
    const batch = Array.isArray(body)
    const raw = batch ? (body as unknown[]) : [body]
    const responses: unknown[] = []

    for (const item of raw) {
      // A response from the client (to a request this server never makes) is
      // acknowledged and dropped.
      if (isRpcResponse(item)) continue

      const parsed = rpcMessage.safeParse(item)
      if (!parsed.success) {
        responses.push(rpcError(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request'))
        continue
      }
      const message = parsed.data

      // Per-request client identity, from the newer `_meta` or an older
      // `initialize`. Recorded on the round so the Family screen can say
      // which assistant a child practiced with.
      const metaInfo = (message.params?._meta as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/clientInfo']
      const initInfo = message.method === 'initialize' ? message.params?.clientInfo : undefined
      const info = (metaInfo ?? initInfo) as { name?: unknown } | undefined
      if (info && typeof info.name === 'string') ctx.clientName = info.name.slice(0, 80)

      const metaVersion = (message.params?._meta as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/protocolVersion']
      const version = negotiate(metaVersion ?? requested)

      if (message.id === undefined) {
        // A notification. Nothing here reacts to one; accept it.
        continue
      }

      try {
        const result = await dispatch(ctx, message, version)
        responses.push({ jsonrpc: '2.0', id: message.id, result })
      } catch (err) {
        if (err instanceof RpcError) {
          responses.push(rpcError(message.id, err.code, err.message, err.data))
        } else {
          request.log.error({ err, method: message.method }, 'mcp tool failed')
          responses.push(rpcError(message.id, -32603, 'Something went wrong on our side'))
        }
      }
    }

    if (!responses.length) {
      reply.code(202)
      return null
    }
    reply.header('content-type', 'application/json')
    return batch ? responses : responses[0]
  })
}
