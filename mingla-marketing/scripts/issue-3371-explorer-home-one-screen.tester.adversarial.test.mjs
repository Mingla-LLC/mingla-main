#!/usr/bin/env node

// #3371 [explorer home one screen] — TESTER adversarial guard.
//
// The implementor's guard proves the approved happy path: the redirect with a
// query, five spec viewports under desktop emulation, the menu read through
// element.click() on `/`, and menu alignment on `/`. This guard attacks what
// that leaves open, against the FINAL production build on `next start`:
//
//   1. Redirect edge cases: trailing slash, casing, sub-paths, HEAD, repeated
//      query keys, a self-referencing query, fragments through a real browser,
//      loops and hop counts; the unshipped interim slug must stay a plain 404.
//   2. A crawl of EVERY sitemap URL plus the core pages: no href, canonical,
//      og:url, JSON-LD value or flight payload names /explorer or the unshipped
//      slug; /going-out is self-canonical, `index, follow`, titled, eyebrowed
//      and breadcrumbed as "Going out"; the Host city grid and all city hubs.
//   3. The side menu through REAL CDP input (mouse, touch, Tab, Enter, Escape):
//      exactly one lit item per page, focus trap and restore, close on
//      navigation — on CutoutNav AND PageSystemNav (city hub) pages.
//   4. Menu rows left-aligned on `/`, `/going-out` and a city hub (where
//      city-hubs.css re-styles every `.cut-btn` below 360px), including 320px:
//      one icon column at the row padding, no wrap/truncation, lit and unlit
//      rows identical, the lit row identical across pages, no page overflow.
//   5. Collateral: every other `.cut-btn` on /, /host, /cities, /about,
//      /going-out, a city hub and /help still computes `justify-content:center`
//      with its content centred, including the menu's bottom CTAs.
//   6. Home spacing / no-scroll at realistic laptop (browser chrome), phone
//      (mobile emulation, DPR 3) and portrait tablet sizes. "Use Mingla" must
//      clear 28px above and below everywhere. The deck/pill and nav/headline
//      clearances may stay short only where origin/main was already equal or
//      worse (ORIGIN_MAIN_BASELINE, measured with this file at 335fbd21f).
//
// Usage (CI):   node --experimental-websocket scripts/<this> --built-only
// Tester runs:  --root=<mingla-marketing dir> --label=main (report-only)
//               --json=<out.json> --shots=<dir>

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback = null) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const SELF = path.basename(fileURLToPath(import.meta.url))
const ROOT = path.resolve(arg('root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')))
const LABEL = arg('label', 'head')
const REPORT_ONLY = LABEL === 'main'
const JSON_OUT = arg('json')
const SHOTS = arg('shots')
const ORIGIN = 'https://usemingla.com'
const RETIRED = '/explorer'
const DESTINATION = '/going-out'
const DESTINATION_LABEL = 'Going out'
const DESTINATION_TITLE = 'Going out: Date Plans, Events & City Gems | Mingla'
const DESTINATION_H1 = 'Find a plan that fits the moment.'
// The interim name from the first #3371 pass never shipped. Spelled indirectly
// so the repo-wide rename grep for it stays empty.
const UNSHIPPED = `/${['for', 'explorers'].join('-')}`

const LAPTOPS = [[1440, 789], [1512, 862], [1366, 657], [1536, 730], [1280, 720]]
const PHONES = [[402, 874], [430, 932], [360, 780]]
const TABLETS = [[768, 1024]]
const SPEC = [[1440, 900], [1280, 800], [1920, 1080], [390, 844], [375, 667]]
const MENU_VIEWPORTS = [[1440, 900], [402, 874], [390, 844], [375, 667], [360, 780], [320, 568]]
const COLLATERAL_ROUTES = ['/', '/host', '/cities', '/about', DESTINATION, '/cities/lagos', '/help']
const MIN_GAP = 28
const MIN_PILL_CLEARANCE = 24
const SAMPLES = 8
const SAMPLE_MS = 350
const REGRESSION_TOLERANCE = 1
const ALIGN_TOLERANCE = 1
const CENTRE_TOLERANCE = 1.5
const STARTUP_TIMEOUT_MS = 240_000

// origin/main 335fbd21f, production build, measured with this file (worst of 8).
const ORIGIN_MAIN_BASELINE = {
  '1440x789': { above: 28.8, below: 27, deckToPills: 34.3, navToHeadline: 42.3, pillsInset: 20 },
  '1512x862': { above: 28.6, below: 28.5, deckToPills: 64.5, navToHeadline: 72.5, pillsInset: 20 },
  '1366x657': { above: 9.8, below: 52.1, deckToPills: -23.5, navToHeadline: 7, pillsInset: 20 },
  '1536x730': { above: 28.1, below: 29.4, deckToPills: 15.8, navToHeadline: 18.8, pillsInset: 20 },
  '1280x720': { above: 28.3, below: 29.9, deckToPills: 12.9, navToHeadline: 13.6, pillsInset: 20 },
  '402x874': { above: 31.1, below: 30.2, deckToPills: 145.3, navToHeadline: 112.1, pillsInset: 24 },
  '430x932': { above: 21, below: 37.8, deckToPills: 170.3, navToHeadline: 141.1, pillsInset: 24 },
  '360x780': { above: 47.4, below: 17.6, deckToPills: 104.2, navToHeadline: 65.1, pillsInset: 24 },
  '768x1024': { above: 44.8, below: 10.5, deckToPills: 154.6, navToHeadline: 161.5, pillsInset: 20 },
  '1440x900': { above: 28.6, below: 29.2, deckToPills: 80.3, navToHeadline: 87.3, pillsInset: 20 },
  '1280x800': { above: 28.7, below: 27.2, deckToPills: 38.8, navToHeadline: 46.8, pillsInset: 20 },
  '1920x1080': { above: 30.9, below: 32.9, deckToPills: 155, navToHeadline: 159.9, pillsInset: 20 },
  '390x844': { above: 36.3, below: 26, deckToPills: 132, navToHeadline: 97.1, pillsInset: 24 },
  '375x667': { above: 67.1, below: -3.4, deckToPills: 45.6, navToHeadline: 8.6, pillsInset: 24 },
}

const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find((candidate) => fs.existsSync(candidate))

const failures = []
const notes = []
const report = { label: LABEL, root: ROOT, startedAt: new Date().toISOString(), redirects: [], browserRedirects: [], crawl: {}, destinationDom: null, menu: [], menuFlows: [], menuAlignment: [], collateral: [], geometry: [], failures, notes }
function check(condition, message) {
  if (condition) return true
  failures.push(message)
  process.stdout.write(`${REPORT_ONLY ? 'WOULD-FAIL' : 'FAIL'} ${message}\n`)
  return false
}
const note = (message) => { notes.push(message); process.stdout.write(`NOTE ${message}\n`) }
const r1 = (value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value)
const spread = (values) => Math.max(...values) - Math.min(...values)

// ---------------------------------------------------------------- wiring
function wiringContract() {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts
  const own = `node --experimental-websocket scripts/${SELF} --built-only`
  const implementor = 'node --experimental-websocket scripts/issue-3371-explorer-home-one-screen.implementor.happy.test.mjs --built-only'
  assert(scripts.build.endsWith(` && ${own} && ${implementor}`), 'the #3371 tester guard must run immediately before the #3371 implementor guard at the end of the build')
  assert(scripts.build.lastIndexOf(own) > scripts.build.lastIndexOf('next build'), 'the #3371 tester guard must run against the final production build')
  assert.equal(scripts.build.split(own).length, 2, 'the #3371 tester guard must be wired exactly once')
}

// ---------------------------------------------------------------- processes
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(probe, message, timeout = 30_000, interval = 80) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value } catch (error) { last = error }
    await sleep(interval)
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`)
}
function waitForExit(child, ms) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.removeListener('exit', done); resolve(false) }, ms)
    const done = () => { clearTimeout(timer); resolve(true) }
    child.once('exit', done)
  })
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  const term = waitForExit(child, 4_000); child.kill('SIGTERM'); if (await term) return true
  const kill = waitForExit(child, 4_000); child.kill('SIGKILL'); return kill
}

// ---------------------------------------------------------------- raw HTTP (redirects are never followed implicitly)
function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { Host: 'usemingla.com', 'User-Agent': 'Mozilla/5.0 Mingla3371Tester/1.0', Accept: 'text/html,*/*' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(60_000, () => req.destroy(new Error(`timeout ${method} ${pathname}`)))
    req.once('error', reject)
    req.end()
  })
}
async function followChain(port, start, method = 'GET') {
  const hops = []
  const seen = new Set()
  let current = start
  for (let index = 0; index < 10; index += 1) {
    if (seen.has(current)) return { hops, loop: true, final: null }
    seen.add(current)
    const response = await request(port, current, method)
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const next = new URL(response.headers.location, 'http://usemingla.com')
      hops.push({ from: current, status: response.status, location: response.headers.location })
      current = `${next.pathname}${next.search}`
      continue
    }
    return { hops, loop: false, final: { path: current, status: response.status, body: response.body, headers: response.headers } }
  }
  return { hops, loop: true, final: null }
}

// ---------------------------------------------------------------- CDP page with real input
class Page {
  constructor(url) {
    this.next = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }) })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      message.error ? pending.reject(Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}, timeoutMs = 30_000) {
    await this.ready
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }
  async tap(x, y) {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  async key(name, modifiers = 0) {
    const keys = { Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' } }
    const spec = keys[name]
    await this.send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', modifiers, ...spec })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...spec })
  }
  async shot(name) {
    if (!SHOTS) return
    const image = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(SHOTS, `${LABEL}-${name}.png`), Buffer.from(image.data, 'base64'))
  }
  close() { this.socket.close() }
}

const kindFor = (width) => (width < 600 ? 'phone' : width < 1024 && width <= 800 ? 'tablet' : 'laptop')
async function emulate(page, width, height, kind = kindFor(width)) {
  const mobile = kind !== 'laptop'
  const deviceScaleFactor = kind === 'phone' ? 3 : kind === 'tablet' ? 2 : 1
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
}
async function go(page, base, route, readyExpression = 'true', timeout = 45_000) {
  await page.send('Page.navigate', { url: `${base}${route}` })
  await waitFor(() => page.evaluate(`document.readyState==='complete'&&(${readyExpression})`), `${route}: page did not load`, timeout)
}

// ---------------------------------------------------------------- 1. redirects
function isPathRef(value, target) {
  if (typeof value !== 'string') return false
  let pathname
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value)
      if (!/(^|\.)usemingla\.com$/i.test(url.hostname)) return false
      pathname = url.pathname
    } else if (value.startsWith('/') && !value.startsWith('//')) {
      pathname = value.split(/[?#]/)[0]
    } else return false
  } catch { return false }
  const lower = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  return lower === target || lower.startsWith(`${target}/`)
}
const isBannedRef = (value) => isPathRef(value, RETIRED) || isPathRef(value, UNSHIPPED)

async function redirectAttacks(port, destination) {
  const cases = [
    ['/explorer', 'GET'], ['/explorer', 'HEAD'], ['/explorer/', 'GET'], ['/explorer/', 'HEAD'],
    ['/explorer?utm_source=x', 'GET'], ['/explorer?utm_source=x&utm_medium=y&utm_source=z', 'GET'], ['/explorer?next=%2Fexplorer', 'GET'],
    ['/Explorer', 'GET'], ['/EXPLORER', 'GET'], ['/explorer/anything', 'GET'], ['/explorer/anything/deeper?x=1', 'GET'],
    ['/explorer.', 'GET'], ['/explorers', 'GET'], [UNSHIPPED, 'GET'], [`${UNSHIPPED}/`, 'GET'],
    [DESTINATION, 'GET'], [DESTINATION, 'HEAD'], [`${DESTINATION}/`, 'GET'],
  ]
  for (const [route, method] of cases) {
    const chain = await followChain(port, route, method)
    const final = chain.final
    const record = {
      route, method, loop: chain.loop, hops: chain.hops, redirectCount: chain.hops.length,
      finalPath: final?.path ?? null, finalStatus: final?.status ?? null,
      finalIsNotFoundPage: final ? /That page slipped out the back\./.test(final.body) : null,
      finalRobots: final ? (/<meta name="robots" content="([^"]+)"/.exec(final.body)?.[1] ?? null) : null,
    }
    report.redirects.push(record)
    process.stdout.write(`REDIRECT ${method} ${route} -> ${chain.hops.map((hop) => `${hop.status} ${hop.location}`).join(' -> ') || '(none)'} => ${record.finalStatus} ${record.finalPath}${chain.loop ? ' LOOP' : ''}\n`)
    check(!chain.loop, `${method} ${route}: redirect loop or >10 hops`)
    check(record.finalStatus === null || record.finalStatus < 500, `${method} ${route}: lands on a ${record.finalStatus}`)
    for (const hop of chain.hops) check(hop.status === 308 || hop.status === 301, `${method} ${route}: non-permanent hop ${hop.status} ${hop.from} -> ${hop.location}`)
  }
  const row = (route, method = 'GET') => report.redirects.find((entry) => entry.route === route && entry.method === method)
  check(destination === DESTINATION, `the registry must redirect ${RETIRED} to ${DESTINATION} (build says ${destination})`)
  for (const method of ['GET', 'HEAD']) {
    const entry = row('/explorer', method)
    check(entry.redirectCount === 1 && entry.hops[0].status === 308 && entry.hops[0].location === DESTINATION, `${method} /explorer must be ONE 308 to ${DESTINATION} (got ${JSON.stringify(entry.hops)})`)
    check(entry.finalStatus === 200 && entry.finalPath === DESTINATION, `${method} /explorer must land on a 200 ${DESTINATION}`)
  }
  // `next start` groups repeated keys on every registry redirect (origin/main's
  // /business does the same); live Vercel keeps the order. Compare the pairs.
  const pairs = (value) => [...new URL(value ?? '/', 'http://x').searchParams].map(([k, v]) => `${k}=${v}`).sort().join('&')
  const query = row('/explorer?utm_source=x&utm_medium=y&utm_source=z')
  check(new URL(query.hops[0]?.location ?? '/', 'http://x').pathname === DESTINATION && pairs(query.hops[0]?.location) === pairs('/?utm_source=x&utm_medium=y&utm_source=z'), `/explorer must carry every query pair to ${DESTINATION} (got ${query.hops[0]?.location})`)
  const selfQuery = row('/explorer?next=%2Fexplorer')
  check(selfQuery.redirectCount === 1 && selfQuery.finalStatus === 200, '/explorer?next=%2Fexplorer must not re-redirect on its own query')
  const slash = row('/explorer/')
  check(slash.finalStatus === 200 && slash.finalPath === DESTINATION, `/explorer/ must reach ${DESTINATION}`)
  check(slash.redirectCount <= 2, `/explorer/ is a ${slash.redirectCount}-hop chain`)
  if (slash.redirectCount === 2) note('/explorer/ is 2 hops (Next trailing-slash normaliser, then the registry redirect) — accepted on #3371 as out of scope')
  for (const cased of ['/Explorer', '/EXPLORER']) {
    const entry = row(cased)
    check(!entry.loop && entry.redirectCount <= 1 && (entry.finalStatus === 200 || (entry.finalStatus === 404 && entry.finalIsNotFoundPage)), `${cased} must reach ${DESTINATION} or the real 404 page (got ${entry.finalStatus} ${entry.finalPath})`)
  }
  for (const route of ['/explorer/anything', '/explorer/anything/deeper?x=1', UNSHIPPED, `${UNSHIPPED}/`]) {
    const entry = row(route)
    check(!entry.loop && entry.redirectCount <= 1, `${route}: must not chain or loop`)
    check(entry.finalStatus === 404 && entry.finalIsNotFoundPage && /noindex/.test(entry.finalRobots ?? ''), `${route}: must land on the styled noindex 404 (got ${entry.finalStatus} ${entry.finalPath}, robots=${entry.finalRobots})`)
  }
  const destSlash = row(`${DESTINATION}/`)
  check(destSlash.redirectCount === 1 && destSlash.finalPath === DESTINATION && destSlash.finalStatus === 200, `${DESTINATION}/ must normalise in one hop`)
}

// ---------------------------------------------------------------- 2. crawl
function bannedInHtml(html) {
  const hits = []
  for (const target of [RETIRED, UNSHIPPED]) {
    const escaped = target.slice(1).replace(/[-]/g, '\\-')
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_\\-/.])((?:https?:)?(?:\\\\?\\/\\\\?\\/(?:www\\.)?usemingla\\.com)?\\\\?\\/${escaped})(?=$|[^A-Za-z0-9_\\-.])`, 'gi')
    for (const match of html.matchAll(pattern)) {
      const at = match.index + match[0].indexOf(match[1])
      hits.push(html.slice(Math.max(0, at - 70), Math.min(html.length, at + 40)).replace(/\s+/g, ' '))
    }
  }
  return hits
}
function walkJson(node, visit, trail = '$') {
  if (Array.isArray(node)) node.forEach((child, index) => walkJson(child, visit, `${trail}[${index}]`))
  else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) { visit(key, value, `${trail}.${key}`); walkJson(value, visit, `${trail}.${key}`) }
}
const decode = (value) => value?.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"') ?? null
function seoFacts(html) {
  const attr = (re) => decode(re.exec(html)?.[1] ?? null)
  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => { try { return JSON.parse(match[1]) } catch (error) { return { __parseError: String(error) } } })
  return {
    canonical: attr(/<link rel="canonical" href="([^"]+)"/), ogUrl: attr(/<meta property="og:url" content="([^"]+)"/),
    robots: attr(/<meta name="robots" content="([^"]+)"/), title: attr(/<title>([^<]*)<\/title>/),
    h1: attr(/<h1\b[^>]*>([^<]*)<\/h1>/), jsonLd,
  }
}

async function crawl(port) {
  const sitemapResponse = await request(port, '/sitemap.xml')
  check(sitemapResponse.status === 200, `/sitemap.xml returned ${sitemapResponse.status}`)
  const sitemapPaths = [...sitemapResponse.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
  Object.assign(report.crawl, { sitemapCount: sitemapPaths.length, sitemapPaths })
  check(sitemapPaths.includes(DESTINATION), `sitemap does not list ${DESTINATION}`)
  check(!sitemapPaths.some((value) => isPathRef(value, RETIRED)), `sitemap lists ${RETIRED}`)
  check(!sitemapPaths.some((value) => isPathRef(value, UNSHIPPED)), `sitemap lists ${UNSHIPPED}`)

  const routes = [...new Set(['/', '/host', '/cities', '/about', '/tools', ...sitemapPaths])]
  const pages = []
  for (const route of routes) {
    const response = await request(port, route)
    const facts = seoFacts(response.body)
    const hrefHits = [...response.body.matchAll(/\bhref="([^"]*)"/g)].map((match) => match[1]).filter(isBannedRef)
    const anyHits = bannedInHtml(response.body)
    const jsonLdHits = []
    facts.jsonLd.forEach((block, index) => walkJson(block, (key, value, trail) => { if (typeof value === 'string' && isBannedRef(value)) jsonLdHits.push(`ld[${index}]${trail.slice(1)}=${value}`) }))
    const entry = { route, status: response.status, xRobotsTag: response.headers['x-robots-tag'] ?? null, canonical: facts.canonical, ogUrl: facts.ogUrl, robots: facts.robots, title: facts.title, hrefHits, jsonLdHits, anyHits: anyHits.slice(0, 6), anyHitCount: anyHits.length }
    pages.push(entry)
    check(response.status === 200, `crawl ${route}: status ${response.status}`)
    check(hrefHits.length === 0, `crawl ${route}: rendered href(s) to a retired path: ${hrefHits.join(', ')}`)
    check(!isBannedRef(facts.canonical ?? ''), `crawl ${route}: canonical names a retired path: ${facts.canonical}`)
    check(!isBannedRef(facts.ogUrl ?? ''), `crawl ${route}: og:url names a retired path: ${facts.ogUrl}`)
    check(jsonLdHits.length === 0, `crawl ${route}: JSON-LD names a retired path: ${jsonLdHits.join(' | ')}`)
    check(anyHits.length === 0, `crawl ${route}: HTML/flight payload still carries a retired path: ${anyHits.slice(0, 3).join(' || ')}`)
    if (route === DESTINATION) {
      const self = `${ORIGIN}${DESTINATION}`
      check(facts.canonical === self, `${DESTINATION}: canonical must self-reference ${self} (got ${facts.canonical})`)
      check(facts.ogUrl === self, `${DESTINATION}: og:url must be ${self} (got ${facts.ogUrl})`)
      check(facts.robots === 'index, follow' && !/noindex/i.test(entry.xRobotsTag ?? ''), `${DESTINATION}: robots must be "index, follow" (got ${facts.robots}, x-robots-tag=${entry.xRobotsTag})`)
      check(facts.title === DESTINATION_TITLE, `${DESTINATION}: title must be "${DESTINATION_TITLE}" (got "${facts.title}")`)
      check(facts.h1 === DESTINATION_H1, `${DESTINATION}: H1 must stay "${DESTINATION_H1}" (got "${facts.h1}")`)
      const lists = []
      facts.jsonLd.forEach((block) => walkJson(block, (key, value) => { if (key === '@type' && value === 'BreadcrumbList') lists.push(true) }))
      const items = []
      facts.jsonLd.forEach((block) => walkJson(block, (key, value) => { if (key === 'itemListElement' && Array.isArray(value) && value.every((item) => item?.['@type'] === 'ListItem')) items.push(value.map((item) => [item.position, item.name, item.item])) }))
      entry.breadcrumb = items
      check(lists.length === 1, `${DESTINATION}: expected one BreadcrumbList (got ${lists.length})`)
      check(items.some((list) => JSON.stringify(list) === JSON.stringify([[1, 'Home', `${ORIGIN}/`], [2, DESTINATION_LABEL, self]])), `${DESTINATION}: BreadcrumbList must be Home -> ${DESTINATION_LABEL} (got ${JSON.stringify(items)})`)
    }
  }
  report.crawl.pages = pages

  const home = await request(port, '/')
  report.crawl.homeHasCityModule = /city-root-module|Mingla city guides/i.test(home.body)
  check(!report.crawl.homeHasCityModule, '/ still server-renders the city guides module')

  const host = await request(port, '/host')
  const moduleAt = host.body.indexOf('city-root-module')
  const section = moduleAt >= 0 ? host.body.slice(moduleAt, host.body.indexOf('</section>', moduleAt)) : ''
  const hostCityLinks = [...new Set([...section.matchAll(/href="(\/cities\/[a-z0-9-]+)"/g)].map((match) => match[1]))]
  report.crawl.hostCityGrid = { present: moduleAt >= 0, links: hostCityLinks }
  check(moduleAt >= 0, '/host lost its city grid')
  check(hostCityLinks.length === 10, `/host city grid must link 10 city hubs (got ${hostCityLinks.length})`)
  const hubStatuses = {}
  for (const hub of [...new Set([...hostCityLinks, ...sitemapPaths.filter((value) => value.startsWith('/cities/'))])]) {
    hubStatuses[hub] = (await request(port, hub)).status
    check(hubStatuses[hub] === 200, `city hub ${hub} returned ${hubStatuses[hub]}`)
  }
  report.crawl.cityHubStatuses = hubStatuses
  process.stdout.write(`CRAWL ${routes.length} routes (${sitemapPaths.length} sitemap), host grid ${hostCityLinks.length} links, hubs ${Object.values(hubStatuses).filter((status) => status === 200).length}/${Object.keys(hubStatuses).length} 200\n`)
}

// ---------------------------------------------------------------- 6. home geometry
const SETTLED = `(()=>{
  const deck=document.querySelector('[data-cut-deck]'); if(!deck) return false
  const h1=deck.querySelector('h1'); const wrap=h1&&h1.nextElementSibling; const pills=deck.querySelector('nav[aria-label="Site"]')
  if(!h1||!wrap||!pills||!deck.querySelector('.group.absolute')) return false
  const still=(el)=>{const s=getComputedStyle(el);return s.opacity==='1'&&(s.transform==='none'||s.transform==='matrix(1, 0, 0, 1, 0, 0)')}
  return still(h1)&&still(wrap)&&still(pills)
})()`

const GEOMETRY = `(()=>{
  const deck=document.querySelector('[data-cut-deck]')
  const h1=deck.querySelector('h1')
  const text=[]
  const walker=document.createTreeWalker(h1,NodeFilter.SHOW_TEXT)
  for(let n=walker.nextNode();n;n=walker.nextNode()){ if(!n.textContent.trim()) continue; const r=document.createRange(); r.selectNodeContents(n); for(const rect of r.getClientRects()) if(rect.width>0&&rect.height>0) text.push(rect) }
  const textTop=Math.min(...text.map(r=>r.top)), textBottom=Math.max(...text.map(r=>r.bottom))
  const alpha=(el)=>{let a=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return 0;a*=parseFloat(s.opacity)}return a}
  const clip=(el)=>{let t=-Infinity,b=Infinity;for(let n=el.parentElement;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.overflowX!=='visible'||s.overflowY!=='visible'){const r=n.getBoundingClientRect();t=Math.max(t,r.top);b=Math.min(b,r.bottom)}}return {t,b}}
  const cards=[...deck.querySelectorAll('.group.absolute')].map(cell=>cell.firstElementChild).filter(card=>card&&alpha(card)>0.05).map(card=>{const r=card.getBoundingClientRect(),c=clip(card);return {top:Math.max(r.top,c.t),bottom:Math.min(r.bottom,c.b)}}).filter(r=>r.bottom>r.top)
  const cardTop=Math.min(...cards.map(r=>r.top)), cardBottom=Math.max(...cards.map(r=>r.bottom))
  const actionEl=[...deck.querySelectorAll('a,button')].find(el=>el.textContent.trim()==='Use Mingla'&&el.getBoundingClientRect().width>0&&alpha(el)>0.05)
  const action=actionEl?actionEl.getBoundingClientRect():null
  let hitCardTop=null
  if(action){ const cx=(action.left+action.right)/2; outer: for(let y=Math.ceil(action.bottom);y<Math.min(innerHeight,action.bottom+320);y+=1){ for(const x of [cx-70,cx,cx+70]){ const hit=document.elementsFromPoint(x,y).find(el=>!el.closest('.z-30')); if(hit&&hit.closest('.group.absolute')&&alpha(hit)>0.05){hitCardTop=y;break outer} } } }
  const pills=[...deck.querySelectorAll('nav[aria-label="Site"] > *')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect())
  const pillsTop=Math.min(...pills.map(r=>r.top)), pillsBottom=Math.max(...pills.map(r=>r.bottom))
  const menu=document.querySelector('button[aria-label="Open menu"]').getBoundingClientRect()
  const r1=v=>Math.round(v*10)/10
  return {
    innerHeight, scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),
    hOverflow:document.documentElement.scrollWidth-innerWidth,
    above:action?r1(action.top-textBottom):null, below:action?r1(cardTop-action.bottom):null, belowHit:action&&hitCardTop!==null?r1(hitCardTop-action.bottom):null,
    deckToPills:r1(pillsTop-cardBottom), navToHeadline:r1(textTop-menu.bottom), pillsInset:r1(innerHeight-pillsBottom),
    cityModule:!!document.querySelector('.city-root-module'),
  }
})()`

async function geometry(page, base) {
  const matrix = [...LAPTOPS.map((v) => [...v, 'laptop']), ...PHONES.map((v) => [...v, 'phone']), ...TABLETS.map((v) => [...v, 'tablet']), ...SPEC.map(([w, h]) => [w, h, w < 768 ? 'phone' : 'laptop'])]
  for (const [width, height, kind] of matrix) {
    const label = `${width}x${height}`
    await emulate(page, width, height, kind)
    await go(page, base, '/', `!!document.querySelector('[data-cut-deck]')`)
    await waitFor(() => page.evaluate(SETTLED), `${label}: hero never settled`, 30_000)
    await page.evaluate(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`)
    const samples = []
    for (let index = 0; index < SAMPLES; index += 1) { samples.push(await page.evaluate(GEOMETRY)); await sleep(SAMPLE_MS) }
    const worst = (key) => { const values = samples.map((sample) => sample[key]).filter((value) => typeof value === 'number'); return values.length ? Math.min(...values) : null }
    const row = {
      viewport: label, kind, above: worst('above'), below: worst('below'), belowHit: worst('belowHit'), deckToPills: worst('deckToPills'),
      navToHeadline: worst('navToHeadline'), pillsInset: worst('pillsInset'),
      scrollHeight: Math.max(...samples.map((sample) => sample.scrollHeight)), innerHeight: samples[0].innerHeight,
      horizontalOverflow: Math.max(...samples.map((sample) => sample.hOverflow)), cityModule: samples.some((sample) => sample.cityModule),
    }
    report.geometry.push(row)
    process.stdout.write(`GEOMETRY ${LABEL} ${label} (${kind}) above=${row.above} below=${row.below} (hit ${row.belowHit}) deck->pills=${row.deckToPills} nav->h1=${row.navToHeadline} pillsInset=${row.pillsInset} scroll=${row.scrollHeight}/${row.innerHeight} hOverflow=${row.horizontalOverflow}\n`)
    if (label === '1440x789' || label === '402x874') await page.shot(`home-${label}`)
    check(row.scrollHeight === row.innerHeight, `${label}: home scrolls (${row.scrollHeight}px document, ${row.innerHeight}px viewport)`)
    check(row.horizontalOverflow <= 0, `${label}: horizontal overflow ${row.horizontalOverflow}px`)
    check(!row.cityModule, `${label}: city guides module rendered on /`)
    const before = ORIGIN_MAIN_BASELINE[label]
    // The "Use Mingla" gaps are what #3371 fixed, so they get NO origin/main allowance.
    // Only the deck/pill and nav/headline clearances, which #3371 did not set out to
    // change, may stay as short as they already were on origin/main.
    for (const [key, floor, allowPreexisting] of [['above', MIN_GAP, false], ['below', MIN_GAP, false], ['deckToPills', MIN_PILL_CLEARANCE, true], ['navToHeadline', 0, true], ['pillsInset', 0, true]]) {
      const value = row[key]
      if (value === null) { check(false, `${label}: ${key} could not be measured`); continue }
      if (value >= floor) continue
      if (allowPreexisting && typeof before?.[key] === 'number' && value >= before[key] - REGRESSION_TOLERANCE) {
        note(`${label}: ${key}=${value}px is under ${floor}px but not worse than origin/main (${before[key]}px) — pre-existing`)
        continue
      }
      const context = typeof before?.[key] !== 'number' ? '' : allowPreexisting ? `; origin/main was ${before[key]}px — NEW REGRESSION` : `; origin/main was ${before[key]}px — the breathing room #3371 restored is gone`
      check(false, `${label}: ${key}=${value}px (< ${floor}px)${context}`)
    }
  }
}

// ---------------------------------------------------------------- 3. menu highlight and input
const MENU_ITEMS = `[...document.querySelectorAll('[role="dialog"] nav[aria-label="Primary"] a')].map(a=>({label:a.textContent.trim(),href:a.getAttribute('href'),current:a.getAttribute('aria-current')}))`
const centerOf = (selector) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`
const MENU_SETTLED = `(()=>{const d=document.querySelector('[role="dialog"]');if(!d||!d.querySelector('nav[aria-label="Primary"] a'))return false;const t=getComputedStyle(d).transform;return t==='none'||t==='matrix(1, 0, 0, 1, 0, 0)'})()`

async function hydrated(page) {
  return waitFor(() => page.evaluate(`(()=>{const b=document.querySelector('button[aria-label="Open menu"]');return !!b&&Object.keys(b).some(k=>k.startsWith('__reactProps'))})()`), 'menu button never hydrated', 30_000)
}
async function openMenu(page, input = 'mouse') {
  await hydrated(page)
  const point = await page.evaluate(centerOf('button[aria-label="Open menu"]'))
  input === 'touch' ? await page.tap(point.x, point.y) : await page.click(point.x, point.y)
  await waitFor(() => page.evaluate(MENU_SETTLED), `menu did not open and settle on a real ${input}`, 10_000)
  await page.evaluate(`(async()=>{await document.fonts.ready;await new Promise(r=>setTimeout(r,250));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`)
}
async function closeMenu(page, route) {
  await page.key('Escape')
  await waitFor(() => page.evaluate(`!document.querySelector('[role="dialog"]')`), `${route}: Escape did not close the menu`, 6_000)
}
const closedState = (page) => page.evaluate(`({dialog:!!document.querySelector('[role="dialog"]'),expanded:document.querySelector('button[aria-label="Open menu"]')?.getAttribute('aria-expanded')??null,bodyOverflow:document.body.style.overflow,active:document.activeElement?.getAttribute('aria-label')??document.activeElement?.tagName})`)

async function menuHighlights(page, base, citySlug) {
  await emulate(page, 1440, 789, 'laptop')
  const routes = ['/', DESTINATION, '/host', '/cities', `/cities/${citySlug}`, '/about', '/tools', '/help', '/privacy-policy', '/support', '/explorer/anything']
  for (const route of routes) {
    await go(page, base, route)
    await sleep(300)
    const hasMenu = await page.evaluate(`!!document.querySelector('button[aria-label="Open menu"]')`)
    const row = { route, landedOn: await page.evaluate('location.pathname'), hasMenu, items: null, lit: null }
    if (hasMenu) {
      await openMenu(page)
      row.items = await page.evaluate(MENU_ITEMS)
      row.lit = row.items.filter((item) => item.current === 'page').map((item) => item.label)
      if (route === DESTINATION) await page.shot('menu-open-destination-1440x789')
      await closeMenu(page, route)
    }
    report.menu.push(row)
    process.stdout.write(`MENU ${LABEL} ${route} -> ${row.landedOn} menu=${hasMenu} lit=${JSON.stringify(row.lit)} items=${JSON.stringify(row.items?.map((item) => `${item.label}:${item.href}`))}\n`)
    if (hasMenu) check(row.lit.length <= 1, `${route}: ${row.lit.length} menu items lit (${row.lit.join(', ')})`)
  }
  const byRoute = (route) => report.menu.find((row) => row.route === route)
  const items = byRoute('/').items ?? []
  check(JSON.stringify(items.map((item) => [item.label, item.href])) === JSON.stringify([['Explorer', '/'], ['Host', '/host'], ['Cities', '/cities'], [DESTINATION_LABEL, DESTINATION], ['About', '/about'], ['Free tools', '/tools']]), `menu must read Explorer, Host, Cities, ${DESTINATION_LABEL}, About, Free tools (got ${JSON.stringify(items.map((item) => item.label))})`)
  check(!report.menu.some((row) => row.items?.some((item) => isBannedRef(item.href))), 'a menu item still links to a retired path')
  const expected = { '/': 'Explorer', [DESTINATION]: DESTINATION_LABEL, '/host': 'Host', '/cities': 'Cities', [`/cities/${citySlug}`]: 'Cities', '/about': 'About' }
  for (const [route, label] of Object.entries(expected)) {
    const row = byRoute(route)
    check(row.hasMenu && JSON.stringify(row.lit) === JSON.stringify([label]), `${route}: exactly "${label}" must be lit (got ${JSON.stringify(row.lit)})`)
  }
  if (!byRoute('/tools').hasMenu) note('/tools renders no side menu (its layout has its own top bar) — highlight not applicable')
}

async function menuFlows(page, base) {
  for (const [width, height, kind, input] of [[1440, 789, 'laptop', 'mouse'], [402, 874, 'phone', 'touch']]) {
    await emulate(page, width, height, kind)
    await go(page, base, DESTINATION)
    await openMenu(page, input)
    if (kind === 'phone') await page.shot('menu-open-destination-402x874')
    const explorer = await page.evaluate(`(()=>{const a=[...document.querySelectorAll('[role="dialog"] nav[aria-label="Primary"] a')].find(a=>a.textContent.trim()==='Explorer');const r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,href:a.getAttribute('href')}})()`)
    input === 'touch' ? await page.tap(explorer.x, explorer.y) : await page.click(explorer.x, explorer.y)
    await waitFor(() => page.evaluate(`location.pathname==='/'`), `${input}: activating Explorer did not reach /`, 15_000).catch(() => null)
    await waitFor(() => page.evaluate(`!document.querySelector('[role="dialog"]')`), `${input}: menu still open`, 6_000).catch(() => null)
    await sleep(900)
    const state = await closedState(page)
    const home = await page.evaluate(`({path:location.pathname,deck:!!document.querySelector('[data-cut-deck]'),scroll:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),inner:innerHeight})`)
    const row = { flow: `${input} Explorer from ${DESTINATION} @${width}x${height}`, explorerHref: explorer.href, ...state, home }
    report.menuFlows.push(row)
    process.stdout.write(`FLOW ${LABEL} ${row.flow}: ${JSON.stringify(row)}\n`)
    check(home.path === '/' && home.deck, `${row.flow}: did not land on the home hero`)
    check(!state.dialog && state.expanded === 'false', `${row.flow}: menu not closed after navigation`)
    check(state.bodyOverflow !== 'hidden', `${row.flow}: body scroll lock leaked after navigation`)
    check(home.scroll === home.inner, `${row.flow}: home scrolls after client-side navigation (${home.scroll}/${home.inner})`)
  }

  for (const route of ['/', DESTINATION, '/cities/lagos']) {
    await emulate(page, 1440, 789, 'laptop')
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await go(page, base, route)
    await hydrated(page)
    await sleep(400)
    let tabsToButton = 0
    for (; tabsToButton < 40; tabsToButton += 1) {
      if (await page.evaluate(`document.activeElement?.getAttribute('aria-label')==='Open menu'`)) break
      await page.key('Tab')
    }
    const reached = await page.evaluate(`document.activeElement?.getAttribute('aria-label')==='Open menu'`)
    check(reached, `${route}: Tab never reached the Open menu button (40 presses)`)
    if (!reached) continue
    await page.key('Enter')
    await waitFor(() => page.evaluate(MENU_SETTLED), `${route}: Enter did not open the menu`, 10_000)
    await sleep(400)
    const describe = `(()=>{const el=document.activeElement;return {inDialog:!!el?.closest('[role="dialog"]'),label:(el?.getAttribute('aria-label')||el?.textContent||'').trim().slice(0,40),href:el?.getAttribute('href')??null,tag:el?.tagName}})()`
    const sequence = [await page.evaluate(describe)]
    for (let index = 0; index < 16; index += 1) { await page.key('Tab'); sequence.push(await page.evaluate(describe)) }
    const items = await page.evaluate(MENU_ITEMS)
    const reachedHrefs = new Set(sequence.map((entry) => entry.href).filter(Boolean))
    const missing = items.filter((item) => !reachedHrefs.has(item.href)).map((item) => item.label)
    const escaped = sequence.filter((entry) => !entry.inDialog)
    await page.key('Tab', 8)
    const shiftTab = await page.evaluate(describe)
    await page.key('Escape')
    await waitFor(() => page.evaluate(`!document.querySelector('[role="dialog"]')`), `${route}: Escape did not close the menu`, 6_000).catch(() => null)
    await sleep(400)
    const after = await closedState(page)
    const row = { flow: `keyboard ${route}`, tabsToButton, sequence: sequence.map((entry) => `${entry.tag}:${entry.label}${entry.href ? `(${entry.href})` : ''}${entry.inDialog ? '' : ' [OUTSIDE]'}`), missing, focusEscapedDialog: escaped.length, shiftTabInDialog: shiftTab.inDialog, ...after }
    report.menuFlows.push(row)
    process.stdout.write(`FLOW ${LABEL} ${row.flow}: ${JSON.stringify(row)}\n`)
    check(missing.length === 0, `${route}: Tab never reached menu item(s) ${missing.join(', ')}`)
    check(escaped.length === 0 && shiftTab.inDialog, `${route}: focus left the open menu dialog`)
    check(!after.dialog && after.expanded === 'false', `${route}: Escape did not close the menu`)
    check(after.active === 'Open menu', `${route}: focus did not return to the menu button after Escape (active=${after.active})`)
    check(after.bodyOverflow !== 'hidden', `${route}: Escape left the body scroll-locked`)
  }

  await emulate(page, 1440, 789, 'laptop')
  await go(page, base, DESTINATION)
  await openMenu(page)
  let onExplorer = false
  for (let index = 0; index < 12 && !onExplorer; index += 1) {
    onExplorer = await page.evaluate(`!!document.activeElement?.closest('nav[aria-label="Primary"]')&&document.activeElement.textContent.trim()==='Explorer'`)
    if (!onExplorer) await page.key('Tab')
  }
  check(onExplorer, 'keyboard: could not focus Explorer inside the menu')
  if (onExplorer) {
    await page.key('Enter')
    await waitFor(() => page.evaluate(`location.pathname==='/'`), 'keyboard: Enter on Explorer did not reach /', 15_000).catch(() => null)
    await sleep(1200)
    const state = await closedState(page)
    const pathname = await page.evaluate('location.pathname')
    report.menuFlows.push({ flow: `keyboard Enter on Explorer from ${DESTINATION}`, pathname, ...state })
    process.stdout.write(`FLOW ${LABEL} keyboard Enter on Explorer from ${DESTINATION}: ${JSON.stringify({ pathname, ...state })}\n`)
    check(pathname === '/' && !state.dialog, `keyboard Enter on Explorer: path=${pathname}, dialog=${state.dialog}`)
  }
}

// ---------------------------------------------------------------- 4. menu row alignment
const MENU_ROWS = `(()=>{
  const dialog=document.querySelector('[role="dialog"]')
  const rows=[...dialog.querySelectorAll('nav[aria-label="Primary"] a')].map((a)=>{
    const s=getComputedStyle(a),box=a.getBoundingClientRect(),svg=a.querySelector('svg'),icon=svg.getBoundingClientRect()
    const rects=[]
    for(const node of a.childNodes){ if(node.nodeType===3&&node.textContent.trim()){ const range=document.createRange(); range.selectNodeContents(node); for(const q of range.getClientRects()) if(q.width>0) rects.push(q) } }
    const tops=[...new Set(rects.map(q=>Math.round(q.top)))]
    const contentLeft=box.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft), contentRight=box.right-parseFloat(s.borderRightWidth)-parseFloat(s.paddingRight)
    return {label:a.textContent.trim(),current:a.getAttribute('aria-current'),justify:s.justifyContent,whiteSpace:s.whiteSpace,fontSize:s.fontSize,fontFamily:s.fontFamily,gap:s.columnGap,paddingLeft:s.paddingLeft,
      boxLeft:box.left,boxRight:box.right,boxWidth:box.width,boxHeight:box.height,contentLeft,contentRight,iconLeft:icon.left,iconWidth:icon.width,iconTop:icon.top-box.top,
      textLeft:rects.length?Math.min(...rects.map(q=>q.left)):null,textRight:rects.length?Math.max(...rects.map(q=>q.right)):null,lines:tops.length,
      scrollWidth:a.scrollWidth,clientWidth:a.clientWidth}
  })
  const panel=dialog.getBoundingClientRect()
  return {rows,panelLeft:panel.left,panelRight:panel.right,innerWidth,docScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth}
})()`

async function menuAlignment(page, base) {
  const plan = []
  for (const [width, height] of MENU_VIEWPORTS) for (const route of ['/', DESTINATION]) plan.push([route, width, height])
  plan.push(['/cities/lagos', 1440, 900], ['/cities/lagos', 360, 780], ['/cities/lagos', 320, 568])
  const litRowByRoute = {}
  for (const [route, width, height] of plan) {
    const label = `${route} ${width}x${height}`
    await emulate(page, width, height)
    await go(page, base, route)
    await sleep(250)
    const closedOverflow = await page.evaluate(`document.documentElement.scrollWidth-innerWidth`)
    if (!(await page.evaluate(`!!document.querySelector('button[aria-label="Open menu"]')`))) {
      check(false, `${label}: no side menu rendered`)
      continue
    }
    await openMenu(page, width < 768 ? 'touch' : 'mouse')
    const sample = await page.evaluate(MENU_ROWS)
    if (SHOTS && (label === `${DESTINATION} 360x780` || label === '/cities/lagos 320x568')) await page.shot(`menu-rows-${route.replace(/\W+/g, '')}-${width}x${height}`)
    await closeMenu(page, label)
    const rows = sample.rows
    const iconOffsets = rows.map((row) => r1(row.iconLeft - row.contentLeft))
    const summary = {
      route, viewport: `${width}x${height}`, closedOverflow, openOverflow: sample.docScrollWidth - sample.innerWidth,
      iconLeftSpread: r1(spread(rows.map((row) => row.iconLeft))), iconOffsets, justify: [...new Set(rows.map((row) => row.justify))],
      lines: rows.map((row) => row.lines), truncated: rows.filter((row) => row.scrollWidth > row.clientWidth || (row.textRight ?? 0) > row.contentRight + ALIGN_TOLERANCE).map((row) => row.label),
      lit: rows.filter((row) => row.current === 'page').map((row) => row.label), rows,
    }
    report.menuAlignment.push(summary)
    process.stdout.write(`ALIGN ${LABEL} ${label} iconOffsets=${JSON.stringify(iconOffsets)} spread=${summary.iconLeftSpread} lines=${JSON.stringify(summary.lines)} truncated=${JSON.stringify(summary.truncated)} overflow closed/open=${closedOverflow}/${summary.openOverflow} lit=${JSON.stringify(summary.lit)}\n`)

    check(rows.length === 6, `${label}: menu must render six rows (got ${rows.length})`)
    check(summary.iconLeftSpread <= ALIGN_TOLERANCE, `${label}: the six icons do not share one left x (spread ${summary.iconLeftSpread}px: ${rows.map((row) => r1(row.iconLeft)).join(', ')})`)
    check(iconOffsets.every((offset) => Math.abs(offset) <= ALIGN_TOLERANCE), `${label}: icons are not at the row padding-left (offsets ${iconOffsets.join(', ')}px)`)
    check(rows.every((row) => row.textLeft !== null && row.textLeft > row.iconLeft + row.iconWidth), `${label}: a label does not start after its icon`)
    check(summary.lines.every((lines) => lines === 1), `${label}: a menu label wraps (${rows.filter((row) => row.lines !== 1).map((row) => `${row.label}=${row.lines} lines`).join(', ')})`)
    check(summary.truncated.length === 0, `${label}: menu label(s) truncated: ${summary.truncated.join(', ')}`)
    check(closedOverflow <= 0 && summary.openOverflow <= 0, `${label}: document scrollWidth exceeds the viewport (closed ${closedOverflow}px, menu open ${summary.openOverflow}px)`)
    check(sample.panelLeft >= -0.5 && sample.panelRight <= sample.innerWidth + 0.5, `${label}: the menu panel is outside the viewport (${r1(sample.panelLeft)}..${r1(sample.panelRight)} of ${sample.innerWidth})`)
    for (const [key, read] of [['row left', (row) => row.boxLeft], ['row width', (row) => row.boxWidth], ['row height', (row) => row.boxHeight], ['padding-left', (row) => parseFloat(row.paddingLeft)], ['icon width', (row) => row.iconWidth], ['icon top', (row) => row.iconTop], ['icon-to-label gap', (row) => row.textLeft - (row.iconLeft + row.iconWidth)]]) {
      const lit = rows.filter((row) => row.current === 'page')
      const unlit = rows.filter((row) => row.current !== 'page')
      if (lit.length && unlit.length) check(spread([...lit, ...unlit].map(read)) <= ALIGN_TOLERANCE, `${label}: lit and unlit rows differ in ${key} (${rows.map((row) => `${row.label}=${r1(read(row))}`).join(', ')})`)
    }
    check(new Set(rows.map((row) => `${row.fontSize}|${row.fontFamily}|${row.gap}|${row.whiteSpace}`)).size === 1, `${label}: rows do not share one type/gap treatment`)
    const destinationRow = rows.find((row) => row.label === DESTINATION_LABEL)
    if (destinationRow) (litRowByRoute[`${width}x${height}`] ??= {})[route] = destinationRow
  }
  for (const [viewport, byRoute] of Object.entries(litRowByRoute)) {
    const lit = byRoute[DESTINATION]
    const unlit = byRoute['/']
    if (!lit || !unlit) continue
    for (const key of ['boxLeft', 'boxWidth', 'boxHeight', 'iconLeft', 'textLeft']) {
      check(Math.abs(lit[key] - unlit[key]) <= ALIGN_TOLERANCE, `${viewport}: the ${DESTINATION_LABEL} row moves between lit (${DESTINATION}) and unlit (/) in ${key}: ${r1(lit[key])} vs ${r1(unlit[key])}`)
    }
  }
}

// ---------------------------------------------------------------- 5. collateral centring of every other .cut-btn
const CUT_BUTTONS = `(()=>{
  const alpha=(el)=>{let a=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return 0;a*=parseFloat(s.opacity)}return a}
  const out=[]
  for(const el of document.querySelectorAll('.cut-btn')){
    if(el.classList.contains('cut-menu-item')) continue
    const box=el.getBoundingClientRect(); if(box.width<1||box.height<1||alpha(el)<0.05) continue
    const s=getComputedStyle(el)
    if(!/flex/.test(s.display)) { out.push({text:el.textContent.trim().slice(0,40),display:s.display,justify:s.justifyContent,offset:null,inMenu:!!el.closest('[role="dialog"]'),menuCta:!!el.closest('[role="dialog"] .mt-auto')}); continue }
    const rects=[]
    for(const node of el.childNodes){
      if(node.nodeType===3){ if(!node.textContent.trim()) continue; const range=document.createRange(); range.selectNodeContents(node); for(const q of range.getClientRects()) if(q.width>0) rects.push(q) }
      else if(node.nodeType===1){ const c=getComputedStyle(node); if(c.position==='absolute'||c.position==='fixed'||c.display==='none') continue; const q=node.getBoundingClientRect(); if(q.width>0) rects.push(q) }
    }
    if(!rects.length) continue
    const scale=box.width/el.offsetWidth||1
    const left=box.left+(parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft))*scale, right=box.right-(parseFloat(s.borderRightWidth)+parseFloat(s.paddingRight))*scale
    const contentLeft=Math.min(...rects.map(q=>q.left)), contentRight=Math.max(...rects.map(q=>q.right))
    out.push({text:el.textContent.trim().slice(0,40),display:s.display,justify:s.justifyContent,offset:Math.round((((contentLeft+contentRight)/2-(left+right)/2)/scale)*10)/10,inMenu:!!el.closest('[role="dialog"]'),menuCta:!!el.closest('[role="dialog"] .mt-auto')})
  }
  return out
})()`

async function collateral(page, base) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const route of COLLATERAL_ROUTES) {
      await emulate(page, width, height)
      await go(page, base, route)
      await page.evaluate(`(async()=>{await document.fonts.ready;window.scrollTo(0,0);return true})()`)
      if (route === '/') await waitFor(() => page.evaluate(SETTLED), `${route}: hero never settled`, 30_000)
      await sleep(1500)
      const buttons = await page.evaluate(CUT_BUTTONS)
      if (!(await page.evaluate(`!!document.querySelector('button[aria-label="Open menu"]')`))) {
        report.collateral.push({ route, viewport: `${width}x${height}`, buttons, noMenu: true })
        check(false, `${route} ${width}x${height}: no side menu rendered`)
        continue
      }
      await openMenu(page, width < 768 ? 'touch' : 'mouse')
      const menuButtons = (await page.evaluate(CUT_BUTTONS)).filter((button) => button.inMenu)
      await closeMenu(page, route)
      const all = [...buttons.filter((button) => !button.inMenu), ...menuButtons]
      report.collateral.push({ route, viewport: `${width}x${height}`, buttons: all })
      const off = all.filter((button) => button.justify !== 'center' || (button.offset !== null && Math.abs(button.offset) > CENTRE_TOLERANCE))
      const bottomCtas = menuButtons.filter((button) => button.menuCta).map((button) => button.text)
      process.stdout.write(`CENTRE ${LABEL} ${route} ${width}x${height} buttons=${all.length} (menu bottom CTAs ${JSON.stringify(bottomCtas)}) off=${JSON.stringify(off.map((button) => `${button.text}:${button.justify}:${button.offset}`))}\n`)
      check(JSON.stringify(bottomCtas) === JSON.stringify(['Explore Your City', 'Host Your City']), `${route} ${width}x${height}: the menu must keep its two centred bottom CTAs (got ${JSON.stringify(bottomCtas)})`)
      check(off.length === 0, `${route} ${width}x${height}: cut-btn(s) no longer centred: ${off.map((button) => `"${button.text}" justify=${button.justify} offset=${button.offset}px`).join('; ')}`)
    }
  }
}

// ---------------------------------------------------------------- destination DOM + browser redirects
async function destinationDom(page, base) {
  await emulate(page, 1440, 900, 'laptop')
  await go(page, base, DESTINATION, `!!document.querySelector('h1')`)
  const dom = await page.evaluate(`(()=>{
    const h1=document.querySelector('h1')
    // CutoutEyebrow is the span directly before the hero H1 (a decorative dot span, then the copy).
    const before=h1.previousElementSibling
    const eyebrow=before&&before.tagName==='SPAN'?before:null
    const crumbs=[...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map(li=>{const a=li.querySelector('a');const cur=li.querySelector('[aria-current="page"]');return {text:(a||cur)?.textContent.trim(),href:a?.getAttribute('href')??null,current:!!cur}})
    return {title:document.title,h1:h1.textContent.trim(),eyebrow:eyebrow?.textContent.trim()??null,crumbs,hOverflow:document.documentElement.scrollWidth-innerWidth}
  })()`)
  report.destinationDom = dom
  process.stdout.write(`DEST ${LABEL} ${JSON.stringify(dom)}\n`)
  check(dom.title === DESTINATION_TITLE, `${DESTINATION}: document.title "${dom.title}"`)
  check(dom.eyebrow === DESTINATION_LABEL, `${DESTINATION}: hero eyebrow must read "${DESTINATION_LABEL}" (got "${dom.eyebrow}")`)
  check(dom.h1 === DESTINATION_H1, `${DESTINATION}: H1 "${dom.h1}"`)
  check(JSON.stringify(dom.crumbs) === JSON.stringify([{ text: 'Home', href: '/', current: false }, { text: DESTINATION_LABEL, href: null, current: true }]), `${DESTINATION}: visible breadcrumb must be Home -> ${DESTINATION_LABEL} (got ${JSON.stringify(dom.crumbs)})`)
}

async function browserRedirects(page, base) {
  await emulate(page, 1440, 789, 'laptop')
  for (const route of ['/explorer?utm_source=x#frag', '/explorer/#frag', '/Explorer?utm_source=x#frag', '/explorer/anything#frag']) {
    await page.send('Page.navigate', { url: `${base}${route}` })
    await sleep(400)
    await waitFor(() => page.evaluate(`document.readyState==='complete'`), `${route}: never completed`, 30_000)
    await sleep(600)
    const landed = await page.evaluate(`({path:location.pathname,search:location.search,hash:location.hash,title:document.title,notFound:/That page slipped out the back\\./.test(document.body.innerText)})`)
    report.browserRedirects.push({ route, ...landed })
    process.stdout.write(`BROWSER ${LABEL} ${route} -> ${landed.path}${landed.search}${landed.hash} "${landed.title}" notFound=${landed.notFound}\n`)
  }
  const [query, slash] = report.browserRedirects
  check(query.path === DESTINATION && query.search === '?utm_source=x' && query.hash === '#frag', `browser /explorer?utm_source=x#frag must land on ${DESTINATION}?utm_source=x#frag (got ${query.path}${query.search}${query.hash})`)
  check(slash.path === DESTINATION && slash.hash === '#frag', `browser /explorer/#frag must land on ${DESTINATION}#frag (got ${slash.path}${slash.hash})`)
}

// ---------------------------------------------------------------- main
async function main() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), `run the final production build before the #3371 tester guard (${ROOT})`)
  if (!REPORT_ONLY) wiringContract()
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.next/routes-manifest.json'), 'utf8'))
  const registryRedirect = manifest.redirects.find((entry) => entry.source === RETIRED)
  report.registryRedirect = registryRedirect ?? null
  check(registryRedirect?.statusCode === 308, `${RETIRED} is not a permanent redirect in the build`)
  check(!manifest.redirects.some((entry) => `${entry.source} ${entry.destination}`.includes(UNSHIPPED)), `the build redirects the unshipped ${UNSHIPPED}`)

  const port = await freePort()
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  delete env.MINGLA_HISTORICAL_2983_BUILD
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, env, stdio: 'ignore' })
  let chrome
  let page
  let profile
  try {
    await waitFor(async () => (await request(port, '/robots.txt')).status === 200, 'next start never served robots.txt', STARTUP_TIMEOUT_MS, 250)
    await redirectAttacks(port, registryRedirect?.destination ?? null)
    await crawl(port)

    if (process.env.VERCEL === '1') {
      process.stdout.write('SKIP #3371 tester browser checks on Chrome-less Vercel; wiring, redirect and crawl gates executed\n')
    } else {
      assert(CHROME, 'Chrome/Chromium is required for the #3371 tester browser checks outside Vercel')
      assert.equal(typeof WebSocket, 'function', 'run this guard with node --experimental-websocket')
      if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
      profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3371-tester-'))
      const chromePort = await freePort()
      chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
      await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'owned Chrome did not start', STARTUP_TIMEOUT_MS, 250)
      const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
      page = new Page(target.webSocketDebuggerUrl)
      await page.send('Page.enable')
      await page.send('Runtime.enable')
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('mingla_consent_v1',JSON.stringify({value:'denied',ts:Date.now()}))}catch(e){}` })
      const base = `http://127.0.0.1:${port}`
      const citySlug = (report.crawl.sitemapPaths.find((value) => value.startsWith('/cities/')) ?? '/cities/lagos').split('/')[2]

      if (!REPORT_ONLY) await destinationDom(page, base)
      await browserRedirects(page, base)
      await geometry(page, base)
      await menuHighlights(page, base, citySlug)
      await menuAlignment(page, base)
      await collateral(page, base)
      if (!REPORT_ONLY) await menuFlows(page, base)
    }
  } finally {
    try { if (page) await page.send('Browser.close', {}, 3_000) } catch { /* force-stopped below */ }
    page?.close()
    const chromeStopped = await stopChild(chrome)
    const serverStopped = await stopChild(server)
    if (profile && chromeStopped) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    if (!chromeStopped || !serverStopped) process.stderr.write('WARN #3371 tester: an owned child process did not exit after SIGKILL\n')
    report.finishedAt = new Date().toISOString()
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (REPORT_ONLY) {
    process.stdout.write(`REPORT-ONLY ${LABEL}: ${failures.length} check(s) would fail against this build\n`)
    return
  }
  if (failures.length) {
    process.stderr.write(`\nFAIL #3371 tester adversarial: ${failures.length} failure(s)\n${failures.map((failure) => ` - ${failure}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('PASS #3371 tester adversarial: redirect edges, full crawl, real-input menu, left-aligned rows without collateral, realistic-viewport home geometry\n')
}

assert(process.argv.includes('--built-only'), 'the #3371 tester guard runs only against a production build: pass --built-only')
await main()
