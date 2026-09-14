#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const REMOVED_PATH = '/editorial-standards'
const PAGE = 'mingla-marketing/app/(core)/editorial-standards/page.tsx'
const POLICY = 'mingla-marketing/components/core-pages/editorial-policy.tsx'
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(ROOT, relative))

function verifySource(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const isPresent = (relative) => overrides[relative] === true || (overrides[relative] !== false && exists(relative))
  const corePages = source('mingla-marketing/content/core-pages.ts')
  const navigation = [
    source('mingla-marketing/components/cutout/audience-menu-content.tsx'),
    source('mingla-marketing/components/cutout/footer.tsx'),
  ].join('\n')
  const searchOwners = [
    corePages,
    source('mingla-marketing/lib/search/route-registry.ts'),
    source('mingla-marketing/components/marketing/posthog-provider.tsx'),
    source('scripts/search/workbook-contract.mjs'),
    source('scripts/search/fixtures/release-route-scope.json'),
  ].join('\n')
  const packageJson = JSON.parse(source('mingla-marketing/package.json'))

  assert.equal(isPresent(PAGE), false, 'the deleted editorial route file must stay absent')
  assert.equal(isPresent(POLICY), false, 'the editorial-only component must stay absent')
  assert.doesNotMatch(corePages, /editorial-standards|Editorial Standards/, 'core-page lifecycle still owns the deleted route')
  assert.doesNotMatch(navigation, /editorial-standards|Editorial Standards/, 'public navigation still links the deleted route')
  assert.doesNotMatch(searchOwners, /editorial-standards|Editorial Standards/, 'search or measurement tooling still treats the deleted route as live')
  assert.match(corePages, /export type CorePageSlug = 'about' \| 'explorer' \| 'cities'/)
  assert.match(corePages, /CORE_PAGES\.cities\.lifecycle === 'search_ready'/, 'the three retained core routes must promote atomically')
  assert.match(packageJson.scripts.prebuild, /issue-3176-editorial-route-removal\.implementor\.happy\.test\.mjs --source-only/, 'the removal guard must run before production builds')
  assert.match(packageJson.scripts.build, /next build && node \.\.\/scripts\/ci\/issue-3176-editorial-route-removal\.implementor\.happy\.test\.mjs --built-only/, 'the 404 guard must run against the final production build')

  const scope = JSON.parse(source('scripts/search/fixtures/release-route-scope.json'))
  assert.equal(scope.marketing.some((record) => record.path === REMOVED_PATH), false, 'route ledger still publishes the deleted route')
  assert.equal(scope.marketing.length, 23, 'route ledger must lose exactly the deleted route')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function request(port, pathname, userAgent = 'Mozilla/5.0') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'accept-encoding': 'identity', 'user-agent': userAgent } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function runtimeContract() {
  assert(exists('mingla-marketing/.next/BUILD_ID'), 'build mingla-marketing before the runtime removal check')
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: MARKETING,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
    for (const userAgent of [
      'Mozilla/5.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'OAI-SearchBot/1.0; +https://openai.com/searchbot',
    ]) {
      const response = await request(port, REMOVED_PATH, userAgent)
      assert.equal(response.status, 404, `deleted editorial route must return 404 to ${userAgent}`)
      assert.doesNotMatch(response.body, /How Mingla chooses, verifies and updates content|Mingla Editorial Standards/, 'former editorial page content still renders')
    }
    for (const pathname of ['/about', '/explorer', '/cities']) {
      assert.equal((await request(port, pathname)).status, 200, `${pathname} regressed while deleting the editorial route`)
    }
    const sitemap = await request(port, '/sitemap.xml')
    assert.equal(sitemap.status, 200)
    assert.doesNotMatch(sitemap.body, /editorial-standards/, 'sitemap still lists the deleted route')
  } finally {
    server.kill('SIGTERM')
    await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1500) })
  }
}

if (!BUILT_ONLY) verifySource()
if (!SOURCE_ONLY) await runtimeContract()
if (SELF_TEST) {
  assert.throws(() => verifySource({ [PAGE]: true }), /route file must stay absent/, 'restoring the deleted page must prove RED')
  process.stdout.write('RED proof: restoring the deleted editorial route was rejected\n')
}
process.stdout.write('PASS #3176 editorial route removal happy path\n')
