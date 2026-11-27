#!/usr/bin/env node
// #4636 — writes lib/site-blocks/registry.json from lib/site-blocks/registry.ts
// (the one registry), for the consumers that cannot import TypeScript: the
// database validator's seed and the Admin editor. `--check` fails when the
// JSON is out of date instead of writing it (run by the #4636 test).
//
//   node scripts/issue-4636-block-registry.mjs          # write
//   node scripts/issue-4636-block-registry.mjs --check  # verify, exit 1 when stale
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loader, MARKETING } from '../lib/__tests__/issue-4452-ts-loader.mjs'

export const JSON_PATH = path.join(MARKETING, 'lib/site-blocks/registry.json')

export async function registryJsonText() {
  const L = loader('issue-4636-registry-json-')
  try {
    const r = await L.load('site-blocks/registry')
    return `${JSON.stringify(r.registryJson(), null, 2)}\n`
  } finally {
    L.cleanup()
  }
}

// Run as a script (realpath: /tmp is /private/tmp on macOS).
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const text = await registryJsonText()
  const current = fs.existsSync(JSON_PATH) ? fs.readFileSync(JSON_PATH, 'utf8') : ''
  if (process.argv.includes('--check')) {
    if (current !== text) {
      console.error('issue-4636: lib/site-blocks/registry.json is out of date; run node scripts/issue-4636-block-registry.mjs')
      process.exitCode = 1
    } else console.log('issue-4636: registry.json matches registry.ts')
  } else if (current !== text) {
    fs.writeFileSync(JSON_PATH, text)
    console.log('issue-4636: wrote lib/site-blocks/registry.json')
  } else console.log('issue-4636: registry.json already current')
}
