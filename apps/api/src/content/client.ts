// The Anthropic client, and the one call that puts bytes where the model can
// read them.
//
// Built lazily rather than at import time. The key is optional on purpose — a
// contributor without one should be able to run the whole rest of the API — and
// a module-level `new Anthropic()` would turn that into a boot failure for
// everybody, which is the shape `env.ts` goes out of its way to avoid.

import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { env } from '../env.js'
import type { UploadKind } from './upload.js'

/** The beta the Files API sits behind, required on upload *and* on every
 *  message that later references the file. */
export const FILES_BETA = 'files-api-2025-04-14'

let cached: Anthropic | null = null

export function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set; document ingestion is switched off.')
  }
  cached ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return cached
}

/** Only for tests, which must not reuse a client built from a different key. */
export function resetAnthropic(): void {
  cached = null
}

export interface StoredFile {
  fileId: string
  bytes: number
}

/**
 * Put a file where the model can read it.
 *
 * Uploaded once and referenced by id from then on: the read call and every
 * per-topic build call point at the same `file_id`, which is what makes the
 * document cacheable across the fan-out instead of re-sent six times.
 */
export async function storeFile(
  client: Anthropic,
  file: { filename: string; mime: string; bytes: Buffer; kind: UploadKind },
): Promise<StoredFile> {
  const uploaded = await client.beta.files.upload({
    file: await toFile(file.bytes, file.filename, { type: file.mime }),
    betas: [FILES_BETA],
  })
  return { fileId: uploaded.id, bytes: uploaded.size_bytes ?? file.bytes.length }
}
