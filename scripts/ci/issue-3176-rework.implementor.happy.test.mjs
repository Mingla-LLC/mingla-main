#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildWorkbookTabs, validateWorkbookTabs, WORKBOOK_SCHEMAS, WORKBOOK_TAB_NAMES } from '../search/workbook-contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const BUILT_ONLY = process.argv.includes('--built-only')
const SOURCE_ONLY = process.argv.includes('--source-only')
const SELF_TEST = process.argv.includes('--self-test')
const CITY_PATHS = [
  '/cities/lagos','/cities/durham-nc','/cities/cary-nc','/cities/raleigh-nc','/cities/new-york-city',
  '/cities/brussels','/cities/paris','/cities/london','/cities/fort-lauderdale','/cities/washington-dc',
]

function sourceContract() {
  const venue = read('mingla-business/src/components/venue/VenueCreatorWizard.tsx')
  assert.doesNotMatch(venue, /captureHostSearchOutcome\(["']generate_lead["']/, 'venue create/claim is not a lead')
  const publicEvent = read('mingla-business/src/components/event/PublicEventPage.tsx')
  assert.doesNotMatch(publicEvent, /captureHostSearchOutcome/, 'public event retains its established analytics dependency boundary')

  const analytics = read('mingla-business/src/analytics/webAnalytics.web.ts')
  assert.match(analytics, /capture_pageview:\s*false/)
  assert.match(analytics, /capture_pageleave:\s*false/)
  assert.match(analytics, /before_send:\s*sanitizeLegacyPageview/)
  assert.match(analytics, /posthog\.capture\(LEGACY_PAGEVIEW_EVENT\)/)
  assert.match(analytics, /properties\.\$current_url = new URL\(href\)\.origin/)
  assert.match(analytics, /name === "rsvp_acknowledgement_viewed"[\s\S]*?props\?\.status === "going"[\s\S]*?captureWebSearchOutcome\("generate_lead"/)
  const auth = read('mingla-business/src/context/AuthContext.tsx')
  assert.doesNotMatch(auth, /captureHostSearchOutcome/, 'byte-pinned auth owner must not gain a parallel analytics dependency')
  assert.match(read('mingla-business/src/services/postHogService.ts'), /event === "signup_completed"[\s\S]*?sanitizeSearchMeasurement\("sign_up"/)
  assert.match(read('mingla-business/src/services/postHogService.web.ts'), /event === "signup_completed"[\s\S]*?captureWebSearchOutcome\("sign_up"/)

  const hostVercel = JSON.parse(read('mingla-business/vercel.json'))
  assert(!hostVercel.rewrites.some((rule) => rule.source === '/indexnow-key.txt'), 'IndexNow key must not bypass the fixed deep-link rewrite table')
  assert(hostVercel.redirects.some((rule) => rule.source === '/indexnow-key.txt' && rule.destination === '/api/indexnow-key'), 'legacy IndexNow key URL must redirect to its protocol key location')
  assert.match(read('scripts/search/indexnow.mjs'), /keyLocation:'https:\/\/host\.usemingla\.com\/api\/indexnow-key'/)

  const packageJson = JSON.parse(read('mingla-marketing/package.json'))
  assert.match(packageJson.scripts.build, /export MINGLA_HISTORICAL_2983_BUILD=1/)
  assert.match(packageJson.scripts.build, /unset MINGLA_HISTORICAL_2983_BUILD && node scripts\/clear-historical-city-build\.mjs && next build && node \.\.\/scripts\/ci\/issue-3176-editorial-route-removal\.implementor\.happy\.test\.mjs --built-only && node \.\.\/scripts\/ci\/issue-3176-editorial-route-removal\.tester\.adversarial\.test\.mjs --built-only && node \.\.\/scripts\/ci\/issue-3176-rework\.implementor\.happy\.test\.mjs --built-only$/)
  assert.equal(packageJson.scripts.postbuild, 'node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs --built-only && node scripts/issue-2990-restructured-page-system.tester.adversarial.test.mjs')
  assert.match(read('mingla-marketing/lib/search/historical-city-build.ts'), /process\.env\.MINGLA_HISTORICAL_2983_BUILD === '1'[\s\S]*?process\.env\.npm_lifecycle_event === 'postbuild'/)

  const tabs = validateWorkbookTabs(buildWorkbookTabs())
  assert.deepEqual(Object.keys(tabs), WORKBOOK_TAB_NAMES)
  assert.deepEqual(tabs['00_ROUTE_LEDGER'].columns, WORKBOOK_SCHEMAS['00_ROUTE_LEDGER'])
  assert.equal(tabs['00_ROUTE_LEDGER'].rows.length, 23)
  assert.equal(tabs['07_BENCHMARK'].rows.length, 145)
  for (const field of [
    'deployment_sha','observed_at','expected_http_status','observed_browser_status','gsc_pages_result','bing_index_result',
    'indexnow_final_receipt','source','medium','campaign','owner','next_action','due_date',
    'resolution_sha','resolution_evidence',
  ]) {
    assert(WORKBOOK_SCHEMAS['00_ROUTE_LEDGER'].includes(field) || WORKBOOK_SCHEMAS['05_GA4_OUTCOMES'].includes(field), `missing #3001 field ${field}`)
  }

  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-workbook-'))
  try {
    execFileSync(process.execPath, ['scripts/search/export-workbook.mjs', `--output=${output}`], { cwd: ROOT, stdio: 'pipe' })
    assert.deepEqual(fs.readdirSync(output).sort(), WORKBOOK_TAB_NAMES.map((name) => `${name}.csv`).sort())
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'accept-encoding': 'identity', 'user-agent': 'Mozilla/5.0 Mingla-3176-release-proof' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject); req.end()
  })
}

async function runtimeContract() {
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'run the final release next build first')
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: MARKETING, env: { ...process.env, MINGLA_HISTORICAL_2983_BUILD: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk })
  server.stderr.on('data', (chunk) => { output += chunk })
  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Next server exited ${server.exitCode}: ${output}`)
      try { if ((await request(port, '/robots.txt')).status === 200) break } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const directory = await request(port, '/cities')
    assert.equal(directory.status, 200, '/cities must be 200 in the final release build')
    assert(directory.body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').includes('Explore Mingla city by city.'), '/cities lost current release content')
    for (const pathname of CITY_PATHS) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} must be 200 in the final release build`)
      assert.equal((response.body.match(/class="ps-catalogue-card"/g) ?? []).length, 50, `${pathname} must render top 50 overall`)
      assert(!response.body.includes('Choose your Mingla path in '), `${pathname} leaked historical audience fork into the release build`)
    }
  } finally {
    server.kill('SIGTERM')
    await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1500) })
  }
  execFileSync(process.execPath, ['--experimental-websocket', 'scripts/ci/issue-3176-core-page-simplification.implementor.happy.test.mjs', '--built-only'], { cwd: ROOT, stdio: 'inherit' })
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
if (SELF_TEST) {
  const tabs = buildWorkbookTabs()
  const broken = { ...tabs, '00_ROUTE_LEDGER': { ...tabs['00_ROUTE_LEDGER'], columns: tabs['00_ROUTE_LEDGER'].columns.filter((field) => field !== 'gsc_pages_result') } }
  assert.throws(() => validateWorkbookTabs(broken), /00_ROUTE_LEDGER/, 'missing GSC field must prove RED')
  process.stdout.write('RED proof: incomplete #3001 route-ledger schema was rejected\n')
}
process.stdout.write('PASS #3176 QA rework: truthful outcomes, historical fixture isolation, exact workbook and current release runtime\n')
