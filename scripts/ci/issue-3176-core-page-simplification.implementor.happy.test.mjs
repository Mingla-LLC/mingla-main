#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
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
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))
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
  assert.doesNotMatch(css, /\.core-city-pills\s+(?:li|a)[^{]*\{[^}]*width:\s*100%/, 'narrow screens must keep city pills wrapping instead of stacking ten full-width rows')
  assert.match(css, /\.core-city-pills a\s*\{[^}]*min-height:\s*44px/, 'city pills must retain 44px touch targets')
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

async function waitFor(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`)
}

class CdpPage {
  constructor(url) {
    this.nextId = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 20_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

async function verifyNarrowHeroGeometry(port) {
  if (process.env.VERCEL === '1') {
    process.stdout.write('SKIP #3176 320px hero geometry on Vercel only; source and runtime contracts executed\n')
    return
  }
  assert(CHROME, 'Chrome is required for the #3176 320px hero geometry guard')
  assert.equal(typeof WebSocket, 'function', 'run the built guard with command-scoped --experimental-websocket')
  const chromePort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-cities-'))
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    'about:blank',
  ], { stdio: 'ignore' })
  let page
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'owned Chrome did not start')
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
    page = new CdpPage(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/cities` })
    await waitFor(() => page.evaluate("document.readyState === 'complete' && !!document.querySelector('.core-cities-hero')"), '/cities did not load for 320px geometry proof')
    await page.evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()')
    const geometry = await page.evaluate(`(()=>{
      const rect=(element)=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}}
      const hero=rect(document.querySelector('.core-cities-hero'))
      const nav=rect(document.querySelector('.core-city-pills'))
      const cue=rect(document.querySelector('.core-cities-scroll'))
      const pills=[...document.querySelectorAll('[data-city-pill]')].map(rect)
      return {hero,nav,cue,pills,innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}
    })()`)
    const geometryEvidence = JSON.stringify(geometry)
    assert.equal(geometry.pills.length, 10, '320px hero must show all ten city pills')
    assert.equal(geometry.overflow, 0, '320px hero must not create horizontal overflow')
    assert(Math.abs(geometry.hero.height - geometry.innerHeight) <= 1, `320px hero must remain exactly 100svh: ${geometryEvidence}`)
    assert(geometry.cue.top >= geometry.hero.top && geometry.cue.bottom <= geometry.hero.bottom && geometry.cue.top < geometry.innerHeight, `320px scroll cue must remain visible and inside the hero: ${geometryEvidence}`)
    assert(geometry.nav.bottom <= geometry.cue.top - 12, `320px city pills need at least 12px clearance above the scroll cue: ${geometryEvidence}`)
    for (const [index, pill] of geometry.pills.entries()) {
      assert(pill.width >= 44 && pill.height >= 44, `320px pill ${index + 1} lost its 44px target`)
      assert(pill.left >= 0 && pill.right <= 320, `320px pill ${index + 1} overflows horizontally`)
      assert(pill.top >= 0 && pill.bottom <= geometry.cue.top - 12, `320px pill ${index + 1} is clipped or overlaps the scroll cue`)
    }
    process.stdout.write(`PASS #3176 320px/400%-equivalent hero geometry ${geometryEvidence}\n`)
  } finally {
    if (page) {
      try { await page.send('Browser.close') } catch {}
      page.close()
    }
    await stopOwnedChild(chrome)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
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
    await verifyNarrowHeroGeometry(port)
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
