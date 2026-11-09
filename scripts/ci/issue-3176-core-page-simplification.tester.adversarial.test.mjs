#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Independent angle: verify the rendered geometry and crawler-visible output
// instead of accepting the implementation's source-shape declarations.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const SCREENSHOT_DIR = process.env.MINGLA_QA_SCREENSHOT_DIR
const WIDTHS = [320, 390, 640, 768, 1024, 1440]
const SLUGS = ['lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city', 'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc']
const CITY_NAMES = ['Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City', 'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington, DC']
const REMOVED_COPY = [
  'Reviewed by the Mingla team',
  'How Mingla publishes information',
  'Contact and corrections',
  'What Mingla can and cannot verify',
  'Product record',
  'Why a city may not be linked yet',
  'Corrections and local knowledge',
  'Policy record',
  'City guide in review',
  'Sources checked',
  'Evidence before promotion',
]
const HUB_ANNOTATIONS = ['Sources:', 'How this list was checked', 'Last reviewed', 'Next evergreen review', 'Directory ID', 'Review status']
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const css = source('mingla-marketing/components/core-pages/core-pages.css')
  const packageJson = JSON.parse(source('mingla-marketing/package.json'))
  const forcedPillStack = /\.core-city-pills\s+(?:li|a)(?:\s*,\s*\.core-city-pills\s+(?:li|a))*\s*\{[^{}]*\bwidth\s*:\s*100%/i

  assert.doesNotMatch(css, forcedPillStack, 'REGRESSION: 320px hero pills were forced into a ten-row stack')
  assert.match(css, /\.core-city-pills\s+ul\s*\{[^}]*flex-wrap\s*:\s*wrap/i, 'city pills must keep natural wrapping')
  assert.match(css, /\.core-city-pills\s+a\s*\{[^}]*min-height\s*:\s*44px/i, 'city pills must keep 44px targets')
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i, 'reduced-motion handling must remain explicit')
  assert.match(packageJson.scripts['test:issue-3176'], new RegExp(`${SELF.replaceAll('.', '\\.') } --source-only`), 'focused #3176 suite must run the tester source guard')
  assert.match(packageJson.scripts.build, new RegExp(`${SELF.replaceAll('.', '\\.') } --source-only`), 'build must run the tester source guard')
  assert.equal(packageJson.scripts['test:issue-3176:tester'], `node --experimental-websocket ../scripts/ci/${SELF}`, 'focused tester runtime command must remain available')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function waitForChildExit(child, timeoutMs, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => { child.removeListener('exit', onExit); reject(new Error(`${label} did not stop`)) }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const term = waitForChildExit(child, 2_000, 'owned child')
  child.kill('SIGTERM')
  try { await term } catch {
    if (child.exitCode !== null || child.signalCode !== null) return
    const kill = waitForChildExit(child, 2_000, 'owned child after SIGKILL')
    child.kill('SIGKILL')
    await kill
  }
}

async function waitFor(check, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`${label}${last ? `: ${last.message}` : ''}`)
}

class CdpPage {
  constructor(webSocketUrl) {
    this.id = 0
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
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
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 25_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }
  close() { this.socket.close() }
}

function request(port, pathname, userAgent = 'Mozilla/5.0 MinglaTester/1.0') {
  return fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { 'user-agent': userAgent } })
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function runtimeContract() {
  assert(CHROME, 'Chrome/Chromium is required for the #3176 tester runtime guard')
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'run the current production build before the #3176 tester runtime guard')
  const appPort = await freePort()
  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-tester-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    cwd: MARKETING,
    env: { ...process.env, MINGLA_HISTORICAL_2983_BUILD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let page
  try {
    await waitFor(async () => (await request(appPort, '/robots.txt')).status === 200, 'Next server did not start')
    let target
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`)
      const targets = await response.json()
      target = targets.find((candidate) => candidate.type === 'page')
      return Boolean(target?.webSocketDebuggerUrl)
    }, 'Chrome debugger did not start')
    page = new CdpPage(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('mingla_consent_v1', JSON.stringify({value:'denied',ts:Date.now()}))`,
    })

    let citiesLoaded = false
    for (const width of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false })
      await page.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      if (!citiesLoaded) {
        await page.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/cities` })
        citiesLoaded = true
      }
      // #4339 phase 2b: /cities is the redesigned tile grid (one tile per
      // registry city, picked clip or licensed photo). The #3176 hero/pill
      // geometry is retired with that hero; the tile grid is held to the same
      // bars: no overflow, canonical names in order, 44px targets, the 16px
      // gutters, and no motion under prefers-reduced-motion.
      await waitFor(() => page.evaluate("document.readyState==='complete'&&document.querySelectorAll('.city-tiles a').length===10"), `${width}px /cities did not settle`)
      await page.evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()')
      const geometry = await page.evaluate(`(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}}
        const tiles=[...document.querySelectorAll('.city-tiles a')]
        const h1=document.querySelector('main h1')
        const grid=getComputedStyle(document.querySelector('.city-tiles')).gridTemplateColumns.split(' ').filter(Boolean).length
        const media=getComputedStyle(document.querySelector('.city-tiles .ph > *'))
        return {tiles:tiles.map(box),tileText:tiles.map(t=>t.innerText.trim()),h1:{...box(h1),clientWidth:h1.clientWidth,scrollWidth:h1.scrollWidth},grid,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,mediaTransition:media.transitionDuration,mediaAnimation:media.animationName}
      })()`)
      assert.equal(geometry.overflow, 0, `${width}px /cities has horizontal overflow`)
      assert.equal(geometry.tiles.length, 10, `${width}px /cities needs ten tiles`)
      assert.deepEqual(geometry.tileText, CITY_NAMES, `${width}px tiles must expose only the canonical city names in order`)
      assert(geometry.h1.scrollWidth <= geometry.h1.clientWidth + 1 && geometry.h1.left >= 16 && geometry.h1.right <= width - 16, `${width}px headline is clipped or inside the 16px gutter: ${JSON.stringify(geometry.h1)}`)
      assert(geometry.tiles.every((tile) => tile.height >= 44 && tile.width >= 44 && tile.left >= 16 && tile.right <= width - 16), `${width}px a city tile lost its 44px target or the 16px gutter`)
      const expectedColumns = width > 1000 ? 5 : width > 640 ? 3 : 2
      assert.equal(geometry.grid, expectedColumns, `${width}px city grid column count`)
      assert(Math.abs(geometry.tiles[0].width / geometry.tiles[0].height - 3 / 4) < 0.015, `${width}px city tile aspect ratio`)
      assert.equal(geometry.mediaAnimation, 'none', `${width}px reduced-motion tile animation`)
      assert(['0s', '0.00001s', '1e-05s'].includes(geometry.mediaTransition), `${width}px reduced-motion transition remained ${geometry.mediaTransition}`)
      if (width === 320) process.stdout.write(`EVIDENCE #3176/#4339 tester 320px tiles ${JSON.stringify({ h1: geometry.h1, tiles: geometry.tiles.slice(0, 2) })}\n`)
      if (SCREENSHOT_DIR && [320, 1440].includes(width)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        const capture = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
        fs.writeFileSync(path.join(SCREENSHOT_DIR, `cities-${width}.png`), Buffer.from(capture.data, 'base64'))
      }
    }

    const browserAgent = 'Mozilla/5.0 MinglaTester/1.0'
    const crawlers = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'OAI-SearchBot/1.0; +https://openai.com/searchbot',
      'Claude-SearchBot/1.0; +https://anthropic.com/claude-search-bot',
      'PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
    ]
    for (const pathname of ['/about', '/going-out', '/cities', ...SLUGS.map((slug) => `/cities/${slug}`)]) {
      const baselineResponse = await request(appPort, pathname, browserAgent)
      assert.equal(baselineResponse.status, 200, `${pathname} direct request`)
      const baselineHtml = await baselineResponse.text()
      const baseline = visibleText(baselineHtml)
      assert.match(baselineHtml, /name="robots" content="index, follow"|content="index, follow" name="robots"/i, `${pathname} approved index gate`)
      assert.match(baselineHtml, new RegExp(`<link[^>]+rel="canonical"[^>]+href="https://usemingla\\.com${pathname}"|<link[^>]+href="https://usemingla\\.com${pathname}"[^>]+rel="canonical"`, 'i'), `${pathname} self-canonical`)
      assert.match(baselineHtml, /application\/ld\+json/i, `${pathname} structured data`)
      for (const phrase of REMOVED_COPY) assert(!baseline.includes(phrase), `${pathname} renders removed annotation: ${phrase}`)
      if (pathname.startsWith('/cities/')) {
        for (const phrase of HUB_ANNOTATIONS) assert(!baseline.includes(phrase), `${pathname} renders removed hub annotation: ${phrase}`)
      }
      for (const crawler of crawlers) {
        const crawlerResponse = await request(appPort, pathname, crawler)
        assert.equal(crawlerResponse.status, 200, `${pathname} crawler status`)
        assert.equal(visibleText(await crawlerResponse.text()), baseline, `${pathname} crawler/direct material-text parity`)
      }
      if (pathname.startsWith('/cities/')) assert.equal((baselineHtml.match(/data-city-place-card/g) ?? []).length, 50, `#4137: ${pathname} must retain 50 cards`)
    }
    const directoryHtml = await (await request(appPort, '/cities')).text()
    const links = [...directoryHtml.matchAll(/<a\b[^>]*href="(\/cities\/[^"]+)"[^>]*>/g)].map((match) => match[1])
    assert.equal(links.length, 10, '/cities must expose exactly ten city tiles (#4339 phase 2b)')
    for (const slug of SLUGS) assert.equal(links.filter((href) => href === `/cities/${slug}`).length, 1, `/cities/${slug} must appear once`)
  } finally {
    page?.close()
    await stopOwned(chrome)
    await stopOwned(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
if (SELF_TEST) {
  const relative = 'mingla-marketing/components/core-pages/core-pages.css'
  const reverted = `${read(relative)}\n@media (max-width:359px){.core-city-pills li,.core-city-pills a{width:100%}}\n`
  assert.throws(() => sourceContract({ [relative]: reverted }), /forced into a ten-row stack/, 'reintroducing the 320px stack must prove RED')
  process.stdout.write('RED proof: reintroducing the 320px ten-row pill stack was rejected\n')
}
process.stdout.write('PASS #3176 tester adversarial responsive, crawler and catalogue contract\n')
