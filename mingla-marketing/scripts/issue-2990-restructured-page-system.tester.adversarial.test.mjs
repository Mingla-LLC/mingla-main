#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const decode = (value) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const visibleText = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const mainHtml = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? ''
const cardTags = (html, kind) => [...html.matchAll(new RegExp(`<a\\b[^>]*class=["'][^"']*ps-catalogue-card[^"']*["'][^>]*data-kind=["']${kind}["'][^>]*>`, 'gi'))]

function sourceContract() {
  const page = read('app/internal/page-system/city-lagos/page.tsx')
  const catalogue = read('components/page-system/city-catalogue.tsx')
  const hostBar = read('components/page-system/city-host-acquisition-bar.tsx')
  const hostFamily = read('content/page-system/host-guide-family.ts')
  const packageJson = JSON.parse(read('package.json'))

  assert.match(page, /requestedCategories\.filter\([\s\S]*EXPLORER_CATEGORIES\.some/,
    'unknown category query values must be allow-listed before reaching the catalogue')
  assert.match(page, /detail\?\.startsWith\('plan:'\)/,
    'a direct plan detail URL must select the plan catalogue without JavaScript')
  assert.match(catalogue, /That pick is no longer available\./,
    'stale or malformed detail URLs must fail closed with a useful message')
  assert.match(catalogue, /role="alert"/)

  const exactDestinations = [...hostBar.matchAll(/href: '(https:\/\/host\.usemingla\.com\/[^']+)'/g)].map((match) => match[1])
  assert.deepEqual(exactDestinations, [
    'https://host.usemingla.com/event/create',
    'https://host.usemingla.com/trip/create',
    'https://host.usemingla.com/experience/create',
    'https://host.usemingla.com/venue/create',
  ], 'the city Host affordance must expose exactly the four approved creation destinations')
  for (const [kind, route] of Object.entries({ event: 'event/create', trip: 'trip/create', venue: 'venue/create', experience: 'experience/create' })) {
    const record = hostFamily.slice(hostFamily.indexOf(`  ${kind}: {`), hostFamily.indexOf(`\n  ${kind === 'event' ? 'trip' : kind === 'trip' ? 'venue' : kind === 'venue' ? 'experience' : '__end__'}: {`) || undefined)
    assert(record.includes(`hostUrl: 'https://host.usemingla.com/${route}'`), `${kind} guide must keep its type-correct Host route`)
  }

  const implementor = 'node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs'
  const tester = 'node scripts/issue-2990-restructured-page-system.tester.adversarial.test.mjs'
  assert.equal(packageJson.scripts.postbuild, `${implementor} --built-only && ${tester}`)
  assert.equal(packageJson.scripts['test:page-system'], `${implementor} && ${tester}`)
  process.stdout.write('PASS adversarial source query, stale-link, Host-route and guard-wiring contracts\n')
}

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'Accept-Encoding': 'identity' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitReady(port, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try { if ((await request(port, '/robots.txt')).status === 200) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready')
}

async function runtimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the adversarial runtime contract')
  const port = await availablePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitReady(port, child)

    const filteredResponse = await request(port, '/internal/page-system/city-lagos?type=garbage&categories=nature%2Cbogus')
    assert.equal(filteredResponse.status, 200)
    const filteredMain = mainHtml(filteredResponse.body)
    assert.equal(cardTags(filteredMain, 'place').length, 5, 'an invalid category must be discarded while the valid Nature filter remains')
    assert.match(visibleText(filteredMain), /5 Lagos places/)
    assert.doesNotMatch(visibleText(filteredMain), /bogus/i)

    const staleResponse = await request(port, '/internal/page-system/city-lagos?type=places&detail=place%3Anot-real')
    assert.equal(staleResponse.status, 200)
    const staleMain = mainHtml(staleResponse.body)
    assert.match(staleMain, /role=["']alert["']/)
    assert.match(visibleText(staleMain), /That pick is no longer available\./)
    assert.match(staleMain, /href=["']\/internal\/page-system\/city-lagos\?type=places["']/)

    const planResponse = await request(port, '/internal/page-system/city-lagos?detail=plan%3Alagos-editorial-romantic')
    assert.equal(planResponse.status, 200)
    const planMain = mainHtml(planResponse.body)
    assert.equal(cardTags(planMain, 'plan').length, 6, 'direct plan URLs must retain the six-plan catalogue behind the detail')
    assert.match(planMain, /data-catalogue-detail/)
    assert.match(visibleText(planMain), /Romantic/)
    assert.doesNotMatch(visibleText(planMain), /plan (?:rank|score)|match score/i)

    const injectedResponse = await request(port, '/internal/page-system/city-lagos?detail=place%3A%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    assert.equal(injectedResponse.status, 200)
    const injectedMain = mainHtml(injectedResponse.body)
    assert.match(visibleText(injectedMain), /That pick is no longer available\./)
    assert.doesNotMatch(injectedMain, /<script>\s*alert\(1\)/i)
    process.stdout.write('PASS adversarial SSR invalid filters, stale details, direct plans and injected detail values\n')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2_000) })
    if (child.exitCode && child.exitCode !== 0 && child.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
}

sourceContract()
await runtimeContract()
process.stdout.write('PASS issue #2990 tester adversarial regression guard\n')
