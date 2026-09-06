#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const visibleText = (html) => html.replace(/<!--([\s\S]*?)-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

function sourceContract() {
  const page = read('app/cities/[city]/page.tsx')
  const hub = read('components/cities/city-hub.tsx')
  const catalogue = read('components/page-system/city-catalogue.tsx')
  const card = read('components/page-system/explorer-catalogue-card.tsx')
  const detail = read('components/page-system/catalogue-detail.tsx')
  const fixture = read('app/internal/page-system/city-lagos/page.tsx')
  const packageJson = JSON.parse(read('package.json'))

  assert.match(page, /city === 'lagos' \? getLagosCatalogueSnapshot\('\/cities\/lagos'\) : null/)
  assert.match(page, /catalogue=\{catalogue \? \{/)
  assert.match(page, /initialType: 'places'/)
  assert.doesNotMatch(page, /searchParams/, 'public city routes must stay statically renderable')
  assert.match(hub, /<CityHero record=\{record\} catalogueCount=\{catalogue\?\.places\.length\} \/>/)
  assert.match(hub, /\{catalogue \? \([\s\S]*?<CityCatalogue[\s\S]*?cityPath=\{cityHubPath\(record\)\}/)
  assert.match(hub, /\{catalogue \? null : <CityNavigator record=\{record\} \/>\}/)
  assert.match(hub, /\{catalogue \? null : <CityFinalActions record=\{record\} \/>\}/)
  assert(hub.indexOf('<CityCatalogue') < hub.indexOf('<CityUtilityGrid'), 'catalogue must precede local planning guidance')
  assert.match(catalogue, /readonly cityName: string/)
  assert.match(catalogue, /readonly cityPath: string/)
  assert.match(catalogue, /return `\$\{cityPath\}\?\$\{query\.toString\(\)\}`/)
  assert.match(catalogue, /syncFromLocation\(\)/, 'public query links must hydrate into filters and details')
  assert.doesNotMatch(catalogue, /const CITY_PATH = '\/internal\//)
  assert.match(card, /readonly cityName\?: string/)
  assert.match(detail, /readonly cityName: string/)
  assert.match(fixture, /cityPath=\{CURRENT_PATH\}/, 'private fixture must remain independently reviewable')
  assert.match(fixture, /cityName="Lagos"/)
  assert.match(packageJson.scripts.build, /issue-2983-lagos-catalogue-transfer\.implementor\.happy\.test\.mjs --source-only/)
  assert.match(packageJson.scripts.build, /issue-2983-lagos-catalogue-transfer\.implementor\.happy\.test\.mjs --built-only/)
  process.stdout.write('PASS #2983 public Lagos catalogue transfer source contract\n')
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'Accept-Encoding': 'identity' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitReady(port, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try { if ((await request(port, '/robots.txt')).status === 200) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready')
}

async function builtContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before #2983 Lagos catalogue runtime proof')
  const port = await availablePort()
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitReady(port, child)
    const lagos = await request(port, '/cities/lagos')
    assert.equal(lagos.status, 200)
    assert.match(visibleText(lagos.body), /Things to do in Lagos, ranked by Mingla/)
    assert.match(lagos.body, /name="robots" content="noindex, follow"/)
    assert.equal((lagos.body.match(/class="ps-catalogue-card"/g) ?? []).length, 50, 'public Lagos HTML must expose all 50 real place cards')
    assert.match(visibleText(lagos.body), /Lekki Conservation Centre/)
    assert.match(visibleText(lagos.body), /Nike Art Gallery/)
    assert.match(lagos.body, /href="\/cities\/lagos\?type=plans"/)
    assert.doesNotMatch(lagos.body, /\/internal\/page-system\/city-lagos/, 'public response must not leak private review links')

    const durham = await request(port, '/cities/durham-nc')
    assert.equal(durham.status, 200)
    assert.doesNotMatch(durham.body, /class="ps-catalogue-controls"/)
    assert.match(visibleText(durham.body), /Find the right plan in Durham/)
    process.stdout.write('PASS #2983 public Lagos serves 50 real cards while unproven cities stay catalogue-free\n')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await builtContract()
