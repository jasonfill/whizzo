// Connected apps, over the API.
//
// Two halves: the consent screen an assistant sends a grown-up to, and the
// list on Account with its one button. There is no `connect` call here — a
// connection is only ever started from the assistant's side, and the token it
// gets never passes through this app.

import type { McpGrantsResponse, McpPendingResponse } from '@whizzo/shared'
import { api } from '../api/client'

export type { McpGrant } from '@whizzo/shared'

export function listGrants(signal?: AbortSignal): Promise<McpGrantsResponse> {
  return api.get('/mcp/grants', signal)
}

export function revokeGrant(id: string): Promise<void> {
  return api.post(`/mcp/grants/${id}/revoke`)
}

/** What the assistant asked for, read back from its signed request. */
export function pendingRequest(req: string, signal?: AbortSignal): Promise<McpPendingResponse> {
  return api.get(`/oauth/authorize/pending?req=${encodeURIComponent(req)}`, signal)
}

/** The grown-up's answer. Returns where to send the browser next. */
export function decide(req: string, approve: boolean, learnerIds: string[]): Promise<{ redirect: string }> {
  return api.post('/oauth/authorize/decision', { req, approve, learnerIds })
}
