// Taking a file somebody handed over directly.
//
// The link path has to be defended against the URL being a trap — see
// `fetch.ts`, where most of the thinking went. A file has no such problem: the
// bytes are already here and nothing is being talked into connecting anywhere.
// What replaces it is a different question, and the one this module exists to
// answer: **how many pages is this?**
//
// The price is quoted in pages before anything is spent, and two of the three
// things we accept are not paginated. A photograph of a worksheet has no pages;
// a `.txt` has as many as the reader's window is wide. Both still cost a read
// call, so both are converted to the same unit here rather than at the point of
// sale — a screen that quoted one document in pages and the next in kilobytes
// would make the two impossible to compare, which is the one thing the estimate
// exists to let a parent do.

import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { pagesForText, PAGES_PER_IMAGE } from '@whizzo/shared'

/** The same ceiling the link path uses. A worksheet is nowhere near it. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * How many files one request may carry.
 *
 * Each one is its own source, its own job and its own charge, so this is not a
 * safety limit so much as a limit on how much can go wrong in a single tap.
 */
export const MAX_FILES_PER_REQUEST = 10

export type UploadKind = 'pdf' | 'image' | 'text'

/**
 * What we accept, and what each one becomes in a message.
 *
 * The content block type is not cosmetic: the API rejects an image sent as a
 * `document` and a PDF sent as an `image`, so the decision is made once, here,
 * from the MIME type — and stored, so the runner never has to guess from a
 * filename later.
 */
export const ACCEPTED: Record<string, UploadKind> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'text/plain': 'text',
  'text/markdown': 'text',
  // What a shared Google Sheet exports as.
  'text/csv': 'text',
}

export type UploadRefusal =
  | { ok: false; code: 'type'; message: string }
  | { ok: false; code: 'too-large'; message: string }
  | { ok: false; code: 'empty'; message: string }
  | { ok: false; code: 'unreadable'; message: string }

/**
 * Is this a file we can do anything with?
 *
 * The refusals are worded for the person holding the file, not for the log. A
 * parent who has just been told "unsupported media type" learns nothing they
 * can act on; one told to print it to PDF first has a next step.
 */
export function screenUpload(file: {
  filename: string
  mime: string
  bytes: number
}): { ok: true; kind: UploadKind } | UploadRefusal {
  // Browsers send `application/pdf; charset=…` often enough to be worth not
  // tripping over, and an empty type for files they do not recognise.
  const mime = file.mime.split(';')[0]!.trim().toLowerCase()
  const kind = ACCEPTED[mime]

  if (!kind) {
    const word = /\.(docx?|pages)$/i.test(file.filename)
      ? 'Word files cannot be read directly — print it to PDF and upload that.'
      : 'That kind of file cannot be read. PDFs, photos and plain text work.'
    return { ok: false, code: 'type', message: word }
  }
  if (file.bytes <= 0) {
    return { ok: false, code: 'empty', message: 'That file is empty.' }
  }
  if (file.bytes > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)
    return {
      ok: false,
      code: 'too-large',
      message: `That file is bigger than ${mb}MB. Split it and upload the part you need.`,
    }
  }
  return { ok: true, kind }
}

/**
 * How many pages this is priced as.
 *
 * A PDF is asked rather than estimated — the count is exactly what the parent
 * is about to be charged for, and guessing it from the byte size would put the
 * quote and the bill in different units. A PDF we cannot open is refused here,
 * while the person is still looking at the file picker, rather than in a job
 * that fails a minute later having already reserved their credits.
 */
export async function pagesOf(
  kind: UploadKind,
  bytes: Buffer,
): Promise<{ ok: true; pages: number } | UploadRefusal> {
  if (kind === 'image') return { ok: true, pages: PAGES_PER_IMAGE }
  if (kind === 'text') return { ok: true, pages: pagesForText(bytes.toString('utf8').length) }

  try {
    // `updateMetadata: false` keeps pdf-lib from rewriting anything; we only
    // ever ask this document a question.
    const pdf = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
    })
    const pages = pdf.getPageCount()
    if (pages < 1) {
      return { ok: false, code: 'unreadable', message: 'That PDF has no pages in it.' }
    }
    return { ok: true, pages }
  } catch {
    return {
      ok: false,
      code: 'unreadable',
      message:
        'That PDF could not be opened. If it is password protected, save an unlocked copy first.',
    }
  }
}

/** The fingerprint a second upload of the same file is recognised by. */
export function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
