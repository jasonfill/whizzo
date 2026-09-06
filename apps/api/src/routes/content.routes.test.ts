// The ingestion surface.
//
// One property runs through all of it: **nothing spends money without saying
// what it will cost first.** The estimate is a separate call from the run on
// purpose — that extra round trip is the difference between a parent choosing
// to spend twenty credits and discovering that they did.

import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
const withUser = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: (db: unknown) => Promise<unknown>) => fn({ query })),
)

vi.mock('../db.js', () => ({
  withUser: (...a: Parameters<typeof withUser>) => withUser(...a),
  // `withAdmin` takes the callback alone — there is no caller to run as, which
  // is the whole difference between the two. Giving it `withUser`'s arity here
  // meant the callback arrived as the user id and was never run.
  withAdmin: (fn: (db: unknown) => Promise<unknown>) => fn({ query }),
  pool: { connect: vi.fn(), query: vi.fn(), on: vi.fn() },
}))

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWT_SECRET: 'a-test-secret-long-enough-for-hs256-signing',
    ANTHROPIC_API_KEY: 'sk-test',
    PG_POOL_MAX: 4,
    NODE_ENV: 'test',
    PORT: 8099,
  } as Record<string, unknown>,
}))
vi.mock('../env.js', () => ({ env: envMock, isProduction: false }))

// The Files API is the one thing here that would cost money to exercise.
const { storeFile } = vi.hoisted(() => ({
  storeFile: vi.fn(async (..._a: unknown[]) => ({ fileId: 'file_abc123', bytes: 1024 })),
}))
const { fetchSource } = vi.hoisted(() => ({ fetchSource: vi.fn() }))
vi.mock('../content/fetch.js', async () => {
  const real = await vi.importActual<typeof import('../content/fetch.js')>('../content/fetch.js')
  // Everything but the network trip is the real thing: the URL screening and
  // the Google export rewriting are exactly what these tests are about.
  return { ...real, fetchSource: (...a: unknown[]) => fetchSource(...a) }
})

vi.mock('../content/client.js', () => ({
  anthropic: () => ({}),
  storeFile: (...a: unknown[]) => storeFile(...a),
  FILES_BETA: 'files-api-2025-04-14',
}))

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001'
const SOURCE = '33333333-4444-4555-8666-777777777777'
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
  const { contentRoutes } = await import('./content.js')
  const { HttpError, fromDatabaseError, fromValidationError } = await import('../errors.js')
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
    const mapped = fromDatabaseError(error)
    if (mapped) {
      reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      return
    }
    const s = error as unknown as { statusCode?: number }
    reply
      .code(s.statusCode && s.statusCode < 500 ? s.statusCode : 500)
      .send({ error: { code: 'error', message: (error as Error).message } })
  })
  await app.register(contentRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

const JOB_ROW = {
  id: '44444444-5555-4666-8777-888888888888',
  source_id: SOURCE,
  status: 'queued',
  stage_detail: {},
  claimed_at: null,
  heartbeat_at: null,
  attempts: 0,
  error: null,
  result: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

beforeEach(async () => {
  // A readable one-page PDF is the boring default, so tests that are about
  // something else are not also about what came back off the wire.
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([600, 800])
  const onePage = Buffer.from(await doc.save())
  fetchSource.mockReset().mockResolvedValue({
    ok: true,
    fetched: {
      bytes: onePage,
      mime: 'application/pdf',
      finalUrl: new URL('https://example.com/a.pdf'),
    },
  })
  storeFile.mockClear()
  envMock.ANTHROPIC_API_KEY = 'sk-test'
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  withUser.mockClear()
})

describe('whether the feature is even switched on', () => {
  it('says so plainly when there is no key', async () => {
    // A contributor running the API without one should get a clear answer, not
    // a 500 from three layers down.
    envMock.ANTHROPIC_API_KEY = undefined
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/content/status', headers: await auth() })
    expect(res.json()).toEqual({ enabled: false, balance: null })
  })

  it('refuses a build rather than half-starting one', async () => {
    envMock.ANTHROPIC_API_KEY = undefined
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/content/sources/${SOURCE}/build`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('not_enabled')
  })

  it('reports the balance when it is on', async () => {
    query.mockResolvedValue({ rows: [{ kind: 'grant', bucket: 'included', credits: 30 }] })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/content/status', headers: await auth() })
    expect(res.json()).toMatchObject({ enabled: true, balance: { included: 30, total: 30 } })
  })
})

describe('pasting a link', () => {
  it('refuses anything that is not https, before touching the network', async () => {
    const app = await buildApp()
    for (const url of ['http://example.com/a.pdf', 'file:///etc/passwd', 'not a url']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/content/sources/link',
        headers: await auth(),
        payload: { url },
      })
      expect(res.statusCode, url).toBe(400)
    }
    expect(query).not.toHaveBeenCalled()
  })

  it('turns a Google Doc into its export link rather than storing the edit URL', async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes('select id from public.content_sources')
        ? { rows: [] }
        : { rows: [{ id: SOURCE }] },
    )
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/api/content/sources/link',
      headers: await auth(),
      payload: { url: 'https://docs.google.com/document/d/abc123/edit' },
    })
    // Both the URL we went and got, and the one written down.
    expect(String(fetchSource.mock.calls[0]![0])).toContain('/export?format=pdf')
    const insert = query.mock.calls.find((c) =>
      String(c[0]).includes('insert into public.content_sources'),
    )!
    expect(String((insert[1] as unknown[])[1])).toContain('/export?format=pdf')
  })

  it('counts the pages of what it fetched rather than quoting every link the same', async () => {
    // The bug this replaced: a source registered without its bytes had no page
    // count, and creditsForPages(0) is the floor — so a one-page worksheet and
    // a forty-page chapter were both "0 pages, about 5 credits".
    fetchSource.mockResolvedValue({
      ok: true,
      fetched: {
        bytes: await (async () => {
          const { PDFDocument } = await import('pdf-lib')
          const doc = await PDFDocument.create()
          for (let i = 0; i < 12; i += 1) doc.addPage([600, 800])
          return Buffer.from(await doc.save())
        })(),
        mime: 'application/pdf',
        finalUrl: new URL('https://example.com/a.pdf'),
      },
    })
    query.mockImplementation(async (sql: string) =>
      String(sql).includes('select id from public.content_sources')
        ? { rows: [] }
        : { rows: [{ id: SOURCE }] },
    )
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/content/sources/link',
      headers: await auth(),
      payload: { url: 'https://example.com/a.pdf' },
    })
    expect(res.statusCode).toBe(200)
    const insert = query.mock.calls.find((c) =>
      String(c[0]).includes('insert into public.content_sources'),
    )!
    // pages is the 6th parameter, and it is what the quote is built from.
    expect((insert[1] as unknown[])[4]).toBe(12)
  })

  it('says a private document is private rather than making cards about signing in', async () => {
    fetchSource.mockResolvedValue({
      ok: false,
      code: 'needs-sign-in',
      message: 'That document is private. Either change sharing to "anyone with the link", or download it and upload the file.',
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/content/sources/link',
      headers: await auth(),
      payload: { url: 'https://docs.google.com/document/d/abc123/edit' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/private/i)
    expect(storeFile).not.toHaveBeenCalled()
  })
})

describe('what it will cost, before it costs it', () => {
  it('quotes the estimate and the balance together', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 24 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 30 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate`,
      headers: await auth(),
    })
    expect(res.json()).toMatchObject({
      estimate: { pages: 24, credits: 24 },
      balance: { total: 30 },
      allowed: true,
    })
  })

  it('says why not, and by how much, when it cannot be afforded', async () => {
    // Covered, so the page cap is not what stops this — the balance is.
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 60 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 5 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate`,
      headers: await auth(),
    })
    expect(res.json().allowed).toBe(false)
    expect(res.json().reason).toMatch(/60 credits/)
  })

  it('caps an uncovered account by pages before it ever counts credits', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 60 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 9999 }] })
      .mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate`,
      headers: await auth(),
    })
    expect(res.json().allowed).toBe(false)
    expect(res.json().reason).toMatch(/Split it/)
  })

  it('halves it for work that can wait', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 40 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate?noRush=true`,
      headers: await auth(),
    })
    expect(res.json().estimate.credits).toBe(20)
  })

  it('404s a document that is not the caller\'s — RLS is the filter', async () => {
    query.mockResolvedValue({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('quoting at the speed that was asked for', () => {
  it('quotes the full price when no rush was NOT chosen', async () => {
    // `z.coerce.boolean()` reads the string "false" as true, so this asked for
    // the rush quote and was handed the half-price one — shown three credits,
    // charged five. A test that only ever passes `true` cannot see it.
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 10 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 90 }] })
      .mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate?noRush=false`,
      headers: await auth(),
    })
    expect(res.json().estimate).toMatchObject({ pages: 10, credits: 10, noRush: false })
  })

  it('halves it when no rush was chosen', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 10 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 90 }] })
      .mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate?noRush=true`,
      headers: await auth(),
    })
    expect(res.json().estimate).toMatchObject({ credits: 5, noRush: true })
  })

  it('quotes the full price when the speed is not mentioned at all', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 10 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 90 }] })
      .mockResolvedValueOnce({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/sources/${SOURCE}/estimate`,
      headers: await auth(),
    })
    expect(res.json().estimate.noRush).toBe(false)
  })
})

describe('starting a run', () => {
  it('refuses with 402 rather than queueing something unaffordable', async () => {
    // Refused here rather than inside the job, so the person finds out now and
    // the refusal carries the number the next screen needs.
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 60 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 5 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/content/sources/${SOURCE}/build`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().estimate.credits).toBe(60)
  })

  it('queues one it can afford, and remembers the choices', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, pages: 10 }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'grant', bucket: 'included', credits: 90 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [JOB_ROW] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/content/sources/${SOURCE}/build`,
      headers: await auth(),
      payload: { topicIds: ['t1', 't2'], noRush: true },
    })
    expect(res.statusCode).toBe(200)
    const detail = JSON.parse(query.mock.calls[3]![1][1] as string)
    expect(detail).toMatchObject({ topicIds: ['t1', 't2'], noRush: true })
  })
})

describe('watching a run', () => {
  it('says the stage in words', async () => {
    query.mockResolvedValue({ rows: [{ ...JOB_ROW, status: 'building', stage_detail: { topics: 3 } }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/jobs/${JOB_ROW.id}`,
      headers: await auth(),
    })
    expect(res.json().job.stage).toBe('Writing cards for 3 topics')
  })

  it('never hands the client our bookkeeping', async () => {
    query.mockResolvedValue({ rows: [{ ...JOB_ROW, attempts: 2 }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/jobs/${JOB_ROW.id}`,
      headers: await auth(),
    })
    expect(res.json().job).not.toHaveProperty('attempts')
  })

  it('404s a run that is not the caller\'s', async () => {
    query.mockResolvedValue({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/jobs/${JOB_ROW.id}`,
      headers: await auth(),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('accepting a draft', () => {
  it('is one action on the whole set', async () => {
    const now = new Date().toISOString()
    query.mockResolvedValue({ rows: [{ id: SOURCE, accepted_at: now }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/library/decks/${SOURCE}/accept`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().acceptedAt).toBe(Date.parse(now))
  })

  it('treats a second tap as success, not as a failure', async () => {
    // A slow connection should not make somebody think acceptance did not take.
    const now = new Date().toISOString()
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SOURCE, accepted_at: now }] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/library/decks/${SOURCE}/accept`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
  })

  it('404s a set that does not exist', async () => {
    query.mockResolvedValue({ rows: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/library/decks/${SOURCE}/accept`,
      headers: await auth(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('handing over files', () => {
  const BOUNDARY = '----whizzoTestBoundary'

  // Call counts, not the implementation — several tests below assert that the
  // Files API was *not* reached.
  beforeEach(() => storeFile.mockClear())

  async function pdfBytes(pages: number): Promise<Buffer> {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i += 1) doc.addPage([600, 800])
    return Buffer.from(await doc.save())
  }

  /** A multipart body, built by hand so the route parses a real one. */
  function multipart(files: Array<{ name: string; type: string; body: Buffer }>): Buffer {
    const parts: Buffer[] = []
    for (const f of files) {
      parts.push(
        Buffer.from(
          `--${BOUNDARY}\r\n` +
            `Content-Disposition: form-data; name="files"; filename="${f.name}"\r\n` +
            `Content-Type: ${f.type}\r\n\r\n`,
        ),
        f.body,
        Buffer.from('\r\n'),
      )
    }
    parts.push(Buffer.from(`--${BOUNDARY}--\r\n`))
    return Buffer.concat(parts)
  }

  /** No prior copy on file, so every upload takes the full path. */
  function nothingSeenBefore() {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes('select id, pages from public.content_sources')
        ? { rows: [] }
        : { rows: [{ id: SOURCE }] },
    )
  }

  async function send(files: Array<{ name: string; type: string; body: Buffer }>) {
    const app = await buildApp()
    return app.inject({
      method: 'POST',
      url: '/api/content/sources/upload',
      headers: {
        ...(await auth()),
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: multipart(files),
    })
  }

  it('makes one source per file, each with its own exact page count', async () => {
    // One set per file is the whole shape: three chapters are three sets of
    // cards, and one bad file does not take the others down with it.
    nothingSeenBefore()
    const res = await send([
      { name: 'ch1.pdf', type: 'application/pdf', body: await pdfBytes(3) },
      { name: 'ch2.pdf', type: 'application/pdf', body: await pdfBytes(5) },
    ])

    expect(res.statusCode).toBe(200)
    expect(res.json().sources).toHaveLength(2)
    expect(res.json().rejected).toEqual([])
    // The page count reaching the row is the one the quote will be built from.
    const inserts = query.mock.calls.filter((c) => String(c[0]).includes('insert into public.content_sources'))
    expect(inserts.map((c) => (c[1] as unknown[])[4])).toEqual([3, 5])
  })

  it('refuses one file by name and still takes the others', async () => {
    nothingSeenBefore()
    const res = await send([
      { name: 'ch1.pdf', type: 'application/pdf', body: await pdfBytes(2) },
      { name: 'notes.docx', type: 'application/msword', body: Buffer.from('not a pdf') },
    ])

    expect(res.json().sources).toHaveLength(1)
    expect(res.json().rejected).toEqual([
      { filename: 'notes.docx', reason: expect.stringMatching(/print it to PDF/i) },
    ])
  })

  it('refuses a PDF it cannot open before anything is uploaded or charged', async () => {
    const res = await send([
      { name: 'broken.pdf', type: 'application/pdf', body: Buffer.from('nope') },
    ])

    expect(res.json().sources).toEqual([])
    expect(res.json().rejected[0].reason).toMatch(/could not be opened/i)
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('recognises a file it already has rather than billing for it twice', async () => {
    // The schema says so in a comment; this is that comment being true.
    query.mockResolvedValue({ rows: [{ id: SOURCE, pages: 9 }] })
    const res = await send([
      { name: 'ch1.pdf', type: 'application/pdf', body: await pdfBytes(3) },
    ])

    expect(res.json().sources).toEqual([{ sourceId: SOURCE, filename: 'ch1.pdf', pages: 9 }])
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('says so plainly when the feature has no key behind it', async () => {
    envMock.ANTHROPIC_API_KEY = undefined
    const res = await send([
      { name: 'ch1.pdf', type: 'application/pdf', body: await pdfBytes(1) },
    ])
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('not_enabled')
  })
})
