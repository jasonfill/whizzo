// Connected apps: what a grown-up sees on Account, and the one thing they can
// do about it.
//
// A grant is read and revoked by its owner, through RLS, like anything else
// of theirs. There is no edit: the learners a connection covers were agreed at
// consent, and widening that is a new consent, not a patch.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { callerOf, requireCaller } from '../auth.js'
import { withUser } from '../db.js'
import { notFound } from '../errors.js'
import { canonicalMcpUrl, mcpConfigured } from '../mcp/tokens.js'

const uuid = z.string().uuid('That is not a valid id')

export async function mcpGrantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCaller)

  app.get('/mcp/grants', async (request) => {
    const caller = callerOf(request)
    const grants = await withUser(caller.id, async (db) => {
      const { rows } = await db.query(
        `select g.id, g.client_label, g.learner_ids, g.current_learner_id, g.scope,
                g.created_at, g.last_used_at, g.revoked_at, c.name as client_name,
                (select coalesce(json_agg(json_build_object('id', l.id, 'name', l.display_name) order by l.created_at), '[]'::json)
                   from public.learners l where l.id = any(g.learner_ids)) as learners
           from public.mcp_grants g
           join public.mcp_clients c on c.id = g.client_id
          where g.revoked_at is null
          order by g.created_at desc`,
      )
      interface Row {
        id: string
        client_label: string
        client_name: string
        learners: Array<{ id: string; name: string }>
        current_learner_id: string | null
        scope: string
        created_at: Date
        last_used_at: Date | null
      }
      return (rows as Row[]).map((r) => ({
        id: r.id,
        client: r.client_label,
        clientName: r.client_name,
        learners: r.learners,
        currentLearnerId: r.current_learner_id,
        scope: r.scope,
        createdAt: new Date(r.created_at).getTime(),
        lastUsedAt: r.last_used_at ? new Date(r.last_used_at).getTime() : null,
      }))
    })
    return {
      grants,
      enabled: mcpConfigured(),
      serverUrl: mcpConfigured() ? canonicalMcpUrl() : null,
    }
  })

  app.post('/mcp/grants/:id/revoke', async (request, reply) => {
    const caller = callerOf(request)
    const { id } = z.object({ id: uuid }).parse(request.params)
    await withUser(caller.id, async (db) => {
      const { rowCount } = await db.query(
        `update public.mcp_grants set revoked_at = now() where id = $1 and revoked_at is null`,
        [id],
      )
      if (!rowCount) throw notFound('No such connection')
    })
    reply.code(204)
    return null
  })
}
