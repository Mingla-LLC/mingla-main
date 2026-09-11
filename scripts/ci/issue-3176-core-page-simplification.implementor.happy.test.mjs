#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(ROOT, relative))
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const CITIES = [
  ['Lagos', '/cities/lagos', 'lagos.jpg'],
  ['Durham', '/cities/durham-nc', 'durham-nc.jpg'],
  ['Cary', '/cities/cary-nc', 'cary-nc.jpg'],
  ['Raleigh', '/cities/raleigh-nc', 'raleigh-nc.jpg'],
  ['New York City', '/cities/new-york-city', 'new-york-city.jpg'],
  ['Brussels', '/cities/brussels', 'brussels.jpg'],
  ['Paris', '/cities/paris', 'paris.jpg'],
  ['London', '/cities/london', 'london.jpg'],
  ['Fort Lauderdale', '/cities/fort-lauderdale', 'fort-lauderdale.jpg'],
  ['Washington, DC', '/cities/washington-dc', 'washington-dc.jpg'],
]
const REMOVED_COPY = [
  'Reviewed by the Mingla team',
  'How Mingla publishes information',
  'Contact and corrections',
  'What Mingla can and cannot verify',
  'Product record',
  'Why a city may not be linked yet',
  'Corrections and local knowledge',
  'Policy record',
]

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function verifySource(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const about = source('mingla-marketing/app/(core)/about/page.tsx')
  const explorer = source('mingla-marketing/app/(core)/explorer/page.tsx')
  const cities = source('mingla-marketing/app/(core)/cities/page.tsx')
  const standards = source('mingla-marketing/app/(core)/editorial-standards/page.tsx')
  const directory = source('mingla-marketing/components/core-pages/city-directory.tsx')
  const hero = source('mingla-marketing/components/core-pages/cities-hero.tsx')
  const answer = source('mingla-marketing/components/cutout/answer.tsx')
  const hub = source('mingla-marketing/components/cities/city-hub.tsx')
  const css = source('mingla-marketing/components/core-pages/core-pages.css')
  const manifestRelative = 'mingla-marketing/public/marketing/cities/asset-manifest.json'
  const manifest = JSON.parse(source(manifestRelative))

  assert.match(cities, /<CitiesHero\s*\/>/, '/cities must use the dedicated cinematic hero')
  assert.equal((cities.match(/<CityDirectory/g) ?? []).length, 1, '/cities must render one city grid')
  assert.match(cities, /<h2>Choose your city\.<\/h2>/)
  assert.match(hero, /Explore Mingla city by city\./)
  assert.match(hero, /Pick a city to discover its top-ranked places and turn what sounds good into a plan\./)
  assert.equal((hero.match(/data-city-pill/g) ?? []).length, 1, 'hero needs the shared ten-pill mapping')
  assert.match(hero, /min-h-\[100svh\]/)
  assert.doesNotMatch(hero, /CutReveal|motion\./, 'hero meaning must render in its final position without client-only reveal')
  assert.match(hero, /<nav aria-label="Choose a Mingla city"[\s\S]*?<ul>[\s\S]*?CITY_HUBS\.map/)
  assert.match(directory, /data-city-card/)
  assert.match(directory, /aria-label=\{`Explore \$\{city\.city\}`\}/)
  assert.match(directory, /<Image[\s\S]*?alt=""[\s\S]*?fill/)
  assert.doesNotMatch(directory, /country|scopeLabel|review|status|ready/i)
  for (const [name, pathname, image] of CITIES) {
    assert(directory.includes(`'${image}'`), `missing ${name} card image`)
    assert(hero.includes('CITY_HUBS.map'), 'hero pills must use the canonical city registry')
    assert(cities.includes('<CityDirectory />'), '/cities must use the shared directory')
    assert(pathname.startsWith('/cities/'))
  }
  assert.match(about, /<CityDirectory\s*\/>/)
  assert.match(explorer, /<CityDirectory\s*\/>/)
  assert.match(about, /Lagos, Durham, Cary, Raleigh, New York City, Brussels, Paris, London, Fort Lauderdale and Washington, DC each have their own Mingla city page\./)
  assert.match(explorer, /Pick the city you are in—or the one you are heading to\./)
  for (const phrase of REMOVED_COPY) {
    assert(![about, explorer, cities, standards, answer].join('\n').includes(phrase), `removed public copy remains: ${phrase}`)
  }
  assert(!exists('mingla-marketing/components/core-pages/review-record.tsx'), 'orphaned ReviewRecord component must be removed')
  assert.doesNotMatch(answer, /lastChecked/)
  assert.match(hub, /historicalCityBuildEnabled\(\)/)
  assert.match(hub, /lifecycle === 'public_noindex' && !historical/)
  assert.match(hub, /if \(!historicalCityBuildEnabled\(\)\) return null/)
  assert.match(css, /aspect-ratio:\s*4\s*\/\s*5/)
  assert.match(css, /@media \(max-width:1023px\)[\s\S]*aspect-ratio:\s*4\s*\/\s*3/)
  assert.match(css, /@media \(max-width:519px\)[\s\S]*aspect-ratio:\s*16\s*\/\s*10/)
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/)

  assert.equal(manifest.schemaVersion, 1, 'city asset manifest needs its supported schema')
  assert.equal(manifest.assets.length, 11, 'city asset manifest needs one hero and ten card images')
  const heroAsset = manifest.assets.find((asset) => asset.path === '/marketing/cities/cities-hero.jpg')
  assert(heroAsset, 'city hero must be registered in the asset manifest')
  assert.equal(heroAsset.role, 'cities-hero-poster')
  assert.equal(heroAsset.source, 'Magnific Image Generator')
  assert.equal(heroAsset.aiGenerated, true)
  assert.equal(heroAsset.documentary, false)
  assert(heroAsset.creationId, 'generated city hero needs a creation ID')
  const heroRelative = `mingla-marketing/public${heroAsset.path}`
  assert(exists(heroRelative), 'registered city hero file must exist')
  assert.equal(sha256(heroRelative), heroAsset.sha256, 'city hero hash must match its provenance record')
  for (const [city, , image] of CITIES) {
    const publicPath = `/marketing/cities/cards/${image}`
    const asset = manifest.assets.find((candidate) => candidate.path === publicPath)
    assert(asset, `${city} card must be registered in the asset manifest`)
    assert.equal(asset.role, 'city-card')
    assert.equal(asset.city, city)
    assert.equal(asset.source, 'Unsplash')
    assert.match(asset.sourceUrl, /^https:\/\/unsplash\.com\/photos\//)
    assert(asset.author, `${city} card needs an author`)
    assert.equal(asset.license, 'Unsplash License')
    assert.equal(asset.licenseUrl, 'https://unsplash.com/license')
    assert.equal(asset.aiGenerated, false, `${city} card cannot be AI-generated`)
    assert(asset.location, `${city} card needs a verified location`)
    const relative = `mingla-marketing/public${publicPath}`
    assert(exists(relative), `${city} card image file must exist`)
    assert.equal(sha256(relative), asset.sha256, `${city} card hash must match its provenance record`)
  }

  const packageJson = JSON.parse(source('mingla-marketing/package.json'))
  assert.match(packageJson.scripts['test:issue-3176'], /issue-3176-core-page-simplification\.implementor\.happy\.test\.mjs --source-only/)
  assert.match(packageJson.scripts.build, /issue-3176-core-page-simplification\.implementor\.happy\.test\.mjs --source-only/)
  assert.match(source('scripts/ci/issue-3176-rework.implementor.happy.test.mjs'), /issue-3176-core-page-simplification\.implementor\.happy\.test\.mjs', '--built-only'/)
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
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'accept-encoding': 'identity' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function verifyRuntime() {
  assert(exists('mingla-marketing/.next/BUILD_ID'), 'run the current release build first')
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: MARKETING,
    env: { ...process.env, MINGLA_HISTORICAL_2983_BUILD: '' },
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
    for (const pathname of ['/about', '/explorer', '/cities', '/editorial-standards']) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} must render`)
      const text = visibleText(response.body)
      for (const phrase of REMOVED_COPY) assert(!text.includes(phrase), `${pathname} renders removed copy: ${phrase}`)
      assert.match(response.body, /name="robots" content="noindex, follow"|content="noindex, follow" name="robots"/i, `${pathname} must remain noindex`)
    }
    const directory = await request(port, '/cities')
    assert.equal((directory.body.match(/<h1\b/gi) ?? []).length, 1, '/cities needs one H1')
    assert.equal((directory.body.match(/data-city-pill="/g) ?? []).length, 10, '/cities needs ten pills')
    assert.equal((directory.body.match(/data-city-card="/g) ?? []).length, 10, '/cities needs ten cards')
    for (const [, pathname] of CITIES) {
      const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.equal((directory.body.match(new RegExp(`href="${escaped}"`, 'g')) ?? []).length, 2, `${pathname} needs one pill and one card`)
    }
    for (const [, pathname] of CITIES) {
      const hub = await request(port, pathname)
      const text = visibleText(hub.body)
      assert.equal(hub.status, 200, `${pathname} must render`)
      for (const phrase of ['City guide in review', 'Evidence before promotion', 'How this ', 'Sources checked', 'Local review', 'Next evergreen review']) {
        assert(!text.includes(phrase), `${pathname} renders internal lifecycle/evidence copy: ${phrase}`)
      }
      assert.equal((hub.body.match(/class="ps-catalogue-card"/g) ?? []).length, 50, `${pathname} must retain its 50-place catalogue`)
    }
  } finally {
    server.kill('SIGTERM')
    await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1500) })
  }
}

if (!BUILT_ONLY) verifySource()
if (!SOURCE_ONLY) await verifyRuntime()
if (SELF_TEST) {
  const relative = 'mingla-marketing/app/(core)/cities/page.tsx'
  const reverted = read(relative).replace('<CitiesHero />', '')
  assert.throws(() => verifySource({ [relative]: reverted }), /dedicated cinematic hero/, 'removing the approved cities hero must prove RED')
  process.stdout.write('RED proof: removing the approved cities hero was rejected\n')
}
process.stdout.write('PASS #3176 simplified core pages and cinematic city directory\n')
