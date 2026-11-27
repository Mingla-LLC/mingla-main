#!/usr/bin/env node
// #4636 — writes lib/site-blocks/page-defaults.json: each converted page's
// default block list (content/site-blocks/page-defaults.ts, built from the
// constants the coded pages render), for Admin's editor to open a page that
// has never been edited. `--check` fails when the JSON is stale (prebuild and
// test:issue-4636 run it, like registry.json).
//
//   node scripts/issue-4636-page-defaults.mjs          # write
//   node scripts/issue-4636-page-defaults.mjs --check  # verify, exit 1 when stale
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKETING } from '../lib/__tests__/issue-4452-ts-loader.mjs'
import { tsxRenderer } from '../lib/__tests__/issue-4452-tsx-render.mjs'

export const DEFAULTS_JSON = path.join(MARKETING, 'lib/site-blocks/page-defaults.json')

export function pageDefaultsJsonText() {
  const T = tsxRenderer('issue-4636-page-defaults-')
  try {
    const { PAGE_DEFAULTS } = T.load('content/site-blocks/page-defaults.ts')
    const { REGISTRY_VERSION } = T.load('lib/site-blocks/registry.ts')
    return `${JSON.stringify({ registry_version: REGISTRY_VERSION, pages: PAGE_DEFAULTS }, null, 2)}\n`
  } finally {
    T.cleanup()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const text = pageDefaultsJsonText()
  const current = fs.existsSync(DEFAULTS_JSON) ? fs.readFileSync(DEFAULTS_JSON, 'utf8') : ''
  if (process.argv.includes('--check')) {
    if (current !== text) {
      console.error('issue-4636: lib/site-blocks/page-defaults.json is out of date; run node scripts/issue-4636-page-defaults.mjs')
      process.exitCode = 1
    } else console.log('issue-4636: page-defaults.json matches the coded pages')
  } else if (current !== text) {
    fs.writeFileSync(DEFAULTS_JSON, text)
    console.log('issue-4636: wrote lib/site-blocks/page-defaults.json')
  } else console.log('issue-4636: page-defaults.json already current')
}
