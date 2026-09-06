// Turning database refusals into honest HTTP.
//
// The policies and triggers in migration 0003 are the enforcement layer, so the
// errors they raise are not internal failures — they are answers. A row hidden
// by RLS and a row rejected by the age gate mean different things to the caller
// and get different statuses.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (m: string, code = 'bad_request') => new HttpError(400, m, code)
export const unauthorized = (m = 'Sign in first') => new HttpError(401, m, 'unauthorized')
export const forbidden = (m = 'Not allowed') => new HttpError(403, m, 'forbidden')
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found')
/**
 * A free-tier ceiling, which is a different refusal from "not allowed".
 *
 * 403 with its own code rather than 402: nothing is owed, and the client has to
 * be able to tell "cover this learner and try again" apart from "you may not
 * touch this record", because only one of those is worth showing an upgrade
 * link for.
 */
export const overLimit = (m: string) => new HttpError(403, m, 'over_limit')

interface PgError {
  code?: string
  message?: string
  constraint?: string
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && 'code' in err
}

/**
 * Map a Postgres error onto a status.
 *
 * Note what is *not* here: a 404 for a row RLS hid. A learner you cannot see
 * simply is not in your result set, so those come back as an empty select and
 * are turned into 404 by the route, not by this function.
 */
export function fromDatabaseError(err: unknown): HttpError | null {
  if (!isPgError(err) || !err.code) return null
  const message = err.message ?? 'The database refused that'

  switch (err.code) {
    // insufficient_privilege — either an explicit raise from one of our guards
    // or an RLS policy declining a write.
    case '42501':
      return new HttpError(403, message, 'forbidden')

    // check_violation — the age gate, an expired invite, a bad enum value.
    case '23514':
      return new HttpError(400, message, 'rejected')

    // unique_violation
    case '23505':
      return new HttpError(409, message, 'conflict')

    // foreign_key_violation — pointing at a learner that does not exist.
    case '23503':
      return new HttpError(400, 'That record does not exist', 'bad_reference')

    // not_null_violation / invalid input syntax for a uuid
    case '23502':
    case '22P02':
      return new HttpError(400, 'That request was not valid', 'bad_request')

    default:
      return null
  }
}

/**
 * A schema refusal is the caller's problem, not ours.
 *
 * Every route validates with `schema.parse()`, and a `ZodError` carries no
 * `statusCode` — so without this it falls all the way through to the 500 arm:
 * a malformed id or a missing field is reported to the caller as "something
 * went wrong on our side", and logged as an unhandled error. Both are wrong,
 * and the second one buries real faults in noise.
 *
 * The message names the first field that failed, because "invalid request" is
 * true of everything and useful for nothing.
 */
export function fromValidationError(err: unknown): HttpError | null {
  const zod = err as { name?: string; issues?: Array<{ path?: unknown[]; message?: string }> }
  if (zod?.name !== 'ZodError' || !Array.isArray(zod.issues)) return null

  const first = zod.issues[0]
  const field = first?.path?.filter((p) => typeof p === 'string').join('.')
  const detail = first?.message ?? 'That request was not valid'
  return new HttpError(400, field ? `${field}: ${detail}` : detail, 'bad_request')
}
