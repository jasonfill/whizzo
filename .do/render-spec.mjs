// Render the app spec with secret values injected, for `doctl apps create`.
//
// .do/app.yaml declares its secrets as `type: SECRET` with no value, because
// the values must never be committed. But a spec with valueless secrets creates
// an app whose API cannot boot — it validates its environment at startup and
// exits. So this fills them in from your shell, writes a gitignored file, and
// that is what you hand to doctl.
//
//   set -a && source apps/api/.env && source apps/web/.env.local && set +a
//   node .do/render-spec.mjs
//   doctl apps create --spec .do/app.rendered.yaml
//
// Delete the rendered file afterwards; it contains live credentials.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'app.yaml')
const target = join(here, 'app.rendered.yaml')

/**
 * Values that are clearly still templates. Injecting one of these produces an
 * app that deploys and then cannot reach its database, which is a slower and
 * more confusing failure than refusing here.
 */
// `localhost` is on the list because APP_URL's development value is exactly
// that, and a production app whose OAuth issuer is http://localhost:5173
// deploys cleanly and then fails every family that tries to connect.
const PLACEHOLDER = /\[YOUR-|<your-|<project-ref>|change-?me|xxxxx|localhost|127\.0\.0\.1/i

const lines = (await readFile(source, 'utf8')).split('\n')
const out = []
const missing = []
const placeholders = []
const filled = []

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  out.push(line)

  // A `type: SECRET` line always follows the `key:` and `scope:` it belongs to.
  if (!/^\s*type:\s*SECRET\s*$/.test(line)) continue

  // Walk back to the key this secret belongs to.
  let key = null
  for (let j = i - 1; j >= 0 && j > i - 5; j -= 1) {
    const match = /^\s*-?\s*key:\s*([A-Z0-9_]+)\s*$/.exec(lines[j])
    if (match) {
      key = match[1]
      break
    }
  }
  if (!key) continue

  const value = process.env[key]
  if (!value) {
    missing.push(key)
    continue
  }
  if (PLACEHOLDER.test(value)) {
    placeholders.push(key)
    continue
  }

  // JSON's double-quoted form is valid YAML and handles the punctuation that
  // shows up in connection strings and JWTs.
  const indent = line.match(/^\s*/)?.[0] ?? '        '
  out.push(`${indent}value: ${JSON.stringify(value)}`)
  filled.push(key)
}

if (missing.length || placeholders.length) {
  if (missing.length) {
    console.error(`\nNot set in your environment:\n`)
    for (const key of missing) console.error(`  ${key}`)
  }
  if (placeholders.length) {
    console.error(`\nStill has a placeholder value — fill these in first:\n`)
    for (const key of placeholders) console.error(`  ${key}`)
  }
  console.error(
    `\nSource both env files:\n` +
      `  set -a && source apps/api/.env && source apps/web/.env.local && set +a\n`,
  )
  process.exit(1)
}

await writeFile(target, out.join('\n'), { mode: 0o600 })
console.log(`wrote ${target} with ${filled.length} secret(s): ${filled.join(', ')}`)
console.log('this file contains live credentials — delete it once doctl has run')
