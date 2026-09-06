// Taking a file somebody handed over.
//
// The property worth defending here is the one the estimate depends on: **the
// page count is exact before a price is shown.** A photograph and a text file
// have no pages of their own, so they are converted rather than guessed at, and
// a file we cannot open is refused while the person is still at the file picker
// rather than inside a job that has already reserved their credits.

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, digestOf, pagesOf, screenUpload } from './upload.js'

async function pdfOf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800])
  return Buffer.from(await doc.save())
}

describe('deciding what we can take', () => {
  it('takes a PDF', () => {
    const out = screenUpload({ filename: 'ch1.pdf', mime: 'application/pdf', bytes: 1000 })
    expect(out).toEqual({ ok: true, kind: 'pdf' })
  })

  it('ignores the charset browsers tack on', () => {
    const out = screenUpload({ filename: 'notes.txt', mime: 'text/plain; charset=utf-8', bytes: 10 })
    expect(out).toEqual({ ok: true, kind: 'text' })
  })

  it('tells somebody with a Word file what to do about it', () => {
    // "Unsupported media type" teaches a parent nothing they can act on.
    const out = screenUpload({ filename: 'spellings.docx', mime: 'application/msword', bytes: 10 })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.message).toMatch(/print it to PDF/i)
  })

  it('refuses an empty file rather than charging the floor for nothing', () => {
    const out = screenUpload({ filename: 'a.pdf', mime: 'application/pdf', bytes: 0 })
    expect(out.ok === false && out.code).toBe('empty')
  })

  it('refuses one over the ceiling, and says the ceiling', () => {
    const out = screenUpload({
      filename: 'textbook.pdf',
      mime: 'application/pdf',
      bytes: MAX_UPLOAD_BYTES + 1,
    })
    expect(out.ok === false && out.code).toBe('too-large')
    expect(out.ok === false && out.message).toMatch(/25MB/)
  })
})

describe('counting what it will be charged as', () => {
  it('asks the PDF rather than estimating from its size', async () => {
    const out = await pagesOf('pdf', await pdfOf(7))
    expect(out).toEqual({ ok: true, pages: 7 })
  })

  it('refuses a PDF it cannot open, before any credits are reserved', async () => {
    const out = await pagesOf('pdf', Buffer.from('this is not a pdf at all'))
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.code).toBe('unreadable')
  })

  it('counts a photograph as one page', async () => {
    const out = await pagesOf('image', Buffer.alloc(400_000))
    expect(out).toEqual({ ok: true, pages: 1 })
  })

  it('never counts a short text file as zero pages', async () => {
    // A free read call still costs a read call.
    const out = await pagesOf('text', Buffer.from('two words'))
    expect(out).toEqual({ ok: true, pages: 1 })
  })

  it('rounds a long text file up rather than down', async () => {
    const out = await pagesOf('text', Buffer.from('x'.repeat(2001)))
    expect(out).toEqual({ ok: true, pages: 2 })
  })
})

describe('recognising the same file twice', () => {
  it('gives identical bytes the same fingerprint, and different bytes a different one', () => {
    expect(digestOf(Buffer.from('abc'))).toBe(digestOf(Buffer.from('abc')))
    expect(digestOf(Buffer.from('abc'))).not.toBe(digestOf(Buffer.from('abd')))
  })
})
