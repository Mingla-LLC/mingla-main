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
const REMOVED_PATH = '/editorial-standards'
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const crawlOwners = [
    'mingla-marketing/components/cutout/audience-menu-content.tsx',
    'mingla-marketing/components/cutout/footer.tsx',
    'mingla-marketing/content/core-pages.ts',
    'mingla-marketing/lib/search/route-registry.ts',
    'mingla-marketing/components/marketing/posthog-provider.tsx',
    'scripts/search/workbook-contract.mjs',
    'scripts/search/fixtures/release-route-scope.json',
  ]
  for (const owner of crawlOwners) {
    assert.doesNotMatch(source(owner), /\/editorial-standards|Editorial Standards/, `${owner} resurrects the deleted page`)
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'mingla-marketing/app/(core)/editorial-standards/page.tsx')), false, 'deleted route file exists')

  const packageJson = JSON.parse(source('mingla-marketing/package.json'))
  assert.match(packageJson.scripts.prebuild, /issue-3176-editorial-route-removal\.tester\.adversarial\.test\.mjs --source-only/, 'independent removal guard must run before production builds')
  assert.match(packageJson.scripts.build, /issue-3176-editorial-route-removal\.tester\.adversarial\.test\.mjs --built-only/, 'independent 404 check must run against the final production build')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
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
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'build mingla-marketing before the independent removal check')
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
      'Googlebot/2.1',
      'bingbot/2.0',
      'OAI-SearchBot/1.0',
      'ClaudeBot/1.0',
      'PerplexityBot/1.0',
    ]) {
      const response = await request(port, REMOVED_PATH, userAgent)
      assert.equal(response.status, 404, `${userAgent} did not receive a real 404`)
      assert.doesNotMatch(response.body, /Mingla Editorial Standards|How Mingla chooses, verifies and updates content/, 'deleted content leaked into the 404 response')
    }

    for (const pathname of ['/', '/about', '/explorer', '/cities', '/host']) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} regressed during editorial-page removal`)
      assert.doesNotMatch(response.body, /href=["']\/editorial-standards(?:[?#"'])/, `${pathname} still links to the deleted page`)
    }
    const sitemap = await request(port, '/sitemap.xml')
    assert.equal(sitemap.status, 200)
    assert.doesNotMatch(sitemap.body, /editorial-standards/, 'sitemap still advertises the deleted page')
  } finally {
    server.kill('SIGTERM')
    await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1500) })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
if (SELF_TEST) {
  assert.throws(
    () => sourceContract({ 'mingla-marketing/components/cutout/footer.tsx': '<a href="/editorial-standards">Editorial Standards</a>' }),
    /resurrects the deleted page/,
    'a stale public link must prove RED',
  )
  process.stdout.write('RED proof: a stale public link to the deleted route was rejected\n')
}
process.stdout.write('PASS #3176 independent editorial-route removal: crawler parity, no stale links and retained-route safety\n')
