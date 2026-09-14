#!/usr/bin/env node

import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const GUARD = path.join(ROOT, 'scripts/ci/issue-3176-explorer-hero-product-proof.tester.adversarial.test.mjs')

function run(env) {
  return spawnSync(process.execPath, ['--experimental-websocket', GUARD, '--built-only'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  })
}

const chromelessVercel = run({
  ...process.env,
  VERCEL: '1',
  MINGLA_TEST_FORCE_CHROMELESS: '1',
})
assert.equal(chromelessVercel.status, 0, chromelessVercel.stderr || chromelessVercel.stdout)
assert.match(chromelessVercel.stdout, /SKIP #3322 Explorer hero browser runtime on Chrome-less Vercel/)
assert.match(chromelessVercel.stdout, /PASS #3176 independent Explorer hero product-proof runtime/)

const localEnv = {
  ...process.env,
  MINGLA_TEST_FORCE_CHROMELESS: '1',
}
delete localEnv.VERCEL
const chromelessLocal = run(localEnv)
assert.notEqual(chromelessLocal.status, 0, 'the same browser guard must remain fail-closed outside Vercel')
assert.match(chromelessLocal.stderr, /Chrome\/Chromium is required for the Explorer hero runtime guard outside Vercel/)

process.stdout.write('PASS #3322 Vercel can finish without weakening GitHub or local Explorer browser enforcement\n')
