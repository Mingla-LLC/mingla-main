#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function verify(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const about = source('mingla-marketing/app/(core)/about/page.tsx')
  const bridge = source('mingla-marketing/components/core-pages/platform-bridge-graphic.tsx')
  const css = source('mingla-marketing/components/core-pages/core-pages.css')
  const appIconPattern = /\/brand\/mingla-logo-white-on-orange\.png/g

  assert.equal(
    (bridge.match(appIconPattern) ?? []).length,
    2,
    'Explorer and Host must use the same rounded app-icon artwork in the platform bridge',
  )
  assert.equal(
    (bridge.match(/className="core-app-icon"/g) ?? []).length,
    2,
    'both platform-bridge app icons must use the shared rounded treatment',
  )
  assert.equal(
    (about.match(/className="core-app-icon"/g) ?? []).length,
    2,
    'both product-card app icons must use the shared rounded treatment',
  )
  assert.equal(
    (about.match(appIconPattern) ?? []).length,
    2,
    'Explorer and Host product cards must use the same orange app-icon artwork',
  )
  assert.match(
    css,
    /\.core-app-icon\s*\{[^}]*overflow:hidden;[^}]*border-radius:1rem;[^}]*object-fit:cover;/,
    'shared app icons must clip to the approved rounded-square shape',
  )
}

verify()

if (process.argv.includes('--self-test')) {
  const relative = 'mingla-marketing/components/core-pages/platform-bridge-graphic.tsx'
  const reverted = read(relative).replace(
    '<img className="core-app-icon" src="/brand/mingla-logo-white-on-orange.png" alt="" /><strong>Mingla Host</strong>',
    '<img src="/brand/mingla-business-logo.png" alt="" /><strong>Mingla Host</strong>',
  )
  assert.throws(
    () => verify({ [relative]: reverted }),
    /Explorer and Host must use the same rounded app-icon artwork/,
    'restoring the unboxed Host mark must prove RED',
  )
  process.stdout.write('RED proof: restoring the unboxed Host mark was rejected\n')
}

process.stdout.write('PASS #3176 About app-icon parity\n')
